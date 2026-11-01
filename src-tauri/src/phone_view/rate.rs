//! Per-address rate limit of the phone view, in fixed windows (one minute by default) that start with an
//! address's first request:
//! - more than `failed_per_window` requests with a missing or wrong token: every further request from
//!   that address gets 429 until the window ends, also one with the valid token;
//! - more than `total_per_window` requests in all: 429.
//!
//! The window runs on an injected [`Clock`], so tests can move time.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Instant;

/// Milliseconds on a monotonic clock.
pub trait Clock: Send + Sync {
    fn now_ms(&self) -> u64;
}

/// The real monotonic clock.
pub struct SystemClock(Instant);

impl SystemClock {
    pub fn new() -> Self {
        Self(Instant::now())
    }
}

impl Default for SystemClock {
    fn default() -> Self {
        Self::new()
    }
}

impl Clock for SystemClock {
    fn now_ms(&self) -> u64 {
        u64::try_from(self.0.elapsed().as_millis()).unwrap_or(u64::MAX)
    }
}

/// A clock that moves only when told to (tests).
#[derive(Default)]
pub struct ManualClock(AtomicU64);

impl ManualClock {
    pub fn advance(&self, ms: u64) {
        self.0.fetch_add(ms, Ordering::SeqCst);
    }
}

impl Clock for ManualClock {
    fn now_ms(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RateLimits {
    pub window_ms: u64,
    pub failed_per_window: u32,
    pub total_per_window: u32,
}

impl Default for RateLimits {
    fn default() -> Self {
        Self {
            window_ms: 60_000,
            failed_per_window: 10,
            total_per_window: 120,
        }
    }
}

/// Addresses tracked at most; a full table first drops ended windows, then refuses new addresses.
const MAX_ADDRESSES: usize = 4_096;

#[derive(Debug, Clone, Copy)]
struct Window {
    start: u64,
    total: u32,
    failed: u32,
}

pub struct RateLimiter {
    limits: RateLimits,
    windows: Mutex<HashMap<IpAddr, Window>>,
}

/// The request is refused; the client may retry after this many seconds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetryAfter(pub u64);

impl RateLimiter {
    pub fn new(limits: RateLimits) -> Self {
        Self {
            limits,
            windows: Mutex::new(HashMap::new()),
        }
    }

    /// Counts one request from `ip`, or refuses it.
    pub fn hit(&self, ip: IpAddr, now: u64) -> Result<(), RetryAfter> {
        let mut windows = self.windows.lock().unwrap_or_else(|e| e.into_inner());
        let limits = self.limits;
        if !windows.contains_key(&ip) && windows.len() >= MAX_ADDRESSES {
            windows.retain(|_, w| now < w.start + limits.window_ms);
            if windows.len() >= MAX_ADDRESSES {
                return Err(RetryAfter(limits.window_ms.div_ceil(1_000)));
            }
        }
        let w = windows.entry(ip).or_insert(Window {
            start: now,
            total: 0,
            failed: 0,
        });
        if now >= w.start + limits.window_ms {
            *w = Window {
                start: now,
                total: 0,
                failed: 0,
            };
        }
        w.total = w.total.saturating_add(1);
        if w.failed >= limits.failed_per_window || w.total > limits.total_per_window {
            let left = (w.start + limits.window_ms).saturating_sub(now);
            return Err(RetryAfter(left.div_ceil(1_000).max(1)));
        }
        Ok(())
    }

    /// Counts a request from `ip` that had a missing or wrong token.
    pub fn failed(&self, ip: IpAddr) {
        let mut windows = self.windows.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(w) = windows.get_mut(&ip) {
            w.failed = w.failed.saturating_add(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: IpAddr = IpAddr::V4(std::net::Ipv4Addr::new(192, 168, 1, 10));
    const B: IpAddr = IpAddr::V4(std::net::Ipv4Addr::new(192, 168, 1, 11));

    #[test]
    fn eleven_failed_tokens_block_the_address_until_the_window_ends() {
        let r = RateLimiter::new(RateLimits::default());
        for _ in 0..10 {
            assert_eq!(r.hit(A, 1_000), Ok(()));
            r.failed(A);
        }
        // The 11th request (with a wrong or even the valid token) is refused.
        assert_eq!(r.hit(A, 1_000), Err(RetryAfter(60)));
        assert_eq!(r.hit(A, 31_000), Err(RetryAfter(30)));
        assert_eq!(r.hit(A, 60_999), Err(RetryAfter(1)));
        // Another address is not affected.
        assert_eq!(r.hit(B, 31_000), Ok(()));
        // A new window.
        assert_eq!(r.hit(A, 61_000), Ok(()));
    }

    #[test]
    fn more_than_120_requests_a_minute_are_refused() {
        let r = RateLimiter::new(RateLimits::default());
        for i in 0..120 {
            assert_eq!(r.hit(A, i), Ok(()), "request {i}");
        }
        assert_eq!(r.hit(A, 500), Err(RetryAfter(60)));
        assert_eq!(r.hit(B, 500), Ok(()));
        assert_eq!(r.hit(A, 60_000), Ok(()));
    }

    #[test]
    fn the_manual_clock_moves_only_when_told() {
        let c = ManualClock::default();
        assert_eq!(c.now_ms(), 0);
        c.advance(60_000);
        assert_eq!(c.now_ms(), 60_000);
        let s = SystemClock::new();
        assert!(s.now_ms() < 60_000);
    }

    #[test]
    fn the_address_table_is_bounded() {
        let r = RateLimiter::new(RateLimits::default());
        for i in 0..MAX_ADDRESSES as u32 {
            let ip = IpAddr::V4(std::net::Ipv4Addr::from(0x0a00_0000 + i));
            assert_eq!(r.hit(ip, 0), Ok(()));
        }
        assert!(r.hit(A, 10).is_err());
        // Once the old windows ended, new addresses are tracked again.
        assert_eq!(r.hit(A, 60_000), Ok(()));
    }
}
