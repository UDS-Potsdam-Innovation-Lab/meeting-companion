//! Meeting Companion core: the meeting model, the store and the Tauri commands the UI calls.
//!
//! The app opens no network port and makes no network request. The UI is served from the app's
//! own assets through Tauri's custom protocol, and every command below reads or writes local files.

pub mod crypto;
pub mod engines;
pub mod log;
pub mod model;
pub mod recording;
pub mod settings;
pub mod store;
pub mod transcript;

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{Emitter, Manager, State};

use crypto::KeychainKeyProvider;
use engines::audio::{AudioSource, FakeAudioSource};
use engines::cpal_source::{CpalAudioDevices, CpalAudioSource};
use engines::devices::{AudioDevices, FakeAudioDevices};
use engines::models::{self, ModelList};
use engines::{FakeSttProvider, SttProvider, WhisperProvider};
use model::{FieldError, Meeting};
use recording::{
    CaptureState, EventSink, MicTestError, MicTestState, Reason, RecordError, Recorder,
    SegmentEvent, StartOptions,
};
use settings::{
    Cached, Catalog, LockedSettingsStore, MemorySettingsStore, SettingsError, SettingsLoad,
    SettingsService, SettingsStore, SettingsUpdate,
};
use store::{FileMeetingStore, LockedMeetingStore, MeetingStore, MemoryMeetingStore, StoreError};
use transcript::{
    LockedTranscriptStore, MemoryTranscriptStore, Segment, TranscriptError, TranscriptStore,
};

/// `MEETING_COMPANION_STORE=memory` keeps meetings in memory only (tests, demos).
pub const ENV_STORE: &str = "MEETING_COMPANION_STORE";
/// `MEETING_COMPANION_SMOKE=1` starts the app with the in-memory store, waits until the UI reports
/// that the agenda setup view rendered, prints `SMOKE OK` and exits 0 (or exits 1 after a timeout).
pub const ENV_SMOKE: &str = "MEETING_COMPANION_SMOKE";
/// Keychain entry (service = app identifier) that holds the meeting data key.
const KEYCHAIN_ACCOUNT: &str = "meeting-data-key";
/// `MEETING_COMPANION_AUDIO=fake` replaces the microphone with generated tones and silence.
pub const ENV_AUDIO: &str = "MEETING_COMPANION_AUDIO";
/// `MEETING_COMPANION_STT=fake` replaces whisper with the scripted fake engine (no model needed).
pub const ENV_STT: &str = "MEETING_COMPANION_STT";
/// Event with the recording indicator's state ([`CaptureState`]).
pub const EVENT_CAPTURE: &str = "capture-state";
/// Event with one transcript segment ([`SegmentEvent`]).
pub const EVENT_SEGMENT: &str = "transcript-segment";
/// Event with the settings now in effect ([`settings::Settings`]), after every change.
pub const EVENT_SETTINGS: &str = "settings-changed";
/// Event with the microphone test's state ([`MicTestState`]).
pub const EVENT_MIC_TEST: &str = "mic-test";
const SMOKE_TIMEOUT: Duration = Duration::from_secs(90);
const SMOKE_VIEW: &str = "agenda-setup";

pub struct AppState {
    store: Arc<dyn MeetingStore>,
    recorder: Recorder,
    settings: SettingsService,
    /// Where meetings and transcripts are stored, shown read-only in the settings.
    storage_folder: String,
    smoke: bool,
}

/// What the core knows right now: the connected devices and its own model scan.
impl Catalog for Recorder {
    fn input_devices(&self) -> Vec<String> {
        Recorder::input_devices(self)
    }
    fn speech_models(&self) -> Vec<String> {
        self.models().models.into_iter().map(|m| m.id).collect()
    }
}

/// The settings for a recording session.
pub fn start_options(s: &settings::Settings) -> StartOptions {
    StartOptions {
        model_id: s.speech_model.clone(),
        device: s.input_device.clone(),
        language: s.meeting_language.hint(),
        on_lost: s.device_lost,
    }
}

/// What `load_settings` returns: the settings, where they came from, and the storage folder.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    #[serde(flatten)]
    pub load: SettingsLoad,
    pub storage_folder: String,
}

/// What the UI gets on start: the latest meeting, or why it could not be read.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LoadResult {
    pub meeting: Option<Meeting>,
    /// `corrupt` (the file is not a valid meeting, or was changed), `unreadable` (the OS refused the
    /// read) or `keyUnavailable` (the data key is not in the OS keychain; nothing can be read or saved).
    pub error: Option<&'static str>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SaveError {
    Invalid {
        fields: Vec<FieldError>,
    },
    Io,
    /// The data key is not available; nothing was written.
    Locked,
}

pub fn load_latest(store: &dyn MeetingStore) -> LoadResult {
    match store.latest() {
        Ok(meeting) => LoadResult {
            meeting,
            error: None,
        },
        Err(e) => {
            // Only the kind of failure is logged, never meeting content.
            log!("could not open the latest meeting: {e}");
            LoadResult {
                meeting: None,
                error: Some(match e {
                    StoreError::Io(_) => "unreadable",
                    StoreError::KeyUnavailable => "keyUnavailable",
                    _ => "corrupt",
                }),
            }
        }
    }
}

/// Stamps the save time and stores the meeting. Returns the stamp.
///
/// The recording consent is not the UI's to set: whatever the UI sends, the stored value is kept
/// (only [`confirm_consent`] sets it).
pub fn save(store: &dyn MeetingStore, mut meeting: Meeting, now_ms: u64) -> Result<u64, SaveError> {
    meeting.updated_at = now_ms;
    meeting.recording_consent_at = store
        .load(&meeting.id)
        .ok()
        .flatten()
        .and_then(|m| m.recording_consent_at);
    match store.save(&meeting) {
        Ok(()) => Ok(now_ms),
        Err(StoreError::Invalid(fields)) => Err(SaveError::Invalid { fields }),
        Err(StoreError::KeyUnavailable) => Err(SaveError::Locked),
        Err(e) => {
            log!("could not save the meeting: {e}");
            Err(SaveError::Io)
        }
    }
}

/// Stores the facilitator's confirmation that everyone was informed that the meeting is
/// transcribed. Only for a running meeting; a second confirmation keeps the first time.
pub fn confirm_consent(
    store: &dyn MeetingStore,
    id: &str,
    now_ms: u64,
) -> Result<u64, RecordError> {
    let failed = |e: StoreError| RecordError::Failed {
        reason: match e {
            StoreError::KeyUnavailable => Reason::Locked,
            _ => Reason::StorageFailed,
        },
    };
    let mut meeting = store
        .load(id)
        .map_err(failed)?
        .ok_or(RecordError::NoMeeting)?;
    if !meeting.run.as_ref().is_some_and(|r| r.ended_at.is_none()) {
        return Err(RecordError::NotRunning);
    }
    if let Some(at) = meeting.recording_consent_at {
        return Ok(at);
    }
    meeting.recording_consent_at = Some(now_ms);
    meeting.updated_at = now_ms;
    store.save(&meeting).map_err(failed)?;
    Ok(now_ms)
}

/// The stored transcript of a meeting, or why it could not be read.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptLoad {
    pub segments: Vec<Segment>,
    /// `corrupt`, `keyUnavailable` or `unreadable`.
    pub error: Option<&'static str>,
}

pub fn load_transcript_of(store: &dyn TranscriptStore, id: &str) -> TranscriptLoad {
    match store.load(id) {
        Ok(segments) => TranscriptLoad {
            segments,
            error: None,
        },
        Err(e) => {
            log!("could not read the transcript: {e}");
            TranscriptLoad {
                segments: Vec::new(),
                error: Some(match e {
                    TranscriptError::KeyUnavailable => "keyUnavailable",
                    TranscriptError::Io(_) => "unreadable",
                    _ => "corrupt",
                }),
            }
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

#[tauri::command]
fn load_latest_meeting(state: State<'_, AppState>) -> LoadResult {
    load_latest(state.store.as_ref())
}

#[tauri::command]
fn save_meeting(state: State<'_, AppState>, meeting: Meeting) -> Result<u64, SaveError> {
    let ended = meeting.run.as_ref().is_some_and(|r| r.ended_at.is_some());
    if ended {
        // The UI stops recording before it ends the meeting; this makes sure of it.
        state.recorder.stop_meeting(&meeting.id);
    }
    save(state.store.as_ref(), meeting, now_ms())
}

#[tauri::command(async)]
fn confirm_recording_consent(
    state: State<'_, AppState>,
    meeting_id: String,
) -> Result<u64, RecordError> {
    confirm_consent(state.store.as_ref(), &meeting_id, now_ms())
}

/// Starts recording with the microphone, model and language from the settings. The model id is
/// still checked against the core's own scan (an unknown one falls back to the preferred model).
#[tauri::command(async)]
fn start_recording(
    state: State<'_, AppState>,
    meeting_id: String,
) -> Result<CaptureState, RecordError> {
    let opts = start_options(&state.settings.current());
    state
        .recorder
        .start_with(state.store.as_ref(), &meeting_id, &opts)
}

#[tauri::command(async)]
fn load_settings(state: State<'_, AppState>, cached: Option<Cached>) -> SettingsView {
    SettingsView {
        load: state
            .settings
            .load(&cached.unwrap_or_default(), &state.recorder),
        storage_folder: state.storage_folder.clone(),
    }
}

/// Checks and applies one change, stores the settings and tells every view (`settings-changed`).
#[tauri::command(async)]
fn update_setting(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    change: serde_json::Value,
) -> Result<SettingsUpdate, SettingsError> {
    let update = state.settings.update(&change, &state.recorder)?;
    let _ = app.emit(EVENT_SETTINGS, &update.settings);
    Ok(update)
}

#[tauri::command(async)]
fn list_input_devices(state: State<'_, AppState>) -> Vec<String> {
    state.recorder.input_devices()
}

/// Opens the chosen microphone for at most 10 s to show its level; nothing is kept.
#[tauri::command(async)]
fn start_mic_test(state: State<'_, AppState>) -> Result<MicTestState, MicTestError> {
    let device = state.settings.current().input_device;
    state.recorder.start_test(device.as_deref())
}

#[tauri::command(async)]
fn stop_mic_test(state: State<'_, AppState>) {
    state.recorder.stop_test();
}

#[tauri::command(async)]
fn pause_recording(state: State<'_, AppState>) -> CaptureState {
    state.recorder.pause()
}

#[tauri::command(async)]
fn stop_recording(state: State<'_, AppState>) -> CaptureState {
    state.recorder.stop()
}

#[tauri::command]
fn recording_status(state: State<'_, AppState>) -> CaptureState {
    state.recorder.status()
}

#[tauri::command(async)]
fn load_transcript(state: State<'_, AppState>, meeting_id: String) -> TranscriptLoad {
    load_transcript_of(state.recorder.transcripts(), &meeting_id)
}

#[tauri::command(async)]
fn list_speech_models(state: State<'_, AppState>) -> ModelList {
    state.recorder.models()
}

/// Sends the core's events to the window.
struct TauriEvents(tauri::AppHandle);

impl EventSink for TauriEvents {
    fn capture(&self, state: &CaptureState) {
        let _ = self.0.emit(EVENT_CAPTURE, state);
    }
    fn segment(&self, event: &SegmentEvent) {
        let _ = self.0.emit(EVENT_SEGMENT, event);
    }
    fn mic_test(&self, state: &MicTestState) {
        let _ = self.0.emit(EVENT_MIC_TEST, state);
    }
}

fn env_is(name: &str, value: &str) -> bool {
    std::env::var(name).is_ok_and(|v| v == value)
}

/// The UI calls this once a view has rendered. Only the smoke run acts on it.
#[tauri::command]
fn view_ready(app: tauri::AppHandle, state: State<'_, AppState>, view: String) {
    if !state.smoke {
        return;
    }
    if view == SMOKE_VIEW {
        println!("SMOKE OK: {SMOKE_VIEW} rendered");
        app.exit(0);
    } else {
        eprintln!("SMOKE FAIL: unexpected view");
        app.exit(1);
    }
}

fn env_flag(name: &str) -> bool {
    std::env::var(name).is_ok_and(|v| v == "1" || v.eq_ignore_ascii_case("true"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let smoke = env_flag(ENV_SMOKE);
            let memory = smoke || env_is(ENV_STORE, "memory");
            let app_data = app.path().app_data_dir()?;
            let meetings_dir = app_data.join("meetings");
            let storage_folder = meetings_dir.to_string_lossy().into_owned();
            type Stores = (
                Arc<dyn MeetingStore>,
                Arc<dyn TranscriptStore>,
                Arc<dyn SettingsStore>,
            );
            let (store, transcripts, settings_store): Stores = if memory {
                (
                    Arc::new(MemoryMeetingStore::new()),
                    Arc::new(MemoryTranscriptStore::new()),
                    Arc::new(MemorySettingsStore::new()),
                )
            } else {
                let keys =
                    KeychainKeyProvider::new(app.config().identifier.clone(), KEYCHAIN_ACCOUNT);
                match FileMeetingStore::open(meetings_dir, &keys) {
                    Ok(store) => {
                        let transcripts = Arc::new(store.transcripts());
                        let settings = Arc::new(store.settings(app_data.join("settings")));
                        (Arc::new(store), transcripts, settings)
                    }
                    // No key: the UI explains it; stored files stay untouched.
                    Err(StoreError::KeyUnavailable) => (
                        Arc::new(LockedMeetingStore),
                        Arc::new(LockedTranscriptStore),
                        Arc::new(LockedSettingsStore),
                    ),
                    Err(e) => return Err(Box::new(e)),
                }
            };
            let settings = SettingsService::open(settings_store);
            let fake_audio = smoke || env_is(ENV_AUDIO, "fake");
            let audio: engines::AudioFactory = if fake_audio {
                Box::new(|| Box::new(FakeAudioSource::demo()) as Box<dyn AudioSource>)
            } else {
                Box::new(|| Box::new(CpalAudioSource::new()) as Box<dyn AudioSource>)
            };
            let devices: Arc<dyn AudioDevices> = if fake_audio {
                Arc::new(FakeAudioDevices::demo())
            } else {
                Arc::new(CpalAudioDevices)
            };
            let stt: Box<dyn SttProvider> = if smoke || env_is(ENV_STT, "fake") {
                Box::new(FakeSttProvider::demo())
            } else {
                let env = models::Env::from_process(app_data);
                Box::new(WhisperProvider {
                    locations: models::locations_for(models::Os::current(), &env),
                })
            };
            let recorder = Recorder::new(
                audio,
                stt,
                transcripts,
                Arc::new(TauriEvents(app.handle().clone())),
                now_ms,
            )
            .with_devices(devices);
            app.manage(AppState {
                store,
                recorder,
                settings,
                storage_folder,
                smoke,
            });
            if smoke {
                std::thread::spawn(|| {
                    std::thread::sleep(SMOKE_TIMEOUT);
                    eprintln!(
                        "SMOKE FAIL: the agenda setup view did not report within the timeout"
                    );
                    std::process::exit(1);
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_latest_meeting,
            save_meeting,
            view_ready,
            confirm_recording_consent,
            start_recording,
            pause_recording,
            stop_recording,
            recording_status,
            load_transcript,
            list_speech_models,
            load_settings,
            update_setting,
            list_input_devices,
            start_mic_test,
            stop_mic_test
        ])
        .run(tauri::generate_context!())
        .expect("error while running Meeting Companion");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::tests::sample;

    #[test]
    fn load_latest_reports_corrupt_file_and_returns_no_meeting() {
        let dir = tempfile::tempdir().unwrap();
        let keys = crypto::MemoryKeyProvider::new();
        let store = FileMeetingStore::open(dir.path(), &keys).unwrap();
        std::fs::write(dir.path().join("m-1.meeting"), b"not json").unwrap();
        assert_eq!(
            load_latest(&store),
            LoadResult {
                meeting: None,
                error: Some("corrupt")
            }
        );
        assert_eq!(
            std::fs::read(dir.path().join("m-1.meeting")).unwrap(),
            b"not json"
        );
    }

    #[test]
    fn save_stamps_time_and_load_returns_it() {
        let store = MemoryMeetingStore::new();
        assert_eq!(save(&store, sample(), 42), Ok(42));
        let loaded = load_latest(&store);
        assert_eq!(loaded.error, None);
        assert_eq!(loaded.meeting.unwrap().updated_at, 42);
    }

    #[test]
    fn save_returns_field_errors_for_invalid_meeting() {
        let store = MemoryMeetingStore::new();
        let mut m = sample();
        m.title.clear();
        match save(&store, m, 1) {
            Err(SaveError::Invalid { fields }) => assert_eq!(fields[0].field, "title"),
            other => panic!("expected Invalid, got {other:?}"),
        }
        assert!(load_latest(&store).meeting.is_none());
    }

    #[test]
    fn missing_key_is_reported_and_nothing_is_saved() {
        let store = LockedMeetingStore;
        assert_eq!(
            load_latest(&store),
            LoadResult {
                meeting: None,
                error: Some("keyUnavailable")
            }
        );
        assert_eq!(save(&store, sample(), 1), Err(SaveError::Locked));
        assert_eq!(
            serde_json::to_value(SaveError::Locked).unwrap(),
            serde_json::json!({ "kind": "locked" })
        );
    }

    #[test]
    fn save_rejects_an_invalid_run_with_field_errors() {
        let store = MemoryMeetingStore::new();
        let mut m = crate::model::tests::running();
        m.run.as_mut().unwrap().items[1].extra_minutes = -5;
        match save(&store, m, 1) {
            Err(SaveError::Invalid { fields }) => {
                assert_eq!(fields[0].field, "run.items[1].extraMinutes");
                assert_eq!(fields[0].code, "outOfRange");
            }
            other => panic!("expected Invalid, got {other:?}"),
        }
        assert!(load_latest(&store).meeting.is_none());
    }

    #[test]
    fn consent_is_stored_by_the_core_only_and_kept_by_later_saves() {
        let store = MemoryMeetingStore::new();
        let m = crate::model::tests::running();
        save(&store, m.clone(), 10).unwrap();
        // The UI cannot set consent through a normal save.
        let mut forged = m.clone();
        forged.recording_consent_at = Some(1);
        save(&store, forged, 11).unwrap();
        assert_eq!(
            store.load("m-1").unwrap().unwrap().recording_consent_at,
            None
        );

        assert_eq!(confirm_consent(&store, "m-1", 5_000), Ok(5_000));
        // A second confirmation keeps the first time.
        assert_eq!(confirm_consent(&store, "m-1", 9_000), Ok(5_000));
        // A later save from the UI without the field keeps it.
        save(&store, m.clone(), 12).unwrap();
        assert_eq!(
            store.load("m-1").unwrap().unwrap().recording_consent_at,
            Some(5_000)
        );
        assert_eq!(
            confirm_consent(&store, "m-9", 1),
            Err(RecordError::NoMeeting)
        );
        let not_started = crate::model::tests::sample();
        let other = MemoryMeetingStore::new();
        save(&other, not_started, 1).unwrap();
        assert_eq!(
            confirm_consent(&other, "m-1", 1),
            Err(RecordError::NotRunning)
        );
        assert_eq!(
            confirm_consent(&LockedMeetingStore, "m-1", 1),
            Err(RecordError::Failed {
                reason: Reason::Locked
            })
        );
    }

    #[test]
    fn a_damaged_transcript_is_reported_and_an_empty_one_loads() {
        let dir = tempfile::tempdir().unwrap();
        let keys = crypto::MemoryKeyProvider::new();
        let store = FileMeetingStore::open(dir.path(), &keys).unwrap();
        let t = store.transcripts();
        assert_eq!(
            load_transcript_of(&t, "m-1"),
            TranscriptLoad {
                segments: vec![],
                error: None
            }
        );
        std::fs::write(
            dir.path().join("m-1.transcript"),
            b"MCTRAN01\xff\xff\xff\xff",
        )
        .unwrap();
        assert_eq!(load_transcript_of(&t, "m-1").error, Some("corrupt"));
        assert_eq!(
            load_transcript_of(&LockedTranscriptStore, "m-1").error,
            Some("keyUnavailable")
        );
    }

    #[test]
    fn save_error_serialises_with_a_kind_tag() {
        let json = serde_json::to_value(SaveError::Io).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "io" }));
    }

    #[test]
    fn recording_takes_device_model_language_and_policy_from_the_settings() {
        let s = settings::Settings {
            input_device: Some("Room mic".into()),
            speech_model: Some("/m/ggml-small.bin".into()),
            meeting_language: settings::MeetingLanguage::De,
            device_lost: settings::DeviceLost::SwitchToDefault,
            ..settings::Settings::default()
        };
        assert_eq!(
            start_options(&s),
            StartOptions {
                model_id: Some("/m/ggml-small.bin".into()),
                device: Some("Room mic".into()),
                language: Some(engines::stt::Lang::De),
                on_lost: settings::DeviceLost::SwitchToDefault,
            }
        );
        let d = start_options(&settings::Settings::default());
        assert_eq!(d, StartOptions::default());
    }

    #[test]
    fn a_chosen_model_that_disappeared_falls_back_to_the_preferred_one() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("ggml-base.bin");
        let b = dir.path().join("ggml-small.bin");
        engines::models::tests::fake_model(&a, true, 10);
        engines::models::tests::fake_model(&b, true, 1_000);
        let locations = vec![engines::models::ModelLocation {
            source: engines::models::ModelSource::App,
            path: dir.path().to_path_buf(),
        }];
        let list = engines::models::scan(&locations);
        let chosen = list.models[1].id.clone();
        assert_eq!(
            engines::models::choose(&list, Some(&chosen)).unwrap().id,
            chosen
        );
        std::fs::remove_file(&b).unwrap();
        let list = engines::models::scan(&locations);
        let used = engines::models::choose(&list, Some(&chosen)).unwrap();
        assert_eq!(used.id, list.models[0].id);
        assert_ne!(used.id, chosen);
    }
}
