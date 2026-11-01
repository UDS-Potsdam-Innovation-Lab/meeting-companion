use std::path::Path;
use std::time::Duration;

use super::*;
use crate::crypto::DataKey;
use crate::engines::claude::tests::{ok_answer, FakeTransport};
use crate::engines::claude::{HttpResponse, API_URL};
use crate::engines::models::tests::fake_gguf;
use crate::engines::models::{ModelLocation, ModelSource};
use crate::secrets::{self, MemorySecretStore};
use crate::settings::{Catalog, FileSettingsStore, SettingsService};

const MARKER_KEY: &str = "FAKE-MARKER-KEY-for-tests-only-2207";

struct Rig {
    _dir: tempfile::TempDir,
    models: std::path::PathBuf,
    transport: Arc<FakeTransport>,
    secrets: Arc<MemorySecretStore>,
    local: Arc<ScriptedLocalProvider>,
    engine: Arc<ScriptedLanguageModel>,
    deps: EngineDeps,
}

fn rig_with(engine: ScriptedLanguageModel, transport: Arc<FakeTransport>) -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let models = dir.path().join("models");
    fake_gguf(
        &models.join("Qwen2.5-3B-Instruct-Q4_K_M.gguf"),
        3,
        &[("general.architecture", "qwen2")],
        100,
    );
    let engine = Arc::new(engine);
    let local = Arc::new(ScriptedLocalProvider::new(
        vec![ModelLocation {
            source: ModelSource::App,
            path: models.clone(),
        }],
        engine.clone(),
    ));
    let secrets = Arc::new(MemorySecretStore::new());
    let deps = EngineDeps {
        local: local.clone(),
        transport: transport.clone(),
        secrets: secrets.clone(),
        fake: None,
    };
    Rig {
        _dir: dir,
        models,
        transport,
        secrets,
        local,
        engine,
        deps,
    }
}

fn rig() -> Rig {
    rig_with(
        ScriptedLanguageModel::default(),
        FakeTransport::answering(vec![]),
    )
}

impl Rig {
    fn model_id(&self) -> String {
        self.local.models().list.models[0].id.clone()
    }
    fn with_key(self) -> Self {
        secrets::set_api_key(self.secrets.as_ref(), MARKER_KEY).unwrap();
        self
    }
}

/// The core's catalog for these tests: the language models of the rig's scan.
struct LlmCatalog<'a>(&'a dyn LocalLlmProvider);

impl Catalog for LlmCatalog<'_> {
    fn input_devices(&self) -> Vec<String> {
        Vec::new()
    }
    fn speech_models(&self) -> Vec<String> {
        Vec::new()
    }
    fn llm_models(&self) -> Vec<String> {
        let found = self.0.models();
        if !found.available {
            return Vec::new();
        }
        found.list.models.into_iter().map(|m| m.id).collect()
    }
}

fn settings(choice: LanguageModelSetting) -> Settings {
    Settings {
        language_model: choice,
        locale: Locale::En,
        ..Settings::default()
    }
}

fn engine_kind(r: &Result<Arc<dyn LanguageModel>, LlmError>) -> Result<(), LlmError> {
    r.as_ref().map(|_| ()).map_err(|e| *e)
}

// ---- AC1 --------------------------------------------------------------------------------------------

#[test]
fn the_default_setting_builds_no_engine_and_touches_no_network_keychain_or_model_file() {
    let r = rig().with_key();
    let reads_before = r.secrets.reads();
    assert_eq!(
        Settings::default().language_model,
        LanguageModelSetting::None
    );
    let built = build_engine(&LanguageModelSetting::None, ClaudeModel::Sonnet, &r.deps);
    assert_eq!(engine_kind(&built), Err(LlmError::NotConfigured));
    let service = LanguageModelService::new(r.deps.clone());
    assert_eq!(
        service.run_test(&settings(LanguageModelSetting::None)),
        Err(LlmError::NotConfigured)
    );
    assert_eq!(r.transport.calls(), 0);
    assert_eq!(r.secrets.reads(), reads_before);
    assert_eq!(r.local.scans(), 0);
    assert_eq!(r.local.loads(), 0);
    assert!(r.engine.requests().is_empty());
}

#[test]
fn a_local_id_outside_the_scan_is_refused_and_a_model_that_disappeared_gives_no_model() {
    let r = rig();
    let catalog = LlmCatalog(r.local.as_ref());
    let store = Arc::new(crate::settings::MemorySettingsStore::new());
    let service = SettingsService::open(store);
    for id in ["/etc/passwd", "", "Qwen2.5-3B-Instruct-Q4_K_M.gguf"] {
        let raw = serde_json::json!({ "key": "languageModel", "value": { "local": id } });
        assert_eq!(
            service.update(&raw, &catalog),
            Err(crate::settings::SettingsError::Invalid {
                key: Some("languageModel")
            })
        );
    }
    let id = r.model_id();
    let raw = serde_json::json!({ "key": "languageModel", "value": { "local": id } });
    let update = service.update(&raw, &catalog).unwrap();
    assert_eq!(
        update.settings.language_model,
        LanguageModelSetting::Local(id.clone())
    );
    assert_eq!(
        serde_json::to_value(&update.settings).unwrap()["languageModel"],
        serde_json::json!({ "local": id })
    );
    let llm = LanguageModelService::new(r.deps.clone());
    assert!(llm.run_test(&update.settings).is_ok());
    assert_eq!(r.engine.requests().len(), 1);

    std::fs::remove_dir_all(&r.models).unwrap();
    assert_eq!(llm.run_test(&update.settings), Err(LlmError::NoModel));
    // The setting stays as the person left it: no switch to another engine.
    assert_eq!(
        service.current().language_model,
        LanguageModelSetting::Local(id)
    );
    assert_eq!(r.engine.requests().len(), 1);
}

#[test]
fn the_core_never_falls_back_to_another_engine() {
    // Local chosen, model gone, a Claude key saved: still NoModel, nothing sent.
    let r = rig().with_key();
    let id = r.model_id();
    std::fs::remove_dir_all(&r.models).unwrap();
    let built = build_engine(
        &LanguageModelSetting::Local(id),
        ClaudeModel::Sonnet,
        &r.deps,
    );
    assert_eq!(engine_kind(&built), Err(LlmError::NoModel));
    assert_eq!(r.transport.calls(), 0);
    assert_eq!(r.secrets.reads(), 0);

    // Claude chosen, no key, local models there: NoApiKey, no local model loaded.
    let r = rig();
    let service = LanguageModelService::new(r.deps.clone());
    assert_eq!(
        service.run_test(&settings(LanguageModelSetting::Claude)),
        Err(LlmError::NoApiKey)
    );
    // Claude offline: Offline, still no local model.
    let r2 = rig_with(
        ScriptedLanguageModel::default(),
        FakeTransport::answering(vec![Err(crate::engines::claude::TransportError::Offline)]),
    )
    .with_key();
    assert_eq!(
        LanguageModelService::new(r2.deps.clone())
            .run_test(&settings(LanguageModelSetting::Claude)),
        Err(LlmError::Offline)
    );
    for rig in [&r, &r2] {
        assert_eq!(rig.local.loads(), 0);
        assert!(rig.engine.requests().is_empty());
    }
}

// ---- job 016: the llama.cpp runtime in the slot ---------------------------------------------------

/// The rig's model folder with llama.cpp's provider, loading through `loader`.
fn llama_provider(
    r: &Rig,
    loader: Arc<dyn crate::engines::llama::ModelLoader>,
) -> Arc<crate::engines::llama::LlamaLocalProvider> {
    Arc::new(crate::engines::llama::LlamaLocalProvider::with_loader(
        vec![ModelLocation {
            source: ModelSource::App,
            path: r.models.clone(),
        }],
        loader,
    ))
}

#[test]
fn with_the_llama_runtime_the_scan_is_listed_as_available_and_only_its_ids_are_accepted() {
    let r = rig();
    let id = r.model_id();
    let local = llama_provider(&r, Arc::new(crate::engines::llama::LlamaCppLoader));
    let found = local.models();
    // The 011 scan, unchanged, now with `available: true`.
    assert!(found.available);
    assert_eq!(
        found.list,
        crate::engines::models::scan_llm(&r.local.locations)
    );
    assert_eq!(found.list.models.len(), 1);
    let json = serde_json::to_value(&found).unwrap();
    assert_eq!(json["available"], serde_json::json!(true));
    assert_eq!(json["models"][0]["id"], serde_json::json!(id));
    // `{ local: id }` only for an id of the current scan.
    let catalog = LlmCatalog(local.as_ref());
    let service = SettingsService::open(Arc::new(crate::settings::MemorySettingsStore::new()));
    for id in [
        "/etc/passwd",
        "",
        "Qwen2.5-3B-Instruct-Q4_K_M.gguf",
        "../x.gguf",
    ] {
        let raw = serde_json::json!({ "key": "languageModel", "value": { "local": id } });
        assert!(service.update(&raw, &catalog).is_err(), "{id}");
    }
    let raw = serde_json::json!({ "key": "languageModel", "value": { "local": id } });
    let update = service.update(&raw, &catalog).unwrap();
    assert_eq!(
        update.settings.language_model,
        LanguageModelSetting::Local(id.clone())
    );
    // Gone from the scan: refused from then on.
    std::fs::remove_file(&id).unwrap();
    assert!(service.update(&raw, &catalog).is_err());
    assert_eq!(engine_kind(&local.load(&id)), Err(LlmError::NoModel));
}

#[test]
fn switching_to_off_claude_or_another_model_releases_the_local_model() {
    use crate::engines::llama::tests::CountingLoader;
    let r = rig().with_key();
    fake_gguf(
        &r.models.join("Llama-3.2-3B-Instruct-Q4_K_M.gguf"),
        3,
        &[("general.architecture", "llama")],
        200,
    );
    let loader = Arc::new(CountingLoader::default());
    let local = llama_provider(&r, loader.clone());
    let ids: Vec<String> = local
        .models()
        .list
        .models
        .into_iter()
        .map(|m| m.id)
        .collect();
    assert_eq!(ids.len(), 2);
    let deps = EngineDeps {
        local: local.clone(),
        ..r.deps.clone()
    };
    let llm = LanguageModelService::new(deps);
    // Choosing loads nothing.
    llm.setting_changed(&LanguageModelSetting::Local(ids[0].clone()));
    assert_eq!(loader.loads(), 0);
    assert_eq!(local.loaded(), None);
    // The first call loads it.
    llm.run_test(&settings(LanguageModelSetting::Local(ids[0].clone())))
        .unwrap();
    assert_eq!(local.loaded().as_deref(), Some(ids[0].as_str()));
    assert_eq!(loader.alive(), 1);
    // Off releases it.
    llm.setting_changed(&LanguageModelSetting::None);
    assert_eq!(local.loaded(), None);
    assert_eq!(loader.alive(), 0);
    // Claude releases it.
    llm.run_test(&settings(LanguageModelSetting::Local(ids[0].clone())))
        .unwrap();
    assert_eq!(loader.alive(), 1);
    llm.setting_changed(&LanguageModelSetting::Claude);
    assert_eq!(loader.alive(), 0);
    // Another model: the first leaves before the second loads, never two at once.
    llm.run_test(&settings(LanguageModelSetting::Local(ids[0].clone())))
        .unwrap();
    llm.setting_changed(&LanguageModelSetting::Local(ids[1].clone()));
    assert_eq!(loader.alive(), 0);
    llm.run_test(&settings(LanguageModelSetting::Local(ids[1].clone())))
        .unwrap();
    assert_eq!(local.loaded().as_deref(), Some(ids[1].as_str()));
    assert_eq!(loader.alive(), 1);
    assert_eq!(loader.most_alive(), 1);
    // The same model again loads nothing new.
    let before = loader.loads();
    llm.run_test(&settings(LanguageModelSetting::Local(ids[1].clone())))
        .unwrap();
    assert_eq!(loader.loads(), before);
    // A Test with Off or Claude releases it too, even without a setting change.
    let _ = llm.run_test(&settings(LanguageModelSetting::None));
    assert_eq!(loader.alive(), 0);
}

#[test]
fn the_model_loads_on_the_first_call_and_off_the_calling_thread() {
    use crate::engines::llama::tests::CountingLoader;
    let r = rig();
    let loader = Arc::new(CountingLoader::default());
    let local = llama_provider(&r, loader.clone());
    let deps = EngineDeps {
        local: local.clone(),
        ..r.deps.clone()
    };
    let engine = build_engine(
        &LanguageModelSetting::Local(r.model_id()),
        ClaudeModel::Sonnet,
        &deps,
    )
    .unwrap();
    // Building the engine loaded nothing.
    assert_eq!(loader.loads(), 0);
    let req = crate::engines::llm::LlmRequest {
        system: TEST_TASK,
        content: SAMPLE_EN.into(),
        max_input_chars: 1_000,
        max_output_tokens: 20,
    };
    run_cancellable(engine, &req, &CancelToken::new()).unwrap();
    assert_eq!(loader.loads(), 1);
    let threads = loader.load_threads();
    assert_eq!(threads.len(), 1);
    assert_ne!(threads[0], std::thread::current().id());
}

#[test]
fn a_garbage_local_model_fails_without_calling_claude_or_falling_back() {
    let r = rig().with_key();
    // In the scan (its header names an architecture), but llama.cpp cannot read it.
    let local = llama_provider(&r, Arc::new(crate::engines::llama::LlamaCppLoader));
    let deps = EngineDeps {
        local: local.clone(),
        ..r.deps.clone()
    };
    let llm = LanguageModelService::new(deps);
    let chosen = settings(LanguageModelSetting::Local(r.model_id()));
    assert_eq!(llm.run_test(&chosen), Err(LlmError::Failed));
    assert_eq!(llm.run_test(&chosen), Err(LlmError::Failed));
    // No call to the Claude transport, no other engine.
    assert_eq!(r.transport.calls(), 0);
    assert!(r.engine.requests().is_empty());
    assert_eq!(local.loaded(), None);
    // The app keeps working: Claude still answers when a person chooses it.
    assert!(llm
        .run_test(&settings(LanguageModelSetting::Claude))
        .is_ok());
    assert_eq!(r.transport.calls(), 1);
}

#[test]
fn the_fake_flag_selects_the_scripted_engine_and_nothing_is_sent() {
    assert!(is_fake(Some("fake")));
    assert!(!is_fake(Some("claude")));
    assert!(!is_fake(None));
    let mut r = rig().with_key();
    r.deps.fake = Some(r.engine.clone());
    let service = LanguageModelService::new(r.deps.clone());
    let reply = service
        .run_test(&settings(LanguageModelSetting::Claude))
        .unwrap();
    assert_eq!(reply.text, crate::engines::llm::SCRIPTED_REPLY);
    assert_eq!(r.transport.calls(), 0);
    assert_eq!(r.engine.requests().len(), 1);
    // "Off" stays off with the fake too.
    assert_eq!(
        service.run_test(&settings(LanguageModelSetting::None)),
        Err(LlmError::NotConfigured)
    );
}

// ---- AC2 --------------------------------------------------------------------------------------------

fn contains(haystack: &[u8], needle: &str) -> bool {
    haystack
        .windows(needle.len())
        .any(|w| w == needle.as_bytes())
}

fn files_under(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
    for e in std::fs::read_dir(dir).unwrap() {
        let p = e.unwrap().path();
        if p.is_dir() {
            files_under(&p, out);
        } else {
            out.push(p);
        }
    }
}

#[test]
fn the_key_is_in_no_file_ipc_answer_log_line_or_error() {
    let r = rig_with(
        ScriptedLanguageModel::default(),
        FakeTransport::answering(vec![
            Ok(HttpResponse {
                status: 401,
                body: format!("{{\"error\":\"{MARKER_KEY}\"}}").into_bytes(),
            }),
            Ok(ok_answer("fine")),
        ]),
    );
    let app_data = tempfile::tempdir().unwrap();
    let settings_service = SettingsService::open(Arc::new(FileSettingsStore::new(
        app_data.path().join("settings"),
        DataKey::generate(),
    )));
    let catalog = LlmCatalog(r.local.as_ref());
    crate::log::capture();
    let mut answers: Vec<String> = Vec::new();
    // set, replace, status: the UI learns `{ set }` only.
    answers.push(
        serde_json::to_string(&secrets::set_api_key(
            r.secrets.as_ref(),
            "FAKE-FIRST-for-tests-only",
        ))
        .unwrap(),
    );
    answers.push(
        serde_json::to_string(&secrets::set_api_key(r.secrets.as_ref(), MARKER_KEY)).unwrap(),
    );
    answers.push(serde_json::to_string(&secrets::api_key_status(r.secrets.as_ref())).unwrap());
    answers.push(
        serde_json::to_string(&secrets::set_api_key(
            r.secrets.as_ref(),
            &format!("{MARKER_KEY} x"),
        ))
        .unwrap(),
    );
    let update = settings_service
        .update(
            &serde_json::json!({ "key": "languageModel", "value": "claude" }),
            &catalog,
        )
        .unwrap();
    assert!(update.saved);
    answers.push(serde_json::to_string(&update).unwrap());
    let llm = LanguageModelService::new(r.deps.clone());
    let current = settings_service.current();
    let unauthorized = llm.run_test(&current);
    assert_eq!(unauthorized, Err(LlmError::Unauthorized));
    answers.push(serde_json::to_string(&unauthorized).unwrap());
    answers.push(format!(
        "{} {:?}",
        unauthorized.clone().unwrap_err(),
        unauthorized
    ));
    let ok = llm.run_test(&current);
    answers.push(serde_json::to_string(&ok).unwrap());
    answers.push(serde_json::to_string(&llm.local_models()).unwrap());
    answers.push(serde_json::to_string(&settings_service.current()).unwrap());
    let lines = crate::log::take_captured();

    assert_eq!(answers[2], r#"{"Ok":{"set":true}}"#);
    for a in &answers {
        assert!(!a.contains(MARKER_KEY), "{a}");
    }
    for l in &lines {
        assert!(!l.contains(MARKER_KEY), "{l}");
    }
    // The key went out in the x-api-key header of both requests, and nowhere else.
    let sent = r.transport.sent.lock().unwrap();
    assert_eq!(sent.len(), 2);
    for req in sent.iter() {
        assert_eq!(req.url, API_URL);
        assert!(!contains(&req.body, MARKER_KEY));
    }
    drop(sent);
    // Nothing in the app data folder holds it: the settings file is sealed, and the key is not in it.
    let mut files = Vec::new();
    files_under(app_data.path(), &mut files);
    assert!(!files.is_empty());
    for f in files {
        let bytes = std::fs::read(&f).unwrap();
        assert!(!contains(&bytes, MARKER_KEY), "{f:?}");
    }
    // What is sealed into the settings file is exactly the settings, checked above.

    // Delete: the keychain entry goes, and a Claude call fails before any request is built.
    assert_eq!(
        secrets::delete_api_key(r.secrets.as_ref()),
        Ok(secrets::ApiKeyStatus { set: false })
    );
    assert_eq!(r.secrets.get(), Ok(None));
    assert_eq!(llm.run_test(&current), Err(LlmError::NoApiKey));
    assert_eq!(r.transport.calls(), 2);
}

#[test]
fn a_locked_keychain_gives_keychain_unavailable_and_the_app_keeps_running() {
    let mut r = rig();
    let locked: Arc<MemorySecretStore> = Arc::new(MemorySecretStore::unavailable());
    r.deps.secrets = locked.clone();
    let llm = LanguageModelService::new(r.deps.clone());
    assert_eq!(
        llm.run_test(&settings(LanguageModelSetting::Claude)),
        Err(LlmError::KeychainUnavailable)
    );
    assert_eq!(
        secrets::set_api_key(llm.secrets(), MARKER_KEY),
        Err(secrets::SecretError::KeychainUnavailable)
    );
    // The service still answers.
    assert_eq!(
        llm.run_test(&settings(LanguageModelSetting::None)),
        Err(LlmError::NotConfigured)
    );
    assert_eq!(r.transport.calls(), 0);
}

// ---- AC3 --------------------------------------------------------------------------------------------

#[test]
fn no_request_is_made_while_the_setting_is_off_or_local() {
    let r = rig().with_key();
    let llm = LanguageModelService::new(r.deps.clone());
    let _ = llm.run_test(&settings(LanguageModelSetting::None));
    let _ = llm.run_test(&settings(LanguageModelSetting::Local(r.model_id())));
    assert_eq!(r.transport.calls(), 0);
    assert_eq!(r.engine.requests().len(), 1);
    // Only once a person chose Claude.
    llm.run_test(&settings(LanguageModelSetting::Claude))
        .unwrap();
    assert_eq!(r.transport.calls(), 1);
}

// ---- AC4 --------------------------------------------------------------------------------------------

#[test]
fn the_test_sends_only_the_fixed_sample_in_the_content_block_and_logs_no_text() {
    let reply_marker = "Reply-Marker-Capybara-3319";
    let r = rig_with(
        ScriptedLanguageModel::new(vec![Ok(reply_marker.into()), Err(LlmError::Failed)]),
        FakeTransport::answering(vec![]),
    );
    let llm = LanguageModelService::new(r.deps.clone());
    let mut s = settings(LanguageModelSetting::Local(r.model_id()));
    crate::log::capture();
    let ok = llm.run_test(&s).unwrap();
    s.locale = Locale::De;
    let err = llm.run_test(&s).unwrap_err();
    let lines = crate::log::take_captured();
    assert_eq!(ok.text, reply_marker);
    assert_eq!(err, LlmError::Failed);
    let seen = r.engine.requests();
    assert!(seen[0].system.starts_with(TEST_TASK));
    assert!(seen[0].content.contains(SAMPLE_EN));
    assert!(seen[1].content.contains(SAMPLE_DE));
    for p in &seen {
        assert!(!p.system.contains(SAMPLE_EN) && !p.system.contains(SAMPLE_DE));
    }
    for l in &lines {
        assert!(!l.contains(reply_marker), "{l}");
        assert!(
            !l.contains("pilot school") && !l.contains("Pilotschule"),
            "{l}"
        );
    }
    assert!(lines
        .iter()
        .any(|l| l.contains("the language model test failed")));
}

// ---- AC6 --------------------------------------------------------------------------------------------

#[test]
fn a_slow_engine_blocks_nothing_and_cancel_returns_cancelled_within_a_second() {
    let r = rig_with(
        ScriptedLanguageModel::default().with_delay(Duration::from_secs(30)),
        FakeTransport::answering(vec![]),
    );
    let llm = Arc::new(LanguageModelService::new(r.deps.clone()));
    let settings_service = Arc::new(SettingsService::open(Arc::new(
        crate::settings::MemorySettingsStore::new(),
    )));
    let chosen = settings(LanguageModelSetting::Local(r.model_id()));
    let running = {
        let llm = llm.clone();
        let chosen = chosen.clone();
        std::thread::spawn(move || llm.run_test(&chosen))
    };
    let t = Instant::now();
    while r.engine.requests().is_empty() && t.elapsed() < Duration::from_secs(2) {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(r.engine.requests().len(), 1);
    // The settings answer at once while the engine works.
    let catalog = LlmCatalog(r.local.as_ref());
    let t = Instant::now();
    settings_service
        .update(
            &serde_json::json!({ "key": "theme", "value": "dark" }),
            &catalog,
        )
        .unwrap();
    assert!(t.elapsed() < Duration::from_millis(200));
    // A second test while one runs is refused, not queued.
    assert_eq!(llm.run_test(&chosen), Err(LlmError::Busy));
    let at = Instant::now();
    llm.cancel_test();
    assert_eq!(running.join().unwrap(), Err(LlmError::Cancelled));
    assert!(at.elapsed() < Duration::from_secs(1), "{:?}", at.elapsed());
    // And the next test runs again.
    llm.cancel_test();
}

#[test]
fn a_recording_with_the_scripted_engine_configured_sends_it_nothing() {
    use crate::engines::audio::FakeAudioSource;
    use crate::engines::FakeSttProvider;
    use crate::recording::{CaptureState, EventSink, Recorder, SegmentEvent};
    use crate::store::{MeetingStore, MemoryMeetingStore};
    use crate::transcript::MemoryTranscriptStore;

    struct Quiet;
    impl EventSink for Quiet {
        fn capture(&self, _: &CaptureState) {}
        fn segment(&self, _: &SegmentEvent) {}
    }

    let mut r = rig().with_key();
    r.deps.fake = Some(r.engine.clone());
    let llm = LanguageModelService::new(r.deps.clone());
    let s = settings(LanguageModelSetting::Claude);
    let recorder = Recorder::new(
        Box::new(|| {
            Box::new(FakeAudioSource::demo()) as Box<dyn crate::engines::audio::AudioSource>
        }),
        Box::new(FakeSttProvider::demo()),
        Arc::new(MemoryTranscriptStore::new()),
        Arc::new(Quiet),
        || 1_000_000,
    );
    let meetings = MemoryMeetingStore::new();
    let mut m = crate::model::tests::running();
    m.recording_consent_at = Some(2_000);
    meetings.save(&m).unwrap();
    recorder
        .start_with(&meetings, "m-1", &crate::start_options(&s))
        .unwrap();
    std::thread::sleep(Duration::from_millis(1_500));
    recorder.pause();
    recorder.stop();
    assert!(r.engine.requests().is_empty());
    assert_eq!(r.transport.calls(), 0);
    // The engine itself works: only the Test reaches it.
    llm.run_test(&s).unwrap();
    assert_eq!(r.engine.requests().len(), 1);
}
