//! Recording sessions: the consent gate, the microphone, the transcript pipeline on its own thread,
//! and the capture state the UI's recording indicator follows.
//!
//! - [`Recorder::start`] opens the microphone only for a running meeting whose stored meeting has
//!   `recording_consent_at`; otherwise it fails with [`RecordError::NoConsent`] and no source starts.
//!   It never starts on its own: only the UI's "Start recording" / "Resume" calls it.
//! - Audio goes into a bounded in-memory sink (at most 30 s) and through the [`Transcriber`] on a
//!   worker thread. Audio is never written anywhere.
//! - Speaker detection runs beside it on its own thread, so it never delays a transcript line: a final
//!   segment is sent to the UI at once (with its sequence number); its audio clip goes to the
//!   [`Diarizer`] through a bounded queue, and the voice follows as a separate `transcript-voice`
//!   event. Each final segment is appended to the encrypted transcript, in order, as soon as its voice
//!   is known or after [`VOICE_WAIT`] without one. Without a speaker model, segments are stored at once
//!   and have no voice. Embeddings and centroids stay in memory, are kept across Pause/Resume, and are
//!   dropped when recording stops.
//! - A failing or silent device (no audio for [`STALL`]) ends the session with an error state within
//!   2 s, and the source is closed.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, SyncSender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::engines::audio::{AudioError, AudioSink, AudioSource};
use crate::engines::diarize::{Diarizer, VoiceTracker};
use crate::engines::models::SpeakerModelList;
use crate::engines::stt::{SpeechToText, SttError};
use crate::engines::{AudioFactory, DiarizerProvider, NoSpeakerModelProvider, SttProvider};
use crate::store::{MeetingStore, StoreError};
use crate::transcript::{
    Segment, Transcriber, TranscriptError, TranscriptStore, TranscriptWriter, Voice,
};

/// No audio for this long while recording counts as a lost device.
pub const STALL: Duration = Duration::from_millis(1_500);
/// How often the capture state (elapsed time, level) is sent while recording.
pub const TICK: Duration = Duration::from_millis(200);
/// Longest a final segment waits for its voice before it is stored without one.
pub const VOICE_WAIT: Duration = Duration::from_secs(5);
/// Most segment clips waiting for the diarizer (each at most 3 s of audio). A segment that finds the
/// queue full gets no voice.
pub const DIARIZE_QUEUE: usize = 8;

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
    /// The final segment's sequence number in the meeting's transcript (its record number); line
    /// choices in the speakers view refer to it. None for a partial.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seq: Option<u64>,
    #[serde(flatten)]
    pub segment: Segment,
}

/// The voice of a final segment, once it is known and stored (`transcript-voice` event).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceEvent {
    pub meeting_id: String,
    pub seq: u64,
    pub voice: Voice,
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
    fn voice(&self, event: &VoiceEvent);
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

/// What a session's worker hands back when it ends: the engines, to reuse, and the meeting's voices.
struct Returned {
    stt: Box<dyn SpeechToText>,
    speakers: Option<(Box<dyn Diarizer>, VoiceTracker)>,
}

/// The running worker's sink and thread, the model id its engine was loaded for, and its meeting.
struct Worker {
    sink: AudioSink,
    handle: JoinHandle<Returned>,
    model: Option<String>,
    meeting_id: String,
}

#[derive(Default)]
struct Inner {
    worker: Option<Worker>,
    /// A loaded engine kept between sessions, with the model id it was asked for.
    engine: Option<(Option<String>, Box<dyn SpeechToText>)>,
    /// A loaded speaker engine kept between sessions.
    diarizer: Option<Box<dyn Diarizer>>,
    /// The voices of the meeting recorded last, kept across Pause/Resume (memory only).
    voices: Option<(String, VoiceTracker)>,
    /// Recorded time per meeting in this app session.
    recorded: Option<(String, u64)>,
}

pub struct Recorder {
    audio: AudioFactory,
    stt: Box<dyn SttProvider>,
    diarize: Box<dyn DiarizerProvider>,
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
            diarize: Box::new(NoSpeakerModelProvider {
                searched: Vec::new(),
            }),
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

    /// Uses `provider` for speaker detection (by default there is none).
    pub fn with_diarizer(mut self, provider: Box<dyn DiarizerProvider>) -> Self {
        self.diarize = provider;
        self
    }

    pub fn models(&self) -> crate::engines::models::ModelList {
        self.stt.models()
    }

    pub fn speaker_models(&self) -> SpeakerModelList {
        self.diarize.models()
    }

    /// Whether voice centroids of a stopped or paused session are held in memory.
    pub fn holds_voices(&self) -> bool {
        self.inner()
            .voices
            .as_ref()
            .is_some_and(|(_, t)| t.voices() > 0)
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

        // Speaker detection is optional: without a model, recording runs without voices.
        let diarizer = inner
            .diarizer
            .take()
            .or_else(|| match self.diarize.load(None) {
                Ok(d) => Some(d),
                Err(e) => {
                    crate::log!("speaker detection is off: {e}");
                    None
                }
            });
        let tracker = match inner.voices.take() {
            Some((id, t)) if id == meeting_id => t,
            _ => VoiceTracker::new(writer.highest_voice().map_or(0, |v| v.index() + 1)),
        };

        let sink = AudioSink::new();
        let mut source = (self.audio)();
        if let Err(e) = source.start(sink.clone()) {
            inner.engine = Some((wanted, engine));
            inner.diarizer = diarizer;
            inner.voices = Some((meeting_id.to_owned(), tracker));
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
        let mut transcriber = Transcriber::new(engine, base, (self.now_ms)());
        if diarizer.is_some() {
            transcriber = transcriber.keeping_clips();
        }
        let speakers = diarizer.map(|d| (d, tracker));
        let shared = self.shared.clone();
        let worker_sink = sink.clone();
        let id = meeting_id.to_owned();
        let handle = std::thread::Builder::new()
            .name("transcript".into())
            .spawn(move || run(shared, worker_sink, transcriber, writer, id, speakers))
            .map_err(|_| self.refuse(meeting_id, Reason::EngineFailed))?;
        inner.worker = Some(Worker {
            sink,
            handle,
            model: wanted,
            meeting_id: meeting_id.to_owned(),
        });
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

    /// Stops recording (End meeting, another meeting). The state becomes `off`, and the meeting's
    /// voice embeddings and centroids are dropped.
    pub fn stop(&self) -> CaptureState {
        let mut inner = self.inner();
        let state = self.halt(&mut inner, Capture::Off, true);
        inner.voices = None;
        state
    }

    /// Stops recording if it belongs to `meeting_id` (the meeting ended).
    pub fn stop_meeting(&self, meeting_id: &str) {
        if self.shared.status().meeting_id.as_deref() == Some(meeting_id) {
            self.stop();
        }
    }

    fn halt(&self, inner: &mut Inner, next: Capture, emit: bool) -> CaptureState {
        self.shared.close_source();
        if let Some(w) = inner.worker.take() {
            w.sink.end();
            match w.handle.join() {
                Ok(returned) => {
                    inner.engine = Some((w.model, returned.stt));
                    if let Some((diarizer, tracker)) = returned.speakers {
                        inner.diarizer = Some(diarizer);
                        inner.voices = Some((w.meeting_id, tracker));
                    }
                }
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
        inner.voices = None;
    }
}

/// One segment's audio for the diarizer.
struct Job {
    seq: u64,
    start_ms: u64,
    end_ms: u64,
    audio: Vec<f32>,
}

/// A final segment sent to the UI and not yet stored.
struct Waiting {
    seq: u64,
    segment: Segment,
    deadline: Instant,
    /// `None` while the diarizer works on it; `Some(voice)` once that is known (or will never be).
    voice: Option<Option<Voice>>,
}

/// The diarizer's thread and the channels to it.
struct Speakers {
    jobs: Option<SyncSender<Job>>,
    results: Receiver<(u64, Option<Voice>)>,
    cancel: Arc<AtomicBool>,
    thread: JoinHandle<(Box<dyn Diarizer>, VoiceTracker)>,
}

/// Sends segments and voices to the UI and stores final segments in order.
struct Delivery {
    shared: Arc<Shared>,
    meeting_id: String,
    writer: Box<dyn TranscriptWriter>,
    next_seq: u64,
    waiting: VecDeque<Waiting>,
    speakers: Option<Speakers>,
}

impl Delivery {
    fn send(&self, seq: Option<u64>, segment: Segment) {
        self.shared.events.segment(&SegmentEvent {
            meeting_id: self.meeting_id.clone(),
            seq,
            segment,
        });
    }

    /// Sends each segment at once; queues each final one's clip for the diarizer.
    fn segments(&mut self, segments: Vec<Segment>, clips: Vec<Vec<f32>>) -> Result<(), Reason> {
        let mut clips = clips.into_iter();
        for segment in segments {
            if !segment.is_final {
                self.send(None, segment);
                continue;
            }
            let seq = self.next_seq;
            self.next_seq += 1;
            let clip = clips.next();
            self.send(Some(seq), segment.clone());
            let queued = match (self.speakers.as_ref().and_then(|s| s.jobs.as_ref()), clip) {
                (Some(jobs), Some(audio)) => jobs
                    .try_send(Job {
                        seq,
                        start_ms: segment.start_ms,
                        end_ms: segment.end_ms,
                        audio,
                    })
                    .is_ok(),
                _ => false,
            };
            self.waiting.push_back(Waiting {
                seq,
                segment,
                deadline: Instant::now() + VOICE_WAIT,
                voice: if queued { None } else { Some(None) },
            });
        }
        self.settle()
    }

    fn resolve(&mut self, seq: u64, voice: Option<Voice>) {
        // A voice that comes after its segment was stored without one is dropped.
        if let Some(w) = self.waiting.iter_mut().find(|w| w.seq == seq) {
            w.voice.get_or_insert(voice);
        }
    }

    /// Takes in the voices that arrived and stores every segment that is ready, in order.
    fn settle(&mut self) -> Result<(), Reason> {
        let arrived: Vec<_> = self
            .speakers
            .as_ref()
            .map(|s| s.results.try_iter().collect())
            .unwrap_or_default();
        for (seq, voice) in arrived {
            self.resolve(seq, voice);
        }
        while let Some(front) = self.waiting.front() {
            if front.voice.is_none() && Instant::now() < front.deadline {
                break;
            }
            let Some(w) = self.waiting.pop_front() else {
                break;
            };
            let mut segment = w.segment;
            segment.voice = w.voice.flatten();
            self.writer.append(&segment).map_err(|e| {
                crate::log!("could not store a transcript segment: {e}");
                Reason::StorageFailed
            })?;
            if let Some(voice) = segment.voice {
                self.shared.events.voice(&VoiceEvent {
                    meeting_id: self.meeting_id.clone(),
                    seq: w.seq,
                    voice,
                });
            }
        }
        Ok(())
    }

    /// At the end of a session: waits for the voices still being worked out (each at most until
    /// its deadline) and stores everything.
    fn finish(&mut self) -> Result<(), Reason> {
        loop {
            self.settle()?;
            let Some(front) = self.waiting.front() else {
                return Ok(());
            };
            let wait = front.deadline.saturating_duration_since(Instant::now());
            let got = match &self.speakers {
                Some(s) => s.results.recv_timeout(wait),
                None => Err(RecvTimeoutError::Disconnected),
            };
            match got {
                Ok((seq, voice)) => self.resolve(seq, voice),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => {
                    for w in &mut self.waiting {
                        w.voice.get_or_insert(None);
                    }
                }
            }
        }
    }

    /// Stops the diarizer's thread and hands back its engine and the meeting's voices.
    fn close(&mut self) -> Option<(Box<dyn Diarizer>, VoiceTracker)> {
        let mut s = self.speakers.take()?;
        s.cancel.store(true, Ordering::SeqCst);
        s.jobs = None;
        match s.thread.join() {
            Ok(back) => Some(back),
            Err(_) => {
                crate::log!("speaker detection stopped unexpectedly");
                None
            }
        }
    }
}

/// The diarizer's thread: works out the voice of each queued clip, in order. Clips are dropped right
/// after; once the session ends, the rest of the queue is skipped.
fn diarize(
    mut diarizer: Box<dyn Diarizer>,
    mut tracker: VoiceTracker,
    jobs: Receiver<Job>,
    results: Sender<(u64, Option<Voice>)>,
    cancel: Arc<AtomicBool>,
) -> (Box<dyn Diarizer>, VoiceTracker) {
    while let Ok(job) = jobs.recv() {
        if cancel.load(Ordering::SeqCst) {
            continue;
        }
        let voice = tracker.voice_for(diarizer.as_mut(), job.start_ms, job.end_ms, &job.audio);
        let seq = job.seq;
        drop(job);
        let _ = results.send((seq, voice));
    }
    (diarizer, tracker)
}

/// How long the monitor lets the speech-to-text thread finish the cut-off utterance before it
/// reports a lost device itself (the engine may be inside a long window).
const FLUSH_GRACE: Duration = Duration::from_millis(250);

/// The worker. Two threads: one drains the sink and runs the pipeline (a slow engine only makes the
/// transcript lag; the sink keeps the audio, bounded), the other watches the device and sends
/// ticks, so a busy engine neither looks like a lost microphone nor freezes the state. Speaker
/// detection hangs off the speech side: the speech thread hands clips to the diarizer's own thread
/// and stores lines as their voices arrive, so neither capture nor loss detection ever waits for it.
fn run(
    shared: Arc<Shared>,
    sink: AudioSink,
    mut transcriber: Transcriber,
    writer: Box<dyn TranscriptWriter>,
    meeting_id: String,
    speakers: Option<(Box<dyn Diarizer>, VoiceTracker)>,
) -> Returned {
    use std::sync::atomic::{AtomicU32, AtomicU64, Ordering::SeqCst};
    let speakers = speakers.and_then(|(diarizer, tracker)| {
        let (jobs, job_rx) = mpsc::sync_channel(DIARIZE_QUEUE);
        let (result_tx, results) = mpsc::channel();
        let cancel = Arc::new(AtomicBool::new(false));
        let c = cancel.clone();
        std::thread::Builder::new()
            .name("speakers".into())
            .spawn(move || diarize(diarizer, tracker, job_rx, result_tx, c))
            .map_err(|_| crate::log!("speaker detection could not start"))
            .ok()
            .map(|thread| Speakers {
                jobs: Some(jobs),
                results,
                cancel,
                thread,
            })
    });
    let mut delivery = Delivery {
        shared: shared.clone(),
        meeting_id,
        next_seq: writer.next_seq(),
        writer,
        waiting: VecDeque::new(),
        speakers,
    };
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
    std::thread::scope(|scope| {
        let stt = scope.spawn(|| {
            let outcome: Result<(), Reason> = loop {
                let taken = sink.take(Duration::from_millis(100));
                if !taken.samples.is_empty() {
                    match transcriber.push(&taken.samples) {
                        Ok(segments) => {
                            let clips = transcriber.take_clips();
                            if let Err(r) = delivery.segments(segments, clips) {
                                break Err(r);
                            }
                        }
                        Err(e) => break Err(e.into()),
                    }
                    elapsed_ms.store(transcriber.recorded_ms(), SeqCst);
                    level_bits.store(transcriber.level().to_bits(), SeqCst);
                } else if let Err(r) = delivery.settle() {
                    break Err(r);
                }
                let gone = lost.lock().unwrap_or_else(|e| e.into_inner()).take();
                let lost_now = taken.failed.map(Reason::from).or(gone);
                if taken.ended || lost_now.is_some() {
                    let flushed = transcriber
                        .flush()
                        .map_err(Reason::from)
                        .and_then(|segments| {
                            let clips = transcriber.take_clips();
                            delivery.segments(segments, clips)
                        })
                        .and_then(|()| delivery.finish());
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
        stt.join().expect("speech-to-text thread panicked");
    });
    let speakers = delivery.close();
    Returned {
        stt: transcriber.into_engine(),
        speakers,
    }
}

#[cfg(test)]
mod tests;
