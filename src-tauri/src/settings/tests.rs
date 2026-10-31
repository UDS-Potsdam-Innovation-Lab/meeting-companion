use std::path::Path;

use serde_json::json;

use super::*;
use crate::crypto::{self, DataKey, MemoryKeyProvider};
use crate::store::{FileMeetingStore, MeetingStore};

const DEVICE: &str = "Zebra-Quokka AirPods 7731";
const MODEL: &str = "/home/someone/models/Quokka-ggml-base.bin";

struct Known {
    devices: Vec<String>,
    models: Vec<String>,
}

impl Catalog for Known {
    fn input_devices(&self) -> Vec<String> {
        self.devices.clone()
    }
    fn speech_models(&self) -> Vec<String> {
        self.models.clone()
    }
    fn speaker_models(&self) -> Vec<String> {
        vec![SPEAKER.into()]
    }
    fn llm_models(&self) -> Vec<String> {
        vec![LLM.into()]
    }
}

const SPEAKER: &str = "/m/campplus.onnx";
const LLM: &str = "/m/Qwen2.5-3B-Instruct-Q4_K_M.gguf";

fn known() -> Known {
    Known {
        devices: vec!["Built-in Audio".into(), DEVICE.into()],
        models: vec![MODEL.into(), "/m/ggml-small.bin".into()],
    }
}

fn all_changed() -> Settings {
    Settings {
        input_device: Some(DEVICE.into()),
        device_lost: DeviceLost::SwitchToDefault,
        speech_model: Some(MODEL.into()),
        speaker_model: Some(SPEAKER.into()),
        meeting_language: MeetingLanguage::En,
        locale: Locale::En,
        theme: Theme::Dark,
        language_model: LanguageModelSetting::Local(LLM.into()),
        claude_model: ClaudeModel::Haiku,
    }
}

/// A file store in a temp app data folder, with the meeting store that owns the key.
fn file_store() -> (tempfile::TempDir, DataKey, FileMeetingStore) {
    let dir = tempfile::tempdir().unwrap();
    let key = DataKey::generate();
    let keys = MemoryKeyProvider::with_key(key.clone());
    let meetings = FileMeetingStore::open(dir.path().join("meetings"), &keys).unwrap();
    (dir, key, meetings)
}

fn contains(haystack: &[u8], needle: &str) -> bool {
    haystack
        .windows(needle.len())
        .any(|w| w == needle.as_bytes())
}

fn change(key: &str, value: serde_json::Value) -> serde_json::Value {
    json!({ "key": key, "value": value })
}

#[test]
fn every_setting_round_trips_through_the_file_and_the_memory_store() {
    let (dir, _key, meetings) = file_store();
    let path = dir.path().join("settings");
    let stores: Vec<Arc<dyn SettingsStore>> = vec![
        Arc::new(meetings.settings(&path)),
        Arc::new(MemorySettingsStore::new()),
    ];
    for store in stores {
        assert_eq!(store.load().unwrap(), None);
        store.save(&all_changed()).unwrap();
        assert_eq!(store.load().unwrap(), Some(all_changed()));
        // A service opened later sees the same values.
        let service = SettingsService::open(store.clone());
        assert_eq!(service.status(), LoadStatus::Stored);
        assert_eq!(service.current(), all_changed());
    }
    // Every change through the service, one at a time, survives a restart.
    let store: Arc<dyn SettingsStore> = Arc::new(meetings.settings(&path));
    std::fs::remove_file(&path).unwrap();
    let service = SettingsService::open(store.clone());
    for c in [
        change("inputDevice", json!(DEVICE)),
        change("deviceLost", json!("switchToDefault")),
        change("speechModel", json!(MODEL)),
        change("speakerModel", json!(SPEAKER)),
        change("meetingLanguage", json!("en")),
        change("locale", json!("en")),
        change("theme", json!("dark")),
        change("languageModel", json!({ "local": LLM })),
        change("claudeModel", json!("haiku")),
    ] {
        assert!(service.update(&c, &known()).unwrap().saved);
    }
    assert_eq!(SettingsService::open(store).current(), all_changed());
    // `null` goes back to the system default and the preferred model.
    let service = SettingsService::open(Arc::new(meetings.settings(&path)));
    service
        .update(&change("inputDevice", json!(null)), &known())
        .unwrap();
    let back = service
        .update(&change("speechModel", json!(null)), &known())
        .unwrap();
    assert_eq!(back.settings.input_device, None);
    assert_eq!(back.settings.speech_model, None);
}

#[test]
fn defaults_are_today_s_behaviour() {
    let d = Settings::default();
    assert_eq!(d.input_device, None);
    assert_eq!(d.device_lost, DeviceLost::Stop);
    assert_eq!(d.speech_model, None);
    assert_eq!(d.meeting_language, MeetingLanguage::Auto);
    assert_eq!(d.meeting_language.hint(), None);
    assert_eq!(MeetingLanguage::De.hint(), Some(Lang::De));
    assert_eq!(MeetingLanguage::En.hint(), Some(Lang::En));
    assert_eq!(d.locale, Locale::De);
    assert_eq!(d.theme, Theme::System);
    assert_eq!(
        serde_json::to_value(&d).unwrap(),
        json!({
            "inputDevice": null,
            "deviceLost": "stop",
            "speechModel": null,
            "speakerModel": null,
            "meetingLanguage": "auto",
            "locale": "de",
            "theme": "system",
            "languageModel": "none",
            "claudeModel": "sonnet"
        })
    );
}

#[test]
fn the_file_holds_no_setting_in_plain_form_and_binds_the_purpose_settings() {
    let (dir, key, meetings) = file_store();
    let path = dir.path().join("settings");
    let store = meetings.settings(&path);
    store.save(&all_changed()).unwrap();
    let bytes = std::fs::read(&path).unwrap();
    assert!(bytes.starts_with(file::MAGIC));
    for needle in [
        DEVICE,
        "Zebra",
        "Quokka",
        MODEL,
        "switchToDefault",
        "inputDevice",
        "dark",
        "theme",
    ] {
        assert!(
            !contains(&bytes, needle),
            "{needle} is readable in the file"
        );
    }
    // Only the file itself and no temp file.
    let mut names: Vec<String> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    assert_eq!(names, ["meetings", "settings"]);

    // A meeting file sealed for the id "settings", or a transcript record, swapped in is refused.
    let json = serde_json::to_vec(&all_changed()).unwrap();
    for swapped in [
        crypto::seal(&key, "settings", &json),
        [
            file::MAGIC.as_slice(),
            &crypto::seal_with(&key, b"MCTRAN01settings", &json),
        ]
        .concat(),
        [
            file::MAGIC.as_slice(),
            &crypto::seal_with(&key, b"MCMEET01settings", &json),
        ]
        .concat(),
    ] {
        std::fs::write(&path, &swapped).unwrap();
        assert!(matches!(store.load(), Err(StoreFailure::Corrupt)));
    }
    // And the settings file does not open as a meeting.
    std::fs::write(dir.path().join("meetings/settings.meeting"), &bytes).unwrap();
    assert!(meetings.load("settings").is_err());
}

fn assert_defaults_and_untouched(path: &Path, store: Arc<dyn SettingsStore>, status: LoadStatus) {
    let before = std::fs::read(path).ok();
    let service = SettingsService::open(store);
    assert_eq!(service.status(), status);
    assert_eq!(service.current(), Settings::default());
    // The UI loads with cached values: they apply in memory, the file stays as it was.
    let cached = Cached {
        locale: Some(json!("en")),
        theme: Some(json!("dark")),
        speech_model: None,
    };
    let load = service.load(&cached, &known());
    assert_eq!(load.status, status);
    assert_eq!(load.settings.locale, Locale::En);
    assert_eq!(load.settings.theme, Theme::Dark);
    assert_eq!(std::fs::read(path).ok(), before, "the file was rewritten");
}

#[test]
fn a_corrupt_tampered_foreign_or_locked_file_gives_the_defaults_and_is_left_alone() {
    let (dir, _key, meetings) = file_store();
    let path = dir.path().join("settings");
    let good = meetings.settings(&path);
    good.save(&all_changed()).unwrap();
    let sealed = std::fs::read(&path).unwrap();

    // Not ours at all.
    std::fs::write(&path, b"not a settings file").unwrap();
    assert_defaults_and_untouched(
        &path,
        Arc::new(meetings.settings(&path)),
        LoadStatus::Corrupt,
    );
    // One bit flipped anywhere.
    for i in [0, 8, 20, sealed.len() - 1] {
        let mut bad = sealed.clone();
        bad[i] ^= 0x01;
        std::fs::write(&path, &bad).unwrap();
        assert_defaults_and_untouched(
            &path,
            Arc::new(meetings.settings(&path)),
            LoadStatus::Corrupt,
        );
    }
    // Sealed with another key.
    std::fs::write(&path, &sealed).unwrap();
    let other = FileSettingsStore::new(&path, DataKey::generate());
    assert_defaults_and_untouched(&path, Arc::new(other), LoadStatus::Corrupt);
    // A locked keychain: nothing is read or written.
    assert_defaults_and_untouched(&path, Arc::new(LockedSettingsStore), LoadStatus::Locked);
    assert_eq!(std::fs::read(&path).unwrap(), sealed);

    // Only a change by the user writes the file again.
    std::fs::write(&path, b"garbage").unwrap();
    let service = SettingsService::open(Arc::new(meetings.settings(&path)));
    let up = service
        .update(&change("theme", json!("light")), &known())
        .unwrap();
    assert!(up.saved);
    assert_eq!(service.status(), LoadStatus::Stored);
    assert_eq!(
        meetings.settings(&path).load().unwrap().unwrap().theme,
        Theme::Light
    );

    // Locked: the change holds for the session but is not saved.
    let locked = SettingsService::open(Arc::new(LockedSettingsStore));
    let up = locked
        .update(&change("theme", json!("dark")), &known())
        .unwrap();
    assert!(!up.saved);
    assert_eq!(locked.current().theme, Theme::Dark);
}

#[test]
fn the_app_still_starts_when_the_settings_file_is_a_folder_or_unreadable() {
    let (dir, _key, meetings) = file_store();
    let path = dir.path().join("settings");
    std::fs::create_dir(&path).unwrap();
    let service = SettingsService::open(Arc::new(meetings.settings(&path)));
    assert_eq!(service.current(), Settings::default());
    assert_ne!(service.status(), LoadStatus::Stored);
}

#[test]
fn unknown_fields_are_dropped_and_invalid_stored_fields_take_their_default() {
    let stored = json!({
        "inputDevice": DEVICE,
        "theme": "purple",
        "locale": "en",
        "deviceLost": 7,
        "meetingLanguage": "de",
        "speechModel": "x".repeat(MAX_MODEL_ID + 1),
        "telemetry": true,
        "uploadTo": "https://example.invalid"
    });
    let s = Settings::from_stored(&serde_json::to_vec(&stored).unwrap()).unwrap();
    assert_eq!(
        s,
        Settings {
            input_device: Some(DEVICE.into()),
            locale: Locale::En,
            meeting_language: MeetingLanguage::De,
            ..Settings::default()
        }
    );
    let out = serde_json::to_value(&s).unwrap();
    assert!(out.get("telemetry").is_none());
    assert!(out.get("uploadTo").is_none());
    assert_eq!(Settings::from_stored(b"[1,2]"), None);
    // A device name over the limit in the file is dropped too.
    let long = json!({ "inputDevice": "d".repeat(MAX_DEVICE_NAME + 1) });
    assert_eq!(
        Settings::from_stored(&serde_json::to_vec(&long).unwrap())
            .unwrap()
            .input_device,
        None
    );
}

#[test]
fn changes_outside_the_schema_are_refused_with_the_key_only() {
    let service = SettingsService::open(Arc::new(MemorySettingsStore::new()));
    let refused = |c: serde_json::Value| service.update(&c, &known()).unwrap_err();
    let key = |k: &'static str| SettingsError::Invalid { key: Some(k) };

    assert_eq!(refused(change("theme", json!("purple"))), key("theme"));
    assert_eq!(refused(change("locale", json!("fr"))), key("locale"));
    assert_eq!(
        refused(change("meetingLanguage", json!("auto-ish"))),
        key("meetingLanguage")
    );
    assert_eq!(
        refused(change("deviceLost", json!("explode"))),
        key("deviceLost")
    );
    assert_eq!(refused(change("theme", json!(3))), key("theme"));
    // Device names: over 256 characters, not connected, empty or with control characters.
    let long = "a".repeat(MAX_DEVICE_NAME + 1);
    for name in [long.as_str(), "Not plugged in", "", "Mic\u{0}"] {
        assert_eq!(
            refused(change("inputDevice", json!(name))),
            key("inputDevice")
        );
    }
    // Exactly 256 characters is fine if the device is connected.
    let max = "ä".repeat(MAX_DEVICE_NAME);
    let mut cat = known();
    cat.devices.push(max.clone());
    assert!(service
        .update(&change("inputDevice", json!(max)), &cat)
        .is_ok());
    // Model ids must be in the core's own current scan.
    for id in ["/etc/passwd", "../ggml-base.bin", "/m/ggml-tiny.bin"] {
        assert_eq!(
            refused(change("speechModel", json!(id))),
            key("speechModel")
        );
    }
    // Unknown keys and extra fields.
    assert_eq!(
        refused(change("uploadTo", json!("x"))),
        SettingsError::Invalid { key: None }
    );
    assert_eq!(
        refused(json!({ "key": "theme", "value": "dark", "extra": 1 })),
        key("theme")
    );
    assert_eq!(
        refused(json!("theme")),
        SettingsError::Invalid { key: None }
    );
    // Nothing refused was applied.
    assert_eq!(service.current().theme, Theme::System);
    assert_eq!(
        serde_json::to_value(key("inputDevice")).unwrap(),
        json!({ "kind": "invalid", "key": "inputDevice" })
    );
}

#[test]
fn the_ui_cache_is_moved_into_a_missing_file_once() {
    let (dir, _key, meetings) = file_store();
    let path = dir.path().join("settings");
    let store: Arc<dyn SettingsStore> = Arc::new(meetings.settings(&path));

    // Nothing to move: the defaults are not written.
    let service = SettingsService::open(store.clone());
    let load = service.load(&Cached::default(), &known());
    assert_eq!(load.status, LoadStatus::Missing);
    assert!(!path.exists());

    let service = SettingsService::open(store.clone());
    let cached = Cached {
        locale: Some(json!("en")),
        theme: Some(json!("dark")),
        speech_model: Some(json!(MODEL)),
    };
    let load = service.load(&cached, &known());
    assert_eq!(load.status, LoadStatus::Stored);
    assert_eq!(load.settings.speech_model.as_deref(), Some(MODEL));
    assert_eq!(load.settings.locale, Locale::En);
    assert!(path.exists());
    // Once stored, the file wins over a different cache.
    let other = Cached {
        locale: Some(json!("de")),
        ..Cached::default()
    };
    let again = SettingsService::open(store.clone()).load(&other, &known());
    assert_eq!(again.settings.locale, Locale::En);

    // A cached model that is not in the scan, or junk, is not taken over.
    std::fs::remove_file(&path).unwrap();
    let service = SettingsService::open(store);
    let junk = Cached {
        locale: Some(json!("fr")),
        theme: Some(json!({ "x": 1 })),
        speech_model: Some(json!("/etc/passwd")),
    };
    let load = service.load(&junk, &known());
    assert_eq!(load.settings, Settings::default());
    assert!(!path.exists());
}

#[test]
fn device_names_model_paths_and_values_never_reach_logs_or_errors() {
    crate::log::capture();
    let (dir, _key, meetings) = file_store();
    let path = dir.path().join("settings");
    let service = SettingsService::open(Arc::new(meetings.settings(&path)));
    let mut messages = Vec::new();
    for c in [
        change("inputDevice", json!(DEVICE)),
        change("speechModel", json!(MODEL)),
    ] {
        service.update(&c, &known()).unwrap();
    }
    // Refused values: a device that is not connected, a model outside the scan, junk enums.
    let mut unknown = known();
    unknown.devices.clear();
    unknown.models.clear();
    for c in [
        change("inputDevice", json!(DEVICE)),
        change("speechModel", json!(MODEL)),
        change("theme", json!(DEVICE)),
        change(DEVICE, json!(MODEL)),
        json!({ "key": "locale", "value": "en", DEVICE: MODEL }),
    ] {
        let e = service.update(&c, &unknown).unwrap_err();
        messages.push(e.to_string());
        messages.push(format!("{e:?}"));
        messages.push(serde_json::to_string(&e).unwrap());
    }
    // Store failures: a corrupt file, a locked keychain, a folder where the file should be.
    std::fs::write(&path, b"junk").unwrap();
    let _ = SettingsService::open(Arc::new(meetings.settings(&path)));
    let locked = SettingsService::open(Arc::new(LockedSettingsStore));
    locked
        .update(&change("inputDevice", json!(DEVICE)), &known())
        .unwrap();
    let blocked = dir.path().join("blocked");
    std::fs::create_dir_all(blocked.join("settings")).unwrap();
    let failing = SettingsService::open(Arc::new(meetings.settings(blocked.join("settings"))));
    let up = failing
        .update(&change("inputDevice", json!(DEVICE)), &known())
        .unwrap();
    assert!(!up.saved);
    for failure in [
        StoreFailure::Corrupt,
        StoreFailure::Locked,
        StoreFailure::Io(std::io::ErrorKind::PermissionDenied),
    ] {
        messages.push(failure.to_string());
        messages.push(format!("{failure:?}"));
    }

    let logs = crate::log::take_captured();
    assert!(
        logs.iter().any(|l| l.contains("setting refused")),
        "{logs:?}"
    );
    assert!(
        logs.iter().any(|l| l.contains("could not store")),
        "{logs:?}"
    );
    for line in logs.iter().chain(messages.iter()) {
        for needle in ["Zebra", "Quokka", "AirPods", "/home/someone"] {
            assert!(!line.contains(needle), "leaked into: {line}");
        }
    }
}

#[test]
fn the_speaker_model_is_accepted_only_from_the_scan_and_can_go_back_to_preferred() {
    let base = Settings::default();
    let ok = parse_change(&serde_json::json!({ "key": "speakerModel", "value": SPEAKER })).unwrap();
    let next = apply(&base, ok, &known()).unwrap();
    assert_eq!(next.speaker_model.as_deref(), Some(SPEAKER));
    for bad in ["/etc/passwd", MODEL, "", "x\u{0}y"] {
        let change =
            parse_change(&serde_json::json!({ "key": "speakerModel", "value": bad })).unwrap();
        assert_eq!(
            apply(&next, change, &known()),
            Err(SettingsError::Invalid {
                key: Some("speakerModel")
            }),
            "{bad:?}"
        );
    }
    let back = parse_change(&serde_json::json!({ "key": "speakerModel", "value": null })).unwrap();
    assert_eq!(apply(&next, back, &known()).unwrap().speaker_model, None);
    // Stored files without the key (job 006) load with the preferred model.
    let old = Settings::from_stored(br#"{"speechModel":"/m/ggml-base.bin"}"#).unwrap();
    assert_eq!(old.speaker_model, None);
    let stored = Settings::from_stored(br#"{"speakerModel":"/m/campplus.onnx"}"#).unwrap();
    assert_eq!(stored.speaker_model.as_deref(), Some(SPEAKER));
}

#[test]
fn the_language_model_setting_is_none_local_from_the_scan_or_claude_and_nothing_else() {
    assert_eq!(
        Settings::default().language_model,
        LanguageModelSetting::None
    );
    let service = SettingsService::open(Arc::new(MemorySettingsStore::new()));
    for (value, expected) in [
        (json!("claude"), LanguageModelSetting::Claude),
        (
            json!({ "local": LLM }),
            LanguageModelSetting::Local(LLM.into()),
        ),
        (json!("none"), LanguageModelSetting::None),
    ] {
        let s = service
            .update(&change("languageModel", value.clone()), &known())
            .unwrap()
            .settings;
        assert_eq!(s.language_model, expected);
        assert_eq!(serde_json::to_value(&s).unwrap()["languageModel"], value);
    }
    for bad in [
        json!("local"),
        json!("openai"),
        json!({ "claude": "claude-3-opus" }),
        json!({ "local": "/etc/passwd" }),
        json!({ "local": "" }),
        json!({ "local": LLM, "extra": 1 }),
        json!(null),
        json!(true),
    ] {
        assert_eq!(
            service.update(&change("languageModel", bad.clone()), &known()),
            Err(SettingsError::Invalid {
                key: Some("languageModel")
            }),
            "{bad}"
        );
    }
    for bad in [json!("claude-sonnet-5-5"), json!("gpt"), json!(null)] {
        assert_eq!(
            service.update(&change("claudeModel", bad), &known()),
            Err(SettingsError::Invalid {
                key: Some("claudeModel")
            })
        );
    }
    // Refused changes leave the setting as it was.
    assert_eq!(service.current().language_model, LanguageModelSetting::None);
    // A stored file: a local id that is not valid text, or an unknown engine, falls back to "none";
    // a local id that the scan no longer finds is kept (the view shows "Not found any more").
    let read =
        |j: serde_json::Value| Settings::from_stored(&serde_json::to_vec(&j).unwrap()).unwrap();
    assert_eq!(
        read(json!({ "languageModel": { "local": "a\u{7}b" } })).language_model,
        LanguageModelSetting::None
    );
    assert_eq!(
        read(json!({ "languageModel": "proxy" })).language_model,
        LanguageModelSetting::None
    );
    assert_eq!(
        read(json!({ "languageModel": { "local": "/gone/model.gguf" }, "claudeModel": "opus" })),
        Settings {
            language_model: LanguageModelSetting::Local("/gone/model.gguf".into()),
            claude_model: ClaudeModel::Opus,
            ..Settings::default()
        }
    );
}
