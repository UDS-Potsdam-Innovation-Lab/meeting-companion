//! The core's only log output. Messages name what failed, never meeting content, transcript text or
//! audio: callers pass fixed text and error kinds only.
//!
//! Tests can capture every line logged from any thread with [`capture`], so a test can check that a
//! known phrase from a recording session never reaches the log.

use std::sync::Mutex;

static CAPTURE: Mutex<Option<Vec<String>>> = Mutex::new(None);

/// Writes one line to stderr, prefixed with the app name.
pub fn log(args: std::fmt::Arguments<'_>) {
    let line = format!("meeting-companion: {args}");
    if let Some(lines) = CAPTURE.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        lines.push(line.clone());
    }
    eprintln!("{line}");
}

/// `log!("…", args)`: see [`log`].
#[macro_export]
macro_rules! log {
    ($($arg:tt)*) => {
        $crate::log::log(format_args!($($arg)*))
    };
}

/// Tests that capture the log run one at a time: the capture is global.
#[cfg(test)]
static CAPTURING: Mutex<()> = Mutex::new(());

/// Starts collecting log lines (from every thread) until [`take_captured`] is called. Hold the
/// returned guard for the whole test: another capturing test waits until it is dropped.
#[cfg(test)]
pub fn capture() -> std::sync::MutexGuard<'static, ()> {
    let guard = CAPTURING.lock().unwrap_or_else(|e| e.into_inner());
    *CAPTURE.lock().unwrap_or_else(|e| e.into_inner()) = Some(Vec::new());
    guard
}

/// Stops collecting and returns what was logged since [`capture`].
#[cfg(test)]
pub fn take_captured() -> Vec<String> {
    CAPTURE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
        .unwrap_or_default()
}
