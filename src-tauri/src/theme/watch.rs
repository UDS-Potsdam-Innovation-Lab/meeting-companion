//! Polls the theme once a second and reports each switch once. `omarchy-theme-set` swaps the whole
//! theme folder (`rm -rf`, then `mv`) and then rewrites `theme.generation`, which file watchers handle
//! badly, so this compares a cheap [`Stamp`] (two small reads) instead and re-reads `colors.toml` only
//! when it changed.
//!
//! - A missing `colors.toml` keeps the previous theme; only after [`MISSING_POLLS`] polls in a row
//!   without it does the window fall back to its own tokens (`None`).
//! - A file that is there but unusable gives `None` at once, and logs one fixed line, never content.
//! - Nothing is reported while nothing changes.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::omarchy::{Stamp, ThemeRead, ThemeSource};
use super::OmarchyTheme;

/// Time between two polls.
pub const POLL_INTERVAL: Duration = Duration::from_secs(1);
/// Polls in a row without `colors.toml` before the theme counts as gone.
pub const MISSING_POLLS: u32 = 3;

/// Waits between polls; tests drive it by hand.
pub trait Clock {
    /// Waits `d`; `false` ends the poller.
    fn sleep(&self, d: Duration) -> bool;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn sleep(&self, d: Duration) -> bool {
        std::thread::sleep(d);
        true
    }
}

pub struct Watcher<S: ThemeSource> {
    source: S,
    stamp: Option<Stamp>,
    current: Option<OmarchyTheme>,
    missing: u32,
    logged_unusable: bool,
}

impl<S: ThemeSource> Watcher<S> {
    /// Reads the theme in effect now.
    pub fn new(source: S) -> Self {
        let mut w = Self {
            source,
            stamp: None,
            current: None,
            missing: 0,
            logged_unusable: false,
        };
        w.poll();
        w
    }

    pub fn current(&self) -> Option<&OmarchyTheme> {
        self.current.as_ref()
    }

    /// One poll. `Some(theme)` when the window has to change (`Some(None)`: back to its own tokens).
    pub fn poll(&mut self) -> Option<Option<OmarchyTheme>> {
        let stamp = self.source.stamp();
        if stamp.colors.is_none() {
            // Missing, maybe only for the moment of a swap.
            self.stamp = Some(stamp);
            self.current.as_ref()?;
            self.missing += 1;
            if self.missing < MISSING_POLLS {
                return None;
            }
            self.missing = 0;
            self.current = None;
            return Some(None);
        }
        self.missing = 0;
        if self.stamp.as_ref() == Some(&stamp) {
            return None;
        }
        let next = match self.source.read() {
            ThemeRead::Theme(t) => {
                self.logged_unusable = false;
                Some(t)
            }
            // Gone between the stamp and the read: look again next time.
            ThemeRead::Missing => {
                self.stamp = None;
                return None;
            }
            ThemeRead::Unusable => {
                if !self.logged_unusable {
                    crate::log!("omarchy theme: unreadable");
                    self.logged_unusable = true;
                }
                None
            }
        };
        self.stamp = Some(stamp);
        if next == self.current {
            return None;
        }
        self.current = next.clone();
        Some(next)
    }
}

/// The poller thread: polls until the clock says stop, keeps `shared` in step and calls `emit` once
/// per change (after `shared` holds it, so a read right after the event sees the new theme).
pub fn run<S, C, F>(
    mut watcher: Watcher<S>,
    clock: &C,
    shared: &Arc<Mutex<Option<OmarchyTheme>>>,
    emit: &F,
) where
    S: ThemeSource,
    C: Clock + ?Sized,
    F: Fn(Option<&OmarchyTheme>) + ?Sized,
{
    while clock.sleep(POLL_INTERVAL) {
        if let Some(change) = watcher.poll() {
            *shared.lock().unwrap_or_else(|e| e.into_inner()) = change.clone();
            emit(change.as_ref());
        }
    }
}

/// A theme source in memory, for tests.
#[cfg(test)]
#[derive(Clone, Default)]
pub struct FakeThemeSource {
    state: Arc<Mutex<(Stamp, ThemeRead)>>,
    reads: Arc<Mutex<u32>>,
}

#[cfg(test)]
impl FakeThemeSource {
    pub fn set(&self, stamp: Stamp, read: ThemeRead) {
        *self.state.lock().unwrap() = (stamp, read);
    }
    pub fn reads(&self) -> u32 {
        *self.reads.lock().unwrap()
    }
}

#[cfg(test)]
impl ThemeSource for FakeThemeSource {
    fn stamp(&self) -> Stamp {
        self.state.lock().unwrap().0.clone()
    }
    fn read(&self) -> ThemeRead {
        *self.reads.lock().unwrap() += 1;
        self.state.lock().unwrap().1.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::super::omarchy::OmarchyThemeSource;
    use super::super::ThemeMode;
    use super::*;
    use std::collections::BTreeMap;
    use std::fs;
    use std::sync::mpsc;
    use std::time::SystemTime;
    use tempfile::TempDir;

    fn theme(name: &str, bg: &str) -> OmarchyTheme {
        OmarchyTheme {
            name: name.into(),
            mode: ThemeMode::Dark,
            palette: BTreeMap::from([
                ("background".into(), bg.into()),
                ("foreground".into(), "#ffffff".into()),
            ]),
        }
    }

    fn stamp(generation: &str, present: bool) -> Stamp {
        Stamp {
            generation: Some(generation.into()),
            colors: present.then_some(SystemTime::UNIX_EPOCH),
        }
    }

    /// A clock whose every `sleep` waits for the test to send one tick (one second of virtual time).
    struct TickClock {
        ticks: Mutex<mpsc::Receiver<()>>,
        done: mpsc::Sender<()>,
        elapsed: Mutex<Duration>,
    }

    impl Clock for TickClock {
        fn sleep(&self, d: Duration) -> bool {
            // Tell the test the previous poll is finished.
            let _ = self.done.send(());
            let ok = self.ticks.lock().unwrap().recv().is_ok();
            if ok {
                *self.elapsed.lock().unwrap() += d;
            }
            ok
        }
    }

    /// Runs the poller on a [`TickClock`]; `tick()` advances one poll and waits until it is done.
    struct Harness {
        tick: Option<mpsc::Sender<()>>,
        done: mpsc::Receiver<()>,
        events: Arc<Mutex<Vec<Option<OmarchyTheme>>>>,
        shared: Arc<Mutex<Option<OmarchyTheme>>>,
        thread: Option<std::thread::JoinHandle<Duration>>,
    }

    impl Harness {
        fn start<S: ThemeSource + 'static>(source: S) -> Self {
            let (tick, ticks) = mpsc::channel();
            let (done_tx, done) = mpsc::channel();
            let events = Arc::new(Mutex::new(Vec::new()));
            let watcher = Watcher::new(source);
            let shared = Arc::new(Mutex::new(watcher.current().cloned()));
            let (e, s) = (events.clone(), shared.clone());
            let thread = std::thread::spawn(move || {
                let clock = TickClock {
                    ticks: Mutex::new(ticks),
                    done: done_tx,
                    elapsed: Mutex::new(Duration::ZERO),
                };
                run(watcher, &clock, &s, &|t: Option<&OmarchyTheme>| {
                    e.lock().unwrap().push(t.cloned())
                });
                let elapsed = *clock.elapsed.lock().unwrap();
                elapsed
            });
            let h = Self {
                tick: Some(tick),
                done,
                events,
                shared,
                thread: Some(thread),
            };
            h.done.recv().unwrap();
            h
        }
        fn tick(&self) {
            self.tick.as_ref().unwrap().send(()).unwrap();
            self.done
                .recv_timeout(Duration::from_secs(5))
                .expect("poll did not finish");
        }
        fn events(&self) -> Vec<Option<OmarchyTheme>> {
            self.events.lock().unwrap().clone()
        }
        fn stop(mut self) -> Duration {
            drop(self.tick.take());
            self.thread.take().unwrap().join().unwrap()
        }
    }

    // ---- AC3 -------------------------------------------------------------------------------------

    fn write_theme(dir: &TempDir, generation: &str, bg: &str) {
        fs::create_dir_all(dir.path().join("theme")).unwrap();
        fs::write(
            dir.path().join("theme/colors.toml"),
            format!("background = \"{bg}\"\nforeground = \"#ffffff\"\n"),
        )
        .unwrap();
        fs::write(dir.path().join("theme.generation"), generation).unwrap();
    }

    #[test]
    fn a_switch_on_disk_is_reported_once_within_two_polls() {
        let dir = TempDir::new().unwrap();
        write_theme(&dir, "1", "#111111");
        fs::write(dir.path().join("theme.name"), "one").unwrap();
        let h = Harness::start(OmarchyThemeSource::new(dir.path()));
        assert_eq!(h.shared.lock().unwrap().as_ref().unwrap().name, "one");
        h.tick();
        h.tick();
        assert!(h.events().is_empty(), "nothing changes, nothing is sent");

        // The switch: theme.generation and colors.toml rewritten.
        write_theme(&dir, "2", "#222222");
        fs::write(dir.path().join("theme.name"), "two").unwrap();
        h.tick();
        h.tick();
        let events = h.events();
        assert_eq!(events.len(), 1, "{events:?}");
        let got = events[0].as_ref().unwrap();
        assert_eq!(got.name, "two");
        assert_eq!(got.palette["background"], "#222222");
        assert_eq!(h.shared.lock().unwrap().as_ref(), Some(got));

        for _ in 0..5 {
            h.tick();
        }
        assert_eq!(h.events().len(), 1, "still one event per switch");
        assert_eq!(h.stop(), Duration::from_secs(9));
    }

    #[test]
    fn the_switch_arrives_on_the_first_poll_after_it() {
        let src = FakeThemeSource::default();
        src.set(stamp("1", true), ThemeRead::Theme(theme("a", "#111111")));
        let h = Harness::start(src.clone());
        src.set(stamp("2", true), ThemeRead::Theme(theme("b", "#222222")));
        h.tick();
        assert_eq!(h.events(), vec![Some(theme("b", "#222222"))]);
        assert!(h.stop() <= Duration::from_secs(2));
    }

    #[test]
    fn nothing_is_read_or_sent_while_nothing_changes() {
        let src = FakeThemeSource::default();
        src.set(stamp("1", true), ThemeRead::Theme(theme("a", "#111111")));
        let h = Harness::start(src.clone());
        let reads = src.reads();
        for _ in 0..10 {
            h.tick();
        }
        assert_eq!(src.reads(), reads, "only the stamp is looked at");
        assert!(h.events().is_empty());
        h.stop();
    }

    #[test]
    fn a_folder_missing_during_a_swap_keeps_the_previous_theme() {
        let src = FakeThemeSource::default();
        src.set(stamp("1", true), ThemeRead::Theme(theme("a", "#111111")));
        let h = Harness::start(src.clone());
        // rm -rf: missing for two polls, then mv brings the new theme.
        src.set(stamp("1", false), ThemeRead::Missing);
        h.tick();
        h.tick();
        assert!(h.events().is_empty());
        assert_eq!(h.shared.lock().unwrap().as_ref().unwrap().name, "a");
        src.set(stamp("2", true), ThemeRead::Theme(theme("b", "#222222")));
        h.tick();
        assert_eq!(h.events(), vec![Some(theme("b", "#222222"))]);
        h.stop();
    }

    #[test]
    fn three_missing_polls_in_a_row_fall_back_to_the_default_tokens() {
        let src = FakeThemeSource::default();
        src.set(stamp("1", true), ThemeRead::Theme(theme("a", "#111111")));
        let h = Harness::start(src.clone());
        src.set(stamp("1", false), ThemeRead::Missing);
        h.tick();
        h.tick();
        assert!(h.events().is_empty());
        h.tick();
        assert_eq!(h.events(), vec![None]);
        assert_eq!(*h.shared.lock().unwrap(), None);
        for _ in 0..4 {
            h.tick();
        }
        assert_eq!(h.events(), vec![None], "sent once");
        // The theme comes back.
        src.set(stamp("2", true), ThemeRead::Theme(theme("a", "#111111")));
        h.tick();
        assert_eq!(h.events(), vec![None, Some(theme("a", "#111111"))]);
        h.stop();
    }

    #[test]
    fn missing_polls_that_are_not_in_a_row_do_not_count() {
        let src = FakeThemeSource::default();
        src.set(stamp("1", true), ThemeRead::Theme(theme("a", "#111111")));
        let h = Harness::start(src.clone());
        for _ in 0..3 {
            src.set(stamp("1", false), ThemeRead::Missing);
            h.tick();
            h.tick();
            src.set(stamp("1", true), ThemeRead::Theme(theme("a", "#111111")));
            h.tick();
        }
        assert!(h.events().is_empty(), "{:?}", h.events());
        h.stop();
    }

    #[test]
    fn an_unusable_theme_falls_back_at_once_and_logs_one_fixed_line() {
        crate::log::capture();
        let src = FakeThemeSource::default();
        src.set(stamp("1", true), ThemeRead::Theme(theme("a", "#111111")));
        let h = Harness::start(src.clone());
        src.set(stamp("2", true), ThemeRead::Unusable);
        h.tick();
        assert_eq!(h.events(), vec![None]);
        src.set(stamp("3", true), ThemeRead::Unusable);
        h.tick();
        h.tick();
        assert_eq!(h.events(), vec![None]);
        h.stop();
        let lines = crate::log::take_captured();
        assert_eq!(lines, vec!["meeting-companion: omarchy theme: unreadable"]);
    }

    /// AC2: nothing from the files reaches the log, whatever they hold.
    #[test]
    fn nothing_from_the_files_is_logged() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("theme")).unwrap();
        let secret = "SECRET-THEME-CONTENT";
        fs::write(dir.path().join("theme.name"), secret).unwrap();
        fs::write(dir.path().join("theme.generation"), secret).unwrap();
        fs::write(
            dir.path().join("theme/colors.toml"),
            format!("background = \"{secret}\"\nforeground = \"#fff\"\n{secret} = \"#fff\"\n"),
        )
        .unwrap();
        crate::log::capture();
        let src = OmarchyThemeSource::new(dir.path());
        let mut w = Watcher::new(src);
        fs::write(dir.path().join("theme/colors.toml"), vec![0xff; 20_000]).unwrap();
        fs::write(dir.path().join("theme.generation"), "2").unwrap();
        w.poll();
        let lines = crate::log::take_captured();
        assert!(lines.iter().all(|l| !l.contains("SECRET")), "{lines:?}");
        assert!(lines
            .iter()
            .all(|l| l == "meeting-companion: omarchy theme: unreadable"));
    }

    #[test]
    fn no_omarchy_at_all_sends_nothing() {
        let dir = TempDir::new().unwrap();
        let h = Harness::start(OmarchyThemeSource::new(dir.path().join("missing")));
        for _ in 0..5 {
            h.tick();
        }
        assert!(h.events().is_empty());
        assert_eq!(*h.shared.lock().unwrap(), None);
        h.stop();
    }
}
