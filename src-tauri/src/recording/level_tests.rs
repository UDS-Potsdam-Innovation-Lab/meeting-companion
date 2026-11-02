//! Job 007: the level stream for the sound wave, from the capture side.

use std::sync::Mutex;

use super::*;
use crate::crypto::{DataKey, MemoryKeyProvider};
use crate::engines::audio::{
    samples_for_ms, FakeAudioSource, FakeCounters, Pace, Tone, MAX_BUFFER_SAMPLES,
};
use crate::engines::devices::FakeAudioDevices;
use crate::engines::level::LEVEL_STALE;
use crate::engines::stt::{ScriptedSpeechToText, SpeechToText, SttError};
use crate::engines::{FakeSttProvider, SttProvider};
use crate::model::tests::running;
use crate::model::Meeting;
use crate::store::{FileMeetingStore, MeetingStore, MemoryMeetingStore};
use crate::transcript::MemoryTranscriptStore;

#[derive(Default)]
struct Events {
    states: Mutex<Vec<(Instant, CaptureState)>>,
    levels: Mutex<Vec<(Instant, LevelEvent)>>,
    tests: Mutex<Vec<MicTestState>>,
}

impl EventSink for Events {
    fn capture(&self, state: &CaptureState) {
        self.states
            .lock()
            .unwrap()
            .push((Instant::now(), state.clone()));
    }
    fn segment(&self, _event: &SegmentEvent) {}
    fn mic_test(&self, state: &MicTestState) {
        self.tests.lock().unwrap().push(state.clone());
    }
    fn level(&self, event: &LevelEvent) {
        self.levels
            .lock()
            .unwrap()
            .push((Instant::now(), event.clone()));
    }
}

impl Events {
    fn levels(&self) -> Vec<(Instant, LevelEvent)> {
        self.levels.lock().unwrap().clone()
    }
    fn levels_since(&self, t: Instant) -> Vec<(Instant, LevelEvent)> {
        self.levels()
            .into_iter()
            .filter(|(at, _)| *at >= t)
            .collect()
    }
}

/// An engine that blocks 2.5 s on every window, as in 005's AC1.
struct BlockingStt(ScriptedSpeechToText);

impl SpeechToText for BlockingStt {
    fn transcribe(
        &mut self,
        window: &[f32],
        final_pass: bool,
    ) -> Result<Vec<crate::engines::stt::Recognized>, SttError> {
        std::thread::sleep(Duration::from_millis(2_500));
        self.0.transcribe(window, final_pass)
    }
}

struct BlockingProvider;

impl SttProvider for BlockingProvider {
    fn models(&self) -> crate::engines::models::ModelList {
        crate::engines::models::ModelList::default()
    }
    fn load(&self, _id: Option<&str>) -> Result<Box<dyn SpeechToText>, SttError> {
        Ok(Box::new(BlockingStt(ScriptedSpeechToText::demo())))
    }
}

fn quick_stt() -> Box<dyn SttProvider> {
    Box::new(FakeSttProvider {
        make: Box::new(ScriptedSpeechToText::demo),
    })
}

fn consented() -> Meeting {
    let mut m = running();
    m.recording_consent_at = Some(2_000);
    m
}

struct Rig {
    recorder: Recorder,
    events: Arc<Events>,
    meetings: MemoryMeetingStore,
}

fn rig(
    make_source: impl Fn() -> FakeAudioSource + Send + Sync + 'static,
    stt: Box<dyn SttProvider>,
) -> Rig {
    let counters = Arc::new(FakeCounters::default());
    let events = Arc::new(Events::default());
    let recorder = Recorder::new(
        Box::new(move || Box::new(make_source().with_counters(counters.clone()))),
        stt,
        Arc::new(MemoryTranscriptStore::new()),
        events.clone(),
        || 1_000_000,
    );
    let meetings = MemoryMeetingStore::new();
    meetings.save(&consented()).unwrap();
    Rig {
        recorder,
        events,
        meetings,
    }
}

fn wait_until(limit: Duration, mut f: impl FnMut() -> bool) -> bool {
    let start = Instant::now();
    while start.elapsed() < limit {
        if f() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    f()
}

/// On macOS: how long a 20 ms sleep takes, when that is too long for a 25 Hz loop (on average over
/// 50 ms), else `None`. GitHub's macOS arm64 runners (virtual machines) oversleep every short sleep to
/// about 100 ms (job 017, measured on `macos-latest`: 25 ms -> 92-121 ms, 1 ms -> 8-12 ms), so no
/// loop there can send 25 levels per second; the rate and latency checks below then say so and skip.
/// A real Mac and Linux run them in full (on Linux this is always `None`).
fn coarse_timers() -> Option<Duration> {
    static MEASURED: std::sync::OnceLock<Option<Duration>> = std::sync::OnceLock::new();
    *MEASURED.get_or_init(|| {
        if !cfg!(target_os = "macos") {
            return None;
        }
        let start = Instant::now();
        for _ in 0..5 {
            std::thread::sleep(Duration::from_millis(20));
        }
        let mean = start.elapsed() / 5;
        (mean > Duration::from_millis(50)).then_some(mean)
    })
}

/// True (and says why on stderr) when this machine's timers cannot carry the 25 Hz checks of `test`.
fn skip_rate_checks(test: &str) -> bool {
    match coarse_timers() {
        Some(mean) => {
            eprintln!(
                "{test}: rate checks skipped: a 20 ms sleep takes {mean:?} on this machine (coarse timers)"
            );
            true
        }
        None => false,
    }
}

/// Tone, silence, tone, silence … in blocks of 600 ms.
const BLOCK_MS: u64 = 600;
fn tone_and_silence() -> FakeAudioSource {
    FakeAudioSource::new(
        vec![Tone::speech(BLOCK_MS), Tone::silence(BLOCK_MS)],
        Pace::RealTime,
    )
    .repeating()
}

#[test]
fn ac1_the_level_comes_from_the_capture_side_while_the_engine_is_busy() {
    if skip_rate_checks("ac1_the_level_comes_from_the_capture_side_while_the_engine_is_busy") {
        return;
    }
    let r = rig(tone_and_silence, Box::new(BlockingProvider));
    r.recorder.start(&r.meetings, "m-1", None).unwrap();
    // The source pushed its first block during start: script time 0 is no later than this.
    let t0 = Instant::now();
    std::thread::sleep(Duration::from_millis(6_000));
    let end = Instant::now();
    let levels: Vec<_> = r
        .events
        .levels()
        .into_iter()
        .filter(|(at, _)| *at <= end)
        .collect();

    // At least 20 per second on average, never a gap over 100 ms.
    let per_second = levels.len() as f64 / end.duration_since(t0).as_secs_f64();
    assert!(
        per_second >= 20.0,
        "{per_second:.1} level events per second"
    );
    let mut gaps = vec![t0.elapsed().min(levels[0].0.duration_since(t0))];
    gaps.extend(levels.windows(2).map(|w| w[1].0.duration_since(w[0].0)));
    gaps.push(end.duration_since(levels.last().unwrap().0));
    let worst = gaps.iter().max().unwrap();
    assert!(*worst <= Duration::from_millis(100), "gap of {worst:?}");

    // Each carries the meeting id, the level and the peak, nothing else.
    for (_, e) in &levels {
        assert_eq!(e.meeting_id.as_deref(), Some("m-1"));
        assert!((0.0..=1.0).contains(&e.level), "{}", e.level);
        assert!((0.0..=1.0).contains(&e.peak), "{}", e.peak);
        let json = serde_json::to_value(e).unwrap();
        let obj = json.as_object().unwrap();
        let mut keys: Vec<_> = obj.keys().cloned().collect();
        keys.sort();
        assert_eq!(keys, ["level", "meetingId", "peak"]);
        assert!(obj.values().all(|v| !v.is_array()));
    }

    // Followed within 100 ms: over 0.3 in tone blocks, under 0.05 in silence blocks.
    let (mut tone, mut quiet) = (0, 0);
    for (at, e) in &levels {
        let ms = at.duration_since(t0).as_millis() as u64;
        let (block, into) = (ms / BLOCK_MS, ms % BLOCK_MS);
        // 100 ms after a change, and not in the last 20 ms of a block (the next one may be due).
        if !(100..BLOCK_MS - 20).contains(&into) {
            continue;
        }
        if block % 2 == 0 {
            tone += 1;
            assert!(e.level > 0.3, "tone block {block} at {ms} ms: {}", e.level);
        } else {
            quiet += 1;
            assert!(
                e.level < 0.05,
                "silent block {block} at {ms} ms: {}",
                e.level
            );
        }
    }
    assert!(tone >= 40 && quiet >= 40, "{tone} {quiet}");

    // Same scale as the 200 ms tick: the speech tone's scaled RMS (0.3 / √2 × 4).
    let top = levels.iter().map(|(_, e)| e.level).fold(0.0, f32::max);
    assert!((top - 0.3 / 2f32.sqrt() * 4.0).abs() < 0.02, "{top}");
    // The tick still comes, with its level field.
    let ticks = r
        .events
        .states
        .lock()
        .unwrap()
        .iter()
        .filter(|(_, s)| s.state == Capture::Recording)
        .count();
    assert!(ticks >= 20, "{ticks}");
    r.recorder.stop();
}

/// The level events after `t`: they ended within 100 ms of `t` and the last one says 0.
fn assert_stopped_after(events: &Events, t: Instant) {
    std::thread::sleep(Duration::from_millis(400));
    let after = events.levels_since(t);
    if let Some((last_at, last)) = after.last() {
        assert!(
            last_at.duration_since(t) <= Duration::from_millis(100),
            "a level event {:?} after",
            last_at.duration_since(t)
        );
        assert_eq!(last.level, 0.0);
        assert_eq!(last.peak, 0.0);
    } else {
        let before = events.levels();
        assert_eq!(before.last().unwrap().1.level, 0.0);
    }
}

#[test]
fn ac2_pause_and_stop_end_the_stream_with_level_0_and_resume_starts_it_again() {
    if skip_rate_checks("ac2_pause_and_stop_end_the_stream_with_level_0_and_resume_starts_it_again")
    {
        return;
    }
    let r = rig(tone_and_silence, quick_stt());
    r.recorder.start(&r.meetings, "m-1", None).unwrap();
    assert!(wait_until(Duration::from_secs(2), || r
        .events
        .levels()
        .iter()
        .any(|(_, e)| e.level > 0.3)));

    let t = Instant::now();
    assert_eq!(r.recorder.pause().state, Capture::Paused);
    assert_stopped_after(&r.events, t);
    let quiet = Instant::now();
    std::thread::sleep(Duration::from_millis(300));
    assert!(r.events.levels_since(quiet).is_empty());

    // Resume: they come again.
    r.recorder.start(&r.meetings, "m-1", None).unwrap();
    let resumed = Instant::now();
    assert!(wait_until(Duration::from_secs(1), || r
        .events
        .levels_since(resumed)
        .len()
        >= 5));

    let t = Instant::now();
    assert_eq!(r.recorder.stop().state, Capture::Off);
    assert_stopped_after(&r.events, t);

    // End of meeting.
    r.recorder.start(&r.meetings, "m-1", None).unwrap();
    assert!(wait_until(Duration::from_secs(1), || r
        .events
        .levels_since(t)
        .len()
        >= 5));
    let t = Instant::now();
    r.recorder.stop_meeting("m-1");
    assert_stopped_after(&r.events, t);
}

#[test]
fn ac2_a_silent_device_stops_the_stream_before_it_counts_as_lost() {
    // Fast pace: 1 s of audio at once, then nothing at all (as in 005).
    let r = rig(
        || FakeAudioSource::new(vec![Tone::speech(1_000)], Pace::Fast),
        quick_stt(),
    );
    r.recorder.start(&r.meetings, "m-1", None).unwrap();
    let started = Instant::now();
    assert!(wait_until(Duration::from_secs(3), || r
        .recorder
        .status()
        .state
        == Capture::Error));
    assert_eq!(r.recorder.status().reason, Some(Reason::MicrophoneLost));
    let levels = r.events.levels();
    let (last_at, last) = levels.last().unwrap();
    assert_eq!(last.level, 0.0);
    // Stopped once samples stayed away (250 ms), long before the device counts as lost.
    assert!(last_at.duration_since(started) < LEVEL_STALE + Duration::from_millis(150));
    let lost_at = r
        .events
        .states
        .lock()
        .unwrap()
        .iter()
        .find(|(_, s)| s.state == Capture::Error)
        .unwrap()
        .0;
    assert!(*last_at < lost_at);
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(r.events.levels().len(), levels.len());
}

#[test]
fn ac2_a_failing_device_stops_the_stream_and_is_reported_as_before() {
    if skip_rate_checks("ac2_a_failing_device_stops_the_stream_and_is_reported_as_before") {
        return;
    }
    let r = rig(
        || tone_and_silence().failing_after(700),
        Box::new(BlockingProvider),
    );
    let started = Instant::now();
    r.recorder.start(&r.meetings, "m-1", None).unwrap();
    assert!(wait_until(Duration::from_secs(4), || r
        .recorder
        .status()
        .state
        == Capture::Error));
    assert_eq!(r.recorder.status().reason, Some(Reason::MicrophoneLost));
    let levels = r.events.levels();
    assert!(levels.len() >= 10, "{}", levels.len());
    let (last_at, last) = levels.last().unwrap();
    assert_eq!(last.level, 0.0);
    // The failure comes at 700 ms of audio; the stream ends right there.
    assert!(last_at.duration_since(started) < Duration::from_millis(700 + 150));
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(r.events.levels().len(), levels.len());
    r.recorder.stop();
}

#[test]
fn ac3_a_full_30_s_sink_still_keeps_up_with_real_time() {
    let sink = AudioSink::new();
    sink.push(&vec![0.1; MAX_BUFFER_SAMPLES]);
    assert_eq!(sink.len(), MAX_BUFFER_SAMPLES);
    // 30 s of audio in 10 ms blocks (a device callback's size), each one dropping the oldest.
    let block = vec![0.2f32; samples_for_ms(10)];
    let started = Instant::now();
    for _ in 0..3_000 {
        sink.push(&block);
    }
    let took = started.elapsed();
    assert!(took < Duration::from_secs(3), "30 s of audio took {took:?}");
    assert_eq!(sink.len(), MAX_BUFFER_SAMPLES);
    assert!((sink.level().level - 0.8).abs() < 1e-3);
}

#[test]
fn ac6_the_microphone_test_sends_the_level_at_the_recording_rate_and_keeps_nothing() {
    if skip_rate_checks(
        "ac6_the_microphone_test_sends_the_level_at_the_recording_rate_and_keeps_nothing",
    ) {
        return;
    }
    let events = Arc::new(Events::default());
    let devices = Arc::new(FakeAudioDevices::new(&["Room mic"], |_| tone_and_silence()));
    let stats_stt = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let loads = stats_stt.clone();
    struct Counting(Arc<std::sync::atomic::AtomicUsize>);
    impl SttProvider for Counting {
        fn models(&self) -> crate::engines::models::ModelList {
            crate::engines::models::ModelList::default()
        }
        fn load(&self, _id: Option<&str>) -> Result<Box<dyn SpeechToText>, SttError> {
            self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(Box::new(ScriptedSpeechToText::demo()))
        }
    }
    let recorder = Recorder::new(
        Box::new(|| Box::new(tone_and_silence())),
        Box::new(Counting(loads)),
        Arc::new(MemoryTranscriptStore::new()),
        events.clone(),
        || 1_000_000,
    )
    .with_devices(devices.clone());
    recorder.start_test(Some("Room mic")).unwrap();
    let t0 = Instant::now();
    std::thread::sleep(Duration::from_millis(2_000));
    let end = Instant::now();
    let levels: Vec<_> = events
        .levels()
        .into_iter()
        .filter(|(at, _)| *at <= end)
        .collect();
    let per_second = levels.len() as f64 / end.duration_since(t0).as_secs_f64();
    assert!(per_second >= 20.0, "{per_second:.1}");
    for w in levels.windows(2) {
        assert!(w[1].0.duration_since(w[0].0) <= Duration::from_millis(100));
    }
    assert!(levels.iter().all(|(_, e)| e.meeting_id.is_none()));
    assert!(levels.iter().any(|(_, e)| e.level > 0.3));
    let t = Instant::now();
    recorder.stop_test();
    assert_stopped_after(&events, t);
    assert_eq!(devices.counters().starts(), 1);
    assert_eq!(devices.counters().stops(), 1);
    assert_eq!(stats_stt.load(std::sync::atomic::Ordering::SeqCst), 0);
    // The countdown state still comes, less often than the level.
    let tests = events.tests.lock().unwrap().len();
    assert!(tests >= 5 && tests < levels.len() / 2, "{tests}");
}

#[test]
fn ac7_level_values_are_neither_logged_nor_stored() {
    crate::log::capture();
    let dir = tempfile::tempdir().unwrap();
    let keys = MemoryKeyProvider::with_key(DataKey::generate());
    let store = FileMeetingStore::open(dir.path().join("meetings"), &keys).unwrap();
    store.save(&consented()).unwrap();
    let transcripts: Arc<dyn TranscriptStore> = Arc::new(store.transcripts());
    let events = Arc::new(Events::default());
    let recorder = Recorder::new(
        Box::new(|| Box::new(tone_and_silence())),
        quick_stt(),
        transcripts,
        events.clone(),
        || 1_000_000,
    );
    recorder.start(&store, "m-1", None).unwrap();
    std::thread::sleep(Duration::from_millis(1_500));
    recorder.pause();
    recorder.start(&store, "m-1", None).unwrap();
    std::thread::sleep(Duration::from_millis(500));
    recorder.stop();
    let failing = Recorder::new(
        Box::new(|| Box::new(tone_and_silence().failing_after(500))),
        quick_stt(),
        Arc::new(store.transcripts()),
        events.clone(),
        || 1_000_000,
    );
    failing.start(&store, "m-1", None).unwrap();
    assert!(wait_until(Duration::from_secs(4), || failing
        .status()
        .state
        == Capture::Error));
    drop(failing);
    let logs = crate::log::take_captured();

    let levels = events.levels();
    // About 2 s of levels at 25 per second; at the coarse timers' rate (see above) still well over 10.
    let expected = if coarse_timers().is_some() { 10 } else { 40 };
    assert!(levels.len() >= expected, "{}", levels.len());
    let values: Vec<String> = levels
        .iter()
        .flat_map(|(_, e)| [e.level, e.peak])
        .filter(|v| *v > 0.0)
        .flat_map(|v| [format!("{v}"), format!("{v:.2}"), format!("{v:.3}")])
        .collect();
    for line in &logs {
        assert!(!line.to_lowercase().contains("level"), "{line}");
        for v in &values {
            assert!(!line.contains(v.as_str()), "level {v} in the log: {line}");
        }
    }
    let mut names = walk(dir.path());
    names.sort();
    assert_eq!(names, ["meetings/m-1.meeting", "meetings/m-1.transcript"]);
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
    out
}
