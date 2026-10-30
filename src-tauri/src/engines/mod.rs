//! Engines, each behind a trait with a fake for tests: microphone capture ([`audio::AudioSource`],
//! real: [`cpal_source::CpalAudioSource`]), speech-to-text ([`stt::SpeechToText`], real:
//! [`whisper::WhisperSpeechToText`]) and speaker detection ([`diarize::Diarizer`], real:
//! [`sherpa::SherpaDiarizer`]), with models found by [`models`]. Nothing outside this module and the
//! recording pipeline sees an engine type; the UI gets plain segments, voice labels and capture states.

pub mod audio;
pub mod cpal_source;
pub mod diarize;
pub mod models;
pub mod sherpa;
pub mod stt;
pub mod whisper;

use std::path::PathBuf;

use diarize::{DiarizeError, Diarizer, ScriptedDiarizer};
use models::{ModelList, ModelSource, SpeakerModel, SpeakerModelList, SpeechModel};
use stt::{ScriptedSpeechToText, SpeechToText, SttError};

/// Creates audio sources; one per recording session.
pub type AudioFactory = Box<dyn Fn() -> Box<dyn audio::AudioSource> + Send + Sync>;

/// Lists the speech models there are and loads one.
pub trait SttProvider: Send + Sync {
    fn models(&self) -> ModelList;
    /// Loads the model with `id` (an id from [`Self::models`]) or the preferred one.
    fn load(&self, id: Option<&str>) -> Result<Box<dyn SpeechToText>, SttError>;
}

/// whisper.cpp with a model found on this device.
pub struct WhisperProvider {
    pub locations: Vec<models::ModelLocation>,
}

impl SttProvider for WhisperProvider {
    fn models(&self) -> ModelList {
        models::scan(&self.locations)
    }

    fn load(&self, id: Option<&str>) -> Result<Box<dyn SpeechToText>, SttError> {
        let list = self.models();
        let model = models::choose(&list, id).ok_or(SttError::NoModel)?;
        let engine = whisper::WhisperSpeechToText::load(&PathBuf::from(&model.id))?;
        Ok(Box::new(engine))
    }
}

/// The scripted fake engine (`MEETING_COMPANION_STT=fake`, tests). Lists one pretend model.
pub struct FakeSttProvider {
    pub make: Box<dyn Fn() -> ScriptedSpeechToText + Send + Sync>,
}

impl FakeSttProvider {
    pub fn demo() -> Self {
        Self {
            make: Box::new(ScriptedSpeechToText::demo),
        }
    }
}

impl SttProvider for FakeSttProvider {
    fn models(&self) -> ModelList {
        ModelList {
            models: vec![SpeechModel {
                id: "fake".into(),
                name: "scripted".into(),
                size_bytes: 0,
                source: ModelSource::Test,
                multilingual: true,
                folder: String::new(),
            }],
            searched: Vec::new(),
        }
    }

    fn load(&self, _id: Option<&str>) -> Result<Box<dyn SpeechToText>, SttError> {
        Ok(Box::new((self.make)()))
    }
}

/// No model anywhere: what a fresh install without a speech model sees.
pub struct NoModelProvider {
    pub searched: Vec<String>,
}

impl SttProvider for NoModelProvider {
    fn models(&self) -> ModelList {
        ModelList {
            models: Vec::new(),
            searched: self.searched.clone(),
        }
    }

    fn load(&self, _id: Option<&str>) -> Result<Box<dyn SpeechToText>, SttError> {
        Err(SttError::NoModel)
    }
}

/// Lists the speaker models there are and loads the preferred one.
pub trait DiarizerProvider: Send + Sync {
    fn models(&self) -> SpeakerModelList;
    /// Loads the model with `id` (an id from [`Self::models`]) or the preferred one.
    fn load(&self, id: Option<&str>) -> Result<Box<dyn Diarizer>, DiarizeError>;
}

/// sherpa-onnx with a speaker model found on this device.
pub struct SherpaProvider {
    pub locations: Vec<models::ModelLocation>,
}

impl DiarizerProvider for SherpaProvider {
    fn models(&self) -> SpeakerModelList {
        models::scan_speaker(&self.locations)
    }

    fn load(&self, id: Option<&str>) -> Result<Box<dyn Diarizer>, DiarizeError> {
        let list = self.models();
        let model = models::choose_speaker(&list, id).ok_or(DiarizeError::NoModel)?;
        Ok(Box::new(sherpa::SherpaDiarizer::load(&PathBuf::from(
            &model.id,
        ))?))
    }
}

/// The scripted fake (`MEETING_COMPANION_DIARIZE=fake`, tests). Lists one pretend model.
pub struct FakeDiarizerProvider {
    pub make: Box<dyn Fn() -> ScriptedDiarizer + Send + Sync>,
}

impl FakeDiarizerProvider {
    pub fn demo() -> Self {
        Self {
            make: Box::new(ScriptedDiarizer::demo),
        }
    }
}

impl DiarizerProvider for FakeDiarizerProvider {
    fn models(&self) -> SpeakerModelList {
        SpeakerModelList {
            models: vec![SpeakerModel {
                id: "fake".into(),
                name: "scripted".into(),
                size_bytes: 0,
                source: ModelSource::Test,
                folder: String::new(),
            }],
            searched: Vec::new(),
        }
    }

    fn load(&self, _id: Option<&str>) -> Result<Box<dyn Diarizer>, DiarizeError> {
        Ok(Box::new((self.make)()))
    }
}

/// No speaker model anywhere: recording and transcription run without voices.
pub struct NoSpeakerModelProvider {
    pub searched: Vec<String>,
}

impl DiarizerProvider for NoSpeakerModelProvider {
    fn models(&self) -> SpeakerModelList {
        SpeakerModelList {
            models: Vec::new(),
            searched: self.searched.clone(),
        }
    }

    fn load(&self, _id: Option<&str>) -> Result<Box<dyn Diarizer>, DiarizeError> {
        Err(DiarizeError::NoModel)
    }
}
