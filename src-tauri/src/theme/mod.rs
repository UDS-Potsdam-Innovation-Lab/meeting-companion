//! The desktop theme the UI may follow (job 020). On Linux this is the active Omarchy theme, read
//! read-only from the files Omarchy itself maintains (`omarchy.rs`) and polled once a second for a
//! switch (`watch.rs`). Every other platform has no theme source: [`ThemeService::start`] returns a
//! service that always answers `None` and starts no thread.
//!
//! The files can come from a theme cloned from a stranger's repository, so they are untrusted input:
//! the core passes on only `#rrggbb` colours, `light`/`dark` and a `[a-z0-9-]{1,64}` slug, and never
//! logs anything read from them.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;

#[cfg(target_os = "linux")]
pub mod omarchy;
#[cfg(target_os = "linux")]
pub mod watch;

/// Light or dark, as the theme declares or its background implies.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    Light,
    Dark,
}

/// The active desktop theme as the UI receives it (`omarchy_theme`, event `omarchy-theme`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OmarchyTheme {
    /// The theme's slug (`tokyo-night`); empty when `theme.name` is missing or not a valid slug.
    pub name: String,
    pub mode: ThemeMode,
    /// Omarchy's palette keys (`background`, `accent`, …), each value `#rrggbb`.
    pub palette: BTreeMap<String, String>,
}

/// The theme the window should follow right now, kept in step by the poller.
#[derive(Clone, Default)]
pub struct ThemeService {
    current: Arc<Mutex<Option<OmarchyTheme>>>,
}

impl ThemeService {
    /// The theme in effect, or `None` (no Omarchy theme: the UI keeps its own tokens).
    pub fn current(&self) -> Option<OmarchyTheme> {
        self.current
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Linux: reads the active Omarchy theme and starts the poller thread, which calls `emit` once
    /// per switch. Without a home folder there is nothing to read and no thread.
    #[cfg(target_os = "linux")]
    pub fn start<F>(emit: F) -> Self
    where
        F: Fn(Option<&OmarchyTheme>) + Send + 'static,
    {
        let service = Self::default();
        let Some(source) = omarchy::OmarchyThemeSource::from_home() else {
            return service;
        };
        let watcher = watch::Watcher::new(source);
        *service.current.lock().unwrap_or_else(|e| e.into_inner()) = watcher.current().cloned();
        let shared = service.current.clone();
        std::thread::Builder::new()
            .name("omarchy-theme".into())
            .spawn(move || watch::run(watcher, &watch::SystemClock, &shared, &emit))
            .ok();
        service
    }

    /// Not Linux: no theme source, no thread; `current` is always `None`.
    #[cfg(not(target_os = "linux"))]
    pub fn start<F>(_emit: F) -> Self
    where
        F: Fn(Option<&OmarchyTheme>) + Send + 'static,
    {
        Self::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// AC1: macOS and Windows builds have no source and start no thread.
    #[cfg(not(target_os = "linux"))]
    #[test]
    fn other_platforms_never_have_a_theme_and_start_no_thread() {
        let emitted = Arc::new(Mutex::new(0));
        let count = emitted.clone();
        let service = ThemeService::start(move |_| *count.lock().unwrap() += 1);
        assert_eq!(service.current(), None);
        std::thread::sleep(std::time::Duration::from_millis(1_500));
        assert_eq!(*emitted.lock().unwrap(), 0);
        // Only this handle and none held by a thread.
        assert_eq!(Arc::strong_count(&service.current), 1);
    }

    #[test]
    fn the_ui_receives_name_mode_and_palette() {
        let theme = OmarchyTheme {
            name: "tokyo-night".into(),
            mode: ThemeMode::Dark,
            palette: BTreeMap::from([("background".into(), "#1a1b26".into())]),
        };
        assert_eq!(
            serde_json::to_value(&theme).unwrap(),
            serde_json::json!({
                "name": "tokyo-night",
                "mode": "dark",
                "palette": { "background": "#1a1b26" }
            })
        );
    }
}
