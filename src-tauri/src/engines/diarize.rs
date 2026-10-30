//! Telling voices apart, behind [`Diarizer`]. An engine turns the audio of one final transcript segment
//! (16 kHz mono, at most 3 s) into a voice embedding; [`VoiceClusterer`] groups the embeddings of a
//! meeting into voices `A`, `B`, … by cosine similarity to one centroid per voice; [`VoiceTracker`] adds
//! the rule for very short segments. Embeddings and centroids live in memory only and are dropped when
//! recording stops; nothing here is written anywhere. No sherpa type appears in this module.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crate::transcript::Voice;

/// A segment shorter than this is too short for a reliable embedding.
pub const MIN_SEGMENT_MS: u64 = 1_000;
/// A short segment takes the previous segment's voice if that one ended less than this before it.
pub const SHORT_GAP_MS: u64 = 1_000;
/// Cosine similarity from which an embedding belongs to an existing voice. Tuned with the
/// `#[ignore]` real-model test (`cargo test --release -- --ignored speaker`).
pub const SAME_VOICE: f32 = 0.5;

/// Why a diarizer could not be loaded or failed. Carries no audio and no embedding.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiarizeError {
    /// No usable speaker model is on this device.
    NoModel,
    /// The engine failed on one segment.
    Failed,
}

impl std::fmt::Display for DiarizeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            DiarizeError::NoModel => "no speaker model",
            DiarizeError::Failed => "speaker engine failed",
        })
    }
}

pub trait Diarizer: Send {
    /// A voice embedding for one segment's audio, or `None` when the engine cannot tell from it.
    fn embed(&mut self, audio: &[f32]) -> Result<Option<Vec<f32>>, DiarizeError>;
}

/// The fake engine: every call returns the embedding of the next scripted speaker (cycling), after an
/// optional delay. Embeddings are one-hot per speaker plus [`FAKE_MARKER`] in the last place, so a test
/// can check that no embedding ever reaches a file.
pub struct ScriptedDiarizer {
    speakers: Vec<usize>,
    next: usize,
    delay: Duration,
    pub calls: Arc<AtomicUsize>,
}

/// Dimension of the fake embeddings.
pub const FAKE_DIM: usize = 32;
/// A value no real embedding would contain verbatim; it marks the fake's embeddings.
pub const FAKE_MARKER: f32 = 0.031_337_77;

impl ScriptedDiarizer {
    /// `speakers`: who speaks in each call, as indices `0..FAKE_DIM - 1`.
    pub fn new(speakers: Vec<usize>) -> Self {
        Self {
            speakers,
            next: 0,
            delay: Duration::ZERO,
            calls: Arc::new(AtomicUsize::new(0)),
        }
    }

    /// Takes `delay` for every call, like a slow device.
    pub fn slow(mut self, delay: Duration) -> Self {
        self.delay = delay;
        self
    }

    /// `MEETING_COMPANION_DIARIZE=fake`: three people taking turns, one of them twice as often.
    pub fn demo() -> Self {
        Self::new(vec![0, 1, 0, 2, 1])
    }
}

impl Diarizer for ScriptedDiarizer {
    fn embed(&mut self, audio: &[f32]) -> Result<Option<Vec<f32>>, DiarizeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if !self.delay.is_zero() {
            std::thread::sleep(self.delay);
        }
        if self.speakers.is_empty() || audio.is_empty() {
            return Ok(None);
        }
        let who = self.speakers[self.next % self.speakers.len()] % (FAKE_DIM - 1);
        self.next += 1;
        let mut v = vec![0.0; FAKE_DIM];
        v[who] = 1.0;
        v[FAKE_DIM - 1] = FAKE_MARKER;
        Ok(Some(v))
    }
}

fn normalised(v: &[f32]) -> Option<Vec<f32>> {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    (norm.is_finite() && norm > f32::EPSILON).then(|| v.iter().map(|x| x / norm).collect())
}

fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

struct Centroid {
    voice: Voice,
    /// Sum of the unit-length embeddings assigned to the voice.
    sum: Vec<f32>,
}

impl Centroid {
    fn similarity(&self, unit: &[f32]) -> f32 {
        normalised(&self.sum).map_or(-1.0, |c| dot(&c, unit))
    }
}

/// Online clustering of one meeting's embeddings into voices, in memory only.
pub struct VoiceClusterer {
    centroids: Vec<Centroid>,
    /// Index of the next new label; labels before it are taken (in this or an earlier session).
    next: usize,
    threshold: f32,
}

impl VoiceClusterer {
    /// `first_free`: the first label this session may hand out (after the highest stored one).
    pub fn new(first_free: usize) -> Self {
        Self::with_threshold(first_free, SAME_VOICE)
    }

    pub fn with_threshold(first_free: usize, threshold: f32) -> Self {
        Self {
            centroids: Vec::new(),
            next: first_free,
            threshold,
        }
    }

    /// Voices known in this session.
    pub fn len(&self) -> usize {
        self.centroids.len()
    }

    pub fn is_empty(&self) -> bool {
        self.centroids.is_empty()
    }

    /// The voice of `embedding`: the most similar known voice if it is similar enough, else a new
    /// voice. After `Z` no new label exists, and the embedding joins the nearest voice. `None` for an
    /// embedding of zero length or with non-finite values.
    pub fn assign(&mut self, embedding: &[f32]) -> Option<Voice> {
        let unit = normalised(embedding)?;
        let best = self
            .centroids
            .iter()
            .enumerate()
            .map(|(i, c)| (c.similarity(&unit), i))
            .max_by(|a, b| a.0.total_cmp(&b.0));
        let index = match (best, Voice::from_index(self.next)) {
            (Some((sim, i)), _) if sim >= self.threshold => i,
            (_, Some(label)) => {
                self.next += 1;
                self.open(label, unit.len())
            }
            (Some((_, i)), None) => i,
            // Every label was used in earlier sessions: the last one gathers the rest.
            (None, None) => self.open(Voice::from_index(Voice::COUNT - 1)?, unit.len()),
        };
        let centroid = &mut self.centroids[index];
        if centroid.sum.len() == unit.len() {
            for (s, x) in centroid.sum.iter_mut().zip(&unit) {
                *s += x;
            }
        }
        Some(centroid.voice)
    }

    fn open(&mut self, voice: Voice, dim: usize) -> usize {
        self.centroids.push(Centroid {
            voice,
            sum: vec![0.0; dim],
        });
        self.centroids.len() - 1
    }
}

/// A meeting's voices across the segments of its recording sessions: the clusterer plus the rule
/// for segments too short to embed.
pub struct VoiceTracker {
    clusterer: VoiceClusterer,
    /// End offset and voice of the previous final segment.
    last: Option<(u64, Option<Voice>)>,
}

impl VoiceTracker {
    pub fn new(first_free: usize) -> Self {
        Self {
            clusterer: VoiceClusterer::new(first_free),
            last: None,
        }
    }

    /// Voices this tracker holds a centroid for.
    pub fn voices(&self) -> usize {
        self.clusterer.len()
    }

    /// The voice of the final segment `[start_ms, end_ms)` with `audio`. A segment shorter than
    /// [`MIN_SEGMENT_MS`] is not embedded: it takes the previous segment's voice if that one ended less
    /// than [`SHORT_GAP_MS`] before, otherwise it has none. An engine failure gives no voice.
    pub fn voice_for(
        &mut self,
        diarizer: &mut dyn Diarizer,
        start_ms: u64,
        end_ms: u64,
        audio: &[f32],
    ) -> Option<Voice> {
        let voice = if end_ms.saturating_sub(start_ms) < MIN_SEGMENT_MS {
            match self.last {
                Some((prev_end, prev)) if start_ms.saturating_sub(prev_end) < SHORT_GAP_MS => prev,
                _ => None,
            }
        } else {
            match diarizer.embed(audio) {
                Ok(Some(e)) => self.clusterer.assign(&e),
                Ok(None) => None,
                Err(e) => {
                    crate::log!("speaker detection failed for a segment: {e}");
                    None
                }
            }
        };
        self.last = Some((end_ms, voice));
        voice
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(c: char) -> Voice {
        Voice::parse(&c.to_string()).unwrap()
    }

    /// A unit vector near axis `axis` (of 8), turned slightly by `wobble`.
    fn near(axis: usize, wobble: f32) -> Vec<f32> {
        let mut e = vec![0.0; 8];
        e[axis] = 1.0;
        e[(axis + 1) % 8] = wobble;
        e
    }

    #[test]
    fn vectors_near_three_centroids_form_three_voices() {
        let mut c = VoiceClusterer::new(0);
        let seq = [
            near(0, 0.0),
            near(1, 0.1),
            near(0, 0.2),
            near(2, 0.0),
            near(1, -0.1),
            near(2, 0.15),
            near(0, -0.1),
        ];
        let labels: String = seq.iter().map(|e| c.assign(e).unwrap().label()).collect();
        assert_eq!(labels, "ABACBCA");
        assert_eq!(c.len(), 3);
    }

    #[test]
    fn a_vector_below_the_similarity_threshold_opens_a_new_voice() {
        let mut c = VoiceClusterer::with_threshold(0, 0.8);
        assert_eq!(c.assign(&[1.0, 0.0]), Some(v('A')));
        // cos 45° ≈ 0.71 < 0.8: another voice.
        assert_eq!(c.assign(&[1.0, 1.0]), Some(v('B')));
        // cos ≈ 0.95 to A: A again.
        assert_eq!(c.assign(&[1.0, 0.3]), Some(v('A')));
        assert_eq!(c.assign(&[0.0, 0.0]), None);
        assert_eq!(c.assign(&[f32::NAN, 1.0]), None);
    }

    #[test]
    fn after_26_voices_a_new_vector_joins_the_nearest_voice() {
        let mut c = VoiceClusterer::new(0);
        let dims = 40;
        let axis = |i: usize| {
            let mut e = vec![0.0; dims];
            e[i] = 1.0;
            e
        };
        for i in 0..26 {
            assert_eq!(c.assign(&axis(i)).unwrap().index(), i);
        }
        // Orthogonal to all of them: no new label exists; it joins the nearest.
        let mut e = axis(30);
        e[7] = 0.2;
        assert_eq!(c.assign(&e), Some(v('H')));
        assert_eq!(c.len(), 26);
    }

    #[test]
    fn labels_after_a_restart_continue_after_the_highest_stored_one() {
        let mut c = VoiceClusterer::new(3);
        assert_eq!(c.assign(&near(0, 0.0)), Some(v('D')));
        assert_eq!(c.assign(&near(4, 0.0)), Some(v('E')));
        // All labels used before: the first new voice is Z, and Z takes the rest.
        let mut full = VoiceClusterer::new(26);
        assert_eq!(full.assign(&near(0, 0.0)), Some(v('Z')));
        assert_eq!(full.assign(&near(3, 0.0)), Some(v('Z')));
    }

    #[test]
    fn short_segments_take_the_previous_voice_only_right_after_it() {
        let mut d = ScriptedDiarizer::new(vec![0, 1, 2]);
        let calls = d.calls.clone();
        let mut t = VoiceTracker::new(0);
        let audio = vec![0.1; 16_000];
        assert_eq!(t.voice_for(&mut d, 0, 2_000, &audio), Some(v('A')));
        // 0.8 s long, 0.5 s after A ended: A, without asking the engine.
        assert_eq!(t.voice_for(&mut d, 2_500, 3_300, &audio), Some(v('A')));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(t.voice_for(&mut d, 4_000, 6_000, &audio), Some(v('B')));
        // Short, but 1.5 s after the previous one: no voice.
        assert_eq!(t.voice_for(&mut d, 7_500, 8_000, &audio), None);
        // Short right after a segment without voice: none either.
        assert_eq!(t.voice_for(&mut d, 8_200, 8_900, &audio), None);
        assert_eq!(t.voice_for(&mut d, 9_000, 12_000, &audio), Some(v('C')));
        assert_eq!(t.voices(), 3);
    }

    #[test]
    fn voice_labels_parse_strictly_and_serialise_as_the_letter() {
        assert_eq!(Voice::parse("A"), Some(v('A')));
        assert_eq!(Voice::parse("Z").unwrap().index(), 25);
        for bad in ["", "a", "AA", "[", "@", "Ä", " A", "1"] {
            assert_eq!(Voice::parse(bad), None, "{bad:?}");
        }
        assert_eq!(Voice::from_index(26), None);
        assert_eq!(serde_json::to_string(&v('C')).unwrap(), "\"C\"");
        assert!(serde_json::from_str::<Voice>("\"c\"").is_err());
    }
}
