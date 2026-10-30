//! Who said what: name-round suggestions, and the choices people make in the speakers view.
//!
//! - [`name_round`] suggests, for each voice, the invited people whose full or first name the voice
//!   said during the first [`NAME_ROUND_MS`] of recorded audio. Transcript text is untrusted: it is
//!   only split into words and compared, never interpreted. A suggestion changes nothing until a
//!   person confirms it.
//! - The commands ([`choose_voice`], [`choose_line`], [`add_guest`], [`apply_name_round`]) check every
//!   input (voice label, participant id, line sequence number, guest name) against the stored
//!   meeting and transcript, and store the choice in the meeting file. The transcript is never
//!   changed. Errors carry no names and no text.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::model::{
    LineChoice, Meeting, NameSource, Participant, Speakers, VoiceChoice, GUEST_NAME_MAX,
    MAX_PARTICIPANTS,
};
use crate::store::{MeetingStore, StoreError};
use crate::transcript::{Segment, TranscriptError, TranscriptStore, Voice};

/// The name round: the first two minutes of recorded audio.
pub const NAME_ROUND_MS: u64 = 120_000;

/// A suggestion for one voice. `unsure` when the voice named several invited people, or when
/// another voice named the same person.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub voice: Voice,
    /// Participant ids, in invite order.
    pub candidates: Vec<String>,
    pub unsure: bool,
}

impl Suggestion {
    /// The one person this suggestion names, if it is not unsure.
    pub fn person(&self) -> Option<&str> {
        match (self.unsure, self.candidates.as_slice()) {
            (false, [one]) => Some(one),
            _ => None,
        }
    }
}

/// Lowercased words: runs of letters and digits (umlauts and ß included, as written).
fn words(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_lowercase)
        .collect()
}

fn contains_words(haystack: &[String], needle: &[String]) -> bool {
    !needle.is_empty() && haystack.windows(needle.len()).any(|w| w == needle)
}

/// Suggestions for every voice that named an invited person in the name round, by voice.
pub fn name_round(participants: &[Participant], segments: &[Segment]) -> Vec<Suggestion> {
    let invited: Vec<(&str, Vec<String>, Vec<String>)> = participants
        .iter()
        .filter(|p| !p.guest)
        .map(|p| {
            let first = p.name.split_whitespace().next().unwrap_or_default();
            (p.id.as_str(), words(&p.name), words(first))
        })
        .collect();
    let mut named: BTreeMap<Voice, BTreeSet<usize>> = BTreeMap::new();
    for s in segments {
        let Some(voice) = s.voice else { continue };
        if !s.is_final || s.start_ms >= NAME_ROUND_MS {
            continue;
        }
        let said = words(&s.text);
        for (i, (_, full, first)) in invited.iter().enumerate() {
            if contains_words(&said, full) || contains_words(&said, first) {
                named.entry(voice).or_default().insert(i);
            }
        }
    }
    let mut voices_per_person: BTreeMap<usize, usize> = BTreeMap::new();
    for people in named.values() {
        for p in people {
            *voices_per_person.entry(*p).or_default() += 1;
        }
    }
    named
        .into_iter()
        .map(|(voice, people)| Suggestion {
            voice,
            unsure: people.len() > 1 || people.iter().any(|p| voices_per_person[p] > 1),
            candidates: people
                .into_iter()
                .map(|i| invited[i].0.to_owned())
                .collect(),
        })
        .collect()
}

/// What the speakers view and the transcript need: the people, the stored choices and the
/// suggestions. No engine type and no embedding.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerState {
    /// Invited people and guests.
    pub participants: Vec<Participant>,
    /// Stored voice choices (confirmed by a person).
    pub voices: Vec<VoiceChoice>,
    /// Stored line choices.
    pub lines: Vec<LineChoice>,
    /// Name-round suggestions for voices without a stored choice.
    pub suggestions: Vec<Suggestion>,
}

/// Why a speaker command was refused. Carries no names and no transcript text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SpeakerError {
    NoMeeting,
    /// Not a voice label `A`–`Z`.
    InvalidVoice,
    /// A well-formed label that no line of the transcript has.
    UnknownVoice,
    UnknownParticipant,
    /// No line of the transcript has this sequence number.
    UnknownLine,
    /// The guest name is `empty`, `tooLong`, a `duplicate` of someone's name, or there are `tooMany`.
    InvalidName {
        code: &'static str,
    },
    Locked,
    StorageFailed,
    TranscriptUnreadable,
}

impl From<StoreError> for SpeakerError {
    fn from(e: StoreError) -> Self {
        match e {
            StoreError::KeyUnavailable => SpeakerError::Locked,
            other => {
                crate::log!("could not store a speaker choice: {other}");
                SpeakerError::StorageFailed
            }
        }
    }
}

impl From<TranscriptError> for SpeakerError {
    fn from(e: TranscriptError) -> Self {
        crate::log!("could not read the transcript for speakers: {e}");
        match e {
            TranscriptError::KeyUnavailable => SpeakerError::Locked,
            _ => SpeakerError::TranscriptUnreadable,
        }
    }
}

/// What a line or voice choice points at.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LineTarget {
    /// This participant said the line.
    #[serde(rename_all = "camelCase")]
    Person { participant_id: String },
    /// Nobody is shown for the line.
    Nobody,
    /// The line follows its voice again (the line choice is removed).
    Voice,
}

fn load(meetings: &dyn MeetingStore, id: &str) -> Result<Meeting, SpeakerError> {
    meetings.load(id)?.ok_or(SpeakerError::NoMeeting)
}

fn state_of(meeting: &Meeting, segments: &[Segment]) -> SpeakerState {
    let speakers = meeting.speakers.clone().unwrap_or_default();
    let suggestions = name_round(&meeting.participants, segments)
        .into_iter()
        .filter(|s| !speakers.voices.iter().any(|v| v.voice == s.voice))
        .collect();
    SpeakerState {
        participants: meeting.participants.clone(),
        voices: speakers.voices,
        lines: speakers.lines,
        suggestions,
    }
}

/// The speakers of a meeting.
pub fn speaker_state(
    meetings: &dyn MeetingStore,
    transcripts: &dyn TranscriptStore,
    id: &str,
) -> Result<SpeakerState, SpeakerError> {
    let meeting = load(meetings, id)?;
    let segments = transcripts.load(id)?;
    Ok(state_of(&meeting, &segments))
}

fn check_participant(meeting: &Meeting, id: Option<&str>) -> Result<(), SpeakerError> {
    match id {
        Some(id) if !meeting.participants.iter().any(|p| p.id == id) => {
            Err(SpeakerError::UnknownParticipant)
        }
        _ => Ok(()),
    }
}

fn save(
    meetings: &dyn MeetingStore,
    mut meeting: Meeting,
    speakers: Speakers,
    segments: &[Segment],
    now_ms: u64,
) -> Result<SpeakerState, SpeakerError> {
    meeting.speakers = Some(speakers);
    meeting.updated_at = now_ms;
    meetings.save(&meeting)?;
    Ok(state_of(&meeting, segments))
}

/// Sets the person for a voice (`None`: "Unassigned"). The source is "Name round" when the person is
/// the voice's name-round suggestion, else "Picked by hand".
pub fn choose_voice(
    meetings: &dyn MeetingStore,
    transcripts: &dyn TranscriptStore,
    id: &str,
    voice: &str,
    participant_id: Option<&str>,
    now_ms: u64,
) -> Result<SpeakerState, SpeakerError> {
    let voice = Voice::parse(voice).ok_or(SpeakerError::InvalidVoice)?;
    let meeting = load(meetings, id)?;
    let segments = transcripts.load(id)?;
    if !segments.iter().any(|s| s.voice == Some(voice)) {
        return Err(SpeakerError::UnknownVoice);
    }
    check_participant(&meeting, participant_id)?;
    let suggested = name_round(&meeting.participants, &segments)
        .into_iter()
        .find(|s| s.voice == voice)
        .and_then(|s| s.person().map(str::to_owned));
    let source = match (participant_id, suggested.as_deref()) {
        (Some(p), Some(s)) if p == s => NameSource::NameRound,
        _ => NameSource::Manual,
    };
    let mut speakers = meeting.speakers.clone().unwrap_or_default();
    speakers.voices.retain(|v| v.voice != voice);
    speakers.voices.push(VoiceChoice {
        voice,
        participant_id: participant_id.map(str::to_owned),
        source,
        confirmed: true,
    });
    speakers.voices.sort_by_key(|v| v.voice);
    save(meetings, meeting, speakers, &segments, now_ms)
}

/// Sets who said one line, overriding its voice for that line only, or lets it follow its voice.
pub fn choose_line(
    meetings: &dyn MeetingStore,
    transcripts: &dyn TranscriptStore,
    id: &str,
    seq: u64,
    target: &LineTarget,
    now_ms: u64,
) -> Result<SpeakerState, SpeakerError> {
    let meeting = load(meetings, id)?;
    let segments = transcripts.load(id)?;
    if seq >= segments.len() as u64 {
        return Err(SpeakerError::UnknownLine);
    }
    let mut speakers = meeting.speakers.clone().unwrap_or_default();
    speakers.lines.retain(|l| l.seq != seq);
    let participant_id = match target {
        LineTarget::Person { participant_id } => {
            check_participant(&meeting, Some(participant_id))?;
            Some(Some(participant_id.clone()))
        }
        LineTarget::Nobody => Some(None),
        LineTarget::Voice => None,
    };
    if let Some(participant_id) = participant_id {
        speakers.lines.push(LineChoice {
            seq,
            participant_id,
        });
        speakers.lines.sort_by_key(|l| l.seq);
    }
    save(meetings, meeting, speakers, &segments, now_ms)
}

/// A new guest and the speakers with it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestAdded {
    pub participant_id: String,
    pub state: SpeakerState,
}

/// Adds a participant who was not on the invite (`guest: true`). The name is trimmed and must be
/// 1–80 characters and differ from everyone else's.
pub fn add_guest(
    meetings: &dyn MeetingStore,
    transcripts: &dyn TranscriptStore,
    id: &str,
    name: &str,
    now_ms: u64,
) -> Result<GuestAdded, SpeakerError> {
    let name = name.trim();
    let invalid = |code| Err(SpeakerError::InvalidName { code });
    if name.is_empty() {
        return invalid("empty");
    }
    if name.chars().count() > GUEST_NAME_MAX {
        return invalid("tooLong");
    }
    let mut meeting = load(meetings, id)?;
    let key = name.to_lowercase();
    if meeting
        .participants
        .iter()
        .any(|p| p.name.trim().to_lowercase() == key)
    {
        return invalid("duplicate");
    }
    if meeting.participants.len() >= MAX_PARTICIPANTS {
        return invalid("tooMany");
    }
    let segments = transcripts.load(id)?;
    let participant_id = (1..)
        .map(|n| format!("guest-{n}"))
        .find(|g| !meeting.participants.iter().any(|p| &p.id == g))
        .unwrap_or_default();
    meeting.participants.push(Participant {
        id: participant_id.clone(),
        name: name.to_owned(),
        guest: true,
    });
    let speakers = meeting.speakers.clone().unwrap_or_default();
    let state = save(meetings, meeting, speakers, &segments, now_ms)?;
    Ok(GuestAdded {
        participant_id,
        state,
    })
}

/// "Apply names to transcript": confirms every name-round suggestion that names exactly one person.
/// Unsure voices stay open.
pub fn apply_name_round(
    meetings: &dyn MeetingStore,
    transcripts: &dyn TranscriptStore,
    id: &str,
    now_ms: u64,
) -> Result<SpeakerState, SpeakerError> {
    let meeting = load(meetings, id)?;
    let segments = transcripts.load(id)?;
    let mut speakers = meeting.speakers.clone().unwrap_or_default();
    for s in name_round(&meeting.participants, &segments) {
        let Some(person) = s.person() else { continue };
        if speakers.voices.iter().any(|v| v.voice == s.voice) {
            continue;
        }
        speakers.voices.push(VoiceChoice {
            voice: s.voice,
            participant_id: Some(person.to_owned()),
            source: NameSource::NameRound,
            confirmed: true,
        });
    }
    speakers.voices.sort_by_key(|v| v.voice);
    save(meetings, meeting, speakers, &segments, now_ms)
}

#[cfg(test)]
mod tests;
