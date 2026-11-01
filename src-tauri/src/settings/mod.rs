//! App settings: one sealed file `<app_data>/settings`, validated against a closed schema.
//!
//! - [`Settings`] is the schema. Every field has a default; a stored file is read field by field, so a
//!   missing or invalid field takes its default and unknown fields are dropped.
//! - [`SettingsStore`] keeps them: [`FileSettingsStore`] (encrypted with the meeting data key, see
//!   [`crate::crypto`]), [`MemorySettingsStore`] (tests, smoke run) and [`LockedSettingsStore`] (no
//!   data key: nothing is read or written).
//! - [`SettingsService`] holds the current settings in memory. A missing, corrupt or tampered file
//!   or a locked keychain gives the defaults, and the file is left as it is until a setting changes.
//! - Changes arrive as a [`SettingChange`] and are checked by [`apply`] against what the core itself
//!   knows ([`Catalog`]): the connected input devices and the speech models of its own scan.
//!
//! Device names and model paths can say something about a person or a room ("Jan's AirPods"). They
//! are only ever written sealed, and no log line or error carries a setting value.

mod file;

pub use file::FileSettingsStore;

use std::sync::{Arc, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::engines::claude::ClaudeModel;
use crate::engines::stt::Lang;

/// Longest input device name the core accepts.
pub const MAX_DEVICE_NAME: usize = 256;
/// Longest model id (a canonical path) the core accepts.
pub const MAX_MODEL_ID: usize = 4_096;

/// What happens when the microphone disappears while recording.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum DeviceLost {
    /// Recording stops with `MicrophoneLost` (the behaviour before this setting existed).
    #[default]
    Stop,
    /// Recording carries on with the system default microphone, with a notice.
    SwitchToDefault,
}

/// The language hint for new recordings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum MeetingLanguage {
    /// German and English, detected per line: no hint.
    #[default]
    Auto,
    De,
    En,
}

impl MeetingLanguage {
    /// The hint given to speech-to-text; `None` lets the engine detect the language per line.
    pub fn hint(self) -> Option<Lang> {
        match self {
            MeetingLanguage::Auto => None,
            MeetingLanguage::De => Some(Lang::De),
            MeetingLanguage::En => Some(Lang::En),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Locale {
    #[default]
    De,
    En,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    Light,
    Dark,
    #[default]
    System,
}

/// Which language model engine later features use. Nothing is chosen by default, and the core never
/// switches between engines on its own: only a person changes this.
///
/// JSON: `"none"` | `{ "local": "<model id from the core's llm scan>" }` | `"claude"`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum LanguageModelSetting {
    /// "Off": no engine; a call returns `NotConfigured` and nothing is sent anywhere.
    #[default]
    None,
    /// A GGUF model on this device, by the id of the core's scan.
    Local(String),
    /// The Claude API (Anthropic, api.anthropic.com, USA), after a person confirmed it.
    Claude,
}

/// Every app setting. `None` for a device or model means "the system default" / "the preferred one".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub input_device: Option<String>,
    pub device_lost: DeviceLost,
    pub speech_model: Option<String>,
    /// Speaker-embedding model id from the core's scan (job 004); `None`: the preferred one.
    pub speaker_model: Option<String>,
    pub meeting_language: MeetingLanguage,
    pub locale: Locale,
    pub theme: Theme,
    /// The language model engine (job 011); `none` by default.
    pub language_model: LanguageModelSetting,
    /// The Claude model, from the core's closed list; used only while `language_model` is `claude`.
    pub claude_model: ClaudeModel,
}

impl Settings {
    /// Reads stored JSON field by field: a missing or invalid field takes its default, unknown fields
    /// are dropped. Never fails; `None` only if the JSON is not an object.
    pub fn from_stored(json: &[u8]) -> Option<Self> {
        let map: Map<String, Value> = serde_json::from_slice(json).ok()?;
        let d = Settings::default();
        fn field<T: serde::de::DeserializeOwned>(map: &Map<String, Value>, k: &str, d: T) -> T {
            map.get(k)
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or(d)
        }
        let text = |k: &str, max: usize| -> Option<String> {
            map.get(k)
                .and_then(Value::as_str)
                .filter(|s| valid_text(s, max))
                .map(str::to_owned)
        };
        Some(Settings {
            input_device: text("inputDevice", MAX_DEVICE_NAME),
            device_lost: field(&map, "deviceLost", d.device_lost),
            speech_model: text("speechModel", MAX_MODEL_ID),
            speaker_model: text("speakerModel", MAX_MODEL_ID),
            meeting_language: field(&map, "meetingLanguage", d.meeting_language),
            locale: field(&map, "locale", d.locale),
            theme: field(&map, "theme", d.theme),
            language_model: match field(&map, "languageModel", d.language_model) {
                LanguageModelSetting::Local(id) if !valid_text(&id, MAX_MODEL_ID) => {
                    LanguageModelSetting::None
                }
                other => other,
            },
            claude_model: field(&map, "claudeModel", d.claude_model),
        })
    }
}

/// Non-empty, at most `max` characters, no control characters.
fn valid_text(s: &str, max: usize) -> bool {
    !s.trim().is_empty() && s.chars().count() <= max && !s.chars().any(char::is_control)
}

/// One change from the UI: `{ "key": "inputDevice", "value": "…" }`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(
    tag = "key",
    content = "value",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum SettingChange {
    InputDevice(Option<String>),
    DeviceLost(DeviceLost),
    SpeechModel(Option<String>),
    SpeakerModel(Option<String>),
    MeetingLanguage(MeetingLanguage),
    Locale(Locale),
    Theme(Theme),
    LanguageModel(LanguageModelSetting),
    ClaudeModel(ClaudeModel),
}

/// The setting keys, in the UI's names. Errors name the key, never the value.
pub const KEYS: [&str; 9] = [
    "inputDevice",
    "deviceLost",
    "speechModel",
    "speakerModel",
    "meetingLanguage",
    "locale",
    "theme",
    "languageModel",
    "claudeModel",
];

/// Why a change was refused. Carries the key only, never the value that was sent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SettingsError {
    /// Not a setting, or a value outside the schema. `key` is `None` when the key itself is unknown.
    Invalid { key: Option<&'static str> },
}

impl std::fmt::Display for SettingsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SettingsError::Invalid { key: Some(k) } => write!(f, "invalid value for {k}"),
            SettingsError::Invalid { key: None } => f.write_str("unknown setting"),
        }
    }
}

/// What the core knows right now, to check user-chosen values against.
pub trait Catalog {
    /// Names of the connected input devices.
    fn input_devices(&self) -> Vec<String>;
    /// Ids of the speech models in the core's own scan.
    fn speech_models(&self) -> Vec<String>;
    /// Ids of the speaker models in the core's own scan.
    fn speaker_models(&self) -> Vec<String> {
        Vec::new()
    }
    /// Ids of the language models in the core's own scan (empty while this build cannot run them).
    fn llm_models(&self) -> Vec<String> {
        Vec::new()
    }
}

/// Parses a change sent by the UI. A key or value outside the schema is refused with the key only.
pub fn parse_change(raw: &Value) -> Result<SettingChange, SettingsError> {
    let key = raw
        .get("key")
        .and_then(Value::as_str)
        .and_then(|k| KEYS.iter().copied().find(|known| *known == k));
    serde_json::from_value(raw.clone()).map_err(|_| SettingsError::Invalid { key })
}

/// Applies a parsed change to `current` after checking it against `catalog`.
pub fn apply(
    current: &Settings,
    change: SettingChange,
    catalog: &dyn Catalog,
) -> Result<Settings, SettingsError> {
    let mut next = current.clone();
    match change {
        SettingChange::InputDevice(device) => {
            if let Some(name) = &device {
                let known = valid_text(name, MAX_DEVICE_NAME)
                    && catalog.input_devices().iter().any(|d| d == name);
                if !known {
                    return Err(SettingsError::Invalid {
                        key: Some("inputDevice"),
                    });
                }
            }
            next.input_device = device;
        }
        SettingChange::SpeechModel(model) => {
            if let Some(id) = &model {
                let known =
                    valid_text(id, MAX_MODEL_ID) && catalog.speech_models().iter().any(|m| m == id);
                if !known {
                    return Err(SettingsError::Invalid {
                        key: Some("speechModel"),
                    });
                }
            }
            next.speech_model = model;
        }
        SettingChange::SpeakerModel(model) => {
            if let Some(id) = &model {
                let known = valid_text(id, MAX_MODEL_ID)
                    && catalog.speaker_models().iter().any(|m| m == id);
                if !known {
                    return Err(SettingsError::Invalid {
                        key: Some("speakerModel"),
                    });
                }
            }
            next.speaker_model = model;
        }
        SettingChange::LanguageModel(choice) => {
            if let LanguageModelSetting::Local(id) = &choice {
                let known =
                    valid_text(id, MAX_MODEL_ID) && catalog.llm_models().iter().any(|m| m == id);
                if !known {
                    return Err(SettingsError::Invalid {
                        key: Some("languageModel"),
                    });
                }
            }
            next.language_model = choice;
        }
        SettingChange::ClaudeModel(v) => next.claude_model = v,
        SettingChange::DeviceLost(v) => next.device_lost = v,
        SettingChange::MeetingLanguage(v) => next.meeting_language = v,
        SettingChange::Locale(v) => next.locale = v,
        SettingChange::Theme(v) => next.theme = v,
    }
    Ok(next)
}

// ---- store --------------------------------------------------------------------------------------

/// Why settings could not be read or written. Carries no setting value.
#[derive(Debug)]
pub enum StoreFailure {
    /// The file is not a sealed settings file for this key (changed, swapped, other key).
    Corrupt,
    /// The data key is not available. Nothing is read or written.
    Locked,
    Io(std::io::ErrorKind),
}

impl std::fmt::Display for StoreFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreFailure::Corrupt => f.write_str("the settings file is unreadable"),
            StoreFailure::Locked => f.write_str("the data key is not available"),
            StoreFailure::Io(kind) => write!(f, "settings storage error: {kind:?}"),
        }
    }
}

pub trait SettingsStore: Send + Sync {
    /// The stored settings, `None` if nothing was stored yet.
    fn load(&self) -> Result<Option<Settings>, StoreFailure>;
    fn save(&self, settings: &Settings) -> Result<(), StoreFailure>;
}

/// Keeps settings in memory only (tests, smoke run, `MEETING_COMPANION_STORE=memory`).
#[derive(Default)]
pub struct MemorySettingsStore {
    stored: Mutex<Option<Settings>>,
}

impl MemorySettingsStore {
    pub fn new() -> Self {
        Self::default()
    }
}

impl SettingsStore for MemorySettingsStore {
    fn load(&self) -> Result<Option<Settings>, StoreFailure> {
        Ok(self
            .stored
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone())
    }

    fn save(&self, settings: &Settings) -> Result<(), StoreFailure> {
        *self.stored.lock().unwrap_or_else(|e| e.into_inner()) = Some(settings.clone());
        Ok(())
    }
}

/// Used when the data key is not available: nothing is read or written.
pub struct LockedSettingsStore;

impl SettingsStore for LockedSettingsStore {
    fn load(&self) -> Result<Option<Settings>, StoreFailure> {
        Err(StoreFailure::Locked)
    }

    fn save(&self, _settings: &Settings) -> Result<(), StoreFailure> {
        Err(StoreFailure::Locked)
    }
}

// ---- service ------------------------------------------------------------------------------------

/// Where the settings in memory came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LoadStatus {
    /// Read from the file (or written since).
    Stored,
    /// No file yet: defaults.
    Missing,
    /// The file was changed, swapped or sealed with another key: defaults; the file is kept.
    Corrupt,
    /// The OS refused the read: defaults.
    Unreadable,
    /// No data key: defaults, nothing is written.
    Locked,
}

/// Values the UI cached in `localStorage` before this store existed (job 003) or for the first
/// paint. They are taken over once when there is no readable settings file.
#[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Cached {
    #[serde(default)]
    pub locale: Option<Value>,
    #[serde(default)]
    pub theme: Option<Value>,
    #[serde(default)]
    pub speech_model: Option<Value>,
}

/// What `load_settings` returns.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsLoad {
    pub settings: Settings,
    pub status: LoadStatus,
}

/// What `update_setting` returns: the settings now in effect and whether they were stored.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsUpdate {
    pub settings: Settings,
    /// False when the file could not be written (no data key, disk error): the change holds for
    /// this session only.
    pub saved: bool,
}

struct State {
    settings: Settings,
    status: LoadStatus,
    cache_taken: bool,
}

/// The settings in effect, and the store behind them.
pub struct SettingsService {
    store: Arc<dyn SettingsStore>,
    state: Mutex<State>,
}

impl SettingsService {
    /// Reads the stored settings. Any failure gives the defaults and leaves the file as it is.
    pub fn open(store: Arc<dyn SettingsStore>) -> Self {
        let (settings, status) = match store.load() {
            Ok(Some(s)) => (s, LoadStatus::Stored),
            Ok(None) => (Settings::default(), LoadStatus::Missing),
            Err(e) => {
                // Only the kind of failure is logged.
                crate::log!("settings fall back to the defaults: {e}");
                let status = match e {
                    StoreFailure::Corrupt => LoadStatus::Corrupt,
                    StoreFailure::Locked => LoadStatus::Locked,
                    StoreFailure::Io(_) => LoadStatus::Unreadable,
                };
                (Settings::default(), status)
            }
        };
        Self {
            store,
            state: Mutex::new(State {
                settings,
                status,
                cache_taken: false,
            }),
        }
    }

    fn state(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn current(&self) -> Settings {
        self.state().settings.clone()
    }

    pub fn status(&self) -> LoadStatus {
        self.state().status
    }

    /// The settings for the UI. The first call takes over the UI's cached values when no settings
    /// file could be read: locale and theme always, the speech model only if the core's own scan has
    /// it. Only a missing file is then written (the one-time move from `localStorage`); a corrupt
    /// file or a locked keychain keeps them in memory, so the file is not overwritten.
    pub fn load(&self, cached: &Cached, catalog: &dyn Catalog) -> SettingsLoad {
        let mut st = self.state();
        if !st.cache_taken && st.status != LoadStatus::Stored {
            st.cache_taken = true;
            let mut next = st.settings.clone();
            let changes = [
                cached.locale.clone().map(|v| ("locale", v)),
                cached.theme.clone().map(|v| ("theme", v)),
                cached.speech_model.clone().map(|v| ("speechModel", v)),
            ];
            for (key, value) in changes.into_iter().flatten() {
                let raw = serde_json::json!({ "key": key, "value": value });
                if let Ok(applied) = parse_change(&raw).and_then(|c| apply(&next, c, catalog)) {
                    next = applied;
                }
            }
            if next != st.settings {
                st.settings = next;
                if st.status == LoadStatus::Missing {
                    match self.store.save(&st.settings) {
                        Ok(()) => st.status = LoadStatus::Stored,
                        Err(e) => crate::log!("could not store the settings: {e}"),
                    }
                }
            }
        }
        st.cache_taken = true;
        SettingsLoad {
            settings: st.settings.clone(),
            status: st.status,
        }
    }

    /// Checks and applies one change from the UI, then stores all settings. A store failure keeps
    /// the change for this session (`saved: false`).
    pub fn update(
        &self,
        raw: &Value,
        catalog: &dyn Catalog,
    ) -> Result<SettingsUpdate, SettingsError> {
        let change = parse_change(raw).inspect_err(|e| crate::log!("setting refused: {e}"))?;
        let mut st = self.state();
        let next = apply(&st.settings, change, catalog)
            .inspect_err(|e| crate::log!("setting refused: {e}"))?;
        st.settings = next;
        st.cache_taken = true;
        let saved = match self.store.save(&st.settings) {
            Ok(()) => {
                st.status = LoadStatus::Stored;
                true
            }
            Err(e) => {
                crate::log!("could not store the settings: {e}");
                false
            }
        };
        Ok(SettingsUpdate {
            settings: st.settings.clone(),
            saved,
        })
    }
}

#[cfg(test)]
mod tests;
