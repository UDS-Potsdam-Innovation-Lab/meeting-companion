//! Test meetings ("scenes") from `scenes.json`: which clip slice plays when, overlaps, pauses, a noise
//! level and the reference text of each turn. [`build`] mixes a scene in memory into one 16 kHz track,
//! deterministically, and returns the reference speaker turns. Noise comes from a seeded generator,
//! never from a recording. Test-only.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::OnceLock;

use serde::Deserialize;

use super::corpus::{self, Manifest};
use crate::engines::audio::SAMPLE_RATE;

const SAMPLES_PER_MS: usize = SAMPLE_RATE as usize / 1000;
/// Fade at both ends of every turn, so a cut slice does not click.
const FADE_MS: usize = 10;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneFile {
    pub sample_rate: u32,
    /// Level every turn is scaled to (RMS over the turn, dBFS).
    pub turn_rms_dbfs: f64,
    pub scenes: Vec<SceneSpec>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneSpec {
    pub id: String,
    pub lang: String,
    pub seed: u64,
    /// Generated noise at this signal-to-noise ratio (dB), or none.
    pub noise_snr_db: Option<f64>,
    /// Silence after the last turn.
    pub tail_ms: u64,
    /// The invited people; `speaker` links a person to a corpus speaker (none: invited but absent).
    pub participants: Vec<ParticipantSpec>,
    pub turns: Vec<TurnSpec>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ParticipantSpec {
    pub speaker: Option<String>,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnSpec {
    pub speaker: String,
    pub clip: String,
    pub at_ms: u64,
    pub from_ms: u64,
    pub len_ms: u64,
    pub text: String,
}

/// One reference turn: who speaks from `start_ms` to `end_ms`, and the reference text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RefTurn {
    pub speaker: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

/// A mixed scene: the track (`speech + noise`), its parts, and the reference turns.
#[derive(Debug, Clone)]
pub struct BuiltScene {
    pub id: String,
    pub lang: String,
    pub samples: Vec<f32>,
    pub speech: Vec<f32>,
    pub noise: Vec<f32>,
    pub noise_snr_db: Option<f64>,
    pub turns: Vec<RefTurn>,
    pub participants: Vec<ParticipantSpec>,
}

impl BuiltScene {
    /// The corpus speakers of the scene, sorted.
    pub fn speakers(&self) -> Vec<String> {
        let mut s: Vec<String> = self.turns.iter().map(|t| t.speaker.clone()).collect();
        s.sort();
        s.dedup();
        s
    }

    pub fn duration_ms(&self) -> u64 {
        (self.samples.len() / SAMPLES_PER_MS) as u64
    }

    /// The name of the participant who is `speaker`.
    pub fn name_of(&self, speaker: &str) -> Option<&str> {
        self.participants
            .iter()
            .find(|p| p.speaker.as_deref() == Some(speaker))
            .map(|p| p.name.as_str())
    }
}

pub fn load_scene_file(root: &Path) -> SceneFile {
    let text = std::fs::read_to_string(root.join("scenes.json")).expect("scenes.json readable");
    let file: SceneFile = serde_json::from_str(&text).expect("scenes.json valid");
    assert_eq!(file.sample_rate, SAMPLE_RATE);
    file
}

/// SplitMix64: a small seeded generator, the same on every machine.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// Uniform in [-1, 1).
    fn uniform(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 52) as f64 - 1.0
    }
}

/// Pink-ish noise (Paul Kellet's filter over white noise), like a room's background hum and hiss.
fn noise(seed: u64, len: usize) -> Vec<f64> {
    let mut rng = Rng(seed);
    let mut b = [0.0f64; 7];
    (0..len)
        .map(|_| {
            let white = rng.uniform();
            b[0] = 0.99886 * b[0] + white * 0.0555179;
            b[1] = 0.99332 * b[1] + white * 0.0750759;
            b[2] = 0.96900 * b[2] + white * 0.1538520;
            b[3] = 0.86650 * b[3] + white * 0.3104856;
            b[4] = 0.55000 * b[4] + white * 0.5329522;
            b[5] = -0.7616 * b[5] - white * 0.0168980;
            let pink = b.iter().sum::<f64>() + white * 0.5362;
            b[6] = white * 0.115926;
            pink
        })
        .collect()
}

fn power(x: impl Iterator<Item = f64>) -> f64 {
    let (sum, n) = x.fold((0.0, 0usize), |(s, n), v| (s + v * v, n + 1));
    if n == 0 {
        0.0
    } else {
        sum / n as f64
    }
}

/// Indices of the samples where at least one reference turn speaks.
pub fn speech_mask(turns: &[RefTurn], len: usize) -> Vec<bool> {
    let mut mask = vec![false; len];
    for t in turns {
        let a = (t.start_ms as usize * SAMPLES_PER_MS).min(len);
        let b = (t.end_ms as usize * SAMPLES_PER_MS).min(len);
        mask[a..b].iter_mut().for_each(|m| *m = true);
    }
    mask
}

/// The SNR of a built scene in dB: speech power where someone speaks over noise power everywhere.
pub fn measured_snr_db(scene: &BuiltScene) -> f64 {
    let mask = speech_mask(&scene.turns, scene.speech.len());
    let ps = power(
        scene
            .speech
            .iter()
            .zip(&mask)
            .filter(|(_, m)| **m)
            .map(|(s, _)| f64::from(*s)),
    );
    let pn = power(scene.noise.iter().map(|n| f64::from(*n)));
    10.0 * (ps / pn).log10()
}

/// Mixes `spec` from the clips: every turn's slice scaled to the common level, faded in and out and
/// added at its time; then the seeded noise at the scene's SNR. Pure: the same input gives the same
/// samples, bit for bit.
pub fn build(
    file: &SceneFile,
    spec: &SceneSpec,
    manifest: &Manifest,
    clips: &BTreeMap<String, Vec<f32>>,
) -> BuiltScene {
    let end_ms = spec
        .turns
        .iter()
        .map(|t| t.at_ms + t.len_ms)
        .max()
        .unwrap_or(0)
        + spec.tail_ms;
    let len = end_ms as usize * SAMPLES_PER_MS;
    let mut speech = vec![0.0f64; len];
    let target = 10f64.powf(file.turn_rms_dbfs / 20.0);
    let mut turns = Vec::new();
    for t in &spec.turns {
        let clip = manifest
            .clips
            .iter()
            .find(|c| c.id == t.clip)
            .unwrap_or_else(|| panic!("{}: unknown clip {}", spec.id, t.clip));
        assert_eq!(
            clip.speaker, t.speaker,
            "{}: {} is not by {}",
            spec.id, t.clip, t.speaker
        );
        let samples = &clips[&t.clip];
        let from = t.from_ms as usize * SAMPLES_PER_MS;
        let n = t.len_ms as usize * SAMPLES_PER_MS;
        assert!(
            from + n <= samples.len(),
            "{}: {} is too short",
            spec.id,
            t.clip
        );
        let slice = &samples[from..from + n];
        let rms = power(slice.iter().map(|s| f64::from(*s))).sqrt();
        let gain = if rms > 0.0 { target / rms } else { 0.0 };
        let fade = (FADE_MS * SAMPLES_PER_MS).min(n / 2).max(1);
        let at = t.at_ms as usize * SAMPLES_PER_MS;
        for (i, s) in slice.iter().enumerate() {
            let edge = i.min(n - 1 - i);
            let ramp = if edge < fade {
                edge as f64 / fade as f64
            } else {
                1.0
            };
            speech[at + i] += f64::from(*s) * gain * ramp;
        }
        turns.push(RefTurn {
            speaker: t.speaker.clone(),
            start_ms: t.at_ms,
            end_ms: t.at_ms + t.len_ms,
            text: t.text.clone(),
        });
    }
    let speech: Vec<f32> = speech.into_iter().map(|s| s as f32).collect();
    let noise: Vec<f32> = match spec.noise_snr_db {
        Some(snr) => {
            let raw = noise(spec.seed, len);
            let mask = speech_mask(&turns, len);
            let ps = power(
                speech
                    .iter()
                    .zip(&mask)
                    .filter(|(_, m)| **m)
                    .map(|(s, _)| f64::from(*s)),
            );
            let pn = power(raw.iter().copied());
            let gain = (ps / (pn * 10f64.powf(snr / 10.0))).sqrt();
            raw.into_iter().map(|x| (x * gain) as f32).collect()
        }
        None => vec![0.0; len],
    };
    let samples = speech.iter().zip(&noise).map(|(s, n)| s + n).collect();
    BuiltScene {
        id: spec.id.clone(),
        lang: spec.lang.clone(),
        samples,
        speech,
        noise,
        noise_snr_db: spec.noise_snr_db,
        turns,
        participants: spec.participants.clone(),
    }
}

/// Builds every scene of the committed corpus.
pub fn build_all() -> Vec<BuiltScene> {
    let root = corpus::root();
    let manifest = corpus::load_manifest(&root).expect("manifest");
    let clips = corpus::load_clips(&root, &manifest);
    let file = load_scene_file(&root);
    file.scenes
        .iter()
        .map(|s| build(&file, s, &manifest, &clips))
        .collect()
}

/// [`build_all`], once per test process.
pub fn all() -> &'static [BuiltScene] {
    static SCENES: OnceLock<Vec<BuiltScene>> = OnceLock::new();
    SCENES.get_or_init(build_all)
}

/// Milliseconds during which at least `n` reference speakers speak at once (10 ms grid).
pub fn ms_with_speakers(turns: &[RefTurn], at_least: usize) -> u64 {
    let end = turns.iter().map(|t| t.end_ms).max().unwrap_or(0);
    let mut count = vec![0usize; end.div_ceil(10) as usize];
    for t in turns {
        for c in &mut count[(t.start_ms / 10) as usize..(t.end_ms / 10) as usize] {
            *c += 1;
        }
    }
    count.iter().filter(|c| **c >= at_least).count() as u64 * 10
}

/// Turns of `speaker`, in time order.
pub fn turns_of<'a>(turns: &'a [RefTurn], speaker: &str) -> Vec<&'a RefTurn> {
    let mut v: Vec<&RefTurn> = turns.iter().filter(|t| t.speaker == speaker).collect();
    v.sort_by_key(|t| t.start_ms);
    v
}

/// The longest silence of `speaker` between two of its turns, in ms.
pub fn longest_return_gap(turns: &[RefTurn], speaker: &str) -> u64 {
    let mine = turns_of(turns, speaker);
    let mut end = 0;
    let mut gap = 0;
    for (i, t) in mine.iter().enumerate() {
        if i > 0 {
            gap = gap.max(t.start_ms.saturating_sub(end));
        }
        end = end.max(t.end_ms);
    }
    gap
}

/// Total speech of `speaker` (overlapping turns counted once), in ms.
pub fn speech_ms(turns: &[RefTurn], speaker: &str) -> u64 {
    let mine: Vec<RefTurn> = turns_of(turns, speaker).into_iter().cloned().collect();
    ms_with_speakers(&mine, 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::speakers::NAME_ROUND_MS;

    /// AC2: building twice gives the same samples bit for bit and the same reference turns.
    #[test]
    fn scenes_are_deterministic() {
        let a = build_all();
        let b = build_all();
        assert_eq!(a.len(), b.len());
        for (x, y) in a.iter().zip(&b) {
            assert_eq!(x.id, y.id);
            assert_eq!(x.turns, y.turns, "{}", x.id);
            assert_eq!(x.samples.len(), y.samples.len(), "{}", x.id);
            assert!(
                x.samples
                    .iter()
                    .zip(&y.samples)
                    .all(|(p, q)| p.to_bits() == q.to_bits()),
                "{}: samples differ",
                x.id
            );
        }
        // Another seed gives other noise: the seed is what makes it repeatable.
        let root = corpus::root();
        let manifest = corpus::load_manifest(&root).unwrap();
        let clips = corpus::load_clips(&root, &manifest);
        let file = load_scene_file(&root);
        let mut spec = file
            .scenes
            .iter()
            .find(|s| s.noise_snr_db.is_some())
            .unwrap()
            .clone();
        let first = build(&file, &spec, &manifest, &clips);
        spec.seed += 1;
        let other = build(&file, &spec, &manifest, &clips);
        assert_ne!(first.noise, other.noise);
        assert_eq!(first.speech, other.speech);
    }

    /// AC2: together the scenes cover the cases the speaker detection meets in a meeting.
    #[test]
    fn scenes_cover_languages_sizes_overlap_short_turns_returns_few_words_noise_and_name_round() {
        let scenes = all();
        let langs: std::collections::BTreeSet<&str> =
            scenes.iter().map(|s| s.lang.as_str()).collect();
        assert_eq!(langs, ["de", "en"].into());
        for s in scenes {
            let n = s.speakers().len();
            assert!((2..=6).contains(&n), "{}: {n} speakers", s.id);
            assert!(s.duration_ms() > 0);
        }
        assert!(scenes.iter().any(|s| s.speakers().len() == 6));

        let overlap = |s: &BuiltScene| {
            ms_with_speakers(&s.turns, 2) as f64 / ms_with_speakers(&s.turns, 1) as f64
        };
        assert!(
            scenes.iter().any(|s| overlap(s) >= 0.10),
            "no scene with 10 % overlapped speech"
        );

        let short = scenes
            .iter()
            .flat_map(|s| &s.turns)
            .filter(|t| t.end_ms - t.start_ms < 1_000)
            .count();
        assert!(short >= 5, "{short} turns shorter than 1 s");

        let returns = scenes.iter().any(|s| {
            s.speakers()
                .iter()
                .any(|sp| longest_return_gap(&s.turns, sp) >= 60_000)
        });
        assert!(returns, "nobody comes back after 60 s");

        let few = scenes.iter().any(|s| {
            s.speakers()
                .iter()
                .any(|sp| speech_ms(&s.turns, sp) <= 2_000)
        });
        assert!(few, "nobody speaks 2 s or less");

        let noisy: Vec<&BuiltScene> = scenes
            .iter()
            .filter(|s| s.noise_snr_db == Some(10.0))
            .collect();
        assert!(!noisy.is_empty(), "no scene at 10 dB SNR");
        for s in &noisy {
            let snr = measured_snr_db(s);
            assert!((snr - 10.0).abs() <= 0.5, "{}: SNR {snr:.2} dB", s.id);
            assert!(s.noise.iter().any(|n| *n != 0.0));
        }
        for s in scenes.iter().filter(|s| s.noise_snr_db.is_none()) {
            assert!(s.noise.iter().all(|n| *n == 0.0), "{}", s.id);
        }

        let name_round = scenes.iter().any(|s| {
            s.speakers().iter().all(|sp| {
                let first = turns_of(&s.turns, sp)[0];
                let name = s.name_of(sp);
                first.start_ms < NAME_ROUND_MS && name.is_some_and(|n| first.text.contains(n))
            })
        });
        assert!(name_round, "no name-round scene");
    }

    #[test]
    fn helpers_measure_overlap_gaps_and_speech_on_a_fixture() {
        let t = |s: &str, a: u64, b: u64| RefTurn {
            speaker: s.into(),
            start_ms: a,
            end_ms: b,
            text: String::new(),
        };
        let turns = [t("a", 0, 1_000), t("b", 500, 2_000), t("a", 70_000, 71_500)];
        assert_eq!(ms_with_speakers(&turns, 1), 3_500);
        assert_eq!(ms_with_speakers(&turns, 2), 500);
        assert_eq!(longest_return_gap(&turns, "a"), 69_000);
        assert_eq!(longest_return_gap(&turns, "b"), 0);
        assert_eq!(speech_ms(&turns, "a"), 2_500);
    }
}
