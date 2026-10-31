//! The meeting as it is stored on the device, and the validation every save goes through.
//!
//! All text in a meeting comes from a person typing into the app and is untrusted: it is length-limited
//! here, never interpreted, and the UI renders it as text only.

use serde::{Deserialize, Serialize};

use crate::transcript::Voice;

/// Version of the stored JSON. Bump it, and add a migration, when the shape changes.
pub const SCHEMA_VERSION: u32 = 1;

pub const TITLE_MAX: usize = 200;
pub const NAME_MAX: usize = 100;
pub const OUTCOME_MAX: usize = 200;
pub const ID_MAX: usize = 64;
pub const MAX_PARTICIPANTS: usize = 100;
pub const MAX_ITEMS: usize = 100;
pub const MINUTES_MIN: u32 = 1;
pub const MINUTES_MAX: u32 = 240;
/// Most minutes "+5 min" may add to one agenda item in total.
pub const EXTRA_MINUTES_MAX: i64 = 240;
/// Longest name of a guest added in the speakers view.
pub const GUEST_NAME_MAX: usize = 80;
/// Most line choices ("Who said this?") one meeting keeps.
pub const MAX_LINE_CHOICES: usize = 20_000;
/// Most topics one agenda-free meeting keeps (the same limit as agenda items).
pub const MAX_TOPICS: usize = 100;
/// Most time spans one topic keeps (each tap on the topic opens one).
pub const MAX_SPANS: usize = 1_000;

/// `mode` of a meeting with an agenda; also what a meeting without `mode` is.
pub const MODE_AGENDA: &str = "agenda";
/// `mode` of an agenda-free meeting: a whole-meeting timer and topics added by hand.
pub const MODE_FREE: &str = "free";
/// `source` of a topic a person typed in. Detected topics (a later job) get their own value.
pub const SOURCE_MANUAL: &str = "manual";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Meeting {
    pub version: u32,
    pub id: String,
    pub title: String,
    /// Calendar date, `YYYY-MM-DD`.
    pub date: String,
    /// Local start time, `HH:MM`.
    pub start: String,
    /// Local end time, `HH:MM`; must be after `start` on the same day.
    pub end: String,
    pub participants: Vec<Participant>,
    pub items: Vec<AgendaItem>,
    /// `agenda` or `free` (agenda-free). Optional and left out of the JSON while unset, so files
    /// without it load unchanged as agenda meetings. A string, not an enum, so that an unknown value
    /// from the UI is reported as a field error instead of failing to parse.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    /// Milliseconds since the Unix epoch of the last save; set by the app, not by the UI.
    #[serde(default)]
    pub updated_at: u64,
    /// Timekeeping of the meeting once it has started. Optional and left out of the JSON while the
    /// meeting has not started, so version 1 files without it load unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run: Option<Run>,
    /// When the facilitator confirmed that everyone was informed that the meeting is transcribed
    /// (ms since epoch). Set only by the core's consent command; recording refuses to start without
    /// it. Optional and left out of the JSON while unset, so files without it load unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recording_consent_at: Option<u64>,
    /// Who the voices and lines of the transcript are, as people chose in the speakers view. Set
    /// only by the core's speaker commands. Optional and left out while unset, so files without it
    /// load unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speakers: Option<Speakers>,
}

/// The people behind the voices and lines of a meeting's transcript. Every entry is a person's
/// choice; suggestions of the name round are worked out when asked for and never stored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Speakers {
    /// Voice → participant, one entry per voice. Applies to every line of the voice, also earlier ones.
    #[serde(default)]
    pub voices: Vec<VoiceChoice>,
    /// Line → participant, for lines without a voice or with the wrong one; keyed by the line's
    /// sequence number in the transcript.
    #[serde(default)]
    pub lines: Vec<LineChoice>,
}

/// How the person for a voice was found.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NameSource {
    /// The voice said the person's name in the name round, and a person confirmed it.
    NameRound,
    /// Picked by hand.
    Manual,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceChoice {
    pub voice: Voice,
    /// The participant, or none ("Unassigned").
    pub participant_id: Option<String>,
    pub source: NameSource,
    /// True for a person's choice (every stored entry); false only for a suggestion.
    pub confirmed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineChoice {
    /// Sequence number of the line in the meeting's transcript.
    pub seq: u64,
    /// The participant, or none (nobody is shown for the line).
    pub participant_id: Option<String>,
}

/// When the meeting and each agenda item ran. All times are milliseconds since the Unix epoch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub started_at: u64,
    /// Set by "End meeting"; an ended meeting is never resumed.
    #[serde(default)]
    pub ended_at: Option<u64>,
    /// The agenda items that have started, in the order they started. At most one has no end: the
    /// current item. Always empty in an agenda-free meeting.
    pub items: Vec<RunItem>,
    /// Agenda-free meetings only: the topics added during the meeting, in the order they were added.
    /// At most one span of all topics is open: the topic "talking now". Left out of the JSON while
    /// empty, so agenda runs are stored unchanged.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub topics: Vec<Topic>,
}

/// A topic of an agenda-free meeting. The title is typed by a person and untrusted like any text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Topic {
    pub id: String,
    pub title: String,
    /// Only `manual` for now. A string so that another value is reported as a field error.
    pub source: String,
    /// When the topic was "talking now", in order. Its minutes are the sum of the spans.
    #[serde(default)]
    pub spans: Vec<Span>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Span {
    pub started_at: u64,
    /// None while the topic is "talking now".
    #[serde(default)]
    pub ended_at: Option<u64>,
}

impl Meeting {
    /// An agenda-free meeting. A meeting without `mode` is an agenda meeting.
    pub fn is_free(&self) -> bool {
        self.mode.as_deref() == Some(MODE_FREE)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunItem {
    /// Id of one of the meeting's agenda items.
    pub item_id: String,
    pub started_at: u64,
    #[serde(default)]
    pub ended_at: Option<u64>,
    /// Minutes added with "+5 min". Signed so that a negative value from the UI is reported as a field
    /// error instead of failing to parse.
    #[serde(default)]
    pub extra_minutes: i64,
    /// Ended with "Park it" instead of "Next".
    #[serde(default)]
    pub parked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Participant {
    pub id: String,
    pub name: String,
    /// Added in the speakers view: not on the invite. Left out of the JSON when false.
    #[serde(default, skip_serializing_if = "is_false")]
    pub guest: bool,
}

fn is_false(b: &bool) -> bool {
    !*b
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Goal {
    Inform,
    Discuss,
    Decide,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaItem {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub outcome: String,
    /// Id of one of the meeting's participants, or none.
    #[serde(default)]
    pub lead: Option<String>,
    pub goal: Goal,
    pub minutes: u32,
}

/// One rejected field. `field` is a path such as `title`, `participants[2].name` or `items[0].minutes`;
/// `code` is a stable identifier the UI maps to a translated message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldError {
    pub field: String,
    pub code: &'static str,
}

impl FieldError {
    fn new(field: impl Into<String>, code: &'static str) -> Self {
        Self {
            field: field.into(),
            code,
        }
    }
}

/// Ids are used as file names, so they are restricted to ASCII letters, digits and `-`.
pub fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= ID_MAX
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// Minutes since midnight for `HH:MM`, or `None` if it is not a valid 24-hour time.
pub fn parse_time(s: &str) -> Option<u32> {
    let b = s.as_bytes();
    if b.len() != 5 || b[2] != b':' {
        return None;
    }
    let h = two_digits(&b[0..2])?;
    let m = two_digits(&b[3..5])?;
    (h < 24 && m < 60).then_some(h * 60 + m)
}

fn two_digits(b: &[u8]) -> Option<u32> {
    if b.len() == 2 && b.iter().all(u8::is_ascii_digit) {
        Some(u32::from(b[0] - b'0') * 10 + u32::from(b[1] - b'0'))
    } else {
        None
    }
}

/// True for a real calendar date written as `YYYY-MM-DD`.
pub fn is_valid_date(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    let digits = |r: std::ops::Range<usize>| -> Option<u32> {
        let part = &b[r];
        part.iter()
            .all(u8::is_ascii_digit)
            .then(|| part.iter().fold(0, |acc, d| acc * 10 + u32::from(d - b'0')))
    };
    let (Some(y), Some(m), Some(d)) = (digits(0..4), digits(5..7), digits(8..10)) else {
        return false;
    };
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let days = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    y >= 1 && (1..=days).contains(&d)
}

fn char_len(s: &str) -> usize {
    s.chars().count()
}

/// Normalised form used to detect duplicate participant names.
fn name_key(name: &str) -> String {
    name.trim().to_lowercase()
}

/// Checks every rule the UI enforces. An empty result means the meeting may be saved.
pub fn validate(m: &Meeting) -> Vec<FieldError> {
    let mut errs = Vec::new();

    if m.version != SCHEMA_VERSION {
        errs.push(FieldError::new("version", "unsupported"));
    }
    if !is_valid_id(&m.id) {
        errs.push(FieldError::new("id", "invalid"));
    }

    if m.title.trim().is_empty() {
        errs.push(FieldError::new("title", "empty"));
    } else if char_len(&m.title) > TITLE_MAX {
        errs.push(FieldError::new("title", "tooLong"));
    }

    if !is_valid_date(&m.date) {
        errs.push(FieldError::new("date", "invalid"));
    }
    match (parse_time(&m.start), parse_time(&m.end)) {
        (None, _) => errs.push(FieldError::new("start", "invalid")),
        (_, None) => errs.push(FieldError::new("end", "invalid")),
        (Some(s), Some(e)) if e <= s => errs.push(FieldError::new("end", "notAfterStart")),
        _ => {}
    }

    if let Some(mode) = &m.mode {
        if mode != MODE_AGENDA && mode != MODE_FREE {
            errs.push(FieldError::new("mode", "unknown"));
        }
    }

    if m.participants.len() > MAX_PARTICIPANTS {
        errs.push(FieldError::new("participants", "tooMany"));
    }
    let mut seen_names = std::collections::HashSet::new();
    let mut seen_ids = std::collections::HashSet::new();
    for (i, p) in m.participants.iter().enumerate() {
        if !is_valid_id(&p.id) || !seen_ids.insert(p.id.as_str()) {
            errs.push(FieldError::new(format!("participants[{i}].id"), "invalid"));
        }
        let field = format!("participants[{i}].name");
        let max = if p.guest { GUEST_NAME_MAX } else { NAME_MAX };
        if p.name.trim().is_empty() {
            errs.push(FieldError::new(field, "empty"));
        } else if char_len(&p.name) > max {
            errs.push(FieldError::new(field, "tooLong"));
        } else if !seen_names.insert(name_key(&p.name)) {
            errs.push(FieldError::new(field, "duplicate"));
        }
    }

    if m.items.len() > MAX_ITEMS {
        errs.push(FieldError::new("items", "tooMany"));
    }
    let mut seen_items = std::collections::HashSet::new();
    for (i, it) in m.items.iter().enumerate() {
        if !is_valid_id(&it.id) || !seen_items.insert(it.id.as_str()) {
            errs.push(FieldError::new(format!("items[{i}].id"), "invalid"));
        }
        if it.title.trim().is_empty() {
            errs.push(FieldError::new(format!("items[{i}].title"), "empty"));
        } else if char_len(&it.title) > TITLE_MAX {
            errs.push(FieldError::new(format!("items[{i}].title"), "tooLong"));
        }
        if char_len(&it.outcome) > OUTCOME_MAX {
            errs.push(FieldError::new(format!("items[{i}].outcome"), "tooLong"));
        }
        if let Some(lead) = &it.lead {
            if !m.participants.iter().any(|p| &p.id == lead) {
                errs.push(FieldError::new(
                    format!("items[{i}].lead"),
                    "notParticipant",
                ));
            }
        }
        if !(MINUTES_MIN..=MINUTES_MAX).contains(&it.minutes) {
            errs.push(FieldError::new(format!("items[{i}].minutes"), "outOfRange"));
        }
    }

    if let Some(run) = &m.run {
        validate_run(m, run, &mut errs);
    }
    if m.recording_consent_at.is_some() && m.run.is_none() {
        errs.push(FieldError::new("recordingConsentAt", "withoutRun"));
    }
    if let Some(speakers) = &m.speakers {
        validate_speakers(m, speakers, &mut errs);
    }

    errs
}

/// Voice and line choices name participants of this meeting, once per voice and line.
fn validate_speakers(m: &Meeting, s: &Speakers, errs: &mut Vec<FieldError>) {
    let known = |id: &Option<String>| {
        id.as_ref()
            .is_none_or(|id| m.participants.iter().any(|p| &p.id == id))
    };
    let mut voices = std::collections::HashSet::new();
    for (i, v) in s.voices.iter().enumerate() {
        if !voices.insert(v.voice) {
            errs.push(FieldError::new(
                format!("speakers.voices[{i}].voice"),
                "duplicate",
            ));
        }
        if !known(&v.participant_id) {
            errs.push(FieldError::new(
                format!("speakers.voices[{i}].participantId"),
                "notParticipant",
            ));
        }
    }
    if s.lines.len() > MAX_LINE_CHOICES {
        errs.push(FieldError::new("speakers.lines", "tooMany"));
    }
    let mut lines = std::collections::HashSet::new();
    for (i, l) in s.lines.iter().enumerate() {
        if !lines.insert(l.seq) {
            errs.push(FieldError::new(
                format!("speakers.lines[{i}].seq"),
                "duplicate",
            ));
        }
        if !known(&l.participant_id) {
            errs.push(FieldError::new(
                format!("speakers.lines[{i}].participantId"),
                "notParticipant",
            ));
        }
    }
}

/// The run state comes from the UI over IPC and is checked like any other input.
fn validate_run(m: &Meeting, run: &Run, errs: &mut Vec<FieldError>) {
    if m.is_free() {
        // An agenda-free meeting keeps the typed agenda items in its draft, but its run ignores them.
        if !run.items.is_empty() {
            errs.push(FieldError::new("run.items", "notInFreeMode"));
        }
        validate_topics(run, errs);
    } else {
        if m.items.is_empty() {
            errs.push(FieldError::new("run", "noItems"));
        }
        if !run.topics.is_empty() {
            errs.push(FieldError::new("run.topics", "notInAgendaMode"));
        }
    }
    if let Some(end) = run.ended_at {
        if end < run.started_at {
            errs.push(FieldError::new("run.endedAt", "beforeStart"));
        }
    }
    let mut seen = std::collections::HashSet::new();
    let mut current = 0;
    for (i, r) in run.items.iter().enumerate() {
        let at = |f: &str| format!("run.items[{i}].{f}");
        if !m.items.iter().any(|it| it.id == r.item_id) {
            errs.push(FieldError::new(at("itemId"), "unknown"));
        } else if !seen.insert(r.item_id.as_str()) {
            errs.push(FieldError::new(at("itemId"), "duplicate"));
        }
        if r.started_at < run.started_at {
            errs.push(FieldError::new(at("startedAt"), "beforeRunStart"));
        }
        match r.ended_at {
            Some(end) if end < r.started_at => {
                errs.push(FieldError::new(at("endedAt"), "beforeStart"));
            }
            Some(_) => {}
            None => {
                current += 1;
                if r.parked {
                    errs.push(FieldError::new(at("parked"), "notEnded"));
                }
                if run.ended_at.is_some() {
                    errs.push(FieldError::new(at("endedAt"), "openAfterEnd"));
                }
            }
        }
        if !(0..=EXTRA_MINUTES_MAX).contains(&r.extra_minutes) {
            errs.push(FieldError::new(at("extraMinutes"), "outOfRange"));
        }
    }
    if current > 1 {
        errs.push(FieldError::new("run.items", "multipleCurrent"));
    }
}

/// The topics of an agenda-free run: titles as agenda item titles, unique ids, typed by a person, and
/// spans inside the run with at most one open ("talking now") and none once the run has ended.
fn validate_topics(run: &Run, errs: &mut Vec<FieldError>) {
    if run.topics.len() > MAX_TOPICS {
        errs.push(FieldError::new("run.topics", "tooMany"));
    }
    let mut ids = std::collections::HashSet::new();
    let mut open = 0;
    for (i, t) in run.topics.iter().enumerate() {
        let at = |f: &str| format!("run.topics[{i}].{f}");
        if !is_valid_id(&t.id) {
            errs.push(FieldError::new(at("id"), "invalid"));
        } else if !ids.insert(t.id.as_str()) {
            errs.push(FieldError::new(at("id"), "duplicate"));
        }
        if t.title.trim().is_empty() {
            errs.push(FieldError::new(at("title"), "empty"));
        } else if char_len(&t.title) > TITLE_MAX {
            errs.push(FieldError::new(at("title"), "tooLong"));
        }
        if t.source != SOURCE_MANUAL {
            errs.push(FieldError::new(at("source"), "unknown"));
        }
        if t.spans.len() > MAX_SPANS {
            errs.push(FieldError::new(at("spans"), "tooMany"));
        }
        for (j, s) in t.spans.iter().enumerate() {
            let at = |f: &str| format!("run.topics[{i}].spans[{j}].{f}");
            if s.started_at < run.started_at {
                errs.push(FieldError::new(at("startedAt"), "beforeRunStart"));
            }
            match s.ended_at {
                Some(end) if end < s.started_at => {
                    errs.push(FieldError::new(at("endedAt"), "beforeStart"));
                }
                Some(_) => {}
                None => {
                    open += 1;
                    if run.ended_at.is_some() {
                        errs.push(FieldError::new(at("endedAt"), "openAfterEnd"));
                    }
                }
            }
        }
    }
    if open > 1 {
        errs.push(FieldError::new("run.topics", "multipleCurrent"));
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn sample() -> Meeting {
        Meeting {
            version: SCHEMA_VERSION,
            id: "m-1".into(),
            title: "Product sync · Beta launch".into(),
            date: "2026-10-30".into(),
            start: "10:00".into(),
            end: "11:00".into(),
            participants: vec![
                Participant {
                    id: "p-1".into(),
                    name: "Mara Klein".into(),
                    guest: false,
                },
                Participant {
                    id: "p-2".into(),
                    name: "Tobias Brandt".into(),
                    guest: false,
                },
            ],
            items: vec![AgendaItem {
                id: "i-1".into(),
                title: "Check-in & goals".into(),
                outcome: String::new(),
                lead: Some("p-1".into()),
                goal: Goal::Inform,
                minutes: 5,
            }],
            mode: None,
            updated_at: 0,
            run: None,
            recording_consent_at: None,
            speakers: None,
        }
    }

    /// `sample()` with two items, started at 1000; item 1 is done, item 2 is current.
    pub fn running() -> Meeting {
        let mut m = sample();
        m.items.push(AgendaItem {
            id: "i-2".into(),
            title: "Beta launch".into(),
            outcome: String::new(),
            lead: None,
            goal: Goal::Decide,
            minutes: 15,
        });
        m.run = Some(Run {
            started_at: 1_000,
            ended_at: None,
            items: vec![
                RunItem {
                    item_id: "i-1".into(),
                    started_at: 1_000,
                    ended_at: Some(361_000),
                    extra_minutes: 0,
                    parked: false,
                },
                RunItem {
                    item_id: "i-2".into(),
                    started_at: 361_000,
                    ended_at: None,
                    extra_minutes: 5,
                    parked: false,
                },
            ],
            topics: vec![],
        });
        m
    }

    fn run_mut(m: &mut Meeting) -> &mut Run {
        m.run.as_mut().unwrap()
    }

    fn codes(m: &Meeting) -> Vec<(String, &'static str)> {
        validate(m).into_iter().map(|e| (e.field, e.code)).collect()
    }

    #[test]
    fn sample_is_valid() {
        assert!(validate(&sample()).is_empty());
    }

    #[test]
    fn rejects_empty_title() {
        let mut m = sample();
        m.title = "   ".into();
        assert_eq!(codes(&m), vec![("title".into(), "empty")]);
    }

    #[test]
    fn rejects_title_over_200_chars() {
        let mut m = sample();
        m.title = "ä".repeat(200);
        assert!(validate(&m).is_empty());
        m.title.push('x');
        assert_eq!(codes(&m), vec![("title".into(), "tooLong")]);
    }

    #[test]
    fn rejects_end_not_after_start() {
        let mut m = sample();
        m.end = "10:00".into();
        assert_eq!(codes(&m), vec![("end".into(), "notAfterStart")]);
        m.end = "09:30".into();
        assert_eq!(codes(&m), vec![("end".into(), "notAfterStart")]);
    }

    #[test]
    fn rejects_malformed_date_and_time() {
        let mut m = sample();
        m.date = "2026-02-30".into();
        m.start = "24:00".into();
        assert_eq!(
            codes(&m),
            vec![("date".into(), "invalid"), ("start".into(), "invalid")]
        );
        assert!(is_valid_date("2024-02-29"));
        assert!(!is_valid_date("2025-02-29"));
        assert!(!is_valid_date("2025-1-01"));
    }

    #[test]
    fn rejects_empty_participant_name() {
        let mut m = sample();
        m.participants[1].name = " ".into();
        assert_eq!(codes(&m), vec![("participants[1].name".into(), "empty")]);
    }

    #[test]
    fn rejects_duplicate_participant_name_ignoring_case_and_space() {
        let mut m = sample();
        m.participants[1].name = "  mara klein ".into();
        assert_eq!(
            codes(&m),
            vec![("participants[1].name".into(), "duplicate")]
        );
    }

    #[test]
    fn lead_must_be_a_participant() {
        let mut m = sample();
        m.items[0].lead = Some("p-9".into());
        assert_eq!(codes(&m), vec![("items[0].lead".into(), "notParticipant")]);
    }

    #[test]
    fn minutes_must_be_1_to_240() {
        let mut m = sample();
        for ok in [1, 240] {
            m.items[0].minutes = ok;
            assert!(validate(&m).is_empty());
        }
        for bad in [0, 241] {
            m.items[0].minutes = bad;
            assert_eq!(codes(&m), vec![("items[0].minutes".into(), "outOfRange")]);
        }
    }

    #[test]
    fn item_needs_a_title() {
        let mut m = sample();
        m.items[0].title = String::new();
        assert_eq!(codes(&m), vec![("items[0].title".into(), "empty")]);
    }

    #[test]
    fn ids_cannot_escape_the_store_directory() {
        for bad in ["", "../x", "a/b", "a\\b", "x.json", "C:", &"a".repeat(65)] {
            assert!(!is_valid_id(bad), "{bad} should be rejected");
        }
        assert!(is_valid_id("0b8e5c1e-1f2a-4c39-9d3e-6d2f3b1a2c4d"));
    }

    #[test]
    fn markup_in_text_is_kept_verbatim() {
        let mut m = sample();
        m.title = "<img src=x onerror=alert(1)>".into();
        assert!(validate(&m).is_empty());
        let json = serde_json::to_string(&m).unwrap();
        let back: Meeting = serde_json::from_str(&json).unwrap();
        assert_eq!(back.title, "<img src=x onerror=alert(1)>");
    }

    // ---- run state ------------------------------------------------------------------------------

    #[test]
    fn running_meeting_is_valid() {
        assert!(validate(&running()).is_empty());
    }

    #[test]
    fn version_1_file_without_run_loads_and_is_written_back_unchanged() {
        let json = r#"{"version":1,"id":"m-1","title":"Sync","date":"2026-10-30","start":"10:00",
            "end":"11:00","participants":[],"items":[{"id":"i-1","title":"A","outcome":"",
            "lead":null,"goal":"inform","minutes":5}],"updatedAt":7}"#;
        let m: Meeting = serde_json::from_str(json).unwrap();
        assert_eq!(m.run, None);
        assert!(validate(&m).is_empty());
        let back = serde_json::to_value(&m).unwrap();
        assert!(back.get("run").is_none());
    }

    #[test]
    fn run_round_trips_through_json_in_camel_case() {
        let m = running();
        let json = serde_json::to_value(&m).unwrap();
        assert_eq!(json["run"]["items"][1]["itemId"], "i-2");
        assert_eq!(json["run"]["items"][1]["extraMinutes"], 5);
        let back: Meeting = serde_json::from_value(json).unwrap();
        assert_eq!(back, m);
    }

    #[test]
    fn run_rejects_unknown_item_ids() {
        let mut m = running();
        run_mut(&mut m).items[1].item_id = "i-9".into();
        assert_eq!(codes(&m), vec![("run.items[1].itemId".into(), "unknown")]);
    }

    #[test]
    fn run_rejects_an_item_started_twice() {
        let mut m = running();
        run_mut(&mut m).items[1].item_id = "i-1".into();
        assert_eq!(codes(&m), vec![("run.items[1].itemId".into(), "duplicate")]);
    }

    #[test]
    fn run_rejects_item_end_before_start() {
        let mut m = running();
        run_mut(&mut m).items[0].ended_at = Some(999);
        assert_eq!(
            codes(&m),
            vec![("run.items[0].endedAt".into(), "beforeStart")]
        );
        let mut m = running();
        run_mut(&mut m).ended_at = Some(500);
        assert_eq!(
            codes(&m),
            vec![
                ("run.endedAt".into(), "beforeStart"),
                ("run.items[1].endedAt".into(), "openAfterEnd")
            ]
        );
    }

    #[test]
    fn run_rejects_an_item_started_before_the_meeting() {
        let mut m = running();
        run_mut(&mut m).items[0].started_at = 10;
        assert_eq!(
            codes(&m),
            vec![("run.items[0].startedAt".into(), "beforeRunStart")]
        );
    }

    #[test]
    fn run_rejects_more_than_one_current_item() {
        let mut m = running();
        run_mut(&mut m).items[0].ended_at = None;
        assert_eq!(codes(&m), vec![("run.items".into(), "multipleCurrent")]);
    }

    #[test]
    fn run_rejects_negative_or_absurd_extensions() {
        let mut m = running();
        for ok in [0, 5, 240] {
            run_mut(&mut m).items[1].extra_minutes = ok;
            assert!(validate(&m).is_empty(), "{ok} should be accepted");
        }
        for bad in [-5, 241, i64::MAX] {
            run_mut(&mut m).items[1].extra_minutes = bad;
            assert_eq!(
                codes(&m),
                vec![("run.items[1].extraMinutes".into(), "outOfRange")],
                "{bad} should be rejected"
            );
        }
    }

    #[test]
    fn run_rejects_a_meeting_without_items() {
        let mut m = sample();
        m.items.clear();
        m.run = Some(Run {
            started_at: 1,
            ended_at: None,
            items: vec![],
            topics: vec![],
        });
        assert_eq!(codes(&m), vec![("run".into(), "noItems")]);
    }

    #[test]
    fn run_rejects_a_parked_item_that_has_not_ended() {
        let mut m = running();
        run_mut(&mut m).items[1].parked = true;
        assert_eq!(codes(&m), vec![("run.items[1].parked".into(), "notEnded")]);
    }

    #[test]
    fn consent_is_optional_kept_and_needs_a_run() {
        // A file without the field (all files before this job) loads with no consent.
        let json = serde_json::to_value(running()).unwrap();
        assert!(json.get("recordingConsentAt").is_none());
        let back: Meeting = serde_json::from_value(json).unwrap();
        assert_eq!(back.recording_consent_at, None);
        let mut m = running();
        m.recording_consent_at = Some(2_000);
        assert!(validate(&m).is_empty());
        let json = serde_json::to_value(&m).unwrap();
        assert_eq!(json["recordingConsentAt"], 2_000);
        let mut s = sample();
        s.recording_consent_at = Some(1);
        assert_eq!(codes(&s), vec![("recordingConsentAt".into(), "withoutRun")]);
    }

    #[test]
    fn ended_run_with_every_item_closed_is_valid() {
        let mut m = running();
        let run = run_mut(&mut m);
        run.items[1].ended_at = Some(400_000);
        run.ended_at = Some(400_000);
        assert!(validate(&m).is_empty());
    }

    // ---- agenda-free mode (job 009) -------------------------------------------------------------

    fn topic(id: &str, spans: &[(u64, Option<u64>)]) -> Topic {
        Topic {
            id: id.into(),
            title: format!("Topic {id}"),
            source: SOURCE_MANUAL.into(),
            spans: spans
                .iter()
                .map(|&(started_at, ended_at)| Span {
                    started_at,
                    ended_at,
                })
                .collect(),
        }
    }

    /// An agenda-free meeting started at 1000 with two topics; t-2 is "talking now". The typed
    /// agenda item of `sample()` stays in the draft.
    pub fn free_running() -> Meeting {
        let mut m = sample();
        m.mode = Some(MODE_FREE.into());
        m.run = Some(Run {
            started_at: 1_000,
            ended_at: None,
            items: vec![],
            topics: vec![
                topic("t-1", &[(1_000, Some(61_000))]),
                topic("t-2", &[(61_000, None)]),
            ],
        });
        m
    }

    #[test]
    fn free_running_meeting_is_valid_and_round_trips_in_camel_case() {
        let m = free_running();
        assert!(validate(&m).is_empty(), "{:?}", validate(&m));
        let json = serde_json::to_value(&m).unwrap();
        assert_eq!(json["mode"], "free");
        assert_eq!(json["run"]["topics"][1]["source"], "manual");
        assert_eq!(json["run"]["topics"][0]["spans"][0]["endedAt"], 61_000);
        assert!(json["run"]["topics"][1]["spans"][0]["endedAt"].is_null());
        let back: Meeting = serde_json::from_value(json).unwrap();
        assert_eq!(back, m);
    }

    #[test]
    fn a_file_without_mode_loads_as_an_agenda_meeting_and_is_written_back_without_it() {
        let json = serde_json::to_value(running()).unwrap();
        assert!(json.get("mode").is_none());
        assert!(json["run"].get("topics").is_none());
        let back: Meeting = serde_json::from_value(json).unwrap();
        assert_eq!(back.mode, None);
        assert!(!back.is_free());
        assert!(back.run.unwrap().topics.is_empty());
        let mut m = running();
        m.mode = Some(MODE_AGENDA.into());
        assert!(validate(&m).is_empty());
    }

    #[test]
    fn rejects_an_unknown_mode() {
        let mut m = sample();
        for bad in ["", "Free", "auto", "<script>"] {
            m.mode = Some(bad.into());
            assert_eq!(codes(&m), vec![("mode".into(), "unknown")], "{bad}");
        }
    }

    #[test]
    fn a_free_run_without_agenda_items_is_accepted() {
        let mut m = free_running();
        m.items.clear();
        assert!(validate(&m).is_empty());
        run_mut(&mut m).topics.clear();
        assert!(validate(&m).is_empty());
    }

    #[test]
    fn an_agenda_run_without_items_is_still_rejected() {
        let mut m = free_running();
        m.items.clear();
        m.mode = Some(MODE_AGENDA.into());
        run_mut(&mut m).topics.clear();
        assert_eq!(codes(&m), vec![("run".into(), "noItems")]);
    }

    #[test]
    fn rejects_a_free_run_with_run_items() {
        let mut m = free_running();
        run_mut(&mut m).items.push(RunItem {
            item_id: "i-1".into(),
            started_at: 1_000,
            ended_at: Some(2_000),
            extra_minutes: 0,
            parked: false,
        });
        assert_eq!(codes(&m), vec![("run.items".into(), "notInFreeMode")]);
    }

    #[test]
    fn rejects_topics_on_an_agenda_run() {
        let mut m = running();
        run_mut(&mut m)
            .topics
            .push(topic("t-1", &[(1_000, Some(2_000))]));
        assert_eq!(codes(&m), vec![("run.topics".into(), "notInAgendaMode")]);
    }

    #[test]
    fn topic_titles_are_1_to_200_characters() {
        let mut m = free_running();
        run_mut(&mut m).topics[0].title = "ä".repeat(200);
        assert!(validate(&m).is_empty());
        run_mut(&mut m).topics[0].title.push('x');
        assert_eq!(codes(&m), vec![("run.topics[0].title".into(), "tooLong")]);
        run_mut(&mut m).topics[0].title = "  ".into();
        assert_eq!(codes(&m), vec![("run.topics[0].title".into(), "empty")]);
    }

    #[test]
    fn rejects_more_than_100_topics() {
        let mut m = free_running();
        let run = run_mut(&mut m);
        run.topics = (0..100)
            .map(|i| topic(&format!("t-{i}"), &[(2_000, Some(3_000))]))
            .collect();
        assert!(validate(&m).is_empty());
        run_mut(&mut m)
            .topics
            .push(topic("t-100", &[(2_000, Some(3_000))]));
        assert_eq!(codes(&m), vec![("run.topics".into(), "tooMany")]);
    }

    #[test]
    fn rejects_a_duplicate_or_malformed_topic_id() {
        let mut m = free_running();
        run_mut(&mut m).topics[1].id = "t-1".into();
        assert_eq!(codes(&m), vec![("run.topics[1].id".into(), "duplicate")]);
        run_mut(&mut m).topics[1].id = "../x".into();
        assert_eq!(codes(&m), vec![("run.topics[1].id".into(), "invalid")]);
    }

    #[test]
    fn rejects_a_topic_source_other_than_manual() {
        let mut m = free_running();
        for bad in ["detected", "", "Manual"] {
            run_mut(&mut m).topics[0].source = bad.into();
            assert_eq!(
                codes(&m),
                vec![("run.topics[0].source".into(), "unknown")],
                "{bad}"
            );
        }
    }

    #[test]
    fn rejects_a_span_before_the_run_or_ending_before_it_starts() {
        let mut m = free_running();
        run_mut(&mut m).topics[0].spans[0].started_at = 999;
        assert_eq!(
            codes(&m),
            vec![("run.topics[0].spans[0].startedAt".into(), "beforeRunStart")]
        );
        let mut m = free_running();
        run_mut(&mut m).topics[0].spans[0].ended_at = Some(500);
        assert_eq!(
            codes(&m),
            vec![("run.topics[0].spans[0].endedAt".into(), "beforeStart")]
        );
    }

    #[test]
    fn rejects_more_than_one_open_span() {
        let mut m = free_running();
        run_mut(&mut m).topics[0].spans[0].ended_at = None;
        assert_eq!(codes(&m), vec![("run.topics".into(), "multipleCurrent")]);
        // Also two open spans of the same topic.
        let mut m = free_running();
        run_mut(&mut m).topics[1].spans.push(Span {
            started_at: 70_000,
            ended_at: None,
        });
        assert_eq!(codes(&m), vec![("run.topics".into(), "multipleCurrent")]);
    }

    #[test]
    fn rejects_an_open_span_after_the_run_has_ended() {
        let mut m = free_running();
        run_mut(&mut m).ended_at = Some(100_000);
        assert_eq!(
            codes(&m),
            vec![("run.topics[1].spans[0].endedAt".into(), "openAfterEnd")]
        );
        run_mut(&mut m).topics[1].spans[0].ended_at = Some(100_000);
        assert!(validate(&m).is_empty());
    }

    #[test]
    fn rejects_a_topic_with_too_many_spans() {
        let mut m = free_running();
        run_mut(&mut m).topics[0].spans = (0..=MAX_SPANS as u64)
            .map(|i| Span {
                started_at: 1_000 + i,
                ended_at: Some(1_000 + i),
            })
            .collect();
        assert_eq!(codes(&m), vec![("run.topics[0].spans".into(), "tooMany")]);
    }

    // ---- speakers (job 004) -----------------------------------------------------------------------

    fn choice(voice: &str, pid: Option<&str>) -> VoiceChoice {
        VoiceChoice {
            voice: Voice::parse(voice).unwrap(),
            participant_id: pid.map(str::to_owned),
            source: NameSource::Manual,
            confirmed: true,
        }
    }

    #[test]
    fn meetings_without_speakers_load_and_save_unchanged() {
        let json = serde_json::to_value(running()).unwrap();
        assert!(json.get("speakers").is_none());
        assert!(json["participants"][0].get("guest").is_none());
        let back: Meeting = serde_json::from_value(json).unwrap();
        assert_eq!(back.speakers, None);
        assert!(!back.participants[0].guest);
    }

    #[test]
    fn speakers_round_trip_in_camel_case_with_guests() {
        let mut m = running();
        m.participants.push(Participant {
            id: "guest-1".into(),
            name: "Gast vom Amt".into(),
            guest: true,
        });
        m.speakers = Some(Speakers {
            voices: vec![
                VoiceChoice {
                    source: NameSource::NameRound,
                    ..choice("A", Some("p-1"))
                },
                choice("B", None),
                choice("C", Some("guest-1")),
            ],
            lines: vec![LineChoice {
                seq: 7,
                participant_id: Some("p-2".into()),
            }],
        });
        assert!(validate(&m).is_empty(), "{:?}", validate(&m));
        let json = serde_json::to_value(&m).unwrap();
        assert_eq!(json["speakers"]["voices"][0]["voice"], "A");
        assert_eq!(json["speakers"]["voices"][0]["participantId"], "p-1");
        assert_eq!(json["speakers"]["voices"][0]["source"], "nameRound");
        assert_eq!(json["speakers"]["voices"][0]["confirmed"], true);
        assert_eq!(json["speakers"]["lines"][0]["seq"], 7);
        assert_eq!(json["participants"][2]["guest"], true);
        let back: Meeting = serde_json::from_value(json).unwrap();
        assert_eq!(back, m);
    }

    #[test]
    fn speakers_name_only_participants_once_per_voice_and_line() {
        let mut m = running();
        m.speakers = Some(Speakers {
            voices: vec![choice("A", Some("p-9")), choice("A", Some("p-1"))],
            lines: vec![
                LineChoice {
                    seq: 1,
                    participant_id: Some("nobody".into()),
                },
                LineChoice {
                    seq: 1,
                    participant_id: None,
                },
            ],
        });
        assert_eq!(
            codes(&m),
            vec![
                ("speakers.voices[0].participantId".into(), "notParticipant"),
                ("speakers.voices[1].voice".into(), "duplicate"),
                ("speakers.lines[0].participantId".into(), "notParticipant"),
                ("speakers.lines[1].seq".into(), "duplicate"),
            ]
        );
        let bad: Result<VoiceChoice, _> = serde_json::from_str(
            r#"{"voice":"a","participantId":null,"source":"manual","confirmed":true}"#,
        );
        assert!(bad.is_err());
    }

    #[test]
    fn guest_names_are_at_most_80_characters() {
        let mut m = running();
        m.participants.push(Participant {
            id: "guest-1".into(),
            name: "x".repeat(80),
            guest: true,
        });
        assert!(validate(&m).is_empty());
        m.participants[2].name.push('x');
        assert_eq!(codes(&m), vec![("participants[2].name".into(), "tooLong")]);
    }
}
