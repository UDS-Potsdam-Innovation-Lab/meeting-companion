//! Runs a scene the way a recording does: the mixed track goes through the real [`Transcriber`]
//! windowing (with the scripted speech-to-text fake, so final segments are at most 3 s and no model is
//! needed), each final segment's audio through a [`Diarizer`] and the real [`VoiceTracker`]; then the
//! measures. Also the fakes for the gate (an oracle and a degraded diarizer) and the regression
//! thresholds. Test-only.

use std::collections::{BTreeMap, VecDeque};
use std::path::Path;
use std::time::Duration;

use serde::Deserialize;

use super::measures::{self, Measures, Scoring, Span};
use super::scene::{BuiltScene, RefTurn};
use crate::engines::diarize::{DiarizeError, Diarizer, VoiceTracker, MIN_SEGMENT_MS};
use crate::engines::stt::{Lang, ScriptedSpeechToText};
use crate::transcript::{Segment, Transcriber, Voice};

/// The collar of the DER, as in NIST evaluations.
pub const COLLAR_MS: u64 = 250;
/// Text of a line that continues a turn (the turn's reference text sits on its first line only).
pub const CONTINUED: &str = "…";

/// One final segment of a run: its time, audio and voice.
#[derive(Debug, Clone)]
pub struct RunLine {
    pub start_ms: u64,
    pub end_ms: u64,
    pub voice: Option<Voice>,
    /// The reference text of the turn this line starts, or [`CONTINUED`].
    pub text: String,
}

#[derive(Debug, Clone)]
pub struct SceneRun {
    pub lines: Vec<RunLine>,
    /// Time spent in the diarizer and tracker, and how many segments were embedded.
    pub took: Duration,
    pub embedded: usize,
}

impl SceneRun {
    pub fn per_segment(&self) -> Duration {
        self.took / self.embedded.max(1) as u32
    }

    pub fn hypothesis(&self) -> Vec<Span> {
        self.lines
            .iter()
            .map(|l| Span {
                start_ms: l.start_ms,
                end_ms: l.end_ms,
                label: l.voice.map(|v| v.label().to_string()),
            })
            .collect()
    }

    /// The lines as transcript segments (final, with voice and reference text).
    pub fn segments(&self, lang: Lang) -> Vec<Segment> {
        self.lines
            .iter()
            .map(|l| Segment {
                start_ms: l.start_ms,
                end_ms: l.end_ms,
                at: 1_700_000_000_000 + l.start_ms,
                text: l.text.clone(),
                lang,
                is_final: true,
                voice: l.voice,
            })
            .collect()
    }
}

pub fn lang_of(scene: &BuiltScene) -> Lang {
    if scene.lang == "de" {
        Lang::De
    } else {
        Lang::En
    }
}

pub fn reference(turns: &[RefTurn]) -> Vec<Span> {
    turns
        .iter()
        .map(|t| Span::new(t.start_ms, t.end_ms, Some(&t.speaker)))
        .collect()
}

/// A final segment of the windowing: time and audio.
pub struct Window {
    pub start_ms: u64,
    pub end_ms: u64,
    pub audio: Vec<f32>,
}

/// The final segments the transcript pipeline makes of the scene's track (pushed in 100 ms chunks,
/// as the recorder does, then flushed).
pub fn windows(scene: &BuiltScene) -> Vec<Window> {
    let stt = ScriptedSpeechToText::new(vec![(CONTINUED.into(), lang_of(scene))]);
    let mut t = Transcriber::new(Box::new(stt), 0, 0).keeping_clips();
    let mut out = Vec::new();
    let mut collect = |segs: Vec<Segment>, clips: Vec<Vec<f32>>| {
        let finals: Vec<Segment> = segs.into_iter().filter(|s| s.is_final).collect();
        assert_eq!(finals.len(), clips.len());
        for (s, audio) in finals.into_iter().zip(clips) {
            out.push(Window {
                start_ms: s.start_ms,
                end_ms: s.end_ms,
                audio,
            });
        }
    };
    for chunk in scene.samples.chunks(1_600) {
        let segs = t.push(chunk).expect("scripted engine");
        let clips = t.take_clips();
        collect(segs, clips);
    }
    let segs = t.flush().expect("scripted engine");
    let clips = t.take_clips();
    collect(segs, clips);
    out
}

/// The reference speaker who speaks most of `[start, end)`, as an index into `speakers`.
pub fn dominant(turns: &[RefTurn], speakers: &[String], start: u64, end: u64) -> Option<usize> {
    let mut best: Option<(u64, usize)> = None;
    for (i, sp) in speakers.iter().enumerate() {
        let ms: u64 = turns
            .iter()
            .filter(|t| &t.speaker == sp)
            .map(|t| t.end_ms.min(end).saturating_sub(t.start_ms.max(start)))
            .sum();
        if ms > 0 && best.is_none_or(|(b, _)| ms > b) {
            best = Some((ms, i));
        }
    }
    best.map(|(_, i)| i)
}

/// Runs the windows of `scene` through `diarizer` and a fresh [`VoiceTracker`]. Each line gets the
/// reference text of the turn it starts (the first line whose time the turn dominates), else
/// [`CONTINUED`].
pub fn run_windows(
    scene: &BuiltScene,
    windows: &[Window],
    diarizer: &mut dyn Diarizer,
) -> SceneRun {
    let mut tracker = VoiceTracker::new(0);
    let mut lines = Vec::new();
    let mut took = Duration::ZERO;
    let mut embedded = 0;
    let mut texted = vec![false; scene.turns.len()];
    for w in windows {
        let started = std::time::Instant::now();
        let voice = tracker.voice_for(diarizer, w.start_ms, w.end_ms, &w.audio);
        took += started.elapsed();
        if w.end_ms - w.start_ms >= MIN_SEGMENT_MS {
            embedded += 1;
        }
        // The turn that covers most of this line.
        let turn = scene
            .turns
            .iter()
            .enumerate()
            .map(|(i, t)| {
                (
                    t.end_ms
                        .min(w.end_ms)
                        .saturating_sub(t.start_ms.max(w.start_ms)),
                    i,
                )
            })
            .filter(|(ms, _)| *ms > 0)
            .max_by(|a, b| a.0.cmp(&b.0).then(b.1.cmp(&a.1)))
            .map(|(_, i)| i);
        let text = match turn {
            Some(i) if !texted[i] => {
                texted[i] = true;
                scene.turns[i].text.clone()
            }
            _ => CONTINUED.to_owned(),
        };
        lines.push(RunLine {
            start_ms: w.start_ms,
            end_ms: w.end_ms,
            voice,
            text,
        });
    }
    SceneRun {
        lines,
        took,
        embedded,
    }
}

pub fn score(scene: &BuiltScene, run: &SceneRun) -> Measures {
    measures::evaluate(
        &reference(&scene.turns),
        &run.hypothesis(),
        &Scoring {
            collar_ms: COLLAR_MS,
            only: None,
        },
    )
}

/// The fake that knows who speaks: for every segment it is asked about, the one-hot embedding of the
/// reference speaker who speaks most of it (none where nobody speaks). Answers are prepared from the
/// windows, in the order the tracker asks (only segments of at least [`MIN_SEGMENT_MS`]).
pub struct OracleDiarizer {
    answers: VecDeque<Option<usize>>,
    dim: usize,
}

impl OracleDiarizer {
    pub fn new(scene: &BuiltScene, windows: &[Window]) -> Self {
        let speakers = scene.speakers();
        Self {
            answers: windows
                .iter()
                .filter(|w| w.end_ms - w.start_ms >= MIN_SEGMENT_MS)
                .map(|w| dominant(&scene.turns, &speakers, w.start_ms, w.end_ms))
                .collect(),
            dim: speakers.len().max(1),
        }
    }
}

impl Diarizer for OracleDiarizer {
    fn embed(&mut self, _audio: &[f32]) -> Result<Option<Vec<f32>>, DiarizeError> {
        let who = self.answers.pop_front().ok_or(DiarizeError::Failed)?;
        Ok(who.map(|i| {
            let mut v = vec![0.0; self.dim];
            v[i] = 1.0;
            v
        }))
    }
}

/// A broken engine: the same embedding for every segment, so everyone is one voice.
pub struct SameVoiceDiarizer;

impl Diarizer for SameVoiceDiarizer {
    fn embed(&mut self, audio: &[f32]) -> Result<Option<Vec<f32>>, DiarizeError> {
        Ok((!audio.is_empty()).then(|| vec![0.6, 0.8]))
    }
}

// ---- thresholds ------------------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThresholdFile {
    pub collar_ms: u64,
    /// By model file name.
    pub models: BTreeMap<String, ModelThresholds>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelThresholds {
    pub sha256: String,
    /// When and how the baseline was measured.
    pub measured: String,
    /// Margin added to the baseline, in percentage points (at most 5).
    pub margin_pp: f64,
    /// In the name-round workflow: speakers whose voice is suggested as the right person, at least.
    pub name_round_min_suggested: usize,
    pub scenes: BTreeMap<String, SceneThresholds>,
}

/// Shares (0..1). `max*` may not be exceeded, `minLineAccuracy` not undercut.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneThresholds {
    pub baseline: Baseline,
    pub max_der: f64,
    pub max_missed: f64,
    pub max_false_alarm: f64,
    pub max_confusion: f64,
    pub min_line_accuracy: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Baseline {
    pub der: f64,
    pub missed: f64,
    pub false_alarm: f64,
    pub confusion: f64,
    pub line_accuracy: f64,
}

pub fn load_thresholds(root: &Path) -> ThresholdFile {
    let text = std::fs::read_to_string(root.join("thresholds.json")).expect("thresholds.json");
    serde_json::from_str(&text).expect("thresholds.json valid")
}

/// The pinned model of `src-tauri/native/speaker-model.sha256`: (file name, SHA-256).
pub fn pinned_model() -> (String, String) {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("native/speaker-model.sha256");
    let text = std::fs::read_to_string(path).expect("speaker-model.sha256");
    let line = text.lines().find(|l| !l.trim().is_empty()).expect("a pin");
    let (sha, name) = line.split_once("  ").expect("<sha256>  <name>");
    (name.trim().to_owned(), sha.trim().to_owned())
}

fn pct(x: f64) -> String {
    format!("{:.1} %", x * 100.0)
}

/// Every threshold `m` breaks, as "`scene`: `measure` … > max …".
pub fn check(scene: &str, m: &Measures, t: &SceneThresholds) -> Vec<String> {
    let mut out = Vec::new();
    for (name, value, max) in [
        ("DER", m.der(), t.max_der),
        ("missed speech", m.missed(), t.max_missed),
        ("false alarm", m.false_alarm(), t.max_false_alarm),
        ("speaker confusion", m.confusion(), t.max_confusion),
    ] {
        if value > max + 1e-9 {
            out.push(format!("{scene}: {name} {} > max {}", pct(value), pct(max)));
        }
    }
    if m.line_accuracy() + 1e-9 < t.min_line_accuracy {
        out.push(format!(
            "{scene}: line accuracy {} < min {}",
            pct(m.line_accuracy()),
            pct(t.min_line_accuracy)
        ));
    }
    out
}

/// One table row: scene, DER and its parts, line accuracy, voices against speakers, time per segment.
pub fn table_row(scene: &str, m: &Measures, per_segment: Duration) -> String {
    format!(
        "{scene:<16} {:>7} {:>7} {:>7} {:>7} {:>7} {:>3}/{:<3} {:>8.1?}",
        pct(m.der()),
        pct(m.missed()),
        pct(m.false_alarm()),
        pct(m.confusion()),
        pct(m.line_accuracy()),
        m.voices,
        m.speakers,
        per_segment
    )
}

pub const TABLE_HEADER: &str =
    "scene                DER  missed  f.alarm  confus.  lines  voices/spk  per segment";

#[cfg(test)]
mod tests {
    use super::super::{corpus, scene};
    use super::*;

    /// The confusion of `m`'s run over the lines that are long enough to embed, have one reference
    /// speaker (no overlap, no change of speaker inside the line) and someone speaking.
    fn clean_confusion(scene: &BuiltScene, run: &SceneRun) -> Measures {
        let full = score(scene, run);
        let clean: Vec<(u64, u64)> = run
            .lines
            .iter()
            .zip(&full.lines)
            .filter(|(l, r)| {
                l.end_ms - l.start_ms >= MIN_SEGMENT_MS && !r.mixed && r.reference.is_some()
            })
            .map(|(l, _)| (l.start_ms, l.end_ms))
            .collect();
        measures::evaluate(
            &reference(&scene.turns),
            &run.hypothesis(),
            &Scoring {
                collar_ms: 0,
                only: Some(clean),
            },
        )
    }

    #[test]
    fn windows_are_final_segments_of_at_most_3_s_in_time_order() {
        for s in scene::all() {
            let w = windows(s);
            assert!(!w.is_empty(), "{}", s.id);
            for x in &w {
                assert!(x.end_ms - x.start_ms <= 3_000, "{}", s.id);
                assert_eq!(
                    x.audio.len() as u64,
                    (x.end_ms - x.start_ms) * 16,
                    "{}",
                    s.id
                );
            }
            assert!(
                w.windows(2).all(|p| p[0].end_ms <= p[1].start_ms),
                "{}",
                s.id
            );
        }
    }

    /// AC3: with an engine that knows who speaks, the real tracker confuses nobody outside overlaps,
    /// short segments and segments that span a change of speaker.
    #[test]
    fn an_oracle_diarizer_through_the_real_tracker_has_no_confusion_outside_overlaps_and_short_segments(
    ) {
        for s in scene::all() {
            let w = windows(s);
            let mut oracle = OracleDiarizer::new(s, &w);
            let run = run_windows(s, &w, &mut oracle);
            let clean = clean_confusion(s, &run);
            assert!(clean.reference_ms > 10_000, "{}: too little to score", s.id);
            assert_eq!(clean.confusion_ms, 0, "{}: {clean:?}", s.id);
            let all = score(s, &run);
            assert_eq!(all.voices, s.speakers().len(), "{}", s.id);
            assert!(
                all.line_accuracy() > 0.8,
                "{}: {}",
                s.id,
                all.line_accuracy()
            );
        }
    }

    /// AC3: a broken engine (everyone one voice) breaks the committed thresholds, and the message
    /// names the scene and the measure.
    #[test]
    fn a_degraded_diarizer_fails_the_gate_naming_scene_and_measure() {
        let thresholds = load_thresholds(&corpus::root());
        let (model, _) = pinned_model();
        let pinned = &thresholds.models[&model];
        for s in scene::all() {
            let w = windows(s);
            let run = run_windows(s, &w, &mut SameVoiceDiarizer);
            let m = score(s, &run);
            assert_eq!(m.voices, 1);
            let failures = check(&s.id, &m, &pinned.scenes[&s.id]);
            assert!(!failures.is_empty(), "{}: a single voice passed", s.id);
            assert!(
                failures
                    .iter()
                    .all(|f| f.starts_with(&format!("{}: ", s.id))),
                "{failures:?}"
            );
            assert!(
                failures
                    .iter()
                    .any(|f| f.contains("speaker confusion") || f.contains("line accuracy")),
                "{failures:?}"
            );
        }
    }

    /// The thresholds file covers every scene for the pinned model, records its checksum and stays
    /// within 5 percentage points of the recorded baseline.
    #[test]
    fn thresholds_cover_every_scene_for_the_pinned_model_within_5_points_of_the_baseline() {
        let thresholds = load_thresholds(&corpus::root());
        assert_eq!(thresholds.collar_ms, COLLAR_MS);
        let (model, sha) = pinned_model();
        let pinned = thresholds
            .models
            .get(&model)
            .unwrap_or_else(|| panic!("no thresholds for the pinned model {model}"));
        assert_eq!(pinned.sha256, sha);
        assert!(pinned.margin_pp > 0.0 && pinned.margin_pp <= 5.0);
        assert!(!pinned.measured.is_empty());
        let ids: Vec<&String> = pinned.scenes.keys().collect();
        let mut expected: Vec<&String> = scene::all().iter().map(|s| &s.id).collect();
        expected.sort();
        assert_eq!(ids, expected);
        let room = 0.05 + 1e-9;
        for (id, t) in &pinned.scenes {
            let b = &t.baseline;
            for (max, base) in [
                (t.max_der, b.der),
                (t.max_missed, b.missed),
                (t.max_false_alarm, b.false_alarm),
                (t.max_confusion, b.confusion),
            ] {
                assert!(max >= base && max - base <= room, "{id}: {max} vs {base}");
            }
            assert!(
                t.min_line_accuracy <= b.line_accuracy
                    && b.line_accuracy - t.min_line_accuracy <= room,
                "{id}"
            );
        }
    }

    #[test]
    fn check_reports_each_broken_threshold() {
        let reference = [
            Span::new(0, 2_000, Some("a")),
            Span::new(2_000, 4_000, Some("b")),
        ];
        let hyp = [
            Span::new(0, 2_000, Some("A")),
            Span::new(2_000, 4_000, Some("A")),
        ];
        let m = measures::evaluate(&reference, &hyp, &Scoring::default());
        let t = SceneThresholds {
            baseline: Baseline {
                der: 0.0,
                missed: 0.0,
                false_alarm: 0.0,
                confusion: 0.0,
                line_accuracy: 1.0,
            },
            max_der: 0.1,
            max_missed: 0.1,
            max_false_alarm: 0.1,
            max_confusion: 0.1,
            min_line_accuracy: 0.9,
        };
        let failures = check("x", &m, &t);
        assert_eq!(
            failures,
            [
                "x: DER 50.0 % > max 10.0 %",
                "x: speaker confusion 50.0 % > max 10.0 %",
                "x: line accuracy 50.0 % < min 90.0 %"
            ]
        );
    }
}
