//! The input level, measured where samples arrive ([`super::audio::AudioSink::push`]), not on the
//! speech thread: the sound wave keeps moving while the engine works on a window.
//!
//! One mapping for every meter (recording and microphone test): scaled RMS, `min(1, rms × 4)`, see
//! [`scaled_rms`]. A block is measured in one pass over the samples, without allocating. The level
//! is a number per block, kept in memory only; it is never stored or logged.

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::audio::{samples_for_ms, AudioSink};

/// How often the level is sent while audio arrives (25 per second).
pub const LEVEL_EVERY: Duration = Duration::from_millis(40);
/// Without new samples for this long, no more level events are sent (the UI shows "No signal"
/// after 500 ms without one; the recording itself declares the device lost after `STALL`).
pub const LEVEL_STALE: Duration = Duration::from_millis(250);
/// Samples per published level: 40 ms. A larger push is measured as one block.
pub const LEVEL_BLOCK: usize = samples_for_ms(40);

/// Root mean square of `samples`, scaled like every level meter of the app: `min(1, rms × 4)`.
pub fn scaled_rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    scale((sum_of_squares(samples) / samples.len() as f32).sqrt())
}

fn scale(rms: f32) -> f32 {
    (rms * 4.0).min(1.0)
}

fn sum_of_squares(samples: &[f32]) -> f32 {
    samples.iter().map(|s| s * s).sum()
}

/// One level reading: scaled RMS and the block's peak (absolute sample value), both 0..1.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Level {
    pub level: f32,
    pub peak: f32,
}

#[derive(Default)]
struct Acc {
    sum: f32,
    n: usize,
    peak: f32,
}

/// The latest level of a sink. Written by the producer (the device callback), read by whoever sends
/// it to the UI. Holds three numbers, never samples.
#[derive(Default)]
pub struct LevelCell {
    /// Producer side only: the samples of the block being measured (sums, not samples).
    acc: Mutex<Acc>,
    level: AtomicU32,
    peak: AtomicU32,
    blocks: AtomicU64,
}

impl LevelCell {
    /// Adds a pushed block: O(n), no allocation. Publishes once at least [`LEVEL_BLOCK`] samples
    /// were measured.
    pub fn measure(&self, samples: &[f32]) {
        if samples.is_empty() {
            return;
        }
        let mut acc = self.acc.lock().unwrap_or_else(|e| e.into_inner());
        for s in samples {
            acc.sum += s * s;
            acc.peak = acc.peak.max(s.abs());
        }
        acc.n += samples.len();
        if acc.n >= LEVEL_BLOCK {
            let level = scale((acc.sum / acc.n as f32).sqrt());
            self.level.store(level.to_bits(), Ordering::Relaxed);
            self.peak
                .store(acc.peak.min(1.0).to_bits(), Ordering::Relaxed);
            self.blocks.fetch_add(1, Ordering::Release);
            *acc = Acc::default();
        }
    }

    /// The level of the newest measured block (0 before the first one).
    pub fn get(&self) -> Level {
        let _ = self.blocks.load(Ordering::Acquire);
        Level {
            level: f32::from_bits(self.level.load(Ordering::Relaxed)),
            peak: f32::from_bits(self.peak.load(Ordering::Relaxed)),
        }
    }

    /// How many blocks were measured.
    pub fn blocks(&self) -> u64 {
        self.blocks.load(Ordering::Acquire)
    }
}

/// Paces the level events of one sink: one every [`LEVEL_EVERY`] while samples arrive; when they
/// stop (pause, stop, a failed or silent device) one last event with level 0, then none.
pub struct LevelPacer {
    last: Option<Instant>,
    on: bool,
}

impl Default for LevelPacer {
    fn default() -> Self {
        Self::new()
    }
}

impl LevelPacer {
    pub fn new() -> Self {
        Self {
            last: None,
            on: false,
        }
    }

    /// Call often (at least every 25 ms). `live`: capture is running and the session has not
    /// ended or failed. Sends through `send` when one is due.
    pub fn step(&mut self, sink: &AudioSink, live: bool, mut send: impl FnMut(Level)) {
        let flowing = live && sink.since_last_push() < LEVEL_STALE;
        if flowing {
            if self.last.is_none_or(|t| t.elapsed() >= LEVEL_EVERY) {
                self.last = Some(Instant::now());
                self.on = true;
                send(sink.level());
            }
        } else {
            self.finish(send);
        }
    }

    /// Sends the closing level 0 if events were flowing.
    pub fn finish(&mut self, mut send: impl FnMut(Level)) {
        if self.on {
            self.on = false;
            self.last = None;
            send(Level::default());
        }
    }

    /// How long until the next event is due (at most `max`), so a loop can sleep exactly that long.
    pub fn due_in(&self, max: Duration) -> Duration {
        match self.last {
            Some(t) => LEVEL_EVERY.saturating_sub(t.elapsed()).min(max),
            None => max,
        }
        .max(Duration::from_millis(1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engines::audio::{render_tones, Tone};

    #[test]
    fn level_is_scaled_rms() {
        assert_eq!(scaled_rms(&[]), 0.0);
        assert!((scaled_rms(&[0.1, -0.1]) - 0.4).abs() < 1e-6);
        assert_eq!(scaled_rms(&[0.9; 10]), 1.0);
    }

    #[test]
    fn a_cell_publishes_the_scaled_rms_and_peak_of_each_block() {
        let cell = LevelCell::default();
        assert_eq!(cell.get(), Level::default());
        // Smaller pushes are gathered until a block is full (as a device callback delivers them).
        cell.measure(&[0.1; 300]);
        assert_eq!(cell.blocks(), 0);
        cell.measure(&[-0.1; 340]);
        assert_eq!(cell.blocks(), 1);
        let l = cell.get();
        assert!((l.level - 0.4).abs() < 1e-5);
        assert!((l.peak - 0.1).abs() < 1e-6);
        // One push of 100 ms is one block.
        let tone = render_tones(&[Tone::speech(100)], 0, samples_for_ms(100), false);
        cell.measure(&tone);
        assert_eq!(cell.blocks(), 2);
        assert!((cell.get().level - scaled_rms(&tone)).abs() < 1e-5);
        assert!(cell.get().level > 0.3);
        cell.measure(&[0.0; LEVEL_BLOCK]);
        assert_eq!(cell.get(), Level::default());
    }
}
