//! "Test microphone": opens the chosen device for at most [`TEST_LIMIT`] and sends its level. The
//! audio goes into a sink of one second, is measured and dropped. It never reaches speech-to-text,
//! the transcript or a file, and no meeting consent is involved because nothing is kept.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::Serialize;

use super::{Capture, LevelEvent, Reason, Recorder, Shared, TICK};
use crate::engines::audio::{AudioSink, AudioSource, SAMPLE_RATE};
use crate::engines::level::{Level, LevelPacer};

/// Longest a microphone test runs.
pub const TEST_LIMIT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MicTest {
    Off,
    Running,
    Error,
}

/// What the Audio section shows (`mic-test` event).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicTestState {
    pub state: MicTest,
    /// Time left until the test stops by itself.
    pub remaining_ms: u64,
    /// Input level 0..1 when the state was sent, on the same scale as the recording's level. The
    /// meter follows the `capture-level` events, sent at the recording's rate.
    pub level: f32,
    pub reason: Option<Reason>,
}

impl MicTestState {
    pub fn off() -> Self {
        Self {
            state: MicTest::Off,
            remaining_ms: 0,
            level: 0.0,
            reason: None,
        }
    }

    fn error(reason: Reason) -> Self {
        Self {
            state: MicTest::Error,
            reason: Some(reason),
            ..Self::off()
        }
    }
}

/// Why a test did not start.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MicTestError {
    /// A meeting is recording or paused; its level is shown instead.
    Busy,
    Failed {
        reason: Reason,
    },
}

pub(super) struct Running {
    stop: Arc<AtomicBool>,
    handle: JoinHandle<()>,
}

impl Recorder {
    /// Starts a microphone test on `device` (`None`: the system default). Refused while a meeting
    /// records or is paused. A running test is restarted.
    pub fn start_test(&self, device: Option<&str>) -> Result<MicTestState, MicTestError> {
        // Serialised with recording starts: a meeting and a test never hold the device together.
        let _inner = self.inner();
        if matches!(
            self.shared.status().state,
            Capture::Recording | Capture::Paused
        ) {
            return Err(MicTestError::Busy);
        }
        self.stop_test();
        let fail = |reason: Reason| {
            crate::log!("microphone test failed: {reason:?}");
            self.shared.events.mic_test(&MicTestState::error(reason));
            MicTestError::Failed { reason }
        };
        let mut source = self.open_source(device).map_err(fail)?;
        // One second at most: enough for a level, never a recording.
        let sink = AudioSink::with_capacity(SAMPLE_RATE as usize);
        if let Err(e) = source.start(sink.clone()) {
            let reason = match (e, device) {
                (crate::engines::audio::AudioError::NoMicrophone, Some(_)) => {
                    Reason::ChosenMicrophoneMissing
                }
                (e, _) => e.into(),
            };
            return Err(fail(reason));
        }
        let first = MicTestState {
            state: MicTest::Running,
            remaining_ms: TEST_LIMIT.as_millis() as u64,
            level: 0.0,
            reason: None,
        };
        self.shared.events.mic_test(&first);
        let stop = Arc::new(AtomicBool::new(false));
        let shared = self.shared.clone();
        let flag = stop.clone();
        let handle = std::thread::Builder::new()
            .name("mic-test".into())
            .spawn(move || run(shared, source, sink, flag))
            .map_err(|_| MicTestError::Failed {
                reason: Reason::MicrophoneBlocked,
            })?;
        *self.test.lock().unwrap_or_else(|e| e.into_inner()) = Some(Running { stop, handle });
        Ok(first)
    }

    /// Stops a running test ("Stop test", leaving the view, a recording starting). Does nothing
    /// when no test runs.
    pub fn stop_test(&self) {
        let running = self.test.lock().unwrap_or_else(|e| e.into_inner()).take();
        if let Some(Running { stop, handle }) = running {
            stop.store(true, Ordering::SeqCst);
            let _ = handle.join();
        }
    }

    /// Whether a test is running right now.
    pub fn test_running(&self) -> bool {
        self.test
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .is_some_and(|r| !r.handle.is_finished())
    }
}

/// Sends the level at the recording's rate (`capture-level`, no meeting id) and the test's state
/// (time left) every [`TICK`]. The level is measured by the sink as samples arrive (the same
/// function as the recording's); the samples are dropped here at once.
fn run(
    shared: Arc<Shared>,
    mut source: Box<dyn AudioSource>,
    sink: AudioSink,
    stop: Arc<AtomicBool>,
) {
    let started = Instant::now();
    let mut last_tick = Instant::now();
    let mut pacer = LevelPacer::new();
    let send_level = |l: Level| shared.events.level(&LevelEvent::new(None, l));
    let outcome = loop {
        let taken = sink.take(pacer.due_in(Duration::from_millis(25)));
        // Dropped right here: only the level, measured on arrival, is kept.
        drop(taken.samples);
        if let Some(e) = taken.failed {
            break Some(Reason::from(e));
        }
        let elapsed = started.elapsed();
        if stop.load(Ordering::SeqCst) || elapsed >= TEST_LIMIT || taken.ended {
            break None;
        }
        pacer.step(&sink, true, send_level);
        if last_tick.elapsed() >= TICK {
            last_tick = Instant::now();
            shared.events.mic_test(&MicTestState {
                state: MicTest::Running,
                remaining_ms: (TEST_LIMIT - elapsed).as_millis() as u64,
                level: sink.level().level,
                reason: None,
            });
        }
    };
    pacer.finish(send_level);
    source.stop();
    sink.end();
    drop(source);
    match outcome {
        Some(reason) => {
            crate::log!("microphone test failed: {reason:?}");
            shared.events.mic_test(&MicTestState::error(reason));
        }
        None => shared.events.mic_test(&MicTestState::off()),
    }
}
