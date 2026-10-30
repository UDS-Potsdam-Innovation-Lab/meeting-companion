//! The core's only log output. Messages name what failed, never meeting content, transcript text or
//! audio: callers pass fixed text and error kinds only.
//!
//! Tests can capture every line logged from any thread with [`capture`], so a test can check that a
//! known phrase from a recording session never reaches the log.

use std::sync::Mutex;

static CAPTURE: Mutex<Option<Vec<String>>> = Mutex::new(None);
/// One capture at a time: tests run in parallel, and a second capture would reset the first.
#[cfg(test)]
static CAPTURING: (Mutex<bool>, std::sync::Condvar) =
    (Mutex::new(false), std::sync::Condvar::new());

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

/// Starts collecting log lines (from every thread) until [`take_captured`] is called.
/// Waits (at most 60 s) while another test captures.
#[cfg(test)]
pub fn capture() {
    let (busy, freed) = &CAPTURING;
    let guard = busy.lock().unwrap_or_else(|e| e.into_inner());
    let (mut guard, _) = freed
        .wait_timeout_while(guard, std::time::Duration::from_secs(60), |b| *b)
        .unwrap_or_else(|e| e.into_inner());
    *guard = true;
    *CAPTURE.lock().unwrap_or_else(|e| e.into_inner()) = Some(Vec::new());
}

/// Stops collecting and returns what was logged since [`capture`].
#[cfg(test)]
pub fn take_captured() -> Vec<String> {
    let lines = CAPTURE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
        .unwrap_or_default();
    let (busy, freed) = &CAPTURING;
    *busy.lock().unwrap_or_else(|e| e.into_inner()) = false;
    freed.notify_all();
    lines
}
