use std::sync::Mutex;

use super::*;
use crate::crypto::{DataKey, MemoryKeyProvider};
use crate::engines::audio::{FakeAudioSource, FakeCounters, Pace, Tone};
use crate::engines::stt::{Lang, ScriptedSpeechToText, SpeechToText, SttError};
use crate::engines::SttProvider;
use crate::engines::{FakeSttProvider, NoModelProvider};
use crate::model::tests::running;
use crate::model::Meeting;
use crate::store::{FileMeetingStore, MemoryMeetingStore};
use crate::transcript::{FileTranscriptStore, MemoryTranscriptStore};

/// Collects events; on every voice event it checks the segment is already stored with that voice.
struct Events {
    states: Mutex<Vec<(Instant, CaptureState)>>,
    segments: Mutex<Vec<(Instant, SegmentEvent)>>,
    voices: Mutex<Vec<(Instant, VoiceEvent)>>,
    store: Option<Arc<dyn TranscriptStore>>,
    stored_before_sent: Mutex<bool>,
}

impl Events {
    fn new(store: Option<Arc<dyn TranscriptStore>>) -> Arc<Self> {
        Arc::new(Self {
            states: Mutex::new(Vec::new()),
            segments: Mutex::new(Vec::new()),
            voices: Mutex::new(Vec::new()),
            store,
            stored_before_sent: Mutex::new(true),
        })
    }
    fn segments(&self) -> Vec<Segment> {
        self.segments
            .lock()
            .unwrap()
            .iter()
            .map(|(_, e)| e.segment.clone())
            .collect()
    }
    fn finals(&self) -> Vec<Segment> {
        self.segments().into_iter().filter(|s| s.is_final).collect()
    }
    fn first_partial_at(&self) -> Option<Instant> {
        self.segments
            .lock()
            .unwrap()
            .iter()
            .find(|(_, e)| !e.segment.is_final)
            .map(|(t, _)| *t)
    }
    fn last_state(&self) -> CaptureState {
        self.states.lock().unwrap().last().unwrap().1.clone()
    }
}

impl EventSink for Events {
    fn capture(&self, state: &CaptureState) {
        self.states
            .lock()
            .unwrap()
            .push((Instant::now(), state.clone()));
    }
    fn segment(&self, event: &SegmentEvent) {
        self.segments
            .lock()
            .unwrap()
            .push((Instant::now(), event.clone()));
    }
    fn voice(&self, event: &VoiceEvent) {
        if let Some(store) = &self.store {
            let stored = store.load(&event.meeting_id).unwrap();
            if stored.get(event.seq as usize).and_then(|s| s.voice) != Some(event.voice) {
                *self.stored_before_sent.lock().unwrap() = false;
            }
        }
        self.voices
            .lock()
            .unwrap()
            .push((Instant::now(), event.clone()));
    }
}

const MARKER: &str = "Zebra-Quokka-7731";

fn script() -> ScriptedSpeechToText {
    ScriptedSpeechToText::new(vec![
        (
            format!("Wir verschieben den Offline-Modus {MARKER}."),
            Lang::De,
        ),
        (
            "We keep the fourteenth as the launch date.".into(),
            Lang::En,
        ),
    ])
}

fn fake_stt() -> Box<FakeSttProvider> {
    Box::new(FakeSttProvider {
        make: Box::new(script),
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
    counters: Arc<FakeCounters>,
    meetings: MemoryMeetingStore,
    transcripts: Arc<dyn TranscriptStore>,
}

fn rig_with(
    make_source: impl Fn() -> FakeAudioSource + Send + Sync + 'static,
    stt: Box<dyn SttProvider>,
) -> Rig {
    let counters = Arc::new(FakeCounters::default());
    let c = counters.clone();
    let transcripts: Arc<dyn TranscriptStore> = Arc::new(MemoryTranscriptStore::new());
    let events = Events::new(Some(transcripts.clone()));
    let recorder = Recorder::new(
        Box::new(move || Box::new(make_source().with_counters(c.clone()))),
        stt,
        transcripts.clone(),
        events.clone(),
        || 1_000_000,
    );
    Rig {
        recorder,
        events,
        counters,
        meetings: MemoryMeetingStore::new(),
        transcripts,
    }
}

/// 0.5 s quiet, then speech and pauses, in real time; then silence (an open, quiet room).
fn talking() -> FakeAudioSource {
    FakeAudioSource::new(
        vec![
            Tone::silence(500),
            Tone::speech(1_800),
            Tone::silence(800),
            Tone::speech(1_500),
            Tone::silence(800),
        ],
        Pace::RealTime,
    )
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

#[test]
fn no_audio_source_starts_before_consent_and_one_starts_after() {
    let rig = rig_with(talking, fake_stt());
    let mut m = running();
    rig.meetings.save(&m).unwrap();
    assert_eq!(rig.counters.starts(), 0);
    // The UI cannot skip the gate: start without stored consent is refused.
    assert_eq!(
        rig.recorder.start(&rig.meetings, "m-1", None),
        Err(RecordError::NoConsent)
    );
    assert_eq!(rig.counters.starts(), 0);
    assert_eq!(rig.recorder.status().state, Capture::Off);

    m.recording_consent_at = Some(5_000);
    rig.meetings.save(&m).unwrap();
    let state = rig.recorder.start(&rig.meetings, "m-1", None).unwrap();
    assert_eq!(state.state, Capture::Recording);
    assert_eq!(rig.counters.starts(), 1);
    // Starting again while recording does not open the microphone twice.
    rig.recorder.start(&rig.meetings, "m-1", None).unwrap();
    assert_eq!(rig.counters.starts(), 1);
    rig.recorder.stop();
    assert_eq!(rig.counters.stops(), 1);
}

#[test]
fn a_meeting_that_is_not_running_or_unknown_is_refused() {
    let rig = rig_with(talking, fake_stt());
    assert_eq!(
        rig.recorder.start(&rig.meetings, "m-1", None),
        Err(RecordError::NoMeeting)
    );
    let mut m = consented();
    m.run.as_mut().unwrap().items[1].ended_at = Some(400_000);
    m.run.as_mut().unwrap().ended_at = Some(400_000);
    rig.meetings.save(&m).unwrap();
    assert_eq!(
        rig.recorder.start(&rig.meetings, "m-1", None),
        Err(RecordError::NotRunning)
    );
    assert_eq!(rig.counters.starts(), 0);
}

#[test]
fn without_a_speech_model_the_microphone_is_not_opened_and_the_reason_is_shown() {
    let rig = rig_with(
        talking,
        Box::new(NoModelProvider {
            searched: vec!["/x/models".into()],
        }),
    );
    rig.meetings.save(&consented()).unwrap();
    assert_eq!(
        rig.recorder.start(&rig.meetings, "m-1", None),
        Err(RecordError::Failed {
            reason: Reason::NoModel
        })
    );
    assert_eq!(rig.counters.starts(), 0);
    let s = rig.recorder.status();
    assert_eq!((s.state, s.reason), (Capture::Error, Some(Reason::NoModel)));
}

#[test]
fn no_microphone_or_a_blocked_one_is_reported_as_the_reason() {
    for (err, reason) in [
        (AudioError::NoMicrophone, Reason::NoMicrophone),
        (AudioError::Blocked, Reason::MicrophoneBlocked),
    ] {
        let rig = rig_with(move || talking().failing_start(err), fake_stt());
        rig.meetings.save(&consented()).unwrap();
        assert_eq!(
            rig.recorder.start(&rig.meetings, "m-1", None),
            Err(RecordError::Failed { reason })
        );
        assert_eq!(rig.events.last_state().state, Capture::Error);
        assert_eq!(rig.events.last_state().reason, Some(reason));
    }
}

#[test]
fn a_device_that_fails_mid_meeting_leaves_the_recording_state_within_2_s() {
    let rig = rig_with(|| talking().repeating().failing_after(700), fake_stt());
    rig.meetings.save(&consented()).unwrap();
    let started = Instant::now();
    rig.recorder.start(&rig.meetings, "m-1", None).unwrap();
    assert!(wait_until(Duration::from_secs(4), || rig
        .recorder
        .status()
        .state
        == Capture::Error));
    let failed_at = rig
        .events
        .states
        .lock()
        .unwrap()
        .iter()
        .find(|(_, s)| s.state == Capture::Error)
        .map(|(t, _)| *t)
        .unwrap();
    // The fake fails after 700 ms of audio; the error state follows well within 2 s.
    assert!(failed_at.duration_since(started) < Duration::from_millis(700 + 2_000));
    assert_eq!(rig.recorder.status().reason, Some(Reason::MicrophoneLost));
    // The source was closed.
    assert_eq!(rig.counters.stops(), 1);
    // "Resume recording" starts a new session without asking for consent again.
    assert!(rig.recorder.start(&rig.meetings, "m-1", None).is_ok());
    assert_eq!(rig.counters.starts(), 2);
    rig.recorder.stop();
}

#[test]
fn a_device_that_goes_silent_without_an_error_counts_as_lost() {
    // Fast pace: the script ends after 1 s and the fake stops delivering anything at all.
    let rig = rig_with(
        || FakeAudioSource::new(vec![Tone::speech(1_000)], Pace::Fast),
        fake_stt(),
    );
    rig.meetings.save(&consented()).unwrap();
    rig.recorder.start(&rig.meetings, "m-1", None).unwrap();
    assert!(wait_until(Duration::from_secs(3), || rig
        .recorder
        .status()
        .state
        == Capture::Error));
    assert_eq!(rig.recorder.status().reason, Some(Reason::MicrophoneLost));
    // The utterance that was cut off was still finished and stored.
    assert_eq!(rig.transcripts.load("m-1").unwrap().len(), 1);
}

#[test]
fn pause_closes_the_microphone_freezes_the_time_and_resume_continues() {
    let rig = rig_with(talking, fake_stt());
    rig.meetings.save(&consented()).unwrap();
    rig.recorder.start(&rig.meetings, "m-1", None).unwrap();
    // The first partial reaches the UI event within 3 s of the scripted speech start (0.5 s).
    let started = Instant::now();
    assert!(wait_until(Duration::from_secs(4), || rig
        .events
        .first_partial_at()
        .is_some()));
    let first = rig.events.first_partial_at().unwrap();
    assert!(
        first.duration_since(started) <= Duration::from_millis(500 + 3_000),
        "first partial after {:?}",
        first.duration_since(started)
    );
    assert!(wait_until(Duration::from_secs(5), || rig
        .events
        .finals()
        .len()
        >= 2));

    let paused = rig.recorder.pause();
    assert_eq!(paused.state, Capture::Paused);
    assert_eq!(rig.counters.stops(), 1);
    let frozen = paused.elapsed_ms;
    assert!(frozen >= 3_000, "{frozen}");
    std::thread::sleep(Duration::from_millis(500));
    assert_eq!(rig.recorder.status().elapsed_ms, frozen);
    assert_eq!(rig.recorder.status().state, Capture::Paused);

    let resumed = rig.recorder.start(&rig.meetings, "m-1", None).unwrap();
    assert_eq!(resumed.state, Capture::Recording);
    assert_eq!(resumed.elapsed_ms, frozen);
    assert_eq!(rig.counters.starts(), 2);
    std::thread::sleep(Duration::from_millis(400));
    assert!(rig.recorder.status().elapsed_ms > frozen);
    let stopped = rig.recorder.stop();
    assert_eq!(stopped.state, Capture::Off);
    assert_eq!(rig.counters.stops(), 2);

    // Every final segment was stored before it was sent, and the store has exactly what was sent.
    assert!(*rig.events.stored_before_sent.lock().unwrap());
    assert_eq!(rig.transcripts.load("m-1").unwrap(), rig.events.finals());
    let langs: Vec<Lang> = rig.events.finals().iter().map(|s| s.lang).collect();
    assert!(langs.contains(&Lang::De) && langs.contains(&Lang::En));
    // Partials come before the final of their utterance.
    let segs = rig.events.segments();
    assert!(!segs[0].is_final);
}

#[test]
fn ending_the_meeting_stops_capture() {
    let rig = rig_with(talking, fake_stt());
    rig.meetings.save(&consented()).unwrap();
    rig.recorder.start(&rig.meetings, "m-1", None).unwrap();
    rig.recorder.stop_meeting("m-2");
    assert_eq!(rig.recorder.status().state, Capture::Recording);
    rig.recorder.stop_meeting("m-1");
    assert_eq!(rig.recorder.status().state, Capture::Off);
    assert_eq!(rig.counters.stops(), 1);
}

#[test]
fn errors_and_states_serialise_without_engine_types() {
    assert_eq!(
        serde_json::to_value(RecordError::NoConsent).unwrap(),
        serde_json::json!({ "kind": "noConsent" })
    );
    assert_eq!(
        serde_json::to_value(RecordError::Failed {
            reason: Reason::NoModel
        })
        .unwrap(),
        serde_json::json!({ "kind": "failed", "reason": "noModel" })
    );
    let ev = SegmentEvent {
        meeting_id: "m-1".into(),
        seq: None,
        segment: Segment {
            start_ms: 1,
            end_ms: 2,
            at: 3,
            text: "x".into(),
            lang: Lang::En,
            is_final: false,
            voice: None,
        },
    };
    assert_eq!(
        serde_json::to_value(ev).unwrap(),
        serde_json::json!({ "meetingId": "m-1", "startMs": 1, "endMs": 2, "at": 3, "text": "x", "lang": "en", "final": false })
    );
    let s = serde_json::to_value(CaptureState::off()).unwrap();
    assert_eq!(s["state"], "off");
    assert_eq!(s["elapsedMs"], 0);
}

/// AC6: a session with the fakes on real files leaves only `.meeting` and `.transcript` files, and
/// neither the log nor any error message contains what was said.
#[test]
fn a_recording_session_writes_only_meeting_and_transcript_files_and_logs_no_text() {
    let _log = crate::log::capture();
    let dir = tempfile::tempdir().unwrap();
    let meetings_dir = dir.path().join("meetings");
    let keys = MemoryKeyProvider::with_key(DataKey::generate());
    let store = FileMeetingStore::open(&meetings_dir, &keys).unwrap();
    store.save(&consented()).unwrap();
    let transcripts: Arc<dyn TranscriptStore> = Arc::new(store.transcripts());
    let events = Events::new(Some(transcripts.clone()));
    let recorder = Recorder::new(
        Box::new(|| Box::new(talking())),
        fake_stt(),
        transcripts.clone(),
        events.clone(),
        || 1_000_000,
    );
    recorder.start(&store, "m-1", None).unwrap();
    let ok = wait_until(Duration::from_secs(8), || events.finals().len() >= 2);
    assert!(ok, "{:?} {:?}", recorder.status(), events.segments());
    recorder.pause();
    recorder.start(&store, "m-1", None).unwrap();
    recorder.stop();
    // An error path too: a source that fails, and a transcript that cannot be read.
    let failing = Recorder::new(
        Box::new(|| Box::new(talking().repeating().failing_after(1_500))),
        fake_stt(),
        transcripts.clone(),
        events.clone(),
        || 1_000_000,
    );
    failing.start(&store, "m-1", None).unwrap();
    assert!(wait_until(Duration::from_secs(5), || failing
        .status()
        .state
        == Capture::Error));
    drop(failing);
    let other = FileTranscriptStore::new(&meetings_dir, DataKey::generate());
    let err = other.load("m-1").unwrap_err();

    let stored = transcripts.load("m-1").unwrap();
    assert!(
        stored.iter().any(|s| s.text.contains(MARKER)),
        "the session did transcribe the marker"
    );
    let logs = crate::log::take_captured();
    assert!(
        logs.iter().any(|l| l.contains("recording stopped")),
        "{logs:?}"
    );
    for line in &logs {
        assert!(
            !line.contains(MARKER),
            "log line contains transcript text: {line}"
        );
        assert!(!line.contains("Offline-Modus"), "{line}");
    }
    for message in [
        err.to_string(),
        format!("{err:?}"),
        serde_json::to_string(&recorder.status()).unwrap(),
        serde_json::to_string(&RecordError::Failed {
            reason: Reason::MicrophoneLost,
        })
        .unwrap(),
    ] {
        assert!(!message.contains(MARKER), "{message}");
    }

    let mut names: Vec<String> = walk(dir.path());
    names.sort();
    assert_eq!(names, ["meetings/m-1.meeting", "meetings/m-1.transcript"]);
    for n in &names {
        assert!(n.ends_with(".meeting") || n.ends_with(".transcript"));
    }
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

// ---- speaker detection (job 004) ----------------------------------------------------------------------

use crate::engines::diarize::{ScriptedDiarizer, FAKE_MARKER};
use crate::engines::FakeDiarizerProvider;
use crate::transcript::Voice;

fn voice(c: char) -> Voice {
    Voice::parse(&c.to_string()).unwrap()
}

fn diarizer(
    make: impl Fn() -> ScriptedDiarizer + Send + Sync + 'static,
) -> Box<FakeDiarizerProvider> {
    Box::new(FakeDiarizerProvider {
        make: Box::new(make),
    })
}

/// Three utterances of 1.5 s each, then an open, quiet room.
fn three_turns() -> FakeAudioSource {
    FakeAudioSource::new(
        vec![
            Tone::silence(300),
            Tone::speech(1_500),
            Tone::silence(800),
            Tone::speech(1_500),
            Tone::silence(800),
            Tone::speech(1_500),
            Tone::silence(800),
        ],
        Pace::RealTime,
    )
}

impl Events {
    fn voices(&self) -> Vec<(u64, Voice)> {
        self.voices
            .lock()
            .unwrap()
            .iter()
            .map(|(_, e)| (e.seq, e.voice))
            .collect()
    }
    fn final_events(&self) -> Vec<(Instant, SegmentEvent)> {
        self.segments
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, e)| e.segment.is_final)
            .cloned()
            .collect()
    }
}

fn stored_voices(transcripts: &dyn TranscriptStore) -> Vec<Option<char>> {
    transcripts
        .load("m-1")
        .unwrap()
        .iter()
        .map(|s| s.voice.map(Voice::label))
        .collect()
}

#[test]
fn three_scripted_voices_tag_the_final_segments_a_b_and_c() {
    let rig = rig_with(three_turns, fake_stt());
    let recorder = rig
        .recorder
        .with_diarizer(diarizer(|| ScriptedDiarizer::new(vec![0, 1, 2])));
    rig.meetings.save(&consented()).unwrap();
    recorder.start(&rig.meetings, "m-1", None).unwrap();
    assert!(wait_until(Duration::from_secs(8), || rig
        .events
        .voices()
        .len()
        >= 3));
    recorder.stop();
    assert_eq!(
        rig.events.voices(),
        [(0, voice('A')), (1, voice('B')), (2, voice('C'))]
    );
    assert_eq!(
        stored_voices(rig.transcripts.as_ref()),
        [Some('A'), Some('B'), Some('C')]
    );
    // Final segments carry their sequence number; partials none.
    let finals = rig.events.final_events();
    let seqs: Vec<_> = finals.iter().map(|(_, e)| e.seq).collect();
    assert_eq!(seqs, [Some(0), Some(1), Some(2)]);
    assert!(rig
        .events
        .segments
        .lock()
        .unwrap()
        .iter()
        .all(|(_, e)| e.segment.is_final == e.seq.is_some()));
    // Each voice event follows the record that already holds the voice.
    assert!(*rig.events.stored_before_sent.lock().unwrap());
}

#[test]
fn labels_stay_across_pause_and_resume_and_continue_after_a_restart() {
    let rig = rig_with(talking, fake_stt());
    // Speakers 0, 1, then 0 and 1 again after the pause.
    let recorder = rig
        .recorder
        .with_diarizer(diarizer(|| ScriptedDiarizer::new(vec![0, 1])));
    rig.meetings.save(&consented()).unwrap();
    recorder.start(&rig.meetings, "m-1", None).unwrap();
    assert!(wait_until(Duration::from_secs(6), || rig
        .events
        .voices()
        .len()
        >= 2));
    recorder.pause();
    assert!(recorder.holds_voices(), "kept across Pause");
    recorder.start(&rig.meetings, "m-1", None).unwrap();
    assert!(wait_until(Duration::from_secs(6), || rig
        .events
        .voices()
        .len()
        >= 4));
    recorder.stop();
    assert!(!recorder.holds_voices(), "dropped when recording stops");
    let labels: Vec<char> = rig.events.voices().iter().map(|(_, v)| v.label()).collect();
    assert_eq!(labels, ['A', 'B', 'A', 'B']);

    // A restart (a new recorder, same stored transcript): embeddings are gone, so new voices get
    // labels after the highest stored one.
    let events = Events::new(Some(rig.transcripts.clone()));
    let restarted = Recorder::new(
        Box::new(|| Box::new(talking())),
        fake_stt(),
        rig.transcripts.clone(),
        events.clone(),
        || 1_000_000,
    )
    .with_diarizer(diarizer(|| ScriptedDiarizer::new(vec![0, 1])));
    restarted.start(&rig.meetings, "m-1", None).unwrap();
    assert!(wait_until(Duration::from_secs(6), || events.voices().len() >= 2));
    restarted.stop();
    let after: Vec<(u64, char)> = events
        .voices()
        .iter()
        .map(|(s, v)| (*s, v.label()))
        .collect();
    assert_eq!(after, [(4, 'C'), (5, 'D')]);
}

#[test]
fn a_slow_diarizer_does_not_delay_the_transcript_line() {
    // 2 s per call: the line still reaches the UI at once; the voice follows in its own event.
    let rig = rig_with(talking, fake_stt());
    let recorder = rig.recorder.with_diarizer(diarizer(|| {
        ScriptedDiarizer::new(vec![0, 1]).slow(Duration::from_secs(2))
    }));
    rig.meetings.save(&consented()).unwrap();
    let started = Instant::now();
    recorder.start(&rig.meetings, "m-1", None).unwrap();
    assert!(wait_until(Duration::from_secs(10), || rig
        .events
        .voices()
        .len()
        >= 2));
    recorder.stop();
    let finals = rig.events.final_events();
    let voices = rig.events.voices.lock().unwrap().clone();
    // The first utterance is 0.5–2.3 s into the script and ends with 0.6 s of silence: its final
    // segment is sent within 3 s of the speech end, not 2 s later.
    let first_final = finals[0].0.duration_since(started);
    assert!(
        first_final <= Duration::from_millis(2_300 + 3_000),
        "final after {first_final:?}"
    );
    assert!(
        finals[0].1.segment.voice.is_none(),
        "sent before the voice is known"
    );
    let (voice_at, first_voice) = &voices[0];
    assert_eq!(first_voice.seq, 0);
    assert!(
        voice_at.duration_since(finals[0].0) >= Duration::from_millis(1_900),
        "the voice comes separately, after the engine's 2 s"
    );
    assert_eq!(
        stored_voices(rig.transcripts.as_ref()),
        [Some('A'), Some('B')]
    );
}

#[test]
fn a_segment_whose_voice_does_not_come_is_stored_after_5_s_without_one() {
    let rig = rig_with(
        || {
            FakeAudioSource::new(
                vec![Tone::silence(300), Tone::speech(1_500), Tone::silence(800)],
                Pace::RealTime,
            )
        },
        fake_stt(),
    );
    // The engine needs 7 s for one segment.
    let recorder = rig.recorder.with_diarizer(diarizer(|| {
        ScriptedDiarizer::new(vec![0]).slow(Duration::from_secs(7))
    }));
    rig.meetings.save(&consented()).unwrap();
    recorder.start(&rig.meetings, "m-1", None).unwrap();
    assert!(wait_until(Duration::from_secs(4), || rig
        .events
        .finals()
        .len()
        == 1));
    let sent = rig.events.final_events()[0].0;
    assert!(
        rig.transcripts.load("m-1").unwrap().is_empty(),
        "waits for the voice"
    );
    assert!(wait_until(Duration::from_secs(7), || rig
        .transcripts
        .load("m-1")
        .unwrap()
        .len()
        == 1));
    let stored_after = sent.elapsed();
    assert!(
        stored_after >= Duration::from_millis(4_800)
            && stored_after <= Duration::from_millis(6_500),
        "stored after {stored_after:?}"
    );
    assert_eq!(stored_voices(rig.transcripts.as_ref()), [None]);
    recorder.stop();
    // The late voice is not sent: the stored line has none.
    assert!(rig.events.voices().is_empty());
}

#[test]
fn a_slow_diarizer_delays_neither_capture_ticks_nor_loss_detection() {
    // The diarizer takes 4 s per segment; the device dies after 2.5 s of audio.
    let rig = rig_with(|| talking().repeating().failing_after(2_500), fake_stt());
    let recorder = rig.recorder.with_diarizer(diarizer(|| {
        ScriptedDiarizer::new(vec![0, 1]).slow(Duration::from_secs(4))
    }));
    rig.meetings.save(&consented()).unwrap();
    let started = Instant::now();
    recorder.start(&rig.meetings, "m-1", None).unwrap();
    assert!(wait_until(Duration::from_secs(6), || recorder
        .status()
        .state
        == Capture::Error));
    let failed_at = rig
        .events
        .states
        .lock()
        .unwrap()
        .iter()
        .find(|(_, s)| s.state == Capture::Error)
        .map(|(t, _)| *t)
        .unwrap();
    assert!(
        failed_at.duration_since(started) < Duration::from_millis(2_500 + 2_000),
        "lost device reported after {:?}",
        failed_at.duration_since(started)
    );
    assert_eq!(recorder.status().reason, Some(Reason::MicrophoneLost));
    // Ticks kept coming while the diarizer was busy.
    let ticks = rig
        .events
        .states
        .lock()
        .unwrap()
        .iter()
        .filter(|(t, s)| {
            s.state == Capture::Recording && t.duration_since(started) < Duration::from_secs(2)
        })
        .count();
    assert!(ticks >= 5, "{ticks} ticks");
    recorder.stop();
}

#[test]
fn without_a_speaker_model_recording_and_transcription_run_as_before() {
    let rig = rig_with(talking, fake_stt());
    let recorder = rig.recorder.with_diarizer(Box::new(NoSpeakerModelProvider {
        searched: vec!["/x/models".into()],
    }));
    rig.meetings.save(&consented()).unwrap();
    recorder.start(&rig.meetings, "m-1", None).unwrap();
    assert!(wait_until(Duration::from_secs(6), || rig
        .events
        .finals()
        .len()
        >= 2));
    recorder.stop();
    assert_eq!(stored_voices(rig.transcripts.as_ref()), [None, None]);
    assert!(rig.events.voices().is_empty());
    assert_eq!(recorder.speaker_models().searched, ["/x/models"]);
    assert!(recorder.speaker_models().models.is_empty());
}

#[test]
fn voice_events_carry_only_the_label() {
    let ev = VoiceEvent {
        meeting_id: "m-1".into(),
        seq: 4,
        voice: voice('B'),
    };
    assert_eq!(
        serde_json::to_value(ev).unwrap(),
        serde_json::json!({ "meetingId": "m-1", "seq": 4, "voice": "B" })
    );
    let fin = SegmentEvent {
        meeting_id: "m-1".into(),
        seq: Some(3),
        segment: Segment {
            start_ms: 1,
            end_ms: 2,
            at: 3,
            text: "x".into(),
            lang: Lang::De,
            is_final: true,
            voice: Some(voice('A')),
        },
    };
    assert_eq!(
        serde_json::to_value(fin).unwrap(),
        serde_json::json!({ "meetingId": "m-1", "seq": 3, "startMs": 1, "endMs": 2, "at": 3, "text": "x", "lang": "de", "final": true, "voice": "A" })
    );
}

/// AC6 (job 004): with the fake audio, speech engine and diarizer on real files, only `.meeting` and
/// `.transcript` files are left; the fake's embedding marker is in neither (after decryption).
#[test]
fn a_session_with_speaker_detection_keeps_no_embedding_anywhere() {
    let _log = crate::log::capture();
    let dir = tempfile::tempdir().unwrap();
    let meetings_dir = dir.path().join("meetings");
    let key = DataKey::generate();
    let keys = MemoryKeyProvider::with_key(key.clone());
    let store = FileMeetingStore::open(&meetings_dir, &keys).unwrap();
    store.save(&consented()).unwrap();
    let transcripts: Arc<dyn TranscriptStore> = Arc::new(store.transcripts());
    let events = Events::new(Some(transcripts.clone()));
    let recorder = Recorder::new(
        Box::new(|| Box::new(three_turns())),
        fake_stt(),
        transcripts.clone(),
        events.clone(),
        || 1_000_000,
    )
    .with_diarizer(diarizer(|| ScriptedDiarizer::new(vec![0, 1, 0])));
    recorder.start(&store, "m-1", None).unwrap();
    assert!(wait_until(Duration::from_secs(8), || events.voices().len() >= 3));
    recorder.pause();
    recorder.stop();
    assert!(!recorder.holds_voices());

    let mut names = walk(dir.path());
    names.sort();
    assert_eq!(names, ["meetings/m-1.meeting", "meetings/m-1.transcript"]);
    // Decrypted, the files hold labels but no embedding value.
    let marker = format!("{FAKE_MARKER}");
    let marker_short = format!("{:.5}", FAKE_MARKER);
    let plain_meeting = serde_json::to_string(&store.load("m-1").unwrap().unwrap()).unwrap();
    let plain_transcript = serde_json::to_string(&transcripts.load("m-1").unwrap()).unwrap();
    for plain in [&plain_meeting, &plain_transcript] {
        assert!(!plain.contains(&marker), "{plain}");
        assert!(!plain.contains(&marker_short), "{plain}");
    }
    assert!(plain_transcript.contains("\"voice\":\"A\""));
    let raw = std::fs::read(meetings_dir.join("m-1.transcript")).unwrap();
    let marker_bytes = FAKE_MARKER.to_le_bytes();
    assert!(!raw.windows(4).any(|w| w == marker_bytes));
    for line in crate::log::take_captured() {
        assert!(!line.contains(MARKER), "{line}");
        assert!(!line.contains(&marker), "{line}");
    }
}

/// An engine that is slower than the 1.5 s stall limit on every window (whisper in a debug build).
struct SlowStt {
    inner: ScriptedSpeechToText,
    delay: Duration,
    /// Set to let the engine catch up (so a test can stop without waiting out the backlog).
    quick: Arc<std::sync::atomic::AtomicBool>,
}

impl SpeechToText for SlowStt {
    fn transcribe(
        &mut self,
        window: &[f32],
        final_pass: bool,
    ) -> Result<Vec<crate::engines::stt::Recognized>, SttError> {
        if !self.quick.load(std::sync::atomic::Ordering::SeqCst) {
            std::thread::sleep(self.delay);
        }
        self.inner.transcribe(window, final_pass)
    }
}

struct SlowProvider(Duration, Arc<std::sync::atomic::AtomicBool>);

impl SttProvider for SlowProvider {
    fn models(&self) -> crate::engines::models::ModelList {
        FakeSttProvider {
            make: Box::new(script),
        }
        .models()
    }
    fn load(&self, _id: Option<&str>) -> Result<Box<dyn SpeechToText>, SttError> {
        Ok(Box::new(SlowStt {
            inner: script(),
            delay: self.0,
            quick: self.1.clone(),
        }))
    }
}

fn slow_stt() -> Box<SlowProvider> {
    Box::new(SlowProvider(Duration::from_millis(2_500), Arc::default()))
}

fn errors_seen(rig: &Rig) -> Vec<(Instant, CaptureState)> {
    let states = rig.events.states.lock().unwrap();
    states
        .iter()
        .filter(|(_, s)| s.state == Capture::Error)
        .cloned()
        .collect()
}

#[test]
fn a_slow_engine_does_not_stop_recording() {
    let rig = rig_with(|| talking().repeating(), slow_stt());
    rig.meetings.save(&consented()).unwrap();
    rig.recorder.start(&rig.meetings, "m-1", None).unwrap();
    // At least 3 windows of 3 s (8+ s), the engine blocking 2.5 s on each call.
    std::thread::sleep(Duration::from_millis(8_500));
    let status = rig.recorder.status();
    assert_eq!(status.state, Capture::Recording);
    assert_eq!(status.reason, None);
    assert!(errors_seen(&rig).is_empty());
    assert_eq!(rig.counters.starts(), 1);
    assert_eq!(rig.counters.stops(), 0);
    assert!(wait_until(Duration::from_secs(8), || !rig
        .events
        .finals()
        .is_empty()));
    assert_eq!(rig.recorder.status().state, Capture::Recording);
    rig.recorder.stop();
    assert!(errors_seen(&rig).is_empty());
}

#[test]
fn a_dead_device_is_detected_within_2_s_while_the_engine_is_busy() {
    let rig = rig_with(
        || FakeAudioSource::new(vec![Tone::speech(1_000)], Pace::Fast),
        slow_stt(),
    );
    rig.meetings.save(&consented()).unwrap();
    let started = Instant::now();
    rig.recorder.start(&rig.meetings, "m-1", None).unwrap();
    assert!(wait_until(Duration::from_secs(6), || rig
        .recorder
        .status()
        .state
        == Capture::Error));
    let (at, state) = errors_seen(&rig).remove(0);
    assert_eq!(state.reason, Some(Reason::MicrophoneLost));
    assert!(at.duration_since(started) < Duration::from_secs(2));
    rig.recorder.stop();
}

#[test]
fn a_device_error_is_reported_within_2_s_while_the_engine_is_busy() {
    let rig = rig_with(|| talking().repeating().failing_after(700), slow_stt());
    rig.meetings.save(&consented()).unwrap();
    let started = Instant::now();
    rig.recorder.start(&rig.meetings, "m-1", None).unwrap();
    assert!(wait_until(Duration::from_secs(6), || rig
        .recorder
        .status()
        .state
        == Capture::Error));
    let (at, state) = errors_seen(&rig).remove(0);
    assert_eq!(state.reason, Some(Reason::MicrophoneLost));
    assert!(at.duration_since(started) < Duration::from_millis(700 + 2_000));
    rig.recorder.stop();
}

#[test]
fn a_lagging_engine_keeps_the_buffer_bounded_and_the_ticks_coming() {
    // The fake delivers far faster than real time, so the slow engine is always behind.
    let quick = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let provider = SlowProvider(Duration::from_millis(2_500), quick.clone());
    let rig = rig_with(
        || FakeAudioSource::new(vec![Tone::speech(60_000)], Pace::Fast).repeating(),
        Box::new(provider),
    );
    rig.meetings.save(&consented()).unwrap();
    rig.recorder.start(&rig.meetings, "m-1", None).unwrap();
    std::thread::sleep(Duration::from_millis(5_500));
    let sink = rig.recorder.inner().worker.as_ref().unwrap().sink.clone();
    assert!(sink.dropped() > 0);
    assert!(sink.high_water() <= sink.capacity());
    assert_eq!(rig.recorder.status().state, Capture::Recording);
    let times_so_far = rig.events.states.lock().unwrap().len();
    assert!(times_so_far >= 5);
    quick.store(true, std::sync::atomic::Ordering::SeqCst);
    rig.recorder.stop();
    // Ticks arrived at least once per second, also while the engine was inside a window.
    let times: Vec<Instant> = rig
        .events
        .states
        .lock()
        .unwrap()
        .iter()
        .filter(|(_, s)| s.state == Capture::Recording)
        .map(|(t, _)| *t)
        .collect();
    assert!(times.len() >= 5);
    for pair in times.windows(2) {
        assert!(pair[1].duration_since(pair[0]) < Duration::from_secs(1));
    }
    assert!(errors_seen(&rig).is_empty());
}

#[test]
fn dev_builds_optimise_whisper_cpp() {
    let toml = include_str!("../../Cargo.toml");
    let section = toml
        .split("[profile.dev.package.\"*\"]")
        .nth(1)
        .expect("a [profile.dev.package.\"*\"] section");
    let line = section
        .lines()
        .find(|l| l.trim_start().starts_with("opt-level"))
        .expect("an opt-level");
    let level: u8 = line.split('=').nth(1).unwrap().trim().parse().unwrap();
    assert!(level >= 2);
    let config = include_str!("../../.cargo/config.toml");
    assert!(config.contains("CMAKE_BUILD_TYPE") && config.contains("Release"));
}
