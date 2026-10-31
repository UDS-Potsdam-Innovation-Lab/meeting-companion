//! Builds the language model engine from the `languageModel` setting and runs the settings view's
//! "Test". No meeting feature uses the engine yet; nothing in the recording pipeline can reach it.
//!
//! - [`build_engine`] is the factory: `none` builds nothing ([`LlmError::NotConfigured`], without
//!   touching the network, the keychain or a model file), `local` asks the [`LocalLlmProvider`],
//!   `claude` builds the Claude engine. It never falls back to another engine.
//! - `MEETING_COMPANION_LLM=fake` ([`ENV_LLM`]) replaces both real engines with the scripted fake.
//! - The local runtime is behind [`LocalLlmProvider`]. This build has none ([`NoLocalRuntime`]):
//!   llama.cpp's static `ggml` libraries share their names with whisper.cpp's, so linking both makes
//!   one silently replace the other. "On this device" is shown as not available yet; a follow-up adds
//!   the runtime with one shared ggml.

use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::Serialize;

use crate::engines::claude::{ClaudeLanguageModel, ClaudeModel, Transport};
use crate::engines::llm::{
    run_cancellable, CancelToken, LanguageModel, LlmError, LlmRequest, ScriptedLanguageModel,
};
use crate::engines::models::{self, LlmModelList, ModelLocation};
use crate::secrets::SecretStore;
use crate::settings::{LanguageModelSetting, Locale, Settings};

/// `MEETING_COMPANION_LLM=fake` selects the scripted engine (smoke run, e2e build).
pub const ENV_LLM: &str = "MEETING_COMPANION_LLM";

/// Whether `MEETING_COMPANION_LLM` asks for the scripted engine.
pub fn is_fake(value: Option<&str>) -> bool {
    value == Some("fake")
}

/// The fixed instructions of the settings view's "Test".
pub const TEST_TASK: &str = "Summarise the text in one sentence, in the language of the text.";
/// The fixed sample text of the "Test": never meeting data. The UI shows the same text.
pub const SAMPLE_EN: &str = "The team agreed to launch the beta on 14 November without offline mode and to tell the third pilot school this week.";
pub const SAMPLE_DE: &str = "Das Team hat beschlossen, die Beta am 14. November ohne Offline-Modus zu starten und die dritte Pilotschule diese Woche zu informieren.";
const TEST_MAX_INPUT_CHARS: usize = 1_000;
const TEST_MAX_OUTPUT_TOKENS: u32 = 200;

/// The language models on this device and whether this build can run them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LocalModels {
    #[serde(flatten)]
    pub list: LlmModelList,
    /// False while the app has no local runtime: "On this device" cannot be chosen.
    pub available: bool,
}

/// Finds and loads local language models.
pub trait LocalLlmProvider: Send + Sync {
    fn models(&self) -> LocalModels;
    /// Loads the model with `id` (an id of [`Self::models`]).
    fn load(&self, id: &str) -> Result<Arc<dyn LanguageModel>, LlmError>;
}

/// This build: no local runtime. Nothing is scanned or loaded.
pub struct NoLocalRuntime {
    pub locations: Vec<ModelLocation>,
}

impl LocalLlmProvider for NoLocalRuntime {
    fn models(&self) -> LocalModels {
        LocalModels {
            list: LlmModelList {
                models: Vec::new(),
                searched: self
                    .locations
                    .iter()
                    .map(|l| l.path.to_string_lossy().into_owned())
                    .collect(),
            },
            available: false,
        }
    }

    fn load(&self, _id: &str) -> Result<Arc<dyn LanguageModel>, LlmError> {
        Err(LlmError::NoModel)
    }
}

/// The GGUF models of the core's read-only scan, run by the scripted engine (`MEETING_COMPANION_LLM=
/// fake`, tests). Counts its scans and loads, so tests can show "Off" touches no model file.
pub struct ScriptedLocalProvider {
    pub locations: Vec<ModelLocation>,
    pub engine: Arc<ScriptedLanguageModel>,
    scans: Mutex<usize>,
    loads: Mutex<usize>,
}

impl ScriptedLocalProvider {
    pub fn new(locations: Vec<ModelLocation>, engine: Arc<ScriptedLanguageModel>) -> Self {
        Self {
            locations,
            engine,
            scans: Mutex::new(0),
            loads: Mutex::new(0),
        }
    }
    pub fn scans(&self) -> usize {
        *self.scans.lock().unwrap_or_else(|e| e.into_inner())
    }
    pub fn loads(&self) -> usize {
        *self.loads.lock().unwrap_or_else(|e| e.into_inner())
    }
}

impl LocalLlmProvider for ScriptedLocalProvider {
    fn models(&self) -> LocalModels {
        *self.scans.lock().unwrap_or_else(|e| e.into_inner()) += 1;
        LocalModels {
            list: models::scan_llm(&self.locations),
            available: true,
        }
    }

    fn load(&self, id: &str) -> Result<Arc<dyn LanguageModel>, LlmError> {
        *self.loads.lock().unwrap_or_else(|e| e.into_inner()) += 1;
        if !self.models().list.models.iter().any(|m| m.id == id) {
            return Err(LlmError::NoModel);
        }
        Ok(Arc::new(self.engine.clone()))
    }
}

/// What the engine factory can use.
#[derive(Clone)]
pub struct EngineDeps {
    pub local: Arc<dyn LocalLlmProvider>,
    pub transport: Arc<dyn Transport>,
    pub secrets: Arc<dyn SecretStore>,
    /// `MEETING_COMPANION_LLM=fake`: the scripted engine instead of Claude.
    pub fake: Option<Arc<ScriptedLanguageModel>>,
}

/// The engine for the current setting. Never another engine than the one chosen.
pub fn build_engine(
    setting: &LanguageModelSetting,
    claude_model: ClaudeModel,
    deps: &EngineDeps,
) -> Result<Arc<dyn LanguageModel>, LlmError> {
    match setting {
        LanguageModelSetting::None => Err(LlmError::NotConfigured),
        LanguageModelSetting::Local(id) => {
            let found = deps.local.models();
            if !found.available || !found.list.models.iter().any(|m| &m.id == id) {
                return Err(LlmError::NoModel);
            }
            deps.local.load(id)
        }
        LanguageModelSetting::Claude => match &deps.fake {
            Some(fake) => Ok(Arc::new(fake.clone())),
            None => Ok(Arc::new(ClaudeLanguageModel::new(
                deps.transport.clone(),
                deps.secrets.clone(),
                claude_model,
            ))),
        },
    }
}

/// What the "Test" shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmTestReply {
    /// Plain text; the UI renders it as text.
    pub text: String,
    pub truncated: bool,
    pub output_truncated: bool,
    pub elapsed_ms: u64,
}

/// Runs the settings view's "Test", one at a time, cancellable.
pub struct LanguageModelService {
    deps: EngineDeps,
    running: Mutex<Option<CancelToken>>,
}

impl LanguageModelService {
    pub fn new(deps: EngineDeps) -> Self {
        Self {
            deps,
            running: Mutex::new(None),
        }
    }

    pub fn secrets(&self) -> &dyn SecretStore {
        self.deps.secrets.as_ref()
    }

    pub fn local_models(&self) -> LocalModels {
        self.deps.local.models()
    }

    /// Sends the fixed sample text through the chosen engine. Blocks: call it off the UI thread.
    pub fn run_test(&self, settings: &Settings) -> Result<LlmTestReply, LlmError> {
        let cancel = {
            let mut running = self.running.lock().unwrap_or_else(|e| e.into_inner());
            if running.is_some() {
                return Err(LlmError::Busy);
            }
            let token = CancelToken::new();
            *running = Some(token.clone());
            token
        };
        let started = Instant::now();
        let result = build_engine(&settings.language_model, settings.claude_model, &self.deps)
            .and_then(|engine| {
                let req = LlmRequest {
                    system: TEST_TASK,
                    content: match settings.locale {
                        Locale::De => SAMPLE_DE,
                        Locale::En => SAMPLE_EN,
                    }
                    .to_owned(),
                    max_input_chars: TEST_MAX_INPUT_CHARS,
                    max_output_tokens: TEST_MAX_OUTPUT_TOKENS,
                };
                run_cancellable(engine, &req, &cancel)
            });
        *self.running.lock().unwrap_or_else(|e| e.into_inner()) = None;
        match result {
            Ok(reply) => Ok(LlmTestReply {
                text: reply.text,
                truncated: reply.truncated,
                output_truncated: reply.output_truncated,
                elapsed_ms: u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
            }),
            Err(e) => {
                crate::log!("the language model test failed: {e}");
                Err(e)
            }
        }
    }

    /// "Cancel test": the running test returns `Cancelled` within a second.
    pub fn cancel_test(&self) {
        if let Some(token) = self
            .running
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            token.cancel();
        }
    }
}

#[cfg(test)]
mod tests;
