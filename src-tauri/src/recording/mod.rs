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
//! - A stop or pause never waits on a stuck engine: the microphone closes first, the worker gets
//!   [`STOP_WAIT`] to finish, then every final segment sent so far is stored (without a voice if it
//!   has none yet) and a worker still inside an engine is left behind. It stores and sends nothing
//!   more for the meeting, its audio is dropped, and the next session loads a fresh engine.
//! - A failing or silent device (no audio for [`STALL`]) ends the session with an error state within
//!   2 s, and the source is closed.
//! - The microphone is the system default or the device chosen in the settings ([`StartOptions`]).
//!   A chosen device that is not connected is never replaced by another one at start: the start
//!   fails with [`Reason::ChosenMicrophoneMissing`].
//! - The microphone test ([`Recorder::start_test`], `mic_test.rs`) opens the chosen device for at
//!   most 10 s to show its level. Its audio goes nowhere else and is dropped at once.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, SyncSender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::engines::audio::{AudioError, AudioSink, AudioSource};
use crate::engines::devices::{AudioDevices, NoAudioDevices};
use crate::engines::diarize::{Diarizer, VoiceTracker};
use crate::engines::level::{Level, LevelPacer};
use crate::engines::models::SpeakerModelList;
use crate::engines::stt::{Lang, SpeechToText, SttError};
use crate::engines::{AudioFactory, DiarizerProvider, NoSpeakerModelProvider, SttProvider};
use crate::settings::DeviceLost;
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
/// How long a stop or pause waits for the worker to finish the cut-off utterance and the voices still
/// being worked out. Then every final segment sent so far is stored (without a voice if it has none
/// yet), and a worker still stuck in an engine is left behind: it stores and sends nothing more, and
/// its engine is not reused.
pub const STOP_WAIT: Duration = Duration::from_millis(1_000);
/// Extra time after [`STOP_WAIT`] for a worker that is finishing to hand its engines back.
const STOP_GRACE: Duration = Duration::from_millis(250);
/// How long a worker that ends gives the diarizer's thread to hand its engine back.
const DIARIZER_RETURN: Duration = Duration::from_millis(100);
/// How long a worker that ends on its own (a lost device) waits for the diarizer's thread.
const DIARIZER_WAIT: Duration = Duration::from_secs(1);

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

/// The input level for the sound wave (`capture-level` event), sent every [`crate::engines::level::LEVEL_EVERY`] while
/// audio arrives, from the capture side. Numbers only: never samples. `meeting_id` is `None` for the
/// microphone test. The last event before capture stops has level 0.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelEvent {
    pub meeting_id: Option<String>,
    /// Scaled RMS 0..1 ([`crate::engines::level::scaled_rms`]).
    pub level: f32,
    /// Highest absolute sample of the block, 0..1.
    pub peak: f32,
}

impl LevelEvent {
    fn new(meeting_id: Option<&str>, l: Level) -> Self {
        Self {
            meeting_id: meeting_id.map(str::to_owned),
            level: l.level,
            peak: l.peak,
        }
    }
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
    /// The voice of a stored final segment (`transcript-voice` event).
    fn voice(&self, _event: &VoiceEvent) {}
    /// The chosen microphone was lost and recording carries on with the system default
    /// (`microphone-switched` event).
    fn switched(&self, _event: &SwitchedEvent) {}
    /// The microphone test's state (`mic-test` event).
    fn mic_test(&self, _state: &MicTestState) {}
    /// The input level of the recording or the microphone test (`capture-level` event).
    fn level(&self, _event: &LevelEvent) {}
}

/// Recording switched to the system default microphone after the chosen one was lost.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchedEvent {
    pub meeting_id: String,
    /// Wall-clock time of the switch, ms since epoch.
    pub at: u64,
    /// Recorded time of the meeting at the switch.
    pub elapsed_ms: u64,
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
    /// Speaker model id from the core's scan; `None` or an id no longer found: the preferred one.
    pub speaker_model: Option<String>,
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

    /// Like [`Self::set`], unless `gone` is set: a session that was stopped or left behind changes
    /// the state no more. The flag is read under the state's lock, so it cannot race the halt.
    fn set_unless(&self, gone: &AtomicBool, f: impl FnOnce(&mut CaptureState)) {
        let snapshot = {
            let mut s = self.status();
            if gone.load(Ordering::SeqCst) {
                return;
            }
            f(&mut s);
            s.clone()
        };
        self.events.capture(&snapshot);
    }

    /// Ends the session with an error state and closes the source, unless the session was left
    /// behind (then the source may already belong to the next one).
    fn fail_unless(&self, abandoned: &AtomicBool, reason: Reason) {
        let snapshot = {
            let mut s = self.status();
            if abandoned.load(Ordering::SeqCst) {
                return;
            }
            self.close_source();
            crate::log!("recording stopped: {reason:?}");
            s.state = Capture::Error;
            s.level = 0.0;
            s.reason = Some(reason);
            s.clone()
        };
        self.events.capture(&snapshot);
    }
}

/// What a session's worker hands back when it ends: the engines, to reuse, and the meeting's voices.
/// An engine that panicked is not handed back.
struct Returned {
    stt: Option<Box<dyn SpeechToText>>,
    speakers: Option<(Box<dyn Diarizer>, VoiceTracker)>,
}

/// What the halt and the worker both see of one session.
#[derive(Default)]
struct Session {
    /// A halt began: the monitor stops ticking, switching, reporting and sending levels (the level
    /// stream stops before the device is closed).
    stopping: AtomicBool,
    /// The halt stopped waiting for this worker: it changes no state and closes no source any more.
    abandoned: AtomicBool,
}

/// The running worker's sink and result, the model id its engine was loaded for, and its meeting.
/// Its thread is never joined: a worker stuck in an engine is left behind (see [`STOP_WAIT`]).
struct Worker {
    sink: AudioSink,
    done: Receiver<Returned>,
    session: Arc<Session>,
    delivery: Arc<Mutex<Delivery>>,
    model: Option<String>,
    /// The speaker model id its diarizer was loaded for.
    speaker_model: Option<String>,
    meeting_id: String,
}

#[derive(Default)]
struct Inner {
    worker: Option<Worker>,
    /// A loaded engine kept between sessions, with the model id it was asked for.
    engine: Option<(Option<String>, Box<dyn SpeechToText>)>,
    /// A loaded speaker engine kept between sessions, with the model id it was asked for.
    diarizer: Option<(Option<String>, Box<dyn Diarizer>)>,
    /// The voices of the meeting recorded last, kept across Pause/Resume (memory only).
    voices: Option<(String, VoiceTracker)>,
    /// Recorded time per meeting in this app session.
    recorded: Option<(String, u64)>,
    /// The last worker a halt stopped waiting for: if it ever finishes, its engines are taken back.
    left_behind: Option<LeftBehind>,
}

/// A worker that did not stop in time, and the model ids its engines were loaded for.
struct LeftBehind {
    done: Receiver<Returned>,
    model: Option<String>,
    speaker_model: Option<String>,
}

impl Inner {
    /// Takes back the engines of a worker left behind that has finished since (a slow engine, not a
    /// stuck one), so they need not be loaded again. Its voices are not taken back: a stop drops them.
    fn reclaim(&mut self) {
        let Some(l) = &self.left_behind else {
            return;
        };
        match l.done.try_recv() {
            Ok(returned) => {
                let Some(l) = self.left_behind.take() else {
                    return;
                };
                if let (None, Some(stt)) = (&self.engine, returned.stt) {
                    self.engine = Some((l.model, stt));
                }
                if let (None, Some((diarizer, _voices))) = (&self.diarizer, returned.speakers) {
                    self.diarizer = Some((l.speaker_model, diarizer));
                }
            }
            Err(mpsc::TryRecvError::Disconnected) => self.left_behind = None,
            Err(mpsc::TryRecvError::Empty) => {}
        }
    }
}

pub struct Recorder {
    audio: Arc<AudioFactory>,
    devices: Arc<dyn AudioDevices>,
    test: Mutex<Option<mic_test::Running>>,
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
            audio: Arc::new(audio),
            devices: Arc::new(NoAudioDevices),
            test: Mutex::new(None),
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
        inner.reclaim();
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
        // Speaker detection is optional: without a model, recording runs without voices.
        let speaker_model = opts.speaker_model.clone();
        let diarizer = match inner.diarizer.take() {
            Some((id, d)) if id == speaker_model => Some(d),
            _ => match self.diarize.load(speaker_model.as_deref()) {
                Ok(d) => Some(d),
                Err(e) => {
                    crate::log!("speaker detection is off: {e}");
                    None
                }
            },
        };
        let tracker = match inner.voices.take() {
            Some((id, t)) if id == meeting_id => t,
            _ => VoiceTracker::new(writer.highest_voice().map_or(0, |v| v.index() + 1)),
        };

        let sink = AudioSink::new();
        let mut source = match self.open_source(opts.device.as_deref()) {
            Ok(s) => s,
            Err(reason) => {
                inner.engine = Some((wanted, engine));
                inner.diarizer = diarizer.map(|d| (speaker_model.clone(), d));
                inner.voices = Some((meeting_id.to_owned(), tracker));
                return Err(self.refuse(meeting_id, reason));
            }
        };
        if let Err(e) = source.start(sink.clone()) {
            inner.engine = Some((wanted, engine));
            inner.diarizer = diarizer.map(|d| (speaker_model.clone(), d));
            inner.voices = Some((meeting_id.to_owned(), tracker));
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
        let mut transcriber = Transcriber::new(engine, base, (self.now_ms)());
        if diarizer.is_some() {
            transcriber = transcriber.keeping_clips();
        }
        let speakers = diarizer.map(|d| (d, tracker));
        let shared = self.shared.clone();
        let worker_sink = sink.clone();
        let id = meeting_id.to_owned();
        let session = Arc::new(Session::default());
        let delivery = Arc::new(Mutex::new(Delivery {
            shared: self.shared.clone(),
            meeting_id: meeting_id.to_owned(),
            next_seq: writer.next_seq(),
            writer,
            waiting: VecDeque::new(),
            jobs: None,
            results: None,
            stop_by: None,
            closed: false,
        }));
        let (done_tx, done) = mpsc::channel();
        let worker_session = session.clone();
        let worker_delivery = delivery.clone();
        // "Switch to the system default" applies to a chosen device; losing the default stops.
        let fallback =
            (opts.on_lost == DeviceLost::SwitchToDefault && opts.device.is_some()).then(|| {
                Fallback {
                    audio: self.audio.clone(),
                    now_ms: self.now_ms,
                }
            });
        let spawned = std::thread::Builder::new()
            .name("transcript".into())
            .spawn(move || {
                let returned = run(
                    shared,
                    worker_sink,
                    transcriber,
                    worker_delivery,
                    worker_session,
                    id,
                    speakers,
                    fallback,
                );
                // Nobody listens any more if the halt stopped waiting.
                let _ = done_tx.send(returned);
            });
        if spawned.is_err() {
            self.shared.close_source();
            return Err(self.refuse(meeting_id, Reason::EngineFailed));
        }
        inner.worker = Some(Worker {
            sink,
            done,
            session,
            delivery,
            model: wanted,
            speaker_model,
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
    /// voice embeddings and centroids are dropped. Returns within [`STOP_WAIT`] plus a short grace,
    /// also when an engine hangs: the microphone is closed first, every final segment sent so far is
    /// stored, and a stuck worker is left behind.
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
        let worker = inner.worker.take();
        if let Some(w) = &worker {
            // Before the source closes, so the monitor cannot switch to another one after it.
            w.session.stopping.store(true, Ordering::SeqCst);
        }
        self.shared.close_source();
        if let Some(w) = worker {
            lock(&w.delivery).stop_by = Some(Instant::now() + STOP_WAIT);
            w.sink.end();
            match w.done.recv_timeout(STOP_WAIT + STOP_GRACE) {
                Ok(returned) => {
                    if let Some(stt) = returned.stt {
                        inner.engine = Some((w.model, stt));
                    }
                    if let Some((diarizer, tracker)) = returned.speakers {
                        inner.diarizer = Some((w.speaker_model, diarizer));
                        inner.voices = Some((w.meeting_id, tracker));
                    }
                }
                Err(e) => {
                    {
                        // Under the state's lock, so the worker cannot change the state after this.
                        let _status = self.shared.status();
                        w.session.abandoned.store(true, Ordering::SeqCst);
                    }
                    match e {
                        RecvTimeoutError::Timeout => {
                            crate::log!("the transcript worker did not stop in time; left behind");
                            inner.left_behind = Some(LeftBehind {
                                done: w.done,
                                model: w.model,
                                speaker_model: w.speaker_model,
                            });
                        }
                        RecvTimeoutError::Disconnected => {
                            crate::log!("the transcript worker stopped unexpectedly")
                        }
                    }
                }
            }
            // Whatever the worker still holds: the final segments it sent are stored now, and it
            // stores and sends nothing more.
            if let Err(reason) = lock(&w.delivery).close() {
                crate::log!("the end of the transcript could not be stored: {reason:?}");
            }
            // A source the worker switched to while this halt began is closed too.
            self.shared.close_source();
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
        inner.voices = None;
    }
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
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

/// The diarizer's thread, seen from the worker: how to cancel it and where its engine comes back.
struct Speakers {
    cancel: Arc<AtomicBool>,
    back: Receiver<(Box<dyn Diarizer>, VoiceTracker)>,
}

/// Sends segments and voices to the UI and stores final segments in order. Shared by the worker and
/// the halt: the worker never holds it while an engine runs, so a halt can always store what was
/// sent and close it, also while the worker is stuck.
struct Delivery {
    shared: Arc<Shared>,
    meeting_id: String,
    writer: Box<dyn TranscriptWriter>,
    next_seq: u64,
    waiting: VecDeque<Waiting>,
    /// Clips to the diarizer's thread, and the voices from it (none without speaker detection).
    jobs: Option<SyncSender<Job>>,
    results: Option<Receiver<(u64, Option<Voice>)>>,
    /// Set by a halt: no segment waits for its voice beyond this.
    stop_by: Option<Instant>,
    /// Closed by a halt: nothing more is stored or sent for this session.
    closed: bool,
}

/// The longest a waiting worker holds the delivery at a time.
const POLL: Duration = Duration::from_millis(20);

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
        if self.closed {
            return Ok(());
        }
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
            let queued = match (self.jobs.as_ref(), clip) {
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

    /// No voice comes any more for the segments still waiting.
    fn give_up_voices(&mut self) {
        for w in &mut self.waiting {
            w.voice.get_or_insert(None);
        }
    }

    /// Takes in the voices that arrived and stores every segment that is ready, in order.
    fn settle(&mut self) -> Result<(), Reason> {
        if self.closed {
            return Ok(());
        }
        let arrived: Vec<_> = self
            .results
            .as_ref()
            .map(|r| r.try_iter().collect())
            .unwrap_or_default();
        for (seq, voice) in arrived {
            self.resolve(seq, voice);
        }
        let now = Instant::now();
        let stopped = self.stop_by.is_some_and(|t| now >= t);
        while let Some(front) = self.waiting.front() {
            if front.voice.is_none() && now < front.deadline && !stopped {
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

    /// One step of waiting for the voices still being worked out: stores what is ready and waits at
    /// most [`POLL`] for the next voice. True once nothing waits any more.
    fn poll(&mut self) -> Result<bool, Reason> {
        self.settle()?;
        let Some(front) = self.waiting.front() else {
            return Ok(true);
        };
        if self.closed {
            return Ok(true);
        }
        let until = self
            .stop_by
            .map_or(front.deadline, |t| t.min(front.deadline));
        let wait = until.saturating_duration_since(Instant::now()).min(POLL);
        let got = match &self.results {
            Some(r) => r.recv_timeout(wait),
            None => Err(RecvTimeoutError::Disconnected),
        };
        match got {
            Ok((seq, voice)) => self.resolve(seq, voice),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => self.give_up_voices(),
        }
        Ok(false)
    }

    /// Stores every final segment still waiting (with the voice it has, or none) and closes the
    /// session's delivery: from now on nothing is stored or sent for it, and the diarizer gets no
    /// more clips.
    fn close(&mut self) -> Result<(), Reason> {
        if self.closed {
            return Ok(());
        }
        let arrived: Vec<_> = self
            .results
            .as_ref()
            .map(|r| r.try_iter().collect())
            .unwrap_or_default();
        for (seq, voice) in arrived {
            self.resolve(seq, voice);
        }
        self.give_up_voices();
        let stored = self.settle();
        self.closed = true;
        self.waiting.clear();
        self.jobs = None;
        self.results = None;
        stored
    }
}

/// At the end of a session: waits for the voices still being worked out (each at most until its
/// deadline, and not beyond a halt's `stop_by`) and stores everything. The delivery is held for at
/// most [`POLL`] at a time.
fn finish(delivery: &Mutex<Delivery>) -> Result<(), Reason> {
    while !lock(delivery).poll()? {}
    Ok(())
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

/// The system default microphone, for "Switch to the system default".
struct Fallback {
    audio: Arc<AudioFactory>,
    now_ms: fn() -> u64,
}

impl Fallback {
    /// Closes the lost source and starts the system default on the same sink, so the pipeline,
    /// the recorded time and the capture state carry on. `false` if the default cannot be opened,
    /// or if the session is being stopped meanwhile (then the new source is closed at once).
    fn switch(&self, shared: &Shared, sink: &AudioSink, stopping: &AtomicBool) -> bool {
        shared.close_source();
        let mut source = (self.audio)();
        sink.recover();
        match source.start(sink.clone()) {
            Ok(()) => {
                let mut slot = shared.source.lock().unwrap_or_else(|e| e.into_inner());
                if stopping.load(Ordering::SeqCst) {
                    source.stop();
                    return false;
                }
                *slot = Some(source);
                crate::log!("microphone lost: switched to the system default");
                true
            }
            Err(e) => {
                crate::log!("microphone lost; the system default could not be opened: {e}");
                false
            }
        }
    }
}

/// How long the monitor lets the speech-to-text thread finish the cut-off utterance before it
/// reports a lost device itself (the engine may be inside a long window).
const FLUSH_GRACE: Duration = Duration::from_millis(250);

/// The worker. Two threads: one drains the sink and runs the pipeline (a slow engine only makes the
/// transcript lag; the sink keeps the audio, bounded), the other watches the device and sends
/// ticks, so a busy engine neither looks like a lost microphone nor freezes the state. Speaker
/// detection hangs off the speech side: the speech thread hands clips to the diarizer's own thread
/// and stores lines as their voices arrive, so neither capture nor loss detection waits for it.
/// Once a halt begins, the monitor stops; once the halt stops waiting (`abandoned`), the worker
/// changes no state any more, and the closed delivery stores and sends nothing.
#[allow(clippy::too_many_arguments)]
fn run(
    shared: Arc<Shared>,
    sink: AudioSink,
    mut transcriber: Transcriber,
    delivery: Arc<Mutex<Delivery>>,
    session: Arc<Session>,
    meeting_id: String,
    speakers: Option<(Box<dyn Diarizer>, VoiceTracker)>,
    fallback: Option<Fallback>,
) -> Returned {
    use std::sync::atomic::{AtomicU32, AtomicU64, Ordering::SeqCst};
    let speakers = speakers.and_then(|(diarizer, tracker)| {
        let (jobs, job_rx) = mpsc::sync_channel(DIARIZE_QUEUE);
        let (result_tx, results) = mpsc::channel();
        let (back_tx, back) = mpsc::channel();
        let cancel = Arc::new(AtomicBool::new(false));
        let c = cancel.clone();
        std::thread::Builder::new()
            .name("speakers".into())
            .spawn(move || {
                let _ = back_tx.send(diarize(diarizer, tracker, job_rx, result_tx, c));
            })
            .map_err(|_| crate::log!("speaker detection could not start"))
            .ok()
            .map(|_| {
                let mut d = lock(&delivery);
                d.jobs = Some(jobs);
                d.results = Some(results);
                Speakers { cancel, back }
            })
    });
    let elapsed_ms = AtomicU64::new(transcriber.recorded_ms());
    let level_bits = AtomicU32::new(0f32.to_bits());
    let done = AtomicBool::new(false);
    let reported = AtomicBool::new(false);
    let lost: Mutex<Option<Reason>> = Mutex::new(None);
    let report = |reason: Reason| {
        if !reported.swap(true, SeqCst) {
            shared.fail_unless(&session.abandoned, reason);
        }
    };
    let tick = |elapsed: u64, level: f32| {
        shared.set_unless(&session.stopping, |s| {
            s.elapsed_ms = elapsed;
            s.level = (level * 4.0).min(1.0);
        });
    };
    let has_fallback = fallback.is_some();
    let mut engine_ok = true;
    std::thread::scope(|scope| {
        let stt = scope.spawn(|| {
            let outcome: Result<(), Reason> = loop {
                let taken = sink.take(Duration::from_millis(100));
                if !taken.samples.is_empty() {
                    // The engine runs outside the delivery, so a halt never waits for it.
                    match transcriber.push(&taken.samples) {
                        Ok(segments) => {
                            let clips = transcriber.take_clips();
                            if let Err(r) = lock(&delivery).segments(segments, clips) {
                                break Err(r);
                            }
                        }
                        Err(e) => break Err(e.into()),
                    }
                    elapsed_ms.store(transcriber.recorded_ms(), SeqCst);
                    level_bits.store(transcriber.level().to_bits(), SeqCst);
                } else if let Err(r) = lock(&delivery).settle() {
                    break Err(r);
                }
                let gone = lost.lock().unwrap_or_else(|e| e.into_inner()).take();
                // With a fallback, the monitor decides whether a failure ends the session.
                let failed = taken.failed.filter(|_| !has_fallback);
                let lost_now = failed.map(Reason::from).or(gone);
                if taken.ended || lost_now.is_some() {
                    let flushed = transcriber
                        .flush()
                        .map_err(Reason::from)
                        .and_then(|segments| {
                            let clips = transcriber.take_clips();
                            lock(&delivery).segments(segments, clips)
                        })
                        .and_then(|()| finish(&delivery));
                    break match (lost_now, flushed) {
                        (Some(r), _) => Err(r),
                        (None, result) => result,
                    };
                }
            };
            elapsed_ms.store(transcriber.recorded_ms(), SeqCst);
            {
                let mut s = shared.status();
                if !session.abandoned.load(SeqCst) {
                    s.elapsed_ms = transcriber.recorded_ms();
                }
            }
            if let Err(reason) = outcome {
                report(reason);
            }
            done.store(true, SeqCst);
        });
        let mut last_tick = Instant::now();
        let mut lost_since: Option<Instant> = None;
        let mut fallback = fallback;
        // The sound wave's level, from the capture side: it keeps coming while the engine works.
        let mut pacer = LevelPacer::new();
        let send_level = |l: Level| shared.events.level(&LevelEvent::new(Some(&meeting_id), l));
        while !done.load(SeqCst) && !stt.is_finished() && !session.stopping.load(SeqCst) {
            std::thread::sleep(pacer.due_in(Duration::from_millis(25)));
            let (failed, ended) = sink.peek();
            let live = failed.is_none()
                && !ended
                && !reported.load(SeqCst)
                && !session.stopping.load(SeqCst);
            pacer.step(&sink, live, send_level);
            let reason = failed.map(Reason::from).or_else(|| {
                (!ended && sink.since_last_push() >= STALL).then_some(Reason::MicrophoneLost)
            });
            // One switch per session: if the default is lost as well, recording stops.
            if reason.is_some() && !ended && !reported.load(SeqCst) {
                if let Some(f) = fallback.take() {
                    if f.switch(&shared, &sink, &session.stopping) {
                        shared.events.switched(&SwitchedEvent {
                            meeting_id: meeting_id.clone(),
                            at: (f.now_ms)(),
                            elapsed_ms: elapsed_ms.load(SeqCst),
                        });
                        continue;
                    }
                }
            }
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
        // The last level is 0, also when the engine never returns.
        pacer.finish(send_level);
        // A halt may stop waiting for this join (the engine may never return).
        if stt.join().is_err() {
            crate::log!("speech-to-text stopped unexpectedly");
            engine_ok = false;
            report(Reason::EngineFailed);
        }
    });
    // The diarizer gets no more clips; its engine comes back once the clip it works on is done.
    let stop_by = {
        let mut d = lock(&delivery);
        d.jobs = None;
        d.stop_by
    };
    let speakers = speakers.and_then(|s| {
        s.cancel.store(true, SeqCst);
        let wait = stop_by.map_or(DIARIZER_WAIT, |t| {
            t.saturating_duration_since(Instant::now())
                .max(DIARIZER_RETURN)
        });
        match s.back.recv_timeout(wait) {
            Ok(back) => Some(back),
            Err(RecvTimeoutError::Timeout) => {
                crate::log!("speaker detection did not stop in time; left behind");
                None
            }
            Err(RecvTimeoutError::Disconnected) => {
                crate::log!("speaker detection stopped unexpectedly");
                None
            }
        }
    });
    Returned {
        stt: engine_ok.then(|| transcriber.into_engine()),
        speakers,
    }
}

mod mic_test;
pub use mic_test::{MicTest, MicTestError, MicTestState, TEST_LIMIT};

#[cfg(test)]
mod level_tests;

#[cfg(test)]
mod device_tests;
#[cfg(test)]
mod tests;
