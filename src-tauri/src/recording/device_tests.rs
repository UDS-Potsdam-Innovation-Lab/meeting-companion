//! Job 006: the chosen microphone, the language hint and the microphone test.

use std::sync::atomic::AtomicUsize;
use std::sync::Mutex;

use super::*;
use crate::crypto::{DataKey, MemoryKeyProvider};
use crate::engines::audio::{FakeAudioSource, FakeCounters, Pace, Tone};
use crate::engines::devices::FakeAudioDevices;
use crate::engines::models::ModelList;
use crate::engines::stt::{ScriptedSpeechToText, SttStats};
use crate::model::tests::running;
use crate::model::Meeting;
use crate::store::{FileMeetingStore, MeetingStore, MemoryMeetingStore};
use crate::transcript::MemoryTranscriptStore;

const ROOM_MIC: &str = "Zebra-Quokka Conference Mic";

#[derive(Default)]
struct Events {
    states: Mutex<Vec<CaptureState>>,
    segments: Mutex<Vec<SegmentEvent>>,
    tests: Mutex<Vec<MicTestState>>,
}

impl EventSink for Events {
    fn capture(&self, state: &CaptureState) {
        self.states.lock().unwrap().push(state.clone());
    }
    fn segment(&self, event: &SegmentEvent) {
        self.segments.lock().unwrap().push(event.clone());
    }
    fn mic_test(&self, state: &MicTestState) {
        self.tests.lock().unwrap().push(state.clone());
    }
}

impl Events {
    fn last_test(&self) -> Option<MicTestState> {
        self.tests.lock().unwrap().last().cloned()
    }
}

/// A fake engine provider that counts loads and shares the engine's stats.
struct CountingStt {
    loads: Arc<AtomicUsize>,
    stats: Arc<SttStats>,
}

impl SttProvider for CountingStt {
    fn models(&self) -> ModelList {
        ModelList::default()
    }
    fn load(&self, _id: Option<&str>) -> Result<Box<dyn SpeechToText>, SttError> {
        self.loads.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let mut engine = ScriptedSpeechToText::new(vec![("Hallo zusammen.".into(), Lang::De)]);
        engine.stats = self.stats.clone();
        Ok(Box::new(engine))
    }
}

struct Rig {
    recorder: Recorder,
    events: Arc<Events>,
    devices: Arc<FakeAudioDevices>,
    default_counters: Arc<FakeCounters>,
    loads: Arc<AtomicUsize>,
    stats: Arc<SttStats>,
    transcripts: Arc<dyn TranscriptStore>,
}

fn speech() -> FakeAudioSource {
    FakeAudioSource::new(
        vec![Tone::speech(1_200), Tone::silence(800)],
        Pace::RealTime,
    )
    .repeating()
}

fn rig_with(transcripts: Arc<dyn TranscriptStore>) -> Rig {
    rig_full(
        transcripts,
        FakeAudioDevices::new(&["Built-in Audio", ROOM_MIC], |_| speech()),
    )
}

fn rig_full(transcripts: Arc<dyn TranscriptStore>, devices: FakeAudioDevices) -> Rig {
    let default_counters = Arc::new(FakeCounters::default());
    let c = default_counters.clone();
    let devices = Arc::new(devices);
    let events = Arc::new(Events::default());
    let loads = Arc::new(AtomicUsize::new(0));
    let stats = Arc::new(SttStats::default());
    let recorder = Recorder::new(
        Box::new(move || Box::new(speech().with_counters(c.clone()))),
        Box::new(CountingStt {
            loads: loads.clone(),
            stats: stats.clone(),
        }),
        transcripts.clone(),
        events.clone(),
        || 1_000_000,
    )
    .with_devices(devices.clone());
    Rig {
        recorder,
        events,
        devices,
        default_counters,
        loads,
        stats,
        transcripts,
    }
}

fn rig() -> Rig {
    rig_with(Arc::new(MemoryTranscriptStore::new()))
}

fn consented() -> Meeting {
    let mut m = running();
    m.recording_consent_at = Some(2_000);
    m
}

fn meetings() -> MemoryMeetingStore {
    let store = MemoryMeetingStore::new();
    store.save(&consented()).unwrap();
    store
}

fn wait_until(limit: Duration, mut f: impl FnMut() -> bool) -> bool {
    let start = Instant::now();
    while start.elapsed() < limit {
        if f() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    f()
}

fn on(device: Option<&str>) -> StartOptions {
    StartOptions {
        device: device.map(str::to_owned),
        ..StartOptions::default()
    }
}

#[test]
fn the_chosen_device_is_opened_and_system_default_opens_the_default() {
    let r = rig();
    let store = meetings();
    let s = r
        .recorder
        .start_with(&store, "m-1", &on(Some(ROOM_MIC)))
        .unwrap();
    assert_eq!(s.state, Capture::Recording);
    assert_eq!(r.devices.opened(), [ROOM_MIC]);
    assert_eq!(r.devices.counters().starts(), 1);
    assert_eq!(r.default_counters.starts(), 0);
    r.recorder.pause();
    assert_eq!(r.devices.counters().stops(), 1);

    r.recorder.start_with(&store, "m-1", &on(None)).unwrap();
    assert_eq!(r.default_counters.starts(), 1);
    assert_eq!(r.devices.opened(), [ROOM_MIC], "no named device opened");
    r.recorder.stop();
    assert_eq!(r.recorder.input_devices(), ["Built-in Audio", ROOM_MIC]);
}

#[test]
fn a_chosen_device_that_is_missing_at_start_records_from_no_other_device() {
    let r = rig();
    let store = meetings();
    r.devices.set_connected(&["Built-in Audio"]);
    let err = r
        .recorder
        .start_with(&store, "m-1", &on(Some(ROOM_MIC)))
        .unwrap_err();
    assert_eq!(
        err,
        RecordError::Failed {
            reason: Reason::ChosenMicrophoneMissing
        }
    );
    let status = r.recorder.status();
    assert_eq!(status.state, Capture::Error);
    assert_eq!(status.reason, Some(Reason::ChosenMicrophoneMissing));
    // Nothing was opened: neither the default nor another named device.
    assert_eq!(r.default_counters.starts(), 0);
    assert_eq!(r.devices.counters().starts(), 0);
    assert_eq!(
        serde_json::to_value(Reason::ChosenMicrophoneMissing).unwrap(),
        serde_json::json!("chosenMicrophoneMissing")
    );
    // A device that vanishes between the list and the open is reported the same way.
    let late = rig();
    let devices = late.devices.clone();
    let recorder = late.recorder;
    devices.set_connected(&[ROOM_MIC]);
    let missing_on_open = Arc::new(FakeAudioDevices::new(&[ROOM_MIC], |_| {
        speech().failing_start(AudioError::NoMicrophone)
    }));
    let recorder = recorder.with_devices(missing_on_open);
    assert_eq!(
        recorder
            .start_with(&store, "m-1", &on(Some(ROOM_MIC)))
            .unwrap_err(),
        RecordError::Failed {
            reason: Reason::ChosenMicrophoneMissing
        }
    );

    // "Use system default": the next start opens the default and records.
    let s = r.recorder.start_with(&store, "m-1", &on(None)).unwrap();
    assert_eq!(s.state, Capture::Recording);
    assert_eq!(r.default_counters.starts(), 1);
    r.recorder.stop();
}

#[test]
fn the_default_meeting_language_is_passed_as_a_hint() {
    let r = rig();
    let store = meetings();
    for language in [Some(Lang::De), Some(Lang::En), None] {
        let opts = StartOptions {
            language,
            ..StartOptions::default()
        };
        r.recorder.start_with(&store, "m-1", &opts).unwrap();
        r.recorder.pause();
    }
    assert_eq!(
        *r.stats.hints.lock().unwrap(),
        [Some(Lang::De), Some(Lang::En), None]
    );
    // The engine was loaded once and reused; the hint is set for every session.
    assert_eq!(r.loads.load(std::sync::atomic::Ordering::SeqCst), 1);
}

#[test]
fn a_hinted_scripted_engine_labels_every_line_with_the_hint() {
    let mut engine = ScriptedSpeechToText::demo();
    engine.set_language(Some(Lang::De));
    let window = vec![0.1; 16_000];
    for _ in 0..4 {
        let out = engine.transcribe(&window, true).unwrap();
        assert!(out.iter().all(|r| r.lang == Lang::De));
    }
}

#[test]
fn a_microphone_test_opens_the_device_once_shows_its_level_and_keeps_nothing() {
    crate::log::capture();
    let dir = tempfile::tempdir().unwrap();
    let keys = MemoryKeyProvider::with_key(DataKey::generate());
    let store = FileMeetingStore::open(dir.path().join("meetings"), &keys).unwrap();
    store.save(&consented()).unwrap();
    let settings = store.settings(dir.path().join("settings"));
    crate::settings::SettingsStore::save(&settings, &crate::settings::Settings::default()).unwrap();
    let before = walk(dir.path());

    let r = rig_with(Arc::new(store.transcripts()));
    let first = r.recorder.start_test(Some(ROOM_MIC)).unwrap();
    assert_eq!(first.state, MicTest::Running);
    assert_eq!(first.remaining_ms, 10_000);
    assert!(wait_until(Duration::from_secs(3), || r
        .events
        .tests
        .lock()
        .unwrap()
        .iter()
        .any(|t| t.level > 0.1)));
    assert!(r.recorder.test_running());
    // "Stop test".
    r.recorder.stop_test();
    assert_eq!(r.events.last_test().unwrap(), MicTestState::off());
    assert_eq!(r.devices.counters().starts(), 1);
    assert_eq!(r.devices.counters().stops(), 1);
    assert_eq!(r.devices.opened(), [ROOM_MIC]);

    // A test on the system default.
    r.recorder.start_test(None).unwrap();
    r.recorder.stop_test();
    assert_eq!(r.default_counters.starts(), 1);
    assert_eq!(r.default_counters.stops(), 1);

    // Nothing reached speech-to-text or the transcript, and no file was written.
    assert_eq!(r.loads.load(std::sync::atomic::Ordering::SeqCst), 0);
    assert_eq!(r.stats.calls.load(std::sync::atomic::Ordering::SeqCst), 0);
    assert!(r.events.segments.lock().unwrap().is_empty());
    assert!(r.transcripts.load("m-1").unwrap().is_empty());
    assert_eq!(r.recorder.status().state, Capture::Off);
    assert_eq!(walk(dir.path()), before);
    assert_eq!(before, ["meetings/m-1.meeting", "settings"]);
    let logs = crate::log::take_captured();
    assert!(logs.iter().all(|l| !l.contains("Zebra")), "{logs:?}");
}

#[test]
fn a_microphone_test_stops_by_itself_after_10_s() {
    let r = rig();
    let started = Instant::now();
    r.recorder.start_test(Some(ROOM_MIC)).unwrap();
    assert!(wait_until(Duration::from_secs(12), || r
        .events
        .last_test()
        .is_some_and(|t| t.state == MicTest::Off)));
    let took = started.elapsed();
    assert!(took >= TEST_LIMIT, "{took:?}");
    assert!(took < TEST_LIMIT + Duration::from_secs(1), "{took:?}");
    assert_eq!(r.devices.counters().starts(), 1);
    assert_eq!(r.devices.counters().stops(), 1);
    // The countdown went down.
    let remaining: Vec<u64> = r
        .events
        .tests
        .lock()
        .unwrap()
        .iter()
        .filter(|t| t.state == MicTest::Running)
        .map(|t| t.remaining_ms)
        .collect();
    assert!(remaining.windows(2).all(|w| w[0] >= w[1]));
    assert!(*remaining.last().unwrap() < 1_000);
    r.recorder.stop_test();
    assert_eq!(r.devices.counters().stops(), 1, "stop is called once");
}

#[test]
fn no_test_while_a_meeting_records_or_is_paused_and_starting_a_meeting_ends_a_test() {
    let r = rig();
    let store = meetings();
    r.recorder.start_with(&store, "m-1", &on(None)).unwrap();
    assert_eq!(r.recorder.start_test(None), Err(MicTestError::Busy));
    r.recorder.pause();
    assert_eq!(r.recorder.start_test(None), Err(MicTestError::Busy));
    r.recorder.stop();

    r.recorder.start_test(Some(ROOM_MIC)).unwrap();
    assert!(r.recorder.test_running());
    r.recorder
        .start_with(&store, "m-1", &on(Some(ROOM_MIC)))
        .unwrap();
    assert!(!r.recorder.test_running());
    // The test's source was closed before the meeting opened the device again.
    assert_eq!(r.devices.counters().starts(), 2);
    assert_eq!(r.devices.counters().stops(), 1);
    r.recorder.stop();
}

#[test]
fn a_device_that_fails_during_the_test_shows_its_reason() {
    let r = rig();
    r.devices.set_connected(&["Built-in Audio"]);
    assert_eq!(
        r.recorder.start_test(Some(ROOM_MIC)),
        Err(MicTestError::Failed {
            reason: Reason::ChosenMicrophoneMissing
        })
    );
    assert_eq!(
        r.events.last_test().unwrap().reason,
        Some(Reason::ChosenMicrophoneMissing)
    );

    let f = rig_full(
        Arc::new(MemoryTranscriptStore::new()),
        FakeAudioDevices::new(&[ROOM_MIC], |_| speech().failing_after(300)),
    );
    let (recorder, events, failing) = (f.recorder, f.events, f.devices);
    recorder.start_test(Some(ROOM_MIC)).unwrap();
    assert!(wait_until(Duration::from_secs(3), || events
        .last_test()
        .is_some_and(|t| t.state == MicTest::Error)));
    assert_eq!(
        events.last_test().unwrap().reason,
        Some(Reason::MicrophoneLost)
    );
    assert_eq!(failing.counters().stops(), 1);
    // Blocked at start.
    let blocked = Arc::new(FakeAudioDevices::new(&[ROOM_MIC], |_| {
        speech().failing_start(AudioError::Blocked)
    }));
    let recorder = recorder.with_devices(blocked);
    assert_eq!(
        recorder.start_test(Some(ROOM_MIC)),
        Err(MicTestError::Failed {
            reason: Reason::MicrophoneBlocked
        })
    );
}

fn walk(root: &std::path::Path) -> Vec<String> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for e in std::fs::read_dir(&dir).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                stack.push(p);
            } else {
                out.push(
                    p.strip_prefix(root)
                        .unwrap()
                        .to_string_lossy()
                        .replace('\\', "/"),
                );
            }
        }
    }
    out.sort();
    out
}
