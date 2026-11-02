//! Quick capture (job 018): the decisions, to-dos and questions people type during a meeting.
//!
//! The commands ([`add_capture`], [`update_capture`], [`delete_capture`], [`restore_capture`]) load the
//! stored meeting, check the input against it ([`crate::model::validate_capture`]), and write the
//! meeting file before they answer, so the UI shows a capture as saved only once it is on disk. The
//! core makes the id and takes the time from its own clock. Capture text is untrusted: it is trimmed
//! and length-limited, never interpreted, and never logged; errors carry field names and codes only.
//!
//! Nothing here calls a language model or the network: every capture is typed by a person.

use serde::{Deserialize, Serialize};

use chacha20poly1305::aead::rand_core::RngCore;
use chacha20poly1305::aead::OsRng;

use crate::model::{self, Capture, FieldError, Meeting, CAPTURE_SOURCE_TYPED, MAX_CAPTURES};
use crate::store::{MeetingStore, StoreError};

/// A new capture as the UI sends it. Closed schema: any other field is refused.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewCapture {
    pub kind: String,
    pub text: String,
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub due: Option<String>,
    /// The agenda item shown as the target ("→ Item 02"); agenda meetings only.
    #[serde(default)]
    pub item_id: Option<String>,
    /// The topic shown as the target; agenda-free meetings only. Neither: "no topic".
    #[serde(default)]
    pub topic_id: Option<String>,
}

/// An edit of a capture. Item and topic stay as they were; moving a capture is not part of this job.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaptureChange {
    pub kind: String,
    pub text: String,
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub due: Option<String>,
}

/// The capture a command wrote (or removed), and every capture of the meeting afterwards.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSaved {
    pub capture: Capture,
    pub captures: Vec<Capture>,
}

/// Why a capture command was refused. Carries field names and codes only, never capture text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CaptureError {
    /// The input broke a rule; nothing was stored. `field` is `text`, `kind`, `owner`, `due`,
    /// `itemId`, `topicId`, `id`, … and `code` a stable identifier the UI maps to a message.
    Invalid {
        fields: Vec<FieldError>,
    },
    NoMeeting,
    /// The meeting has not started or has ended.
    NotRunning,
    /// No capture of the meeting has this id.
    UnknownCapture,
    /// The data key is not available; nothing was written.
    Locked,
    StorageFailed,
}

impl From<StoreError> for CaptureError {
    fn from(e: StoreError) -> Self {
        match e {
            StoreError::Invalid(fields) => CaptureError::Invalid { fields },
            StoreError::KeyUnavailable => CaptureError::Locked,
            other => {
                // The error kind only; the store's errors never hold meeting content.
                crate::log!("could not store a capture: {other}");
                CaptureError::StorageFailed
            }
        }
    }
}

fn invalid(fields: Vec<FieldError>) -> CaptureError {
    CaptureError::Invalid { fields }
}

fn load(meetings: &dyn MeetingStore, id: &str) -> Result<Meeting, CaptureError> {
    meetings.load(id)?.ok_or(CaptureError::NoMeeting)
}

fn load_running(meetings: &dyn MeetingStore, id: &str) -> Result<Meeting, CaptureError> {
    let meeting = load(meetings, id)?;
    if meeting.run.as_ref().is_some_and(|r| r.ended_at.is_none()) {
        Ok(meeting)
    } else {
        Err(CaptureError::NotRunning)
    }
}

/// Empty strings from the UI mean "none".
fn none_if_empty(v: Option<String>) -> Option<String> {
    v.filter(|s| !s.trim().is_empty())
}

/// A capture id from the OS random generator: `c-` and 16 hex digits, unique in the meeting.
fn new_id(meeting: &Meeting) -> String {
    loop {
        let id = format!("c-{:016x}", OsRng.next_u64());
        if !meeting.captures.iter().any(|c| c.id == id) {
            return id;
        }
    }
}

fn check(meeting: &Meeting, capture: &Capture) -> Result<(), CaptureError> {
    let errs = model::validate_capture(meeting, capture);
    if errs.is_empty() {
        Ok(())
    } else {
        Err(invalid(errs))
    }
}

/// Writes the meeting and answers with `capture` and the stored list.
fn write(
    meetings: &dyn MeetingStore,
    mut meeting: Meeting,
    capture: Capture,
    now_ms: u64,
) -> Result<CaptureSaved, CaptureError> {
    meeting.updated_at = now_ms;
    meetings.save(&meeting)?;
    Ok(CaptureSaved {
        capture,
        captures: meeting.captures,
    })
}

/// Every capture of a meeting, in the order they were captured.
pub fn load_captures(meetings: &dyn MeetingStore, id: &str) -> Result<Vec<Capture>, CaptureError> {
    Ok(load(meetings, id)?.captures)
}

/// Quick capture: stores a confirmed capture typed by a person, attached to the item or topic the UI
/// showed as the target. The text is trimmed; id and time come from the core.
pub fn add_capture(
    meetings: &dyn MeetingStore,
    id: &str,
    input: NewCapture,
    now_ms: u64,
) -> Result<CaptureSaved, CaptureError> {
    let mut meeting = load_running(meetings, id)?;
    let capture = Capture {
        id: new_id(&meeting),
        kind: input.kind,
        text: input.text.trim().to_owned(),
        owner: none_if_empty(input.owner),
        due: none_if_empty(input.due),
        item_id: none_if_empty(input.item_id),
        topic_id: none_if_empty(input.topic_id),
        source: CAPTURE_SOURCE_TYPED.to_owned(),
        created_at: now_ms,
        edited_at: None,
    };
    check(&meeting, &capture)?;
    if meeting.captures.len() >= MAX_CAPTURES {
        return Err(invalid(vec![FieldError {
            field: "captures".into(),
            code: "tooMany",
        }]));
    }
    meeting.captures.push(capture.clone());
    write(meetings, meeting, capture, now_ms)
}

/// Saves an edit of kind, text, owner and due date. Id, time, item or topic and source stay.
pub fn update_capture(
    meetings: &dyn MeetingStore,
    id: &str,
    capture_id: &str,
    change: CaptureChange,
    now_ms: u64,
) -> Result<CaptureSaved, CaptureError> {
    let mut meeting = load_running(meetings, id)?;
    let index = meeting
        .captures
        .iter()
        .position(|c| c.id == capture_id)
        .ok_or(CaptureError::UnknownCapture)?;
    let old = &meeting.captures[index];
    let capture = Capture {
        kind: change.kind,
        text: change.text.trim().to_owned(),
        owner: none_if_empty(change.owner),
        due: none_if_empty(change.due),
        edited_at: Some(now_ms.max(old.created_at)),
        ..old.clone()
    };
    check(&meeting, &capture)?;
    meeting.captures[index] = capture.clone();
    write(meetings, meeting, capture, now_ms)
}

/// Removes a capture. The answer holds the removed capture, so "Undo" can bring it back as it was.
pub fn delete_capture(
    meetings: &dyn MeetingStore,
    id: &str,
    capture_id: &str,
    now_ms: u64,
) -> Result<CaptureSaved, CaptureError> {
    let mut meeting = load_running(meetings, id)?;
    let index = meeting
        .captures
        .iter()
        .position(|c| c.id == capture_id)
        .ok_or(CaptureError::UnknownCapture)?;
    let removed = meeting.captures.remove(index);
    write(meetings, meeting, removed, now_ms)
}

/// "Undo" of a delete: puts the capture back with its original id, time and item or topic. It comes
/// from the UI and is checked like any input; its id must not be in use.
pub fn restore_capture(
    meetings: &dyn MeetingStore,
    id: &str,
    capture: Capture,
    now_ms: u64,
) -> Result<CaptureSaved, CaptureError> {
    let mut meeting = load_running(meetings, id)?;
    let mut errs = model::validate_capture(&meeting, &capture);
    if meeting.captures.iter().any(|c| c.id == capture.id) {
        errs.push(FieldError {
            field: "id".into(),
            code: "duplicate",
        });
    }
    if capture.text != capture.text.trim() {
        errs.push(FieldError {
            field: "text".into(),
            code: "untrimmed",
        });
    }
    if !errs.is_empty() {
        return Err(invalid(errs));
    }
    if meeting.captures.len() >= MAX_CAPTURES {
        return Err(invalid(vec![FieldError {
            field: "captures".into(),
            code: "tooMany",
        }]));
    }
    meeting.captures.push(capture.clone());
    meeting.captures.sort_by_key(|c| c.created_at);
    write(meetings, meeting, capture, now_ms)
}

#[cfg(test)]
mod tests;
