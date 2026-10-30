//! The meeting as it is stored on the device, and the validation every save goes through.
//!
//! All text in a meeting comes from a person typing into the app and is untrusted: it is length-limited
//! here, never interpreted, and the UI renders it as text only.

use serde::{Deserialize, Serialize};

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
    /// Milliseconds since the Unix epoch of the last save; set by the app, not by the UI.
    #[serde(default)]
    pub updated_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Participant {
    pub id: String,
    pub name: String,
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
        if p.name.trim().is_empty() {
            errs.push(FieldError::new(field, "empty"));
        } else if char_len(&p.name) > NAME_MAX {
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

    errs
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
                },
                Participant {
                    id: "p-2".into(),
                    name: "Tobias Brandt".into(),
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
            updated_at: 0,
        }
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
}
