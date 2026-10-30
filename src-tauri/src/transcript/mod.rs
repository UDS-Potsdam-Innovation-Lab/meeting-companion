//! The transcript: [`Segment`]s (what the UI shows and the store keeps), the [`Transcriber`] that
//! turns audio into segments with any [`SpeechToText`] engine, and the encrypted append-only store.
//!
//! Pipeline: audio is cut into 100 ms frames. A frame louder than [`VOICE_RMS`] starts an utterance
//! window. While someone speaks, the window is sent to the engine every [`PARTIAL_EVERY_MS`] for a
//! partial segment. The window is finished (final segment) after [`END_SILENCE_MS`] of silence or when
//! it reaches [`MAX_WINDOW_MS`]; the engine never gets more than that at once. Silence between
//! utterances is dropped at once, so the pipeline itself holds at most one window of audio.

pub mod store;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

pub use crate::engines::stt::Lang;
use crate::engines::stt::{SpeechToText, SttError, MAX_WINDOW_MS};

pub use store::{
    FileTranscriptStore, LockedTranscriptStore, MemoryTranscriptStore, TranscriptError,
    TranscriptStore, TranscriptWriter,
};

const SAMPLES_PER_MS: u64 = crate::engines::audio::SAMPLE_RATE as u64 / 1000;
const FRAME: usize = 1_600; // 100 ms
/// RMS level from which a frame counts as speech.
pub const VOICE_RMS: f32 = 0.01;
pub const END_SILENCE_MS: u64 = 600;
pub const PARTIAL_EVERY_MS: u64 = 1_000;
/// Most characters of one segment's text that are kept.
pub const TEXT_MAX: usize = 2_000;

/// A voice label, `A` to `Z`, in the order voices were first heard in a meeting. It names a voice, not
/// a person: who it is comes from a person's choice in the speakers view. Serialised as the letter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Voice(u8);

impl Voice {
    /// `A`–`Z`: at most this many voices per meeting.
    pub const COUNT: usize = 26;

    pub fn from_index(i: usize) -> Option<Self> {
        (i < Self::COUNT).then_some(Self(i as u8))
    }

    pub fn index(self) -> usize {
        usize::from(self.0)
    }

    /// Exactly one letter `A`–`Z`; anything else is not a voice label.
    pub fn parse(s: &str) -> Option<Self> {
        match s.as_bytes() {
            [b @ b'A'..=b'Z'] => Some(Self(b - b'A')),
            _ => None,
        }
    }

    pub fn label(self) -> char {
        char::from(b'A' + self.0)
    }
}

impl std::fmt::Display for Voice {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.label())
    }
}

impl Serialize for Voice {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_char(self.label())
    }
}

impl<'de> Deserialize<'de> for Voice {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        Voice::parse(&s).ok_or_else(|| serde::de::Error::custom("not a voice label"))
    }
}

/// One transcript line. Offsets are milliseconds of recorded audio since the meeting's recording
/// began (pauses do not count); `at` is the wall-clock time the segment started (ms since epoch).
/// The text is untrusted: the UI renders it as text only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub at: u64,
    pub text: String,
    pub lang: Lang,
    /// False for the running preview of the current utterance, which a final segment replaces.
    #[serde(rename = "final")]
    pub is_final: bool,
    /// The voice the diarizer heard, for a final segment. Optional and left out while unknown, so
    /// records from before speaker detection load unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voice: Option<Voice>,
}

fn ms(samples: u64) -> u64 {
    samples / SAMPLES_PER_MS
}

fn rms(frame: &[f32]) -> f32 {
    if frame.is_empty() {
        return 0.0;
    }
    (frame.iter().map(|s| s * s).sum::<f32>() / frame.len() as f32).sqrt()
}

fn clip(text: &str) -> String {
    text.chars().take(TEXT_MAX).collect()
}

pub struct Transcriber {
    stt: Box<dyn SpeechToText>,
    base_ms: u64,
    wall_start_ms: u64,
    /// Samples consumed (in whole frames).
    pos: u64,
    pending: Vec<f32>,
    window: Vec<f32>,
    window_start: u64,
    silence: u64,
    since_partial: u64,
    level: f32,
    /// With [`Self::keeping_clips`]: the audio of each final segment produced since the last
    /// [`Self::take_clips`], in order, for the diarizer. The recorder takes them after every push, so
    /// this holds at most one window (3 s).
    clips: Option<Vec<Vec<f32>>>,
}

impl Transcriber {
    /// `base_ms`: recorded time before this session (earlier sessions of the meeting).
    /// `wall_start_ms`: wall-clock time this session's first sample was captured.
    pub fn new(stt: Box<dyn SpeechToText>, base_ms: u64, wall_start_ms: u64) -> Self {
        Self {
            stt,
            base_ms,
            wall_start_ms,
            pos: 0,
            pending: Vec::with_capacity(FRAME),
            window: Vec::new(),
            window_start: 0,
            silence: 0,
            since_partial: 0,
            level: 0.0,
            clips: None,
        }
    }

    /// Keeps the audio of each final segment for [`Self::take_clips`] (speaker detection).
    pub fn keeping_clips(mut self) -> Self {
        self.clips = Some(Vec::new());
        self
    }

    /// The audio of every final segment returned since the last call, one clip per final segment
    /// and in the same order. Empty unless [`Self::keeping_clips`].
    pub fn take_clips(&mut self) -> Vec<Vec<f32>> {
        self.clips.as_mut().map(std::mem::take).unwrap_or_default()
    }

    /// Recorded time including earlier sessions.
    pub fn recorded_ms(&self) -> u64 {
        self.base_ms + ms(self.pos + self.pending.len() as u64)
    }

    /// RMS of the last frame, 0..1.
    pub fn level(&self) -> f32 {
        self.level
    }

    /// Audio this pipeline holds right now (pending frame + utterance window).
    pub fn held_samples(&self) -> usize {
        let clips: usize = self.clips.iter().flatten().map(Vec::len).sum();
        self.pending.len() + self.window.len() + clips
    }

    /// Gives the engine back, e.g. to reuse a loaded model in the next session.
    pub fn into_engine(self) -> Box<dyn SpeechToText> {
        self.stt
    }

    pub fn push(&mut self, samples: &[f32]) -> Result<Vec<Segment>, SttError> {
        let mut out = Vec::new();
        let mut rest = samples;
        while !rest.is_empty() {
            let take = (FRAME - self.pending.len()).min(rest.len());
            self.pending.extend_from_slice(&rest[..take]);
            rest = &rest[take..];
            if self.pending.len() == FRAME {
                let frame = std::mem::replace(&mut self.pending, Vec::with_capacity(FRAME));
                self.frame(&frame, &mut out)?;
            }
        }
        Ok(out)
    }

    /// Finishes the current utterance (pause, stop): its text becomes final.
    pub fn flush(&mut self) -> Result<Vec<Segment>, SttError> {
        let mut out = Vec::new();
        if !self.window.is_empty() {
            let room = (MAX_WINDOW_MS * SAMPLES_PER_MS) as usize - self.window.len();
            let n = room.min(self.pending.len());
            self.window.extend_from_slice(&self.pending[..n]);
            self.finish(&mut out)?;
        }
        self.pos += self.pending.len() as u64;
        self.pending.clear();
        Ok(out)
    }

    fn frame(&mut self, frame: &[f32], out: &mut Vec<Segment>) -> Result<(), SttError> {
        let level = rms(frame);
        self.level = level;
        let voiced = level >= VOICE_RMS;
        let start = self.pos;
        self.pos += frame.len() as u64;
        if self.window.is_empty() {
            if !voiced {
                return Ok(());
            }
            self.window_start = start;
            self.silence = 0;
            self.since_partial = 0;
        }
        self.window.extend_from_slice(frame);
        self.since_partial += frame.len() as u64;
        self.silence = if voiced {
            0
        } else {
            self.silence + frame.len() as u64
        };
        if ms(self.silence) >= END_SILENCE_MS || ms(self.window.len() as u64) >= MAX_WINDOW_MS {
            self.finish(out)
        } else if ms(self.since_partial) >= PARTIAL_EVERY_MS && voiced {
            self.since_partial = 0;
            self.partial(out)
        } else {
            Ok(())
        }
    }

    fn at(&self, offset_samples: u64) -> (u64, u64) {
        let rel = ms(offset_samples);
        (self.base_ms + rel, self.wall_start_ms + rel)
    }

    fn partial(&mut self, out: &mut Vec<Segment>) -> Result<(), SttError> {
        let recognized = self.stt.transcribe(&self.window, false)?;
        let text = recognized
            .iter()
            .map(|r| r.text.trim())
            .filter(|t| !t.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        if let (false, Some(first)) = (text.is_empty(), recognized.first()) {
            let (start_ms, at) = self.at(self.window_start);
            out.push(Segment {
                start_ms,
                end_ms: start_ms + ms(self.window.len() as u64),
                at,
                text: clip(&text),
                lang: first.lang,
                is_final: false,
                voice: None,
            });
        }
        Ok(())
    }

    fn finish(&mut self, out: &mut Vec<Segment>) -> Result<(), SttError> {
        let window = std::mem::take(&mut self.window);
        let len_ms = ms(window.len() as u64);
        let recognized = self.stt.transcribe(&window, true)?;
        let (base, wall) = self.at(self.window_start);
        for r in recognized {
            let text = r.text.trim();
            if text.is_empty() {
                continue;
            }
            let start = r.start_ms.min(len_ms);
            let end = r.end_ms.clamp(start, len_ms);
            if let Some(clips) = self.clips.as_mut() {
                let at = |ms: u64| ((ms * SAMPLES_PER_MS) as usize).min(window.len());
                clips.push(window[at(start)..at(end)].to_vec());
            }
            out.push(Segment {
                start_ms: base + start,
                end_ms: base + end,
                at: wall + start,
                text: clip(text),
                lang: r.lang,
                is_final: true,
                voice: None,
            });
        }
        self.silence = 0;
        self.since_partial = 0;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engines::audio::{render_tones, samples_for_ms, AudioSink, Tone};
    use crate::engines::stt::ScriptedSpeechToText;
    use std::sync::atomic::Ordering;

    fn script() -> ScriptedSpeechToText {
        ScriptedSpeechToText::new(vec![
            ("Guten Morgen zusammen, wir fangen an.".into(), Lang::De),
            (
                "Good morning, let's look at the launch date.".into(),
                Lang::En,
            ),
            ("Das passt für die Pilotschulen.".into(), Lang::De),
        ])
    }

    fn feed(t: &mut Transcriber, audio: &[f32]) -> Vec<(Segment, u64)> {
        // In 100 ms chunks, noting how much audio had arrived when each segment came out.
        let mut out = Vec::new();
        let mut fed = 0u64;
        for chunk in audio.chunks(samples_for_ms(100)) {
            fed += chunk.len() as u64;
            for s in t.push(chunk).unwrap() {
                out.push((s, ms(fed)));
            }
        }
        out
    }

    #[test]
    fn scripted_audio_gives_partials_then_finals_in_order_with_both_languages() {
        let audio = render_tones(
            &[
                Tone::silence(500),
                Tone::speech(2_500),
                Tone::silence(1_000),
                Tone::speech(2_000),
                Tone::silence(1_000),
                Tone::speech(1_500),
                Tone::silence(1_000),
            ],
            0,
            samples_for_ms(9_500),
            false,
        );
        let mut t = Transcriber::new(Box::new(script()), 0, 1_000_000);
        let segs: Vec<Segment> = feed(&mut t, &audio).into_iter().map(|(s, _)| s).collect();
        let finals: Vec<&Segment> = segs.iter().filter(|s| s.is_final).collect();
        assert_eq!(finals.len(), 3);
        assert_eq!(finals[0].text, "Guten Morgen zusammen, wir fangen an.");
        assert_eq!(
            finals.iter().map(|s| s.lang).collect::<Vec<_>>(),
            [Lang::De, Lang::En, Lang::De]
        );
        // Each utterance: one or more partials, then its final; offsets only grow.
        let kinds: String = segs
            .iter()
            .map(|s| if s.is_final { 'F' } else { 'p' })
            .collect();
        assert!(
            kinds.starts_with("pp") && kinds.matches('F').count() == 3,
            "{kinds}"
        );
        for utterance in kinds.split_inclusive('F') {
            assert!(
                utterance.starts_with('p') && utterance.ends_with('F'),
                "{kinds}"
            );
        }
        for w in segs.windows(2) {
            assert!(w[1].start_ms >= w[0].start_ms);
        }
        assert_eq!(finals[0].start_ms, 500);
        assert_eq!(finals[0].at, 1_000_500);
        assert!(finals[1].start_ms >= 4_000);
        // Partials show the first words of the line being spoken.
        let first_partial = &segs[0];
        assert!(!first_partial.is_final);
        assert!("Guten Morgen zusammen, wir fangen an.".starts_with(&first_partial.text));
    }

    #[test]
    fn first_partial_arrives_within_3_s_of_speech_start_and_windows_never_exceed_3_s() {
        let stt = script();
        let stats = stt.stats.clone();
        let audio = render_tones(
            &[
                Tone::silence(2_000),
                Tone::speech(8_000),
                Tone::silence(1_000),
            ],
            0,
            samples_for_ms(11_000),
            false,
        );
        let mut t = Transcriber::new(Box::new(stt), 0, 0);
        let out = feed(&mut t, &audio);
        let (first, arrived_ms) = out.iter().find(|(s, _)| !s.is_final).unwrap();
        assert_eq!(first.start_ms, 2_000);
        assert!(
            *arrived_ms - 2_000 <= 3_000,
            "first partial after {arrived_ms} ms"
        );
        // 8 s of speech without a pause is cut into windows of at most 3 s.
        assert!(stats.longest_window.load(Ordering::SeqCst) <= samples_for_ms(MAX_WINDOW_MS));
        assert!(out.iter().filter(|(s, _)| s.is_final).count() >= 3);
    }

    #[test]
    fn flush_finalises_the_current_utterance_and_offsets_continue_after_the_base() {
        let mut t = Transcriber::new(Box::new(script()), 60_000, 5_000);
        let audio = render_tones(&[Tone::speech(1_250)], 0, samples_for_ms(1_250), false);
        let before = t.push(&audio).unwrap();
        assert!(before.iter().all(|s| !s.is_final));
        let after = t.flush().unwrap();
        assert_eq!(after.len(), 1);
        assert!(after[0].is_final);
        assert_eq!(after[0].start_ms, 60_000);
        assert_eq!(t.recorded_ms(), 61_250);
        assert!(t.flush().unwrap().is_empty());
    }

    #[test]
    fn audio_held_stays_bounded_over_a_simulated_two_hour_meeting() {
        // Real time is simulated: 2 h of audio pushed through the sink and the pipeline, with the
        // consumer sometimes falling 40 s behind. The sink never holds more than 30 s, the pipeline
        // never more than one 3 s window.
        let stt = script();
        let stats = stt.stats.clone();
        let mut t = Transcriber::new(Box::new(stt), 0, 0);
        let sink = AudioSink::new();
        let script = [
            Tone::speech(2_500),
            Tone::silence(800),
            Tone::speech(4_000),
            Tone::silence(1_200),
        ];
        let chunk = samples_for_ms(100);
        let total_chunks = 2 * 60 * 60 * 10;
        let mut pos = 0;
        let mut max_sink = 0;
        let mut max_held = 0;
        for i in 0..total_chunks {
            sink.push(&render_tones(&script, pos, chunk, true));
            pos += chunk;
            max_sink = max_sink.max(sink.len());
            // Every 10 minutes the engine stalls for 40 s; otherwise it drains every second.
            let stalled = (i % 6_000) < 400;
            if !stalled && i % 10 == 0 {
                let taken = sink.take(std::time::Duration::ZERO);
                t.push(&taken.samples).unwrap();
                max_held = max_held.max(t.held_samples());
            }
        }
        assert!(max_sink <= samples_for_ms(30_000), "sink held {max_sink}");
        assert_eq!(sink.high_water(), samples_for_ms(30_000));
        assert!(sink.dropped() > 0);
        assert!(max_held <= samples_for_ms(MAX_WINDOW_MS) + FRAME);
        assert!(stats.longest_window.load(Ordering::SeqCst) <= samples_for_ms(MAX_WINDOW_MS));
    }

    #[test]
    fn overlong_engine_text_is_clipped() {
        let mut t = Transcriber::new(
            Box::new(ScriptedSpeechToText::new(vec![(
                "x".repeat(5_000),
                Lang::En,
            )])),
            0,
            0,
        );
        let audio = render_tones(
            &[Tone::speech(1_000), Tone::silence(800)],
            0,
            samples_for_ms(1_800),
            false,
        );
        let segs = t.push(&audio).unwrap();
        let fin = segs.iter().find(|s| s.is_final).unwrap();
        assert_eq!(fin.text.chars().count(), TEXT_MAX);
    }
}
