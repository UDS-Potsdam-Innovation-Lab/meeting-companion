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
pub mod speakers;
pub mod store;
pub mod transcript;

use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{Emitter, Manager, State};

use crypto::KeychainKeyProvider;
use engines::audio::{AudioSource, FakeAudioSource};
use engines::cpal_source::{CpalAudioDevices, CpalAudioSource};
use engines::devices::{AudioDevices, FakeAudioDevices};
use engines::models::{self, ModelKind, ModelList, SpeakerModelList};
use engines::{
    DiarizerProvider, FakeDiarizerProvider, FakeSttProvider, SherpaProvider, SttProvider,
    WhisperProvider,
};
use model::{FieldError, Meeting};
use recording::{
    CaptureState, EventSink, LevelEvent, MicTestError, MicTestState, Reason, RecordError, Recorder,
    SegmentEvent, StartOptions, SwitchedEvent, VoiceEvent,
};
use settings::{
    Cached, Catalog, LockedSettingsStore, MemorySettingsStore, SettingsError, SettingsLoad,
    SettingsService, SettingsStore, SettingsUpdate,
};
use speakers::{GuestAdded, LineTarget, SpeakerError, SpeakerState};
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
/// Event with the voice of a stored final segment ([`VoiceEvent`]).
pub const EVENT_VOICE: &str = "transcript-voice";
/// `MEETING_COMPANION_DIARIZE=fake` replaces the speaker model with the scripted fake (no model needed).
pub const ENV_DIARIZE: &str = "MEETING_COMPANION_DIARIZE";
/// Event with the settings now in effect ([`settings::Settings`]), after every change.
pub const EVENT_SETTINGS: &str = "settings-changed";
/// Event with the microphone test's state ([`MicTestState`]).
pub const EVENT_MIC_TEST: &str = "mic-test";
/// Event with the input level for the sound wave ([`recording::LevelEvent`]), 25 per second while
/// audio arrives. Numbers only, never samples.
pub const EVENT_LEVEL: &str = "capture-level";
/// Event when recording switched to the system default microphone ([`SwitchedEvent`]).
pub const EVENT_SWITCHED: &str = "microphone-switched";
const SMOKE_TIMEOUT: Duration = Duration::from_secs(90);
const SMOKE_VIEW: &str = "agenda-setup";

pub struct AppState {
    store: Arc<dyn MeetingStore>,
    recorder: Recorder,
    settings: SettingsService,
    /// Where meetings and transcripts are stored, shown read-only in the settings.
    storage_folder: String,
    smoke: bool,
    /// Held by every command that reads, changes and writes the meeting file, so a save from the
    /// UI and a speaker choice cannot overwrite each other.
    edits: Mutex<()>,
}

impl AppState {
    fn edit(&self) -> MutexGuard<'_, ()> {
        self.edits.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// What the core knows right now: the connected devices and its own model scan.
impl Catalog for Recorder {
    fn input_devices(&self) -> Vec<String> {
        Recorder::input_devices(self)
    }
    fn speech_models(&self) -> Vec<String> {
        self.models().models.into_iter().map(|m| m.id).collect()
    }
    fn speaker_models(&self) -> Vec<String> {
        self.speaker_models()
            .models
            .into_iter()
            .map(|m| m.id)
            .collect()
    }
}

/// The settings for a recording session.
pub fn start_options(s: &settings::Settings) -> StartOptions {
    StartOptions {
        model_id: s.speech_model.clone(),
        device: s.input_device.clone(),
        language: s.meeting_language.hint(),
        on_lost: s.device_lost,
        speaker_model: s.speaker_model.clone(),
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
/// The recording consent and the speakers are not the UI's to set: whatever the UI sends, the
/// stored values are kept (only [`confirm_consent`] and the speaker commands set them). Guests added
/// in the speakers view stay participants even if the UI's copy of the meeting does not have them.
pub fn save(store: &dyn MeetingStore, mut meeting: Meeting, now_ms: u64) -> Result<u64, SaveError> {
    meeting.updated_at = now_ms;
    let stored = store.load(&meeting.id).ok().flatten();
    meeting.recording_consent_at = stored.as_ref().and_then(|m| m.recording_consent_at);
    meeting.speakers = stored.as_ref().and_then(|m| m.speakers.clone());
    for guest in stored
        .iter()
        .flat_map(|m| &m.participants)
        .filter(|p| p.guest)
    {
        if !meeting.participants.iter().any(|p| p.id == guest.id) {
            meeting.participants.push(guest.clone());
        }
    }
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
    let _edit = state.edit();
    save(state.store.as_ref(), meeting, now_ms())
}

#[tauri::command(async)]
fn confirm_recording_consent(
    state: State<'_, AppState>,
    meeting_id: String,
) -> Result<u64, RecordError> {
    let _edit = state.edit();
    confirm_consent(state.store.as_ref(), &meeting_id, now_ms())
}

/// Starts recording with the microphone, model and language from the settings. The model id is
/// still checked against the core's own scan (an unknown one falls back to the preferred model).
#[tauri::command(async)]
fn load_speakers(
    state: State<'_, AppState>,
    meeting_id: String,
) -> Result<SpeakerState, SpeakerError> {
    speakers::speaker_state(
        state.store.as_ref(),
        state.recorder.transcripts(),
        &meeting_id,
    )
}

/// The person for a voice; `participant_id` null = "Unassigned".
#[tauri::command(async)]
fn choose_voice(
    state: State<'_, AppState>,
    meeting_id: String,
    voice: String,
    participant_id: Option<String>,
) -> Result<SpeakerState, SpeakerError> {
    let _edit = state.edit();
    speakers::choose_voice(
        state.store.as_ref(),
        state.recorder.transcripts(),
        &meeting_id,
        &voice,
        participant_id.as_deref(),
        now_ms(),
    )
}

/// Who said one line ("Who said this?").
#[tauri::command(async)]
fn choose_line(
    state: State<'_, AppState>,
    meeting_id: String,
    seq: u64,
    target: LineTarget,
) -> Result<SpeakerState, SpeakerError> {
    let _edit = state.edit();
    speakers::choose_line(
        state.store.as_ref(),
        state.recorder.transcripts(),
        &meeting_id,
        seq,
        &target,
        now_ms(),
    )
}

#[tauri::command(async)]
fn add_guest(
    state: State<'_, AppState>,
    meeting_id: String,
    name: String,
) -> Result<GuestAdded, SpeakerError> {
    let _edit = state.edit();
    speakers::add_guest(
        state.store.as_ref(),
        state.recorder.transcripts(),
        &meeting_id,
        &name,
        now_ms(),
    )
}

/// "Apply names to transcript".
#[tauri::command(async)]
fn apply_name_round(
    state: State<'_, AppState>,
    meeting_id: String,
) -> Result<SpeakerState, SpeakerError> {
    let _edit = state.edit();
    speakers::apply_name_round(
        state.store.as_ref(),
        state.recorder.transcripts(),
        &meeting_id,
        now_ms(),
    )
}

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

/// The speaker models found on this device (the preferred one is used) and the folders searched.
#[tauri::command(async)]
fn list_speaker_models(state: State<'_, AppState>) -> SpeakerModelList {
    state.recorder.speaker_models()
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
    fn voice(&self, event: &VoiceEvent) {
        let _ = self.0.emit(EVENT_VOICE, event);
    }
    fn mic_test(&self, state: &MicTestState) {
        let _ = self.0.emit(EVENT_MIC_TEST, state);
    }
    fn switched(&self, event: &SwitchedEvent) {
        let _ = self.0.emit(EVENT_SWITCHED, event);
    }
    fn level(&self, event: &LevelEvent) {
        let _ = self.0.emit(EVENT_LEVEL, event);
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
            let env = models::Env::from_process(app_data.clone());
            let stt: Box<dyn SttProvider> = if smoke || env_is(ENV_STT, "fake") {
                Box::new(FakeSttProvider::demo())
            } else {
                Box::new(WhisperProvider {
                    locations: models::locations_of(
                        ModelKind::Whisper,
                        models::Os::current(),
                        &env,
                    ),
                })
            };
            let diarize: Box<dyn DiarizerProvider> = if smoke || env_is(ENV_DIARIZE, "fake") {
                Box::new(FakeDiarizerProvider::demo())
            } else {
                Box::new(SherpaProvider {
                    locations: models::locations_of(
                        ModelKind::Speaker,
                        models::Os::current(),
                        &env,
                    ),
                })
            };
            let recorder = Recorder::new(
                audio,
                stt,
                transcripts,
                Arc::new(TauriEvents(app.handle().clone())),
                now_ms,
            )
            .with_devices(devices)
            .with_diarizer(diarize);
            app.manage(AppState {
                store,
                recorder,
                settings,
                storage_folder,
                smoke,
                edits: Mutex::new(()),
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
            list_speaker_models,
            load_speakers,
            choose_voice,
            choose_line,
            add_guest,
            apply_name_round,
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
    fn a_save_from_the_ui_keeps_the_stored_speakers_and_guests() {
        use model::{NameSource, Participant, Speakers, VoiceChoice};
        let store = MemoryMeetingStore::new();
        let ui_copy = crate::model::tests::running();
        let mut stored = ui_copy.clone();
        stored.participants.push(Participant {
            id: "guest-1".into(),
            name: "Petra Sand".into(),
            guest: true,
        });
        stored.speakers = Some(Speakers {
            voices: vec![VoiceChoice {
                voice: transcript::Voice::parse("A").unwrap(),
                participant_id: Some("guest-1".into()),
                source: NameSource::Manual,
                confirmed: true,
            }],
            lines: vec![],
        });
        store.save(&stored).unwrap();
        // The UI's copy has neither the guest nor the speakers, or forges other speakers.
        let mut forged = ui_copy.clone();
        forged.speakers = Some(Speakers::default());
        save(&store, forged, 5).unwrap();
        save(&store, ui_copy, 6).unwrap();
        let after = store.load("m-1").unwrap().unwrap();
        assert_eq!(after.speakers, stored.speakers);
        assert_eq!(after.participants, stored.participants);
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
            speaker_model: Some("/m/campplus.onnx".into()),
            ..settings::Settings::default()
        };
        assert_eq!(
            start_options(&s),
            StartOptions {
                model_id: Some("/m/ggml-small.bin".into()),
                device: Some("Room mic".into()),
                language: Some(engines::stt::Lang::De),
                on_lost: settings::DeviceLost::SwitchToDefault,
                speaker_model: Some("/m/campplus.onnx".into()),
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
