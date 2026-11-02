//! What the suggester sends and how it reads the answer.
//!
//! - [`SUGGEST_TASK`] is the fixed instruction (a `&'static str`). Transcript text only ever goes into
//!   the request's content, which [`crate::engines::llm::Prompt::build`] escapes and wraps in the
//!   `<untrusted_content>` block.
//! - [`content`] writes one line per final segment, newest last: `#<number> <time> <speaker>: <text>`.
//!   It keeps the newest segments that fit in [`MAX_INPUT_CHARS`], so the limit cuts the oldest.
//! - [`parse_reply`] reads the answer against a closed format. A reply without its `SUGGESTIONS` / `END`
//!   frame, or one the engine cut at its limit, gives nothing; inside the frame, each entry is checked
//!   on its own and a bad one is dropped. Nothing of the model's text ever goes into an error.

use std::collections::BTreeSet;

use crate::engines::llm::LlmReply;
use crate::model::{
    Meeting, Participant, CAPTURE_KINDS, CAPTURE_SEGMENTS_MAX, CAPTURE_TEXT_MAX, KIND_TODO,
};
use crate::settings::Locale;
use crate::transcript::Voice;

/// The suggester's fixed instructions. The engine adds [`crate::engines::llm::CONTENT_RULE`].
pub const SUGGEST_TASK: &str = "You help a meeting team notice decisions, to-dos and open questions \
in a short excerpt of their meeting transcript. A person confirms or dismisses every suggestion you \
make; you never decide anything yourself.
Each transcript line reads: #<number> <time> <speaker>: <what was said>. <time> is minutes:seconds \
since the meeting started.
Reply in exactly this format and nothing else:
SUGGESTIONS
<kind>|<numbers>|<owner>|<text>
END
<kind> is decision, todo or question. <numbers> are the numbers of the transcript lines it comes \
from, separated by commas, for example 12,13. <owner> is empty, or, for a todo only, the speaker \
name exactly as written in the transcript of the person who takes it on. <text> is one short \
sentence in the language of the transcript that says what was decided, what is to be done or what \
is asked.
Suggest only what was clearly said in the lines, at most 3 entries. If there is nothing, reply with \
the two lines SUGGESTIONS and END.";

/// The frame of a reply.
pub const REPLY_OPEN: &str = "SUGGESTIONS";
pub const REPLY_CLOSE: &str = "END";
/// Most final segments one request holds (the newest).
pub const WINDOW_SEGMENTS: usize = 20;
/// Most characters of content one request holds; the oldest lines go first.
pub const MAX_INPUT_CHARS: usize = 6_000;
/// The reply's token limit: three entries need far fewer.
pub const MAX_OUTPUT_TOKENS: u32 = 600;
/// Most suggestions one reply can add; further valid entries are dropped.
pub const MAX_PER_RUN: usize = 3;

/// A final segment of the running meeting, as the suggester holds it (memory only).
#[derive(Clone, PartialEq, Eq)]
pub struct Line {
    pub seq: u64,
    /// Wall-clock start, ms since epoch.
    pub at: u64,
    pub text: String,
    pub voice: Option<Voice>,
}

/// One checked entry of a reply: kind, text, owner (a participant id) and source segments.
#[derive(Clone, PartialEq, Eq)]
pub struct Parsed {
    pub kind: String,
    pub text: String,
    pub owner: Option<String>,
    pub segments: Vec<u64>,
}

/// The speaker of a line: the person chosen for the line, else the person chosen for its voice in the
/// speakers view, else the voice label ("Stimme A"), else "unknown".
pub fn speaker_name(meeting: &Meeting, line: &Line, locale: Locale) -> String {
    let person = |id: &Option<String>| {
        id.as_ref()
            .and_then(|id| meeting.participants.iter().find(|p| &p.id == id))
            .map(|p| p.name.clone())
    };
    let speakers = meeting.speakers.as_ref();
    if let Some(choice) = speakers.and_then(|s| s.lines.iter().find(|l| l.seq == line.seq)) {
        return person(&choice.participant_id).unwrap_or_else(|| unknown(locale).to_owned());
    }
    if let Some(voice) = line.voice {
        if let Some(name) = speakers
            .and_then(|s| s.voices.iter().find(|v| v.voice == voice))
            .and_then(|v| person(&v.participant_id))
        {
            return name;
        }
        let label = voice.to_string();
        return match locale {
            Locale::De => format!("Stimme {label}"),
            Locale::En => format!("Voice {label}"),
        };
    }
    unknown(locale).to_owned()
}

fn unknown(locale: Locale) -> &'static str {
    match locale {
        Locale::De => "Unbekannt",
        Locale::En => "Unknown",
    }
}

/// `m:ss` (or `h:mm:ss`) since the meeting started.
fn since_start(meeting: &Meeting, at: u64) -> String {
    let start = meeting.run.as_ref().map(|r| r.started_at).unwrap_or(at);
    let s = at.saturating_sub(start) / 1_000;
    if s >= 3_600 {
        format!("{}:{:02}:{:02}", s / 3_600, (s / 60) % 60, s % 60)
    } else {
        format!("{}:{:02}", s / 60, s % 60)
    }
}

/// One line of text on one line: line breaks in transcript text or names become spaces.
fn one_line(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .trim()
        .to_owned()
}

/// The request's content: the newest final segments of `lines` (oldest first, newest last) that fit
/// in [`MAX_INPUT_CHARS`], and the numbers of the segments it holds.
pub fn content(meeting: &Meeting, lines: &[Line], locale: Locale) -> (String, Vec<u64>) {
    let mut picked: Vec<String> = Vec::new();
    let mut seqs: Vec<u64> = Vec::new();
    let mut chars = 0usize;
    for line in lines.iter().rev().take(WINDOW_SEGMENTS) {
        let text = format!(
            "#{} {} {}: {}",
            line.seq,
            since_start(meeting, line.at),
            one_line(&speaker_name(meeting, line, locale)),
            one_line(&line.text)
        );
        let n = text.chars().count() + 1;
        // The newest line always goes (the prompt cuts it if it alone is too long).
        if !picked.is_empty() && chars + n > MAX_INPUT_CHARS {
            break;
        }
        chars += n;
        picked.push(text);
        seqs.push(line.seq);
    }
    picked.reverse();
    seqs.reverse();
    (picked.join("\n"), seqs)
}

/// Reads a reply. `sent` are the segment numbers of the request; `people` the meeting's participants.
pub fn parse_reply(reply: &LlmReply, sent: &[u64], people: &[Participant]) -> Vec<Parsed> {
    if reply.output_truncated {
        return Vec::new();
    }
    let lines: Vec<&str> = reply
        .text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    let (Some(&first), Some(&last)) = (lines.first(), lines.last()) else {
        return Vec::new();
    };
    if lines.len() < 2 || first != REPLY_OPEN || last != REPLY_CLOSE {
        return Vec::new();
    }
    let sent: BTreeSet<u64> = sent.iter().copied().collect();
    lines[1..lines.len() - 1]
        .iter()
        .filter_map(|l| entry(l, &sent, people))
        .take(MAX_PER_RUN)
        .collect()
}

fn entry(line: &str, sent: &BTreeSet<u64>, people: &[Participant]) -> Option<Parsed> {
    let mut parts = line.splitn(4, '|');
    let kind = parts.next()?.trim();
    let numbers = parts.next()?;
    let owner = parts.next()?.trim();
    let text = parts.next()?.trim();
    if !CAPTURE_KINDS.contains(&kind) {
        return None;
    }
    let mut segments = BTreeSet::new();
    for n in numbers.split(',') {
        let n = n.trim().trim_start_matches('#');
        let seq: u64 = n.parse().ok()?;
        if !sent.contains(&seq) {
            return None;
        }
        segments.insert(seq);
    }
    if segments.is_empty() || segments.len() > CAPTURE_SEGMENTS_MAX {
        return None;
    }
    let count = text.chars().count();
    if count == 0 || count > CAPTURE_TEXT_MAX {
        return None;
    }
    // An owner only on a to-do, and only a participant's exact name; otherwise the owner goes and the
    // suggestion stays.
    let owner = (kind == KIND_TODO && !owner.is_empty())
        .then(|| {
            people
                .iter()
                .find(|p| p.name == owner)
                .map(|p| p.id.clone())
        })
        .flatten();
    Some(Parsed {
        kind: kind.to_owned(),
        text: text.to_owned(),
        owner,
        segments: segments.into_iter().collect(),
    })
}
