//! [`SpeechToText`] with whisper.cpp (`whisper-rs`), on the CPU, fully on the device. The model file
//! comes from [`super::models`]; the app ships and downloads none. Each final window's language is
//! detected on its own and limited to German or English, so a mixed meeting gets per-segment
//! languages; previews reuse the last detected language.

use std::path::Path;

use whisper_rs::{
    FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperState,
};

use super::stt::{Lang, Recognized, SpeechToText, SttError};

pub struct WhisperSpeechToText {
    // Keeps the model alive for the state.
    _ctx: WhisperContext,
    state: WhisperState,
    multilingual: bool,
    threads: usize,
    /// Language of the last final window; previews reuse it instead of running detection again.
    last_lang: Lang,
}

impl WhisperSpeechToText {
    /// Loads a ggml model file. Any failure means "no usable model".
    pub fn load(path: &Path) -> Result<Self, SttError> {
        // Route whisper.cpp's own logging away from stderr: nothing it prints reaches the log.
        whisper_rs::install_logging_hooks();
        let mut params = WhisperContextParameters::default();
        params.use_gpu(false);
        let ctx = WhisperContext::new_with_params(path, params).map_err(|_| SttError::NoModel)?;
        let state = ctx.create_state().map_err(|_| SttError::NoModel)?;
        let multilingual = ctx.is_multilingual();
        let threads = std::thread::available_parallelism()
            .map(|n| n.get().clamp(1, 4))
            .unwrap_or(2);
        Ok(Self {
            _ctx: ctx,
            state,
            multilingual,
            threads,
            last_lang: Lang::De,
        })
    }

    /// German or English, whichever whisper finds more likely for this window.
    fn detect(&mut self, window: &[f32]) -> Result<Lang, SttError> {
        if !self.multilingual {
            return Ok(Lang::En);
        }
        self.state
            .pcm_to_mel(window, self.threads)
            .map_err(|_| SttError::Failed)?;
        let (_, probs) = self
            .state
            .lang_detect(0, self.threads)
            .map_err(|_| SttError::Failed)?;
        let p = |code: &str| {
            whisper_rs::get_lang_id(code)
                .and_then(|id| probs.get(id as usize).copied())
                .unwrap_or(0.0)
        };
        Ok(if p("de") > p("en") {
            Lang::De
        } else {
            Lang::En
        })
    }
}

impl SpeechToText for WhisperSpeechToText {
    fn transcribe(
        &mut self,
        window: &[f32],
        final_pass: bool,
    ) -> Result<Vec<Recognized>, SttError> {
        if window.is_empty() {
            return Ok(Vec::new());
        }
        // Detection runs the encoder once more; a preview reuses the language of the last final window.
        let lang = if final_pass {
            let lang = self.detect(window)?;
            self.last_lang = lang;
            lang
        } else {
            self.last_lang
        };
        let code = match lang {
            Lang::De => "de",
            Lang::En => "en",
        };
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_n_threads(self.threads as i32);
        params.set_language(Some(code));
        params.set_translate(false);
        params.set_no_context(true);
        params.set_single_segment(!final_pass);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_suppress_blank(true);
        self.state
            .full(params, window)
            .map_err(|_| SttError::Failed)?;
        let mut out = Vec::new();
        for segment in self.state.as_iter() {
            let text = segment.to_str_lossy().map_err(|_| SttError::Failed)?;
            let text = text.trim();
            if text.is_empty() {
                continue;
            }
            // whisper timestamps are in 10 ms units.
            out.push(Recognized {
                start_ms: segment.start_timestamp().max(0) as u64 * 10,
                end_ms: segment.end_timestamp().max(0) as u64 * 10,
                text: text.to_owned(),
                lang,
            });
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engines::audio::{render_tones, samples_for_ms, Tone};

    /// Needs a real model; run by hand:
    /// `MEETING_COMPANION_WHISPER_MODEL=~/.local/share/voxtype/models/ggml-base.bin \
    ///  cargo test --manifest-path src-tauri/Cargo.toml -- --ignored whisper`
    /// Without the variable it uses the preferred model the scan finds on this device.
    #[test]
    #[ignore]
    fn whisper_transcribes_a_window_with_a_local_model() {
        let path = std::env::var_os("MEETING_COMPANION_WHISPER_MODEL")
            .map(std::path::PathBuf::from)
            .or_else(|| {
                let env = crate::engines::models::Env::from_process(std::env::temp_dir());
                let locations = crate::engines::models::locations_for(
                    crate::engines::models::Os::current(),
                    &env,
                );
                crate::engines::models::scan(&locations)
                    .models
                    .first()
                    .map(|m| std::path::PathBuf::from(&m.id))
            })
            .expect("no whisper model found; set MEETING_COMPANION_WHISPER_MODEL");
        let mut stt = WhisperSpeechToText::load(&path).expect("model loads");
        let window = render_tones(
            &[Tone::speech(2_000), Tone::silence(1_000)],
            0,
            samples_for_ms(3_000),
            false,
        );
        let started = std::time::Instant::now();
        let out = stt.transcribe(&window, true).expect("transcribes");
        eprintln!(
            "whisper: {} with {} segment(s) in {:?}",
            path.display(),
            out.len(),
            started.elapsed()
        );
        for r in &out {
            assert!(r.end_ms >= r.start_ms);
        }
    }
}
