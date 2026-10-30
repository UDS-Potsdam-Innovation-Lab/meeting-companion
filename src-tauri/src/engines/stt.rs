//! Speech-to-text behind [`SpeechToText`]. An engine turns one window of 16 kHz mono audio (at most
//! [`MAX_WINDOW_MS`]) into recognised text with a language. Whether a result is partial or final is
//! decided by the pipeline (`crate::transcript::Transcriber`), not by the engine.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use super::audio::SAMPLE_RATE;

/// Longest window of audio an engine is given at once.
pub const MAX_WINDOW_MS: u64 = 3_000;

/// Languages a meeting is transcribed in. Mixed within one meeting; detected per segment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Lang {
    De,
    En,
}

/// Text recognised in one window. Offsets are milliseconds from the start of the window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Recognized {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    pub lang: Lang,
}

/// Why an engine could not be loaded or failed. Carries no audio and no text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SttError {
    /// No usable speech model is installed (or the chosen one is gone).
    NoModel,
    /// The engine failed while transcribing.
    Failed,
}

impl std::fmt::Display for SttError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            SttError::NoModel => "no speech model",
            SttError::Failed => "speech engine failed",
        })
    }
}

pub trait SpeechToText: Send {
    /// Transcribes `window` (16 kHz mono, at most [`MAX_WINDOW_MS`]). `final_pass` is true when the
    /// window is complete (the speaker paused or the window is full); false for a running preview.
    fn transcribe(&mut self, window: &[f32], final_pass: bool)
        -> Result<Vec<Recognized>, SttError>;
}

/// A fake engine: every final window gets the next line of a script (cycling); a partial window
/// gets the first words of that line, more the longer the window. Records the longest window it was
/// given and how often it was called.
pub struct ScriptedSpeechToText {
    lines: Vec<(String, Lang)>,
    next: usize,
    pub stats: Arc<SttStats>,
}

#[derive(Debug, Default)]
pub struct SttStats {
    pub calls: AtomicUsize,
    pub longest_window: AtomicUsize,
}

impl ScriptedSpeechToText {
    pub fn new(lines: Vec<(String, Lang)>) -> Self {
        Self {
            lines,
            next: 0,
            stats: Arc::new(SttStats::default()),
        }
    }

    /// The script used by `MEETING_COMPANION_STT=fake`: German and English, as in a mixed meeting.
    pub fn demo() -> Self {
        Self::new(
            [
                ("Okay, let's start with the beta launch scope.", Lang::En),
                (
                    "Die Pilotschulen brauchen den Offline-Modus nicht für die Beta.",
                    Lang::De,
                ),
                ("Then we can keep the date on the fourteenth.", Lang::En),
                (
                    "Gut, dann informieren wir die dritte Schule diese Woche.",
                    Lang::De,
                ),
            ]
            .into_iter()
            .map(|(t, l)| (t.to_owned(), l))
            .collect(),
        )
    }
}

impl SpeechToText for ScriptedSpeechToText {
    fn transcribe(
        &mut self,
        window: &[f32],
        final_pass: bool,
    ) -> Result<Vec<Recognized>, SttError> {
        self.stats.calls.fetch_add(1, Ordering::SeqCst);
        self.stats
            .longest_window
            .fetch_max(window.len(), Ordering::SeqCst);
        if self.lines.is_empty() || window.is_empty() {
            return Ok(Vec::new());
        }
        let (line, lang) = self.lines[self.next % self.lines.len()].clone();
        let end_ms = window.len() as u64 * 1000 / u64::from(SAMPLE_RATE);
        let text = if final_pass {
            self.next += 1;
            line
        } else {
            let words: Vec<&str> = line.split_whitespace().collect();
            let n = ((words.len() as u64 * end_ms) / MAX_WINDOW_MS).clamp(1, words.len() as u64);
            words[..n as usize].join(" ")
        };
        Ok(vec![Recognized {
            start_ms: 0,
            end_ms,
            text,
            lang,
        }])
    }
}
