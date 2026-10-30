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
//! - The microphone is the system default or the device chosen in the settings ([`StartOptions`]).
//!   A chosen device that is not connected is never replaced by another one at start: the start
//!   fails with [`Reason::ChosenMicrophoneMissing`].
//! - The microphone test ([`Recorder::start_test`], `mic_test.rs`) opens the chosen device for at
//!   most 10 s to show its level. Its audio goes nowhere else and is dropped at once.

use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::engines::audio::{AudioError, AudioSink, AudioSource};
use crate::engines::devices::{AudioDevices, NoAudioDevices};
use crate::engines::stt::{Lang, SpeechToText, SttError};
use crate::engines::{AudioFactory, SttProvider};
use crate::settings::DeviceLost;
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
    /// The microphone chosen in the settings is not connected; no other one was opened.
    ChosenMicrophoneMissing,
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
    /// The microphone test's state (`mic-test` event).
    fn mic_test(&self, _state: &MicTestState) {}
}

/// How a recording session runs, from the settings.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StartOptions {
    /// Speech model id from the core's scan; `None` or an id no longer found: the preferred model.
    pub model_id: Option<String>,
    /// Input device by name; `None`: the system default.
    pub device: Option<String>,
    /// Language hint for speech-to-text; `None`: detected per line.
    pub language: Option<Lang>,
    /// What happens when the microphone disappears while recording.
    pub on_lost: DeviceLost,
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
    devices: Arc<dyn AudioDevices>,
    test: Mutex<Option<mic_test::Running>>,
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
            devices: Arc::new(NoAudioDevices),
            test: Mutex::new(None),
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

    /// Named input devices can be chosen from `devices` (default: none, only the system default).
    pub fn with_devices(mut self, devices: Arc<dyn AudioDevices>) -> Self {
        self.devices = devices;
        self
    }

    /// Names of the connected input devices.
    pub fn input_devices(&self) -> Vec<String> {
        self.devices.list()
    }

    /// A source for `device` (`None`: the system default), or why it cannot be opened: a chosen
    /// device that is not connected is never replaced by another one.
    fn open_source(&self, device: Option<&str>) -> Result<Box<dyn AudioSource>, Reason> {
        match device {
            None => Ok((self.audio)()),
            Some(name) if self.devices.list().iter().any(|d| d == name) => {
                Ok(self.devices.open(name))
            }
            Some(_) => Err(Reason::ChosenMicrophoneMissing),
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
        let opts = StartOptions {
            model_id: model_id.map(str::to_owned),
            ..StartOptions::default()
        };
        self.start_with(meetings, meeting_id, &opts)
    }

    /// [`Self::start`] with the device, language and model from the settings.
    pub fn start_with(
        &self,
        meetings: &dyn MeetingStore,
        meeting_id: &str,
        opts: &StartOptions,
    ) -> Result<CaptureState, RecordError> {
        let model_id = opts.model_id.as_deref();
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
        let mut engine = match inner.engine.take() {
            Some((id, engine)) if id == wanted => engine,
            _ => match self.stt.load(model_id) {
                Ok(e) => e,
                Err(e) => return Err(self.refuse(meeting_id, e.into())),
            },
        };
        engine.set_language(opts.language);

        // A microphone test gives the device back before the meeting takes it.
        self.stop_test();
        let sink = AudioSink::new();
        let mut source = match self.open_source(opts.device.as_deref()) {
            Ok(s) => s,
            Err(reason) => {
                inner.engine = Some((wanted, engine));
                return Err(self.refuse(meeting_id, reason));
            }
        };
        if let Err(e) = source.start(sink.clone()) {
            inner.engine = Some((wanted, engine));
            let reason = match (e, &opts.device) {
                (AudioError::NoMicrophone, Some(_)) => Reason::ChosenMicrophoneMissing,
                (e, _) => e.into(),
            };
            return Err(self.refuse(meeting_id, reason));
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
        self.stop_test();
        let mut inner = self.inner();
        let _ = self.halt(&mut inner, Capture::Off, false);
    }
}

/// The worker: drains the sink, runs the pipeline, stores finals, sends segments and ticks.
fn run(
    shared: Arc<Shared>,
    sink: AudioSink,
    mut transcriber: Transcriber,
    mut writer: Box<dyn TranscriptWriter>,
    meeting_id: String,
) -> Box<dyn SpeechToText> {
    let mut last_audio = Instant::now();
    let mut last_tick = Instant::now();
    let deliver =
        |segments: Vec<Segment>, writer: &mut Box<dyn TranscriptWriter>| -> Result<(), Reason> {
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
            last_audio = Instant::now();
            match transcriber.push(&taken.samples) {
                Ok(segments) => {
                    if let Err(r) = deliver(segments, &mut writer) {
                        break Err(r);
                    }
                }
                Err(e) => break Err(e.into()),
            }
        }
        let lost = if let Some(e) = taken.failed {
            Some(Reason::from(e))
        } else if !taken.ended && last_audio.elapsed() >= STALL {
            Some(Reason::MicrophoneLost)
        } else {
            None
        };
        if taken.ended || lost.is_some() {
            let flushed = transcriber
                .flush()
                .map_err(Reason::from)
                .and_then(|segments| deliver(segments, &mut writer));
            break match (lost, flushed) {
                (Some(r), _) => Err(r),
                (None, result) => result,
            };
        }
        if last_tick.elapsed() >= TICK {
            last_tick = Instant::now();
            let (elapsed, level) = (transcriber.recorded_ms(), transcriber.level());
            shared.set(|s| {
                s.elapsed_ms = elapsed;
                s.level = (level * 4.0).min(1.0);
            });
        }
    };
    let elapsed = transcriber.recorded_ms();
    shared.status().elapsed_ms = elapsed;
    if let Err(reason) = outcome {
        shared.fail(reason);
    }
    transcriber.into_engine()
}

mod mic_test;
pub use mic_test::{MicTest, MicTestError, MicTestState, TEST_LIMIT};

#[cfg(test)]
mod device_tests;
#[cfg(test)]
mod tests;
