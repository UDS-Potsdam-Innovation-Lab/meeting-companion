//! Recording sessions: the consent gate, the microphone, the transcript pipeline on its own thread,
//! and the capture state the UI's recording indicator follows.
//!
//! - [`Recorder::start`] opens the microphone only for a running meeting whose stored meeting has
//!   `recording_consent_at`; otherwise it fails with [`RecordError::NoConsent`] and no source starts.
//!   It never starts on its own: only the UI's "Start recording" / "Resume" calls it.
//! - Audio goes into a bounded in-memory sink (at most 30 s) and through the [`Transcriber`] on a
//!   worker thread. Final segments are appended to the encrypted transcript before they are sent to
//!   the UI. Audio is never written anywhere.
//! - A failing or silent device (no audio for [`STALL`]) ends the session with an error state within
//!   2 s, and the source is closed.

use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::engines::audio::{AudioError, AudioSink, AudioSource};
use crate::engines::stt::{SpeechToText, SttError};
use crate::engines::{AudioFactory, SttProvider};
use crate::store::{MeetingStore, StoreError};
use crate::transcript::{Segment, Transcriber, TranscriptError, TranscriptStore, TranscriptWriter};

/// No audio for this long while recording counts as a lost device.
pub const STALL: Duration = Duration::from_millis(1_500);
/// How often the capture state (elapsed time, level) is sent while recording.
pub const TICK: Duration = Duration::from_millis(200);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Capture {
    Off,
    Recording,
    Paused,
    Error,
}

/// Why recording is not running. The UI shows a translated message for each.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Reason {
    NoMicrophone,
    MicrophoneBlocked,
    MicrophoneLost,
    NoModel,
    EngineFailed,
    StorageFailed,
    TranscriptUnreadable,
    Locked,
}

impl From<AudioError> for Reason {
    fn from(e: AudioError) -> Self {
        match e {
            AudioError::NoMicrophone => Reason::NoMicrophone,
            AudioError::Blocked => Reason::MicrophoneBlocked,
            AudioError::DeviceLost => Reason::MicrophoneLost,
        }
    }
}

impl From<SttError> for Reason {
    fn from(e: SttError) -> Self {
        match e {
            SttError::NoModel => Reason::NoModel,
            SttError::Failed => Reason::EngineFailed,
        }
    }
}

impl From<&TranscriptError> for Reason {
    fn from(e: &TranscriptError) -> Self {
        match e {
            TranscriptError::Corrupt | TranscriptError::InvalidId => Reason::TranscriptUnreadable,
            TranscriptError::KeyUnavailable => Reason::Locked,
            TranscriptError::Io(_) => Reason::StorageFailed,
        }
    }
}

/// What the recording indicator shows. Sent as the `capture-state` event and returned by commands.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureState {
    pub state: Capture,
    pub meeting_id: Option<String>,
    /// Recorded time of the meeting; paused time does not count.
    pub elapsed_ms: u64,
    /// Input level 0..1 while recording, 0 otherwise.
    pub level: f32,
    pub reason: Option<Reason>,
}

impl CaptureState {
    pub fn off() -> Self {
        Self {
            state: Capture::Off,
            meeting_id: None,
            elapsed_ms: 0,
            level: 0.0,
            reason: None,
        }
    }
}

/// A final or partial segment for the UI (`transcript-segment` event).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentEvent {
    pub meeting_id: String,
    #[serde(flatten)]
    pub segment: Segment,
}

/// Why a recording command was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RecordError {
    /// The meeting has no stored consent confirmation.
    NoConsent,
    /// The meeting has not started or has ended.
    NotRunning,
    NoMeeting,
    /// Recording could not start; the capture state shows the same reason.
    Failed {
        reason: Reason,
    },
}

/// Where the core sends events. The app emits Tauri events; tests collect them.
pub trait EventSink: Send + Sync {
    fn capture(&self, state: &CaptureState);
    fn segment(&self, event: &SegmentEvent);
}

struct Shared {
    status: Mutex<CaptureState>,
    source: Mutex<Option<Box<dyn AudioSource>>>,
    events: Arc<dyn EventSink>,
}

impl Shared {
    fn status(&self) -> MutexGuard<'_, CaptureState> {
        self.status.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn close_source(&self) {
        let source = self.source.lock().unwrap_or_else(|e| e.into_inner()).take();
        if let Some(mut s) = source {
            s.stop();
        }
    }

    fn set(&self, f: impl FnOnce(&mut CaptureState)) -> CaptureState {
        let snapshot = {
            let mut s = self.status();
            f(&mut s);
            s.clone()
        };
        self.events.capture(&snapshot);
        snapshot
    }

    fn fail(&self, reason: Reason) -> CaptureState {
        self.close_source();
        crate::log!("recording stopped: {reason:?}");
        self.set(|s| {
            s.state = Capture::Error;
            s.level = 0.0;
            s.reason = Some(reason);
        })
    }
}

/// The running worker's sink, thread and the model id its engine was loaded for.
type Worker = (AudioSink, JoinHandle<Box<dyn SpeechToText>>, Option<String>);

#[derive(Default)]
struct Inner {
    worker: Option<Worker>,
    /// A loaded engine kept between sessions, with the model id it was asked for.
    engine: Option<(Option<String>, Box<dyn SpeechToText>)>,
    /// Recorded time per meeting in this app session.
    recorded: Option<(String, u64)>,
}

pub struct Recorder {
    audio: AudioFactory,
    stt: Box<dyn SttProvider>,
    transcripts: Arc<dyn TranscriptStore>,
    now_ms: fn() -> u64,
    shared: Arc<Shared>,
    inner: Mutex<Inner>,
}

impl Recorder {
    pub fn new(
        audio: AudioFactory,
        stt: Box<dyn SttProvider>,
        transcripts: Arc<dyn TranscriptStore>,
        events: Arc<dyn EventSink>,
        now_ms: fn() -> u64,
    ) -> Self {
        Self {
            audio,
            stt,
            transcripts,
            now_ms,
            shared: Arc::new(Shared {
                status: Mutex::new(CaptureState::off()),
                source: Mutex::new(None),
                events,
            }),
            inner: Mutex::new(Inner::default()),
        }
    }

    pub fn models(&self) -> crate::engines::models::ModelList {
        self.stt.models()
    }

    pub fn transcripts(&self) -> &dyn TranscriptStore {
        self.transcripts.as_ref()
    }

    pub fn status(&self) -> CaptureState {
        self.shared.status().clone()
    }

    fn inner(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Starts (or resumes) recording `meeting_id` with the speech model `model_id` (or the preferred
    /// one). Refused without stored consent; the microphone opens last, after the model loaded.
    pub fn start(
        &self,
        meetings: &dyn MeetingStore,
        meeting_id: &str,
        model_id: Option<&str>,
    ) -> Result<CaptureState, RecordError> {
        let mut inner = self.inner();
        {
            let s = self.shared.status();
            if s.state == Capture::Recording && s.meeting_id.as_deref() == Some(meeting_id) {
                return Ok(s.clone());
            }
        }
        self.halt(&mut inner, Capture::Off, false);

        let meeting = match meetings.load(meeting_id) {
            Ok(Some(m)) => m,
            Ok(None) => return Err(RecordError::NoMeeting),
            Err(StoreError::KeyUnavailable) => return Err(self.refuse(meeting_id, Reason::Locked)),
            Err(_) => return Err(self.refuse(meeting_id, Reason::StorageFailed)),
        };
        if !meeting.run.as_ref().is_some_and(|r| r.ended_at.is_none()) {
            return Err(RecordError::NotRunning);
        }
        if meeting.recording_consent_at.is_none() {
            return Err(RecordError::NoConsent);
        }

        let writer = match self.transcripts.writer(meeting_id) {
            Ok(w) => w,
            Err(e) => {
                crate::log!("could not open the transcript: {e}");
                return Err(self.refuse(meeting_id, Reason::from(&e)));
            }
        };
        let wanted = model_id.map(str::to_owned);
        let engine = match inner.engine.take() {
            Some((id, engine)) if id == wanted => engine,
            _ => match self.stt.load(model_id) {
                Ok(e) => e,
                Err(e) => return Err(self.refuse(meeting_id, e.into())),
            },
        };

        let sink = AudioSink::new();
        let mut source = (self.audio)();
        if let Err(e) = source.start(sink.clone()) {
            inner.engine = Some((wanted, engine));
            return Err(self.refuse(meeting_id, e.into()));
        }
        *self.shared.source.lock().unwrap_or_else(|e| e.into_inner()) = Some(source);

        let base = match &inner.recorded {
            Some((id, ms)) if id == meeting_id => *ms,
            _ => writer.last_end_ms(),
        };
        let state = self.shared.set(|s| {
            *s = CaptureState {
                state: Capture::Recording,
                meeting_id: Some(meeting_id.to_owned()),
                elapsed_ms: base,
                level: 0.0,
                reason: None,
            }
        });
        let transcriber = Transcriber::new(engine, base, (self.now_ms)());
        let shared = self.shared.clone();
        let worker_sink = sink.clone();
        let id = meeting_id.to_owned();
        let handle = std::thread::Builder::new()
            .name("transcript".into())
            .spawn(move || run(shared, worker_sink, transcriber, writer, id))
            .map_err(|_| self.refuse(meeting_id, Reason::EngineFailed))?;
        inner.worker = Some((sink, handle, wanted));
        Ok(state)
    }

    fn refuse(&self, meeting_id: &str, reason: Reason) -> RecordError {
        self.shared.set(|s| {
            s.state = Capture::Error;
            s.meeting_id = Some(meeting_id.to_owned());
            s.level = 0.0;
            s.reason = Some(reason);
        });
        RecordError::Failed { reason }
    }

    /// "Pause": closes the microphone; the current utterance is finished and stored.
    pub fn pause(&self) -> CaptureState {
        let mut inner = self.inner();
        if self.shared.status().state != Capture::Recording {
            return self.status();
        }
        self.halt(&mut inner, Capture::Paused, true)
    }

    /// Stops recording (End meeting, another meeting). The state becomes `off`.
    pub fn stop(&self) -> CaptureState {
        let mut inner = self.inner();
        self.halt(&mut inner, Capture::Off, true)
    }

    /// Stops recording if it belongs to `meeting_id` (the meeting ended).
    pub fn stop_meeting(&self, meeting_id: &str) {
        if self.shared.status().meeting_id.as_deref() == Some(meeting_id) {
            self.stop();
        }
    }

    fn halt(&self, inner: &mut Inner, next: Capture, emit: bool) -> CaptureState {
        self.shared.close_source();
        if let Some((sink, handle, model)) = inner.worker.take() {
            sink.end();
            match handle.join() {
                Ok(engine) => inner.engine = Some((model, engine)),
                Err(_) => crate::log!("the transcript worker stopped unexpectedly"),
            }
        }
        let current = self.status();
        if let Some(id) = &current.meeting_id {
            inner.recorded = Some((id.clone(), current.elapsed_ms));
        }
        if current.state == Capture::Off
            || (current.state == Capture::Error && next == Capture::Paused)
        {
            return current;
        }
        let update = |s: &mut CaptureState| {
            s.state = next;
            s.level = 0.0;
            s.reason = None;
            if next == Capture::Off {
                s.meeting_id = None;
                s.elapsed_ms = 0;
            }
        };
        if emit {
            self.shared.set(update)
        } else {
            let mut s = self.shared.status();
            update(&mut s);
            s.clone()
        }
    }
}

impl Drop for Recorder {
    fn drop(&mut self) {
        let mut inner = self.inner();
        let _ = self.halt(&mut inner, Capture::Off, false);
    }
}

/// How long the monitor lets the speech-to-text thread finish the cut-off utterance before it
/// reports a lost device itself (the engine may be inside a long window).
const FLUSH_GRACE: Duration = Duration::from_millis(250);

/// The worker. Two threads: one drains the sink and runs the pipeline (a slow engine only makes the
/// transcript lag; the sink keeps the audio, bounded), the other watches the device and sends
/// ticks, so a busy engine neither looks like a lost microphone nor freezes the state.
fn run(
    shared: Arc<Shared>,
    sink: AudioSink,
    mut transcriber: Transcriber,
    mut writer: Box<dyn TranscriptWriter>,
    meeting_id: String,
) -> Box<dyn SpeechToText> {
    use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering::SeqCst};
    let elapsed_ms = AtomicU64::new(transcriber.recorded_ms());
    let level_bits = AtomicU32::new(0f32.to_bits());
    let done = AtomicBool::new(false);
    let reported = AtomicBool::new(false);
    let lost: Mutex<Option<Reason>> = Mutex::new(None);
    let report = |reason: Reason| {
        if !reported.swap(true, SeqCst) {
            shared.fail(reason);
        }
    };
    let tick = |elapsed: u64, level: f32| {
        shared.set(|s| {
            s.elapsed_ms = elapsed;
            s.level = (level * 4.0).min(1.0);
        });
    };
    let engine = std::thread::scope(|scope| {
        let stt = scope.spawn(|| {
            let deliver = |segments: Vec<Segment>,
                           writer: &mut Box<dyn TranscriptWriter>|
             -> Result<(), Reason> {
                for segment in segments {
                    if segment.is_final {
                        writer.append(&segment).map_err(|e| {
                            crate::log!("could not store a transcript segment: {e}");
                            Reason::StorageFailed
                        })?;
                    }
                    shared.events.segment(&SegmentEvent {
                        meeting_id: meeting_id.clone(),
                        segment,
                    });
                }
                Ok(())
            };
            let outcome: Result<(), Reason> = loop {
                let taken = sink.take(Duration::from_millis(100));
                if !taken.samples.is_empty() {
                    match transcriber.push(&taken.samples) {
                        Ok(segments) => {
                            if let Err(r) = deliver(segments, &mut writer) {
                                break Err(r);
                            }
                        }
                        Err(e) => break Err(e.into()),
                    }
                    elapsed_ms.store(transcriber.recorded_ms(), SeqCst);
                    level_bits.store(transcriber.level().to_bits(), SeqCst);
                }
                let gone = lost.lock().unwrap_or_else(|e| e.into_inner()).take();
                let lost_now = taken.failed.map(Reason::from).or(gone);
                if taken.ended || lost_now.is_some() {
                    let flushed = transcriber
                        .flush()
                        .map_err(Reason::from)
                        .and_then(|segments| deliver(segments, &mut writer));
                    break match (lost_now, flushed) {
                        (Some(r), _) => Err(r),
                        (None, result) => result,
                    };
                }
            };
            elapsed_ms.store(transcriber.recorded_ms(), SeqCst);
            shared.status().elapsed_ms = transcriber.recorded_ms();
            if let Err(reason) = outcome {
                report(reason);
            }
            done.store(true, SeqCst);
            transcriber.into_engine()
        });
        let mut last_tick = Instant::now();
        let mut lost_since: Option<Instant> = None;
        while !done.load(SeqCst) {
            std::thread::sleep(Duration::from_millis(25));
            let (failed, ended) = sink.peek();
            let reason = failed.map(Reason::from).or_else(|| {
                (!ended && sink.since_last_push() >= STALL).then_some(Reason::MicrophoneLost)
            });
            if let Some(reason) = reason {
                lost.lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .get_or_insert(reason);
                let since = *lost_since.get_or_insert_with(Instant::now);
                if since.elapsed() >= FLUSH_GRACE {
                    report(reason);
                }
            }
            if last_tick.elapsed() >= TICK && !reported.load(SeqCst) {
                last_tick = Instant::now();
                tick(
                    elapsed_ms.load(SeqCst),
                    f32::from_bits(level_bits.load(SeqCst)),
                );
            }
        }
        stt.join().expect("speech-to-text thread panicked")
    });
    engine
}

#[cfg(test)]
mod tests;
