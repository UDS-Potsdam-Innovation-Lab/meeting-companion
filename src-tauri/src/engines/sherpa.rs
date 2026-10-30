//! [`Diarizer`] with the sherpa-onnx speaker-embedding extractor, on the CPU, fully on the device. The
//! model file comes from [`super::models::scan_speaker`]; the app ships and downloads none. Only
//! `SpeakerEmbeddingExtractor` is used: it computes the filterbank features and runs the ONNX model.
//! Audio is handed over in memory and the embedding comes back in memory; nothing is written.

use std::path::Path;

use sherpa_onnx::{SpeakerEmbeddingExtractor, SpeakerEmbeddingExtractorConfig};

use super::audio::SAMPLE_RATE;
use super::diarize::{DiarizeError, Diarizer};

pub struct SherpaDiarizer {
    extractor: SpeakerEmbeddingExtractor,
}

impl SherpaDiarizer {
    /// Loads a speaker-embedding model. Any failure means "no usable model".
    pub fn load(path: &Path) -> Result<Self, DiarizeError> {
        let threads = std::thread::available_parallelism()
            .map(|n| n.get().clamp(1, 2))
            .unwrap_or(1);
        let config = SpeakerEmbeddingExtractorConfig {
            model: Some(path.to_str().ok_or(DiarizeError::NoModel)?.to_owned()),
            num_threads: threads as i32,
            debug: false,
            provider: Some("cpu".into()),
        };
        let extractor = SpeakerEmbeddingExtractor::create(&config).ok_or(DiarizeError::NoModel)?;
        if extractor.dim() <= 0 {
            return Err(DiarizeError::NoModel);
        }
        Ok(Self { extractor })
    }
}

impl Diarizer for SherpaDiarizer {
    fn embed(&mut self, audio: &[f32]) -> Result<Option<Vec<f32>>, DiarizeError> {
        if audio.is_empty() {
            return Ok(None);
        }
        let stream = self.extractor.create_stream().ok_or(DiarizeError::Failed)?;
        stream.accept_waveform(SAMPLE_RATE as i32, audio);
        stream.input_finished();
        if !self.extractor.is_ready(&stream) {
            return Ok(None);
        }
        self.extractor
            .compute(&stream)
            .map(Some)
            .ok_or(DiarizeError::Failed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engines::diarize::VoiceTracker;
    use crate::engines::models;

    /// 16 kHz mono 16-bit PCM WAV samples.
    fn read_wav(path: &Path) -> Vec<f32> {
        let bytes = std::fs::read(path).expect("wav readable");
        assert_eq!(&bytes[..4], b"RIFF", "{} is not a WAV file", path.display());
        let mut pos = 12;
        let mut format = None;
        while pos + 8 <= bytes.len() {
            let id = &bytes[pos..pos + 4];
            let size = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().unwrap()) as usize;
            let body = &bytes[pos + 8..(pos + 8 + size).min(bytes.len())];
            if id == b"fmt " {
                let u16_at = |i: usize| u16::from_le_bytes([body[i], body[i + 1]]);
                let rate = u32::from_le_bytes(body[4..8].try_into().unwrap());
                format = Some((u16_at(0), u16_at(2), rate, u16_at(14)));
            } else if id == b"data" {
                assert_eq!(
                    format,
                    Some((1, 1, SAMPLE_RATE, 16)),
                    "{}: need 16 kHz mono 16-bit PCM",
                    path.display()
                );
                return body
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|c| f32::from(i16::from_le_bytes(*c)) / 32_768.0)
                    .collect();
            }
            pos += 8 + size + (size & 1);
        }
        panic!("{}: no data chunk", path.display());
    }

    /// Hand-run check with a real speaker model on two recorded voices:
    /// `MEETING_COMPANION_SPEAKER_WAVS=<person-1.wav>,<person-2.wav> cargo test --manifest-path
    /// src-tauri/Cargo.toml --release -- --ignored speaker`. Each WAV holds one person (16 kHz mono
    /// 16-bit). The model is `MEETING_COMPANION_SPEAKER_MODEL`, else the one the scan prefers. Prints the
    /// time per segment, to judge the speed on the device.
    #[test]
    #[ignore]
    fn speaker_detection_with_a_local_model_tells_two_recorded_voices_apart() {
        let path = std::env::var_os("MEETING_COMPANION_SPEAKER_MODEL")
            .map(std::path::PathBuf::from)
            .or_else(|| {
                let env = models::Env::from_process(std::env::temp_dir());
                let locations =
                    models::locations_of(models::ModelKind::Speaker, models::Os::current(), &env);
                models::scan_speaker(&locations)
                    .models
                    .first()
                    .map(|m| std::path::PathBuf::from(&m.id))
            })
            .expect("no speaker model found; set MEETING_COMPANION_SPEAKER_MODEL");
        let wavs = std::env::var("MEETING_COMPANION_SPEAKER_WAVS")
            .expect("set MEETING_COMPANION_SPEAKER_WAVS=<person-1.wav>,<person-2.wav>");
        let people: Vec<Vec<f32>> = wavs
            .split(',')
            .map(|p| read_wav(Path::new(p.trim())))
            .collect();
        assert_eq!(people.len(), 2, "two WAV files, one per person");
        let mut d = SherpaDiarizer::load(&path).expect("model loads");
        let mut tracker = VoiceTracker::new(0);
        // Segments of up to 2.5 s, taking turns between the two people, as in a conversation.
        let piece = SAMPLE_RATE as usize * 5 / 2;
        let chunks: Vec<Vec<&[f32]>> = people
            .iter()
            .map(|p| {
                p.chunks(piece)
                    .filter(|c| c.len() >= SAMPLE_RATE as usize)
                    .collect()
            })
            .collect();
        let turns = chunks[0].len().min(chunks[1].len());
        assert!(turns >= 2, "each WAV needs at least 2 s of speech");
        let mut labels = [Vec::new(), Vec::new()];
        let mut t = 0u64;
        let mut took = std::time::Duration::ZERO;
        for i in 0..turns {
            for (who, list) in chunks.iter().enumerate() {
                let audio = list[i];
                let ms = audio.len() as u64 * 1000 / u64::from(SAMPLE_RATE);
                let started = std::time::Instant::now();
                let voice = tracker.voice_for(&mut d, t + 2_000, t + 2_000 + ms, audio);
                took += started.elapsed();
                t += ms + 2_000;
                labels[who].push(voice.map(|v| v.label()));
            }
        }
        eprintln!(
            "speaker: {} — {} segments, {:?} per segment; voices {:?}",
            path.display(),
            turns * 2,
            took / (turns as u32 * 2),
            labels
        );
        let first = |who: usize| labels[who][0].expect("a voice");
        assert_ne!(first(0), first(1), "the two people get different labels");
        for (who, list) in labels.iter().enumerate() {
            assert!(list.iter().all(|l| *l == Some(first(who))), "{labels:?}");
        }
    }
}
