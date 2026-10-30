//! Microphone capture behind [`AudioSource`]. Every source delivers 16 kHz mono `f32` samples into an
//! [`AudioSink`]; the sink is a bounded in-memory buffer (at most [`MAX_BUFFER_SECONDS`]) that the
//! transcript pipeline drains. Audio is never written to disk.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

/// Sample rate of every [`AudioSource`]: the rate speech-to-text engines (whisper) expect.
pub const SAMPLE_RATE: u32 = 16_000;
/// Most audio the in-memory buffer holds. When the engine falls behind, the oldest samples go.
pub const MAX_BUFFER_SECONDS: u32 = 30;
pub const MAX_BUFFER_SAMPLES: usize = (SAMPLE_RATE * MAX_BUFFER_SECONDS) as usize;

/// Why capture could not start or stopped. Carries no device names and no audio.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioError {
    /// There is no input device.
    NoMicrophone,
    /// The OS refused access to the microphone, or it could not be opened.
    Blocked,
    /// The device went away or failed while recording.
    DeviceLost,
}

impl std::fmt::Display for AudioError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            AudioError::NoMicrophone => "no microphone",
            AudioError::Blocked => "microphone blocked",
            AudioError::DeviceLost => "microphone lost",
        })
    }
}

/// A microphone (or a stand-in). `start` opens it and makes it push samples into the sink until
/// `stop`; a failure while running is reported through [`AudioSink::fail`].
pub trait AudioSource: Send {
    fn start(&mut self, sink: AudioSink) -> Result<(), AudioError>;
    /// Closes the device. Calling it when not started does nothing.
    fn stop(&mut self);
}

#[derive(Default)]
struct BufferState {
    samples: VecDeque<f32>,
    dropped: u64,
    failed: Option<AudioError>,
    ended: bool,
    high_water: usize,
}

/// What [`AudioSink::take`] returns: the samples that arrived, and whether capture failed or ended.
#[derive(Debug, Default)]
pub struct Taken {
    pub samples: Vec<f32>,
    pub failed: Option<AudioError>,
    pub ended: bool,
}

/// The bounded buffer between a source (producer) and the pipeline (consumer). Cheap to clone.
#[derive(Clone)]
pub struct AudioSink {
    inner: Arc<(Mutex<BufferState>, Condvar)>,
    capacity: usize,
}

impl Default for AudioSink {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioSink {
    pub fn new() -> Self {
        Self::with_capacity(MAX_BUFFER_SAMPLES)
    }

    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            inner: Arc::new((Mutex::new(BufferState::default()), Condvar::new())),
            capacity,
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, BufferState> {
        self.inner.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Adds samples; drops the oldest ones beyond the capacity.
    pub fn push(&self, samples: &[f32]) {
        let mut s = self.lock();
        if s.ended {
            return;
        }
        s.samples.extend(samples.iter().copied());
        let over = s.samples.len().saturating_sub(self.capacity);
        if over > 0 {
            s.samples.drain(..over);
            s.dropped += over as u64;
        }
        s.high_water = s.high_water.max(s.samples.len());
        drop(s);
        self.inner.1.notify_all();
    }

    /// The source failed; the pipeline stops.
    pub fn fail(&self, err: AudioError) {
        self.lock().failed.get_or_insert(err);
        self.inner.1.notify_all();
    }

    /// Capture was stopped on purpose; the pipeline flushes and stops.
    pub fn end(&self) {
        self.lock().ended = true;
        self.inner.1.notify_all();
    }

    /// Waits up to `timeout` for samples or a state change and takes everything there is.
    pub fn take(&self, timeout: Duration) -> Taken {
        let mut s = self.lock();
        if s.samples.is_empty() && s.failed.is_none() && !s.ended {
            s = self
                .inner
                .1
                .wait_timeout(s, timeout)
                .unwrap_or_else(|e| e.into_inner())
                .0;
        }
        Taken {
            samples: s.samples.drain(..).collect(),
            failed: s.failed,
            ended: s.ended,
        }
    }

    pub fn len(&self) -> usize {
        self.lock().samples.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// The most samples the buffer ever held.
    pub fn high_water(&self) -> usize {
        self.lock().high_water
    }

    /// Samples dropped because the consumer fell behind.
    pub fn dropped(&self) -> u64 {
        self.lock().dropped
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }
}

/// Number of samples in `ms` milliseconds.
pub const fn samples_for_ms(ms: u64) -> usize {
    (ms * SAMPLE_RATE as u64 / 1000) as usize
}

// ---- fake ---------------------------------------------------------------------------------------

/// One part of a fake recording: a tone of `amplitude` (0 = silence) for `ms` milliseconds.
#[derive(Debug, Clone, Copy)]
pub struct Tone {
    pub amplitude: f32,
    pub ms: u64,
}

impl Tone {
    pub const fn speech(ms: u64) -> Self {
        Self { amplitude: 0.3, ms }
    }
    pub const fn silence(ms: u64) -> Self {
        Self { amplitude: 0.0, ms }
    }
}

/// Generates the samples of a script of tones, starting at sample `from`.
pub fn render_tones(script: &[Tone], from: usize, len: usize, repeat: bool) -> Vec<f32> {
    let total: usize = script.iter().map(|t| samples_for_ms(t.ms)).sum();
    let mut out = Vec::with_capacity(len);
    for i in from..from + len {
        if total == 0 || (!repeat && i >= total) {
            break;
        }
        let mut pos = i % total;
        let mut amp = 0.0;
        for t in script {
            let n = samples_for_ms(t.ms);
            if pos < n {
                amp = t.amplitude;
                break;
            }
            pos -= n;
        }
        let phase = i as f32 * 220.0 * std::f32::consts::TAU / SAMPLE_RATE as f32;
        out.push(amp * phase.sin());
    }
    out
}

/// How fast the fake delivers audio.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pace {
    /// 100 ms of audio every 100 ms, like a microphone.
    RealTime,
    /// As fast as possible (tests).
    Fast,
}

/// Counts of `start`/`stop` calls, shared with the test that owns the fake.
#[derive(Debug, Default)]
pub struct FakeCounters {
    pub starts: AtomicUsize,
    pub stops: AtomicUsize,
}

impl FakeCounters {
    pub fn starts(&self) -> usize {
        self.starts.load(Ordering::SeqCst)
    }
    pub fn stops(&self) -> usize {
        self.stops.load(Ordering::SeqCst)
    }
}

/// Replays generated tones and silence. Can refuse to start, or fail after some audio.
pub struct FakeAudioSource {
    script: Vec<Tone>,
    repeat: bool,
    pace: Pace,
    fail_start: Option<AudioError>,
    fail_after_ms: Option<u64>,
    counters: Arc<FakeCounters>,
    running: Option<(Arc<std::sync::atomic::AtomicBool>, JoinHandle<()>)>,
    /// Where the next start continues, so a pause does not replay the script from the start.
    position: Arc<AtomicUsize>,
}

impl FakeAudioSource {
    pub fn new(script: Vec<Tone>, pace: Pace) -> Self {
        Self {
            script,
            repeat: false,
            pace,
            fail_start: None,
            fail_after_ms: None,
            counters: Arc::new(FakeCounters::default()),
            running: None,
            position: Arc::new(AtomicUsize::new(0)),
        }
    }

    /// The demo used by `MEETING_COMPANION_AUDIO=fake`: 2.5 s "speech", 1 s pause, forever.
    pub fn demo() -> Self {
        let mut s = Self::new(
            vec![Tone::speech(2_500), Tone::silence(1_000)],
            Pace::RealTime,
        );
        s.repeat = true;
        s
    }

    pub fn repeating(mut self) -> Self {
        self.repeat = true;
        self
    }

    pub fn failing_start(mut self, err: AudioError) -> Self {
        self.fail_start = Some(err);
        self
    }

    pub fn failing_after(mut self, ms: u64) -> Self {
        self.fail_after_ms = Some(ms);
        self
    }

    pub fn with_counters(mut self, counters: Arc<FakeCounters>) -> Self {
        self.counters = counters;
        self
    }

    pub fn counters(&self) -> Arc<FakeCounters> {
        self.counters.clone()
    }
}

impl AudioSource for FakeAudioSource {
    fn start(&mut self, sink: AudioSink) -> Result<(), AudioError> {
        self.counters.starts.fetch_add(1, Ordering::SeqCst);
        if let Some(err) = self.fail_start {
            return Err(err);
        }
        self.stop_thread();
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let (script, repeat, pace, fail_after) = (
            self.script.clone(),
            self.repeat,
            self.pace,
            self.fail_after_ms,
        );
        let position = self.position.clone();
        let stop2 = stop.clone();
        let handle = std::thread::spawn(move || {
            let chunk = samples_for_ms(100);
            let mut sent: u64 = 0;
            while !stop2.load(Ordering::SeqCst) {
                if let Some(limit) = fail_after {
                    if sent >= limit {
                        sink.fail(AudioError::DeviceLost);
                        return;
                    }
                }
                let from = position.load(Ordering::SeqCst);
                let samples = render_tones(&script, from, chunk, repeat);
                if samples.is_empty() {
                    // Script over: keep the device "open" with silence, as a quiet room would.
                    if pace == Pace::Fast {
                        return;
                    }
                    sink.push(&vec![0.0; chunk]);
                } else {
                    position.fetch_add(samples.len(), Ordering::SeqCst);
                    sink.push(&samples);
                }
                sent += 100;
                if pace == Pace::RealTime {
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
        });
        self.running = Some((stop, handle));
        Ok(())
    }

    fn stop(&mut self) {
        self.counters.stops.fetch_add(1, Ordering::SeqCst);
        self.stop_thread();
    }
}

impl FakeAudioSource {
    fn stop_thread(&mut self) {
        if let Some((stop, handle)) = self.running.take() {
            stop.store(true, Ordering::SeqCst);
            let _ = handle.join();
        }
    }
}

impl Drop for FakeAudioSource {
    fn drop(&mut self) {
        self.stop_thread();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sink_keeps_at_most_its_capacity_and_drops_the_oldest() {
        let sink = AudioSink::with_capacity(10);
        sink.push(&[1.0; 6]);
        sink.push(&[2.0; 6]);
        assert_eq!(sink.len(), 10);
        assert_eq!(sink.dropped(), 2);
        let taken = sink.take(Duration::ZERO);
        assert_eq!(&taken.samples[..4], &[1.0; 4]);
        assert!(sink.is_empty());
    }

    #[test]
    fn sink_reports_failure_and_end() {
        let sink = AudioSink::new();
        sink.fail(AudioError::DeviceLost);
        assert_eq!(
            sink.take(Duration::ZERO).failed,
            Some(AudioError::DeviceLost)
        );
        sink.end();
        sink.push(&[0.5; 4]);
        let t = sink.take(Duration::ZERO);
        assert!(t.ended);
        assert!(t.samples.is_empty());
    }

    #[test]
    fn tones_render_speech_and_silence() {
        let script = [Tone::speech(100), Tone::silence(100)];
        let s = render_tones(&script, 0, samples_for_ms(200), false);
        assert_eq!(s.len(), 3_200);
        assert!(s[..1_600].iter().any(|x| x.abs() > 0.1));
        assert!(s[1_600..].iter().all(|x| *x == 0.0));
        assert!(render_tones(&script, 3_200, 10, false).is_empty());
        assert_eq!(render_tones(&script, 3_200, 10, true).len(), 10);
    }
}
