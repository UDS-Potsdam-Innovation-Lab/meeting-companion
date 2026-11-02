//! Capture suggestions (job 019): decisions, to-dos and questions the language model proposes from the
//! transcript of the running meeting. A suggestion is never a capture: only a person's tap on
//! Bestätigen ([`CaptureSuggester::confirm`]) stores one, with `source: "suggested"`.
//!
//! - The [`CaptureSuggester`] follows the recording through the core's events ([`SuggesterSink`]): the
//!   final segments of the meeting that records (with their voices), and the capture state. Taking a
//!   segment is a short lock and a counter; the request runs on the suggester's own thread, so it never
//!   holds up the transcript.
//! - It asks after [`Cadence::every_segments`] new final segments, or after [`Cadence::max_wait`] with
//!   at least one, while the meeting records and a language model is chosen. At most one request is
//!   in flight; `Busy` (a settings Test is running) skips the run. With `languageModel = "none"` it
//!   makes no call at all.
//! - Pause, Stop, End meeting and a change of the `languageModel` setting cancel a running request
//!   (`run_cancellable` returns within a second); an answer that arrives after that is dropped. A
//!   setting change also drops the lines collected so far: a newly chosen engine gets only what was
//!   said after the change.
//! - The request goes only through the [`SuggestEngine`] (the `LanguageModel` trait behind the
//!   setting): fixed instructions ([`prompt::SUGGEST_TASK`]), the transcript lines only in the escaped
//!   content block. The reply is parsed against a closed format ([`prompt::parse_reply`]).
//! - Pending and dismissed suggestions live in memory only, for the meeting that records; they are
//!   dropped when it ends or another meeting records. A suggestion with the same kind and source
//!   segments as one offered before in the meeting is not offered again.
//! - Nothing here logs or returns prompt, reply, transcript or suggestion text: errors are kinds.

pub mod prompt;

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use chacha20poly1305::aead::rand_core::RngCore;
use chacha20poly1305::aead::OsRng;
use serde::{Deserialize, Serialize};

use crate::captures::{self, CaptureChange, CaptureError, CaptureSaved, NewCapture, UndoCopies};
use crate::engines::llm::{CancelToken, LlmError, LlmReply, LlmRequest};
use crate::language_model::LanguageModelService;
use crate::model::FieldError;
use crate::recording::{
    Capture as Recording, CaptureState, EventSink, LevelEvent, MicTestState, SegmentEvent,
    SwitchedEvent, VoiceEvent,
};
use crate::settings::{LanguageModelSetting, Locale, SettingsService};
use crate::store::MeetingStore;
use prompt::{Line, Parsed};

/// When the suggester asks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cadence {
    /// After this many new final segments.
    pub every_segments: usize,
    /// Or after this long since the last request (or the start of recording), with at least one new
    /// final segment.
    pub max_wait: Duration,
    /// How often the suggester's thread looks at the clock.
    pub tick: Duration,
}

/// 4 segments or 60 s, whichever comes first.
pub const CADENCE: Cadence = Cadence {
    every_segments: 4,
    max_wait: Duration::from_secs(60),
    tick: Duration::from_millis(250),
};

impl Default for Cadence {
    fn default() -> Self {
        CADENCE
    }
}

/// Whether a request is due: `new` final segments since the last request, `since` the time since it.
pub fn due(cadence: &Cadence, new: usize, since: Duration) -> bool {
    new >= cadence.every_segments || (new >= 1 && since >= cadence.max_wait)
}

/// Most suggestions waiting at once in a meeting; further ones are not offered.
pub const MAX_PENDING: usize = 20;
/// Most final segments the suggester holds (memory only).
const KEEP_LINES: usize = prompt::WINDOW_SEGMENTS;

/// A suggestion waiting for a person: never stored, never a capture until Bestätigen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    /// `s-` and 16 hex digits.
    pub id: String,
    /// `decision`, `todo` or `question`.
    pub kind: String,
    /// The model's text: untrusted, shown as text only.
    pub text: String,
    /// To-dos only: a participant id the reply named exactly.
    pub owner: Option<String>,
    /// The numbers of the transcript segments it came from, ascending.
    pub segments: Vec<u64>,
    /// When it was offered (ms since epoch).
    pub created_at: u64,
}

/// What the UI shows for a meeting: the waiting suggestions (oldest first) and the last run's error.
/// The UI reads it with `load_suggestions`; [`SuggestionEvents`] hears every change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionsState {
    pub meeting_id: String,
    pub pending: Vec<Suggestion>,
    /// Why the last request gave nothing (a kind only); cleared by the next answer or a new setting.
    pub error: Option<LlmError>,
}

/// Hears every change of the state. The app reads the state by command instead (see `lib.rs`); tests
/// collect the changes.
pub trait SuggestionEvents: Send + Sync {
    fn suggestions(&self, state: &SuggestionsState);
}

/// The language model behind the `languageModel` setting, for the suggester.
pub trait SuggestEngine: Send + Sync {
    /// The setting now, and the app language (for voice labels in the content).
    fn setting(&self) -> (LanguageModelSetting, Locale);
    /// One request through the chosen engine (`Prompt::build`, `run_cancellable`). Blocks.
    fn complete(&self, req: &LlmRequest, cancel: &CancelToken) -> Result<LlmReply, LlmError>;
}

/// The app's engine: the settings now and the [`LanguageModelService`].
pub struct AppEngine {
    pub llm: Arc<LanguageModelService>,
    pub settings: Arc<SettingsService>,
}

impl SuggestEngine for AppEngine {
    fn setting(&self) -> (LanguageModelSetting, Locale) {
        let s = self.settings.current();
        (s.language_model, s.locale)
    }
    fn complete(&self, req: &LlmRequest, cancel: &CancelToken) -> Result<LlmReply, LlmError> {
        self.llm.run_task(&self.settings.current(), req, cancel)
    }
}

/// What a confirm attaches the capture to, and an edited version (Bearbeiten → Bestätigen).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Confirm {
    pub suggestion_id: String,
    #[serde(default)]
    pub item_id: Option<String>,
    #[serde(default)]
    pub topic_id: Option<String>,
    /// The person's edit; none: the suggestion as offered.
    #[serde(default)]
    pub edit: Option<CaptureChange>,
}

/// The suggestions of the meeting that records (or recorded last).
struct Session {
    meeting_id: String,
    lines: VecDeque<Line>,
    /// Final segments since the last request.
    new: usize,
    /// The last request (or the start of recording).
    last_run: Instant,
    pending: Vec<Suggestion>,
    /// Kind and segments of every suggestion offered in this meeting (also dismissed and confirmed).
    offered: HashSet<(String, Vec<u64>)>,
    /// Confirmed suggestions by capture id, so Undo of a confirm can put one back.
    confirmed: HashMap<String, Suggestion>,
    error: Option<LlmError>,
}

impl Session {
    fn new(meeting_id: &str) -> Self {
        Self {
            meeting_id: meeting_id.to_owned(),
            lines: VecDeque::new(),
            new: 0,
            last_run: Instant::now(),
            pending: Vec::new(),
            offered: HashSet::new(),
            confirmed: HashMap::new(),
            error: None,
        }
    }

    fn state(&self) -> SuggestionsState {
        SuggestionsState {
            meeting_id: self.meeting_id.clone(),
            pending: self.pending.clone(),
            error: self.error,
        }
    }
}

#[derive(Default)]
struct State {
    session: Option<Session>,
    /// The session's meeting records right now (not paused, stopped or failed).
    recording: bool,
    /// Bumped by every cancel: an answer for an older generation is dropped.
    generation: u64,
    in_flight: Option<CancelToken>,
    shutdown: bool,
}

impl State {
    fn session_of(&mut self, meeting_id: &str) -> Option<&mut Session> {
        self.session.as_mut().filter(|s| s.meeting_id == meeting_id)
    }

    /// Cancels a running request; its answer will be dropped.
    fn cancel(&mut self) {
        self.generation += 1;
        if let Some(token) = self.in_flight.take() {
            token.cancel();
        }
    }
}

struct Shared {
    state: Mutex<State>,
    wake: Condvar,
    engine: Arc<dyn SuggestEngine>,
    meetings: Arc<dyn MeetingStore>,
    events: Arc<dyn SuggestionEvents>,
    cadence: Cadence,
    now_ms: fn() -> u64,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// See the module documentation. Dropping it stops its thread.
pub struct CaptureSuggester {
    shared: Arc<Shared>,
}

/// A request the thread is about to make.
struct Job {
    generation: u64,
    cancel: CancelToken,
    meeting_id: String,
    lines: Vec<Line>,
}

impl CaptureSuggester {
    pub fn new(
        engine: Arc<dyn SuggestEngine>,
        meetings: Arc<dyn MeetingStore>,
        events: Arc<dyn SuggestionEvents>,
        cadence: Cadence,
        now_ms: fn() -> u64,
    ) -> Self {
        let shared = Arc::new(Shared {
            state: Mutex::new(State::default()),
            wake: Condvar::new(),
            engine,
            meetings,
            events,
            cadence,
            now_ms,
        });
        let worker = shared.clone();
        let spawned = std::thread::Builder::new()
            .name("capture-suggester".into())
            .spawn(move || run(&worker));
        if spawned.is_err() {
            crate::log!("capture suggestions are off: no thread");
        }
        Self { shared }
    }

    fn emit(&self, state: Option<SuggestionsState>) {
        if let Some(s) = state {
            self.shared.events.suggestions(&s);
        }
    }

    /// The capture state changed: suggestions run only while a meeting records.
    pub fn on_capture(&self, capture: &CaptureState) {
        let mut st = self.shared.lock();
        match (capture.state, capture.meeting_id.as_deref()) {
            (Recording::Recording, Some(id)) => {
                if st.session.as_ref().is_none_or(|s| s.meeting_id != id) {
                    st.cancel();
                    st.session = Some(Session::new(id));
                }
                if !st.recording {
                    st.recording = true;
                    if let Some(s) = st.session.as_mut() {
                        s.last_run = Instant::now();
                    }
                }
            }
            _ => {
                if st.recording || st.in_flight.is_some() {
                    st.recording = false;
                    st.cancel();
                }
            }
        }
        self.shared.wake.notify_all();
    }

    /// A transcript segment was sent to the UI. Only final segments of the recording meeting count.
    pub fn on_segment(&self, event: &SegmentEvent) {
        let (Some(seq), true) = (event.seq, event.segment.is_final) else {
            return;
        };
        let mut st = self.shared.lock();
        let recording = st.recording;
        let Some(s) = st.session_of(&event.meeting_id) else {
            return;
        };
        if !recording {
            return;
        }
        s.lines.push_back(Line {
            seq,
            at: event.segment.at,
            text: event.segment.text.clone(),
            voice: event.segment.voice,
        });
        while s.lines.len() > KEEP_LINES {
            s.lines.pop_front();
        }
        s.new += 1;
        drop(st);
        self.shared.wake.notify_all();
    }

    /// The voice of a final segment became known.
    pub fn on_voice(&self, event: &VoiceEvent) {
        let mut st = self.shared.lock();
        if let Some(s) = st.session_of(&event.meeting_id) {
            if let Some(line) = s.lines.iter_mut().find(|l| l.seq == event.seq) {
                line.voice = Some(event.voice);
            }
        }
    }

    /// The `languageModel` setting changed: a running request is cancelled, the error cleared, and the
    /// lines collected so far are dropped. The first request to a newly chosen engine holds only what
    /// was said after the change, so nothing spoken under another setting (e.g. "Vorschläge aus")
    /// reaches it.
    pub fn setting_changed(&self) {
        let state = {
            let mut st = self.shared.lock();
            st.cancel();
            st.session.as_mut().map(|s| {
                s.lines.clear();
                s.new = 0;
                s.last_run = Instant::now();
                s.error = None;
                s.state()
            })
        };
        self.emit(state);
    }

    /// The meeting ended: a running request is cancelled and its suggestions are dropped.
    pub fn meeting_ended(&self, meeting_id: &str) {
        let ended = {
            let mut st = self.shared.lock();
            if st.session_of(meeting_id).is_none() {
                return;
            }
            st.cancel();
            st.recording = false;
            st.session = None;
            SuggestionsState {
                meeting_id: meeting_id.to_owned(),
                pending: Vec::new(),
                error: None,
            }
        };
        self.emit(Some(ended));
    }

    /// The waiting suggestions of a meeting (none for any other meeting).
    pub fn state(&self, meeting_id: &str) -> SuggestionsState {
        let mut st = self.shared.lock();
        st.session_of(meeting_id)
            .map(|s| s.state())
            .unwrap_or_else(|| SuggestionsState {
                meeting_id: meeting_id.to_owned(),
                pending: Vec::new(),
                error: None,
            })
    }

    /// Verwerfen: the suggestion goes for this meeting (and is not offered again).
    pub fn dismiss(
        &self,
        meeting_id: &str,
        suggestion_id: &str,
    ) -> Result<SuggestionsState, CaptureError> {
        let state = {
            let mut st = self.shared.lock();
            let s = st.session_of(meeting_id).ok_or_else(unknown_suggestion)?;
            let i = s
                .pending
                .iter()
                .position(|p| p.id == suggestion_id)
                .ok_or_else(unknown_suggestion)?;
            s.pending.remove(i);
            s.state()
        };
        self.emit(Some(state.clone()));
        Ok(state)
    }

    /// Bestätigen: stores the suggestion (or the person's edit of it) as a capture with
    /// `source: "suggested"` and its segments, checked like a typed capture. An unknown or already
    /// handled suggestion stores nothing. The suggestion leaves the waiting list only once the meeting
    /// file is written.
    pub fn confirm(
        &self,
        meetings: &dyn MeetingStore,
        meeting_id: &str,
        confirm: Confirm,
        now_ms: u64,
    ) -> Result<CaptureSaved, CaptureError> {
        let suggestion = {
            let mut st = self.shared.lock();
            st.session_of(meeting_id)
                .and_then(|s| {
                    s.pending
                        .iter()
                        .find(|p| p.id == confirm.suggestion_id)
                        .cloned()
                })
                .ok_or_else(unknown_suggestion)?
        };
        let input = match confirm.edit {
            Some(edit) => NewCapture {
                kind: edit.kind,
                text: edit.text,
                owner: edit.owner,
                due: edit.due,
                item_id: confirm.item_id,
                topic_id: confirm.topic_id,
            },
            None => NewCapture {
                kind: suggestion.kind.clone(),
                text: suggestion.text.clone(),
                owner: suggestion.owner.clone(),
                due: None,
                item_id: confirm.item_id,
                topic_id: confirm.topic_id,
            },
        };
        let saved = captures::add_suggested(
            meetings,
            meeting_id,
            input,
            suggestion.segments.clone(),
            now_ms,
        )?;
        let state = {
            let mut st = self.shared.lock();
            st.session_of(meeting_id).map(|s| {
                s.pending.retain(|p| p.id != suggestion.id);
                s.confirmed.insert(saved.capture.id.clone(), suggestion);
                s.state()
            })
        };
        self.emit(state);
        Ok(saved)
    }

    /// Undo of a confirm: removes the capture (like a delete) and puts the suggestion back as waiting.
    pub fn unconfirm(
        &self,
        meetings: &dyn MeetingStore,
        kept: &UndoCopies,
        meeting_id: &str,
        capture_id: &str,
        now_ms: u64,
    ) -> Result<CaptureSaved, CaptureError> {
        let saved = captures::delete_capture(meetings, kept, meeting_id, capture_id, now_ms)?;
        let state = {
            let mut st = self.shared.lock();
            st.session_of(meeting_id).and_then(|s| {
                let back = s.confirmed.remove(capture_id)?;
                s.pending.push(back);
                s.pending.sort_by_key(|p| p.created_at);
                Some(s.state())
            })
        };
        self.emit(state);
        Ok(saved)
    }

    /// Whether a request is running (tests).
    pub fn in_flight(&self) -> bool {
        self.shared.lock().in_flight.is_some()
    }
}

impl Drop for CaptureSuggester {
    fn drop(&mut self) {
        let mut st = self.shared.lock();
        st.shutdown = true;
        st.cancel();
        drop(st);
        self.shared.wake.notify_all();
    }
}

fn unknown_suggestion() -> CaptureError {
    CaptureError::Invalid {
        fields: vec![FieldError {
            field: "suggestionId".into(),
            code: "unknown",
        }],
    }
}

/// The suggester's thread: waits for a due request, runs it, takes in its answer.
fn run(shared: &Shared) {
    loop {
        let Some(job) = next_job(shared) else {
            return;
        };
        let (setting, locale) = shared.engine.setting();
        let result = if matches!(setting, LanguageModelSetting::None) {
            // No language model chosen: no call at all.
            None
        } else {
            ask(shared, &job, locale)
        };
        finish(shared, &job, result);
    }
}

/// Waits until a request is due (or the suggester is dropped).
fn next_job(shared: &Shared) -> Option<Job> {
    let mut st = shared.lock();
    loop {
        if st.shutdown {
            return None;
        }
        let ready = st.recording && st.in_flight.is_none();
        if ready {
            let off = matches!(shared.engine.setting().0, LanguageModelSetting::None);
            let generation = st.generation;
            if let Some(s) = st.session.as_mut() {
                if due(&shared.cadence, s.new, s.last_run.elapsed()) {
                    s.new = 0;
                    s.last_run = Instant::now();
                    if !off {
                        let job = Job {
                            generation,
                            cancel: CancelToken::new(),
                            meeting_id: s.meeting_id.clone(),
                            lines: s.lines.iter().cloned().collect(),
                        };
                        st.in_flight = Some(job.cancel.clone());
                        return Some(job);
                    }
                }
            }
        }
        st = shared
            .wake
            .wait_timeout(st, shared.cadence.tick)
            .map(|(g, _)| g)
            .unwrap_or_else(|e| e.into_inner().0);
    }
}

/// What one run gave: the checked entries of the reply, or why there were none.
type Outcome = Result<Vec<Parsed>, LlmError>;

/// Builds the request from the stored meeting (names, participants), runs it and parses the reply.
/// `None`: nothing to ask.
fn ask(shared: &Shared, job: &Job, locale: Locale) -> Option<Outcome> {
    let meeting = match shared.meetings.load(&job.meeting_id) {
        Ok(Some(m)) => m,
        Ok(None) => return None,
        Err(e) => {
            crate::log!("capture suggestions skipped a run: {e}");
            return None;
        }
    };
    let (content, sent) = prompt::content(&meeting, &job.lines, locale);
    if sent.is_empty() {
        return None;
    }
    let req = LlmRequest {
        system: prompt::SUGGEST_TASK,
        content,
        max_input_chars: prompt::MAX_INPUT_CHARS,
        max_output_tokens: prompt::MAX_OUTPUT_TOKENS,
    };
    let result = shared.engine.complete(&req, &job.cancel);
    // Parsed here, outside the lock; only the checked entries go on.
    Some(result.map(|reply| prompt::parse_reply(&reply, &sent, &meeting.participants)))
}

/// Takes in the answer, unless it was cancelled meanwhile.
fn finish(shared: &Shared, job: &Job, outcome: Option<Outcome>) {
    let state = {
        let mut st = shared.lock();
        let current = st.generation == job.generation && !job.cancel.is_cancelled();
        if current {
            st.in_flight = None;
        }
        let (Some(outcome), true) = (outcome, current) else {
            return;
        };
        let now = (shared.now_ms)();
        let Some(s) = st.session_of(&job.meeting_id) else {
            return;
        };
        match outcome {
            Ok(parsed) => {
                s.error = None;
                for p in parsed {
                    let key = (p.kind.clone(), p.segments.clone());
                    if s.pending.len() >= MAX_PENDING || s.offered.contains(&key) {
                        continue;
                    }
                    s.offered.insert(key);
                    s.pending.push(Suggestion {
                        id: new_id(),
                        kind: p.kind,
                        text: p.text,
                        owner: p.owner,
                        segments: p.segments,
                        created_at: now,
                    });
                }
            }
            // A Test is running: this run is skipped quietly.
            Err(LlmError::Busy | LlmError::Cancelled | LlmError::NotConfigured) => {}
            Err(e) => {
                crate::log!("capture suggestions: {e}");
                s.error = Some(e);
            }
        }
        s.state()
    };
    shared.events.suggestions(&state);
}

fn new_id() -> String {
    format!("s-{:016x}", OsRng.next_u64())
}

/// Passes the core's events on and feeds the suggester: segments and voices of the recording meeting,
/// and the capture state. The suggester only takes a short lock; it never delays the transcript.
pub struct SuggesterSink {
    pub inner: Arc<dyn EventSink>,
    pub suggester: Arc<CaptureSuggester>,
}

impl EventSink for SuggesterSink {
    fn capture(&self, state: &CaptureState) {
        self.inner.capture(state);
        self.suggester.on_capture(state);
    }
    fn segment(&self, event: &SegmentEvent) {
        self.inner.segment(event);
        self.suggester.on_segment(event);
    }
    fn voice(&self, event: &VoiceEvent) {
        self.inner.voice(event);
        self.suggester.on_voice(event);
    }
    fn switched(&self, event: &SwitchedEvent) {
        self.inner.switched(event);
    }
    fn mic_test(&self, state: &MicTestState) {
        self.inner.mic_test(state);
    }
    fn level(&self, event: &LevelEvent) {
        self.inner.level(event);
    }
}

#[cfg(test)]
mod tests;
