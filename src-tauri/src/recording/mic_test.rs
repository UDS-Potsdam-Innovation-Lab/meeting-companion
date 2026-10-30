//! "Test microphone": opens the chosen device for at most [`TEST_LIMIT`] and sends its level. The
//! audio goes into a sink of one second, is measured and dropped. It never reaches speech-to-text,
//! the transcript or a file, and no meeting consent is involved because nothing is kept.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::Serialize;

use super::{Capture, Reason, Recorder, Shared, TICK};
use crate::engines::audio::{AudioSink, AudioSource, SAMPLE_RATE};

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
    /// Input level 0..1, on the same scale as the recording's level.
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

/// Root mean square of the samples, scaled like the recording's level meter.
fn level(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
    (rms * 4.0).min(1.0)
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

fn run(
    shared: Arc<Shared>,
    mut source: Box<dyn AudioSource>,
    sink: AudioSink,
    stop: Arc<AtomicBool>,
) {
    let started = Instant::now();
    let mut last_tick = Instant::now();
    let mut current = 0.0f32;
    let outcome = loop {
        let taken = sink.take(Duration::from_millis(50));
        // Measured and dropped right here.
        if !taken.samples.is_empty() {
            current = level(&taken.samples);
        }
        if let Some(e) = taken.failed {
            break Some(Reason::from(e));
        }
        let elapsed = started.elapsed();
        if stop.load(Ordering::SeqCst) || elapsed >= TEST_LIMIT || taken.ended {
            break None;
        }
        if last_tick.elapsed() >= TICK / 2 {
            last_tick = Instant::now();
            shared.events.mic_test(&MicTestState {
                state: MicTest::Running,
                remaining_ms: (TEST_LIMIT - elapsed).as_millis() as u64,
                level: current,
                reason: None,
            });
        }
    };
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn level_is_scaled_rms() {
        assert_eq!(level(&[]), 0.0);
        assert!((level(&[0.1, -0.1]) - 0.4).abs() < 1e-6);
        assert_eq!(level(&[0.9; 10]), 1.0);
    }
}
