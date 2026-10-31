//! A stop is bounded (job 008): engines that block forever or panic, behind `SpeechToText` and
//! `Diarizer`. No models, microphone or network.

use std::sync::atomic::AtomicUsize;
use std::sync::Condvar;

use super::*;
use crate::engines::diarize::{DiarizeError, Diarizer};
use crate::engines::DiarizerProvider;

/// The longest a stop may take (AC3).
const BOUND: Duration = Duration::from_secs(2);

/// Lets every waiter through once opened. A test that never opens it leaves the engine stuck for
/// good, as a hung native engine would be.
#[derive(Clone, Default)]
struct Gate(Arc<(Mutex<bool>, Condvar)>);

impl Gate {
    fn wait(&self) {
        let (open, cv) = &*self.0;
        let mut open = open.lock().unwrap();
        while !*open {
            open = cv.wait(open).unwrap();
        }
    }
    fn open(&self) {
        let (open, cv) = &*self.0;
        *open.lock().unwrap() = true;
        cv.notify_all();
    }
}

/// What a stuck engine does once it is told to: block until the gate opens, or panic.
#[derive(Clone, Copy, PartialEq)]
enum Fault {
    Block,
    Panic,
}

/// Shared switches for a test's engines.
#[derive(Clone)]
struct Trap {
    fault: Fault,
    /// Set by the test: the engine's next call fails as `fault` says.
    armed: Arc<AtomicBool>,
    /// Set by the engine once it is inside the faulty call.
    caught: Arc<AtomicBool>,
    gate: Gate,
}

impl Trap {
    fn new(fault: Fault) -> Self {
        Self {
            fault,
            armed: Arc::default(),
            caught: Arc::default(),
            gate: Gate::default(),
        }
    }
    fn arm(&self) {
        self.armed.store(true, Ordering::SeqCst);
    }
    fn spring(&self) {
        if !self.armed.load(Ordering::SeqCst) {
            return;
        }
        self.caught.store(true, Ordering::SeqCst);
        match self.fault {
            Fault::Block => self.gate.wait(),
            Fault::Panic => panic!("the fake engine panicked"),
        }
    }
    fn caught(&self) -> bool {
        self.caught.load(Ordering::SeqCst)
    }
}

/// The scripted speech engine, until its trap is armed.
struct TrappedStt {
    inner: ScriptedSpeechToText,
    trap: Option<Trap>,
}

impl SpeechToText for TrappedStt {
    fn transcribe(
        &mut self,
        window: &[f32],
        final_pass: bool,
    ) -> Result<Vec<crate::engines::stt::Recognized>, SttError> {
        if let Some(trap) = &self.trap {
            trap.spring();
        }
        self.inner.transcribe(window, final_pass)
    }
}

/// The first engine it loads carries the trap; every later one is a fresh, working engine.
struct TrappedSttProvider {
    trap: Trap,
    loads: Arc<AtomicUsize>,
}

impl SttProvider for TrappedSttProvider {
    fn models(&self) -> crate::engines::models::ModelList {
        FakeSttProvider {
            make: Box::new(script),
        }
        .models()
    }
    fn load(&self, _id: Option<&str>) -> Result<Box<dyn SpeechToText>, SttError> {
        let first = self.loads.fetch_add(1, Ordering::SeqCst) == 0;
        Ok(Box::new(TrappedStt {
            inner: script(),
            trap: first.then(|| self.trap.clone()),
        }))
    }
}

/// The scripted diarizer; from its call number `from` on, the trap is armed.
struct TrappedDiarizer {
    inner: ScriptedDiarizer,
    calls: usize,
    from: usize,
    trap: Trap,
}

impl Diarizer for TrappedDiarizer {
    fn embed(&mut self, audio: &[f32]) -> Result<Option<Vec<f32>>, DiarizeError> {
        self.calls += 1;
        if self.calls > self.from {
            self.trap.arm();
            self.trap.spring();
        }
        self.inner.embed(audio)
    }
}

struct TrappedDiarizerProvider {
    trap: Trap,
    from: usize,
}

impl DiarizerProvider for TrappedDiarizerProvider {
    fn models(&self) -> crate::engines::models::SpeakerModelList {
        crate::engines::models::SpeakerModelList::default()
    }
    fn load(&self, _id: Option<&str>) -> Result<Box<dyn Diarizer>, DiarizeError> {
        Ok(Box::new(TrappedDiarizer {
            inner: ScriptedDiarizer::new(vec![0, 1, 2]),
            calls: 0,
            from: self.from,
            trap: self.trap.clone(),
        }))
    }
}

fn trapped_stt(trap: &Trap) -> (Box<TrappedSttProvider>, Arc<AtomicUsize>) {
    let loads = Arc::new(AtomicUsize::new(0));
    (
        Box::new(TrappedSttProvider {
            trap: trap.clone(),
            loads: loads.clone(),
        }),
        loads,
    )
}

/// The final segments sent to the UI, as (seq, text).
fn sent(events: &Events) -> Vec<(u64, String)> {
    events
        .final_events()
        .into_iter()
        .map(|(_, e)| (e.seq.unwrap(), e.segment.text))
        .collect()
}

/// The stored segments, as (seq, text).
fn stored(transcripts: &dyn TranscriptStore, id: &str) -> Vec<(u64, String)> {
    transcripts
        .load(id)
        .unwrap()
        .into_iter()
        .enumerate()
        .map(|(i, s)| (i as u64, s.text))
        .collect()
}

/// Stops and checks AC3: back within 2 s, the state is `off` and the microphone is closed.
fn stop_in_time(counters: &FakeCounters, recorder: &Recorder) -> CaptureState {
    let started = Instant::now();
    let state = recorder.stop();
    let took = started.elapsed();
    assert!(took < BOUND, "stop took {took:?}");
    assert_eq!(state.state, Capture::Off);
    assert_eq!(recorder.status().state, Capture::Off);
    assert!(counters.starts() >= 1);
    assert_eq!(
        counters.stops(),
        counters.starts(),
        "every source opened is closed when stop returns"
    );
    state
}

/// After a stuck worker is let go: it stores nothing more for the meeting and sends no segment,
/// voice or state for it (AC4).
fn nothing_more_after(events: &Events, transcripts: &dyn TranscriptStore, trap: &Trap) {
    let stored_then = stored(transcripts, "m-1");
    let segments_then = events.segments.lock().unwrap().len();
    let voices_then = events.voices().len();
    let states_then = events.states.lock().unwrap().len();
    trap.gate.open();
    std::thread::sleep(Duration::from_millis(800));
    assert_eq!(stored(transcripts, "m-1"), stored_then);
    assert_eq!(events.segments.lock().unwrap().len(), segments_then);
    assert_eq!(events.voices().len(), voices_then);
    assert_eq!(events.states.lock().unwrap().len(), states_then);
    assert_eq!(events.last_state().state, Capture::Off);
}

#[test]
fn stop_returns_within_2_s_when_the_speech_engine_blocks_forever_and_keeps_every_final_line() {
    let trap = Trap::new(Fault::Block);
    let (provider, _) = trapped_stt(&trap);
    let rig = rig_with(|| talking().repeating(), provider);
    rig.meetings.save(&consented()).unwrap();
    rig.recorder.start(&rig.meetings, "m-1", None).unwrap();
    assert!(wait_until(Duration::from_secs(8), || rig
        .events
        .finals()
        .len()
        >= 2));
    trap.arm();
    // Audio keeps coming: the engine blocks on the queued audio.
    assert!(wait_until(Duration::from_secs(4), || trap.caught()));
    let before = sent(&rig.events);

    stop_in_time(&rig.counters, &rig.recorder);
    // Every final line the UI got is stored, in order, with its sequence number.
    assert!(before.len() >= 2);
    assert_eq!(sent(&rig.events), before);
    assert_eq!(stored(rig.transcripts.as_ref(), "m-1"), before);
    nothing_more_after(&rig.events, rig.transcripts.as_ref(), &trap);
}

#[test]
fn stop_returns_within_2_s_when_the_diarizer_blocks_forever_and_stores_lines_without_voice() {
    let trap = Trap::new(Fault::Block);
    let rig = rig_with(three_turns, fake_stt());
    // The first voice is worked out; the second call blocks for good.
    let recorder = rig
        .recorder
        .with_diarizer(Box::new(TrappedDiarizerProvider {
            trap: trap.clone(),
            from: 1,
        }));
    rig.meetings.save(&consented()).unwrap();
    recorder.start(&rig.meetings, "m-1", None).unwrap();
    assert!(wait_until(Duration::from_secs(8), || rig
        .events
        .finals()
        .len()
        >= 3));
    assert!(trap.caught());
    let before = sent(&rig.events);

    stop_in_time(&rig.counters, &recorder);
    assert_eq!(before.len(), 3);
    assert_eq!(stored(rig.transcripts.as_ref(), "m-1"), before);
    // A line whose voice is not known yet is stored without one.
    assert_eq!(
        stored_voices(rig.transcripts.as_ref()),
        [Some('A'), None, None]
    );
    assert_eq!(rig.events.voices(), [(0, voice('A'))]);
    assert!(!recorder.holds_voices());
    nothing_more_after(&rig.events, rig.transcripts.as_ref(), &trap);
}

#[test]
fn stop_returns_within_2_s_after_the_speech_engine_panicked_and_a_fresh_one_records_next() {
    let trap = Trap::new(Fault::Panic);
    let (provider, loads) = trapped_stt(&trap);
    let rig = rig_with(|| talking().repeating(), provider);
    rig.meetings.save(&consented()).unwrap();
    rig.recorder.start(&rig.meetings, "m-1", None).unwrap();
    assert!(wait_until(Duration::from_secs(8), || !rig
        .events
        .finals()
        .is_empty()));
    trap.arm();
    assert!(wait_until(Duration::from_secs(4), || trap.caught()));
    // The panic ends the session with an error, and the microphone is closed.
    assert!(wait_until(Duration::from_secs(2), || rig
        .recorder
        .status()
        .state
        == Capture::Error));
    assert_eq!(rig.recorder.status().reason, Some(Reason::EngineFailed));
    assert_eq!(rig.counters.stops(), rig.counters.starts());
    let before = sent(&rig.events);

    stop_in_time(&rig.counters, &rig.recorder);
    assert_eq!(stored(rig.transcripts.as_ref(), "m-1"), before);
    // The engine that panicked is not reused.
    rig.recorder.start(&rig.meetings, "m-1", None).unwrap();
    assert_eq!(loads.load(Ordering::SeqCst), 2);
    assert!(wait_until(Duration::from_secs(8), || rig
        .events
        .finals()
        .len()
        > before.len()));
    stop_in_time(&rig.counters, &rig.recorder);
}

#[test]
fn stop_returns_within_2_s_after_the_diarizer_panicked() {
    let trap = Trap::new(Fault::Panic);
    let rig = rig_with(three_turns, fake_stt());
    let recorder = rig
        .recorder
        .with_diarizer(Box::new(TrappedDiarizerProvider {
            trap: trap.clone(),
            from: 1,
        }));
    rig.meetings.save(&consented()).unwrap();
    recorder.start(&rig.meetings, "m-1", None).unwrap();
    assert!(wait_until(Duration::from_secs(8), || rig
        .events
        .finals()
        .len()
        >= 2));
    assert!(wait_until(Duration::from_secs(2), || trap.caught()));
    let before = sent(&rig.events);

    stop_in_time(&rig.counters, &recorder);
    // Recording itself went on without voices.
    assert_eq!(stored(rig.transcripts.as_ref(), "m-1"), before);
    let voices = stored_voices(rig.transcripts.as_ref());
    assert_eq!(voices[0], Some('A'));
    assert!(voices[1..].iter().all(Option::is_none));
}

#[test]
fn a_stuck_stop_blocks_neither_saving_the_ended_meeting_nor_the_status_nor_the_next_recording() {
    let trap = Trap::new(Fault::Block);
    let (provider, loads) = trapped_stt(&trap);
    let rig = rig_with(|| talking().repeating(), provider);
    let edits = Mutex::new(());
    rig.meetings.save(&consented()).unwrap();
    let mut next = consented();
    next.id = "m-2".into();
    rig.meetings.save(&next).unwrap();
    rig.recorder.start(&rig.meetings, "m-1", None).unwrap();
    assert!(wait_until(Duration::from_secs(8), || !rig
        .events
        .finals()
        .is_empty()));
    trap.arm();
    assert!(wait_until(Duration::from_secs(4), || trap.caught()));

    let mut ended = consented();
    let run = ended.run.as_mut().unwrap();
    run.ended_at = Some(400_000);
    run.items[1].ended_at = Some(400_000);
    std::thread::scope(|scope| {
        // "End meeting": the UI asks for the stop and saves the ended run without waiting for it.
        let stopping = scope.spawn(|| rig.recorder.stop());
        std::thread::sleep(Duration::from_millis(100));
        assert!(
            !stopping.is_finished(),
            "the stop is still waiting for the worker"
        );
        // `recording_status` answers while the stop runs.
        let asked = Instant::now();
        let status = rig.recorder.status();
        assert!(asked.elapsed() < Duration::from_millis(100));
        assert_eq!(status.meeting_id.as_deref(), Some("m-1"));
        // `save_meeting` for the ended run returns within 2 s.
        let saving = Instant::now();
        crate::save_from_ui(
            &rig.meetings,
            &rig.recorder,
            &crate::phone_view::tests::idle(),
            &edits,
            ended,
            500_000,
        )
        .unwrap();
        let took = saving.elapsed();
        assert!(took < BOUND, "save took {took:?}");
        assert_eq!(stopping.join().unwrap().state, Capture::Off);
    });
    let saved = rig.meetings.load("m-1").unwrap().unwrap();
    assert_eq!(saved.run.unwrap().ended_at, Some(400_000));
    assert_eq!(rig.recorder.status().state, Capture::Off);
    assert_eq!(rig.counters.stops(), rig.counters.starts());

    // The new meeting records with a fresh engine while the old worker still hangs.
    let finals_before = rig.events.finals().len();
    let state = rig.recorder.start(&rig.meetings, "m-2", None).unwrap();
    assert_eq!(state.state, Capture::Recording);
    assert_eq!(loads.load(Ordering::SeqCst), 2);
    assert!(wait_until(Duration::from_secs(8), || rig
        .events
        .final_events()
        .iter()
        .skip(finals_before)
        .any(|(_, e)| e.meeting_id == "m-2")));
    stop_in_time(&rig.counters, &rig.recorder);
    assert!(!rig.transcripts.load("m-2").unwrap().is_empty());
}

#[test]
fn saves_from_the_ui_still_validate_agenda_free_meetings_and_end_them_with_their_topics() {
    let rig = rig_with(talking, fake_stt());
    let edits = Mutex::new(());
    let free = crate::model::tests::free_running();
    crate::save_from_ui(
        &rig.meetings,
        &rig.recorder,
        &crate::phone_view::tests::idle(),
        &edits,
        free.clone(),
        10,
    )
    .unwrap();

    let mut bad = free.clone();
    bad.mode = Some("auto".into());
    match crate::save_from_ui(
        &rig.meetings,
        &rig.recorder,
        &crate::phone_view::tests::idle(),
        &edits,
        bad,
        11,
    ) {
        Err(crate::SaveError::Invalid { fields }) => assert_eq!(fields[0].field, "mode"),
        other => panic!("expected Invalid, got {other:?}"),
    }
    let mut two_open = free.clone();
    two_open.run.as_mut().unwrap().topics[0].spans[0].ended_at = None;
    match crate::save_from_ui(
        &rig.meetings,
        &rig.recorder,
        &crate::phone_view::tests::idle(),
        &edits,
        two_open,
        12,
    ) {
        Err(crate::SaveError::Invalid { fields }) => assert_eq!(fields[0].field, "run.topics"),
        other => panic!("expected Invalid, got {other:?}"),
    }

    // "End meeting" in free mode: the ended run with the open span closed is saved.
    let mut ended = free;
    let run = ended.run.as_mut().unwrap();
    run.ended_at = Some(100_000);
    run.topics[1].spans[0].ended_at = Some(100_000);
    crate::save_from_ui(
        &rig.meetings,
        &rig.recorder,
        &crate::phone_view::tests::idle(),
        &edits,
        ended.clone(),
        13,
    )
    .unwrap();
    let saved = rig.meetings.load("m-1").unwrap().unwrap();
    assert_eq!(saved.run, ended.run);
    assert!(saved.is_free());
}
