//! Reads the active Omarchy theme (Omarchy 4.x) from `$HOME/.local/state/omarchy/current/`:
//! - `theme/colors.toml`: flat `key = "value"` lines (palette keys, legacy `color0`…`color15`,
//!   `mode` or the legacy `theme_type`);
//! - `theme/light.mode`: an optional marker file;
//! - `theme.name`: the slug; `theme.generation`: a token `omarchy-theme-set` rewrites on every switch.
//!
//! Read-only, no process, no network. Every file is opened non-blocking and must be a regular file
//! of at most [`MAX_FILE_BYTES`] in UTF-8; anything else is unusable. Only `#rgb`, `#rrggbb` and
//! `#rrggbbaa` values of known keys are taken (normalised to `#rrggbb`), key by key.

use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Read as _;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use super::{OmarchyTheme, ThemeMode};

/// Larger files are not read at all.
pub const MAX_FILE_BYTES: u64 = 16 * 1024;
/// `theme.name` and `theme.generation` are a single short line.
const MAX_LINE_FILE_BYTES: u64 = 256;

/// The palette keys passed on to the UI (Omarchy's semantic names).
pub const PALETTE_KEYS: [&str; 18] = [
    "accent",
    "background",
    "foreground",
    "dark_background",
    "darker_background",
    "lighter_background",
    "dark_foreground",
    "light_foreground",
    "bright_foreground",
    "muted",
    "selection",
    "red",
    "yellow",
    "orange",
    "green",
    "cyan",
    "blue",
    "magenta",
];

/// Semantic keys an older theme gives only as an ANSI colour (as `omarchy-theme-color` resolves them).
const LEGACY_ALIASES: [(&str, &str); 13] = [
    ("background", "color0"),
    ("foreground", "color7"),
    ("red", "color1"),
    ("green", "color2"),
    ("yellow", "color3"),
    ("blue", "color4"),
    ("magenta", "color5"),
    ("cyan", "color6"),
    ("muted", "color8"),
    ("dark_foreground", "color8"),
    ("lighter_background", "color0"),
    ("light_foreground", "color7"),
    ("bright_foreground", "color15"),
];

/// Where the active theme lives, below the home folder (Omarchy hardcodes it; no `XDG_STATE_HOME`).
pub const CURRENT_DIR: &str = ".local/state/omarchy/current";

/// What a read found.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum ThemeRead {
    Theme(OmarchyTheme),
    /// No `colors.toml` (no Omarchy, or the folder is being swapped).
    #[default]
    Missing,
    /// The file is there but cannot be used: not a regular file, too large, not UTF-8, unreadable,
    /// or without a valid `background` and `foreground`.
    Unusable,
}

impl ThemeRead {
    pub fn theme(self) -> Option<OmarchyTheme> {
        match self {
            ThemeRead::Theme(t) => Some(t),
            _ => None,
        }
    }
}

/// A cheap marker of the theme on disk: changes on every switch. `colors` is `None` while
/// `colors.toml` is missing.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Stamp {
    pub generation: Option<String>,
    pub colors: Option<SystemTime>,
}

/// Where the poller gets the theme from; [`OmarchyThemeSource`] in the app, a fake in tests.
pub trait ThemeSource: Send {
    fn stamp(&self) -> Stamp;
    fn read(&self) -> ThemeRead;
}

/// The files of the running Omarchy, below one `current` folder.
pub struct OmarchyThemeSource {
    current: PathBuf,
}

impl OmarchyThemeSource {
    /// `current` is the folder laid out like `~/.local/state/omarchy/current/`.
    pub fn new(current: impl Into<PathBuf>) -> Self {
        Self {
            current: current.into(),
        }
    }

    /// `$HOME/.local/state/omarchy/current`; `None` without a usable `HOME`.
    pub fn from_home() -> Option<Self> {
        let home = std::env::var_os("HOME").filter(|h| !h.is_empty())?;
        let home = PathBuf::from(home);
        home.is_absolute()
            .then(|| Self::new(home.join(CURRENT_DIR)))
    }

    fn colors_path(&self) -> PathBuf {
        self.current.join("theme").join("colors.toml")
    }
}

impl ThemeSource for OmarchyThemeSource {
    fn stamp(&self) -> Stamp {
        let generation = read_small(&self.current.join("theme.generation"), MAX_LINE_FILE_BYTES)
            .ok()
            .map(|g| g.trim().to_owned());
        let colors = fs::metadata(self.colors_path())
            .ok()
            .map(|m| m.modified().unwrap_or(SystemTime::UNIX_EPOCH));
        Stamp { generation, colors }
    }

    fn read(&self) -> ThemeRead {
        let text = match read_small(&self.colors_path(), MAX_FILE_BYTES) {
            Ok(text) => text,
            Err(FileError::Missing) => return ThemeRead::Missing,
            Err(FileError::Unusable) => return ThemeRead::Unusable,
        };
        let light_file =
            fs::metadata(self.current.join("theme").join("light.mode")).is_ok_and(|m| m.is_file());
        let name = read_small(&self.current.join("theme.name"), MAX_LINE_FILE_BYTES)
            .ok()
            .map(|n| valid_slug(n.trim()))
            .unwrap_or_default();
        match parse_theme(&text, light_file, name) {
            Some(theme) => ThemeRead::Theme(theme),
            None => ThemeRead::Unusable,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
enum FileError {
    Missing,
    Unusable,
}

/// Reads a small regular file without ever blocking: opened with `O_NONBLOCK` (a FIFO opens at once
/// instead of waiting for a writer), then checked on the open handle, so a swap in between is caught.
fn read_small(path: &Path, limit: u64) -> Result<String, FileError> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NONBLOCK | libc::O_NOCTTY | libc::O_CLOEXEC)
        .open(path)
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => FileError::Missing,
            _ => FileError::Unusable,
        })?;
    let meta = file.metadata().map_err(|_| FileError::Unusable)?;
    if !meta.is_file() || meta.len() > limit {
        return Err(FileError::Unusable);
    }
    let mut bytes = Vec::with_capacity(usize::try_from(meta.len()).unwrap_or(0));
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| FileError::Unusable)?;
    if bytes.len() as u64 > limit {
        return Err(FileError::Unusable);
    }
    String::from_utf8(bytes).map_err(|_| FileError::Unusable)
}

/// `[a-z0-9-]{1,64}`, else empty.
pub fn valid_slug(name: &str) -> String {
    let ok = (1..=64).contains(&name.len())
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    if ok {
        name.to_owned()
    } else {
        String::new()
    }
}

/// `#rgb`, `#rrggbb` or `#rrggbbaa` → `#rrggbb` (lower case, alpha dropped); anything else `None`.
pub fn normalise_hex(value: &str) -> Option<String> {
    let digits = value.strip_prefix('#')?;
    if !digits.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let digits = digits.to_ascii_lowercase();
    match digits.len() {
        3 => Some(
            digits
                .chars()
                .flat_map(|c| [c, c])
                .fold(String::from("#"), |mut s, c| {
                    s.push(c);
                    s
                }),
        ),
        6 | 8 => Some(format!("#{}", &digits[..6])),
        _ => None,
    }
}

fn is_colour_key(key: &str) -> bool {
    PALETTE_KEYS.contains(&key)
        || key
            .strip_prefix("color")
            .and_then(|n| n.parse::<u8>().ok())
            .is_some_and(|n| n <= 15 && key.len() <= "color15".len())
}

/// The value of a `key = value` line: the text between the first pair of quotes, or the first word
/// of an unquoted value.
fn line_value(raw: &str) -> Option<&str> {
    let raw = raw.trim();
    let first = raw.chars().next()?;
    if first == '"' || first == '\'' {
        let rest = &raw[1..];
        let end = rest.find(first)?;
        Some(&rest[..end])
    } else {
        raw.split_whitespace().next()
    }
}

fn mode_word(value: &str) -> Option<ThemeMode> {
    match value {
        "light" => Some(ThemeMode::Light),
        "dark" => Some(ThemeMode::Dark),
        _ => None,
    }
}

/// The palette and mode keys of `colors.toml`; unknown keys and invalid values are dropped one by one.
struct Parsed {
    colours: BTreeMap<String, String>,
    mode: Option<ThemeMode>,
    theme_type: Option<ThemeMode>,
}

fn parse_lines(text: &str) -> Parsed {
    let mut parsed = Parsed {
        colours: BTreeMap::new(),
        mode: None,
        theme_type: None,
    };
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim().trim_matches(|c| c == '"' || c == '\'');
        let Some(value) = line_value(value) else {
            continue;
        };
        match key {
            "mode" => parsed.mode = mode_word(value).or(parsed.mode),
            "theme_type" => parsed.theme_type = mode_word(value).or(parsed.theme_type),
            _ if is_colour_key(key) => {
                if let Some(hex) = normalise_hex(value) {
                    parsed.colours.insert(key.to_owned(), hex);
                }
            }
            _ => {}
        }
    }
    parsed
}

/// The mode in `omarchy-theme-color`'s order: `mode`, `theme_type`, a `light.mode` file, the
/// background's brightness (sum of the channels above 382 is light), dark.
pub fn resolve_mode(
    mode: Option<ThemeMode>,
    theme_type: Option<ThemeMode>,
    light_file: bool,
    background: Option<&str>,
) -> ThemeMode {
    if let Some(m) = mode.or(theme_type) {
        return m;
    }
    if light_file {
        return ThemeMode::Light;
    }
    match background.and_then(channel_sum) {
        Some(sum) if sum > 382 => ThemeMode::Light,
        _ => ThemeMode::Dark,
    }
}

fn channel_sum(hex: &str) -> Option<u32> {
    let d = hex.strip_prefix('#')?;
    if d.len() != 6 {
        return None;
    }
    (0..3)
        .map(|i| u32::from_str_radix(&d[i * 2..i * 2 + 2], 16).ok())
        .sum()
}

/// The theme of one `colors.toml`; `None` without a valid `background` and `foreground`.
pub fn parse_theme(text: &str, light_file: bool, name: String) -> Option<OmarchyTheme> {
    let parsed = parse_lines(text);
    let mut colours = parsed.colours;
    for (key, legacy) in LEGACY_ALIASES {
        if !colours.contains_key(key) {
            if let Some(v) = colours.get(legacy).cloned() {
                colours.insert(key.to_owned(), v);
            }
        }
    }
    let palette: BTreeMap<String, String> = colours
        .into_iter()
        .filter(|(k, _)| PALETTE_KEYS.contains(&k.as_str()))
        .collect();
    if !palette.contains_key("background") || !palette.contains_key("foreground") {
        return None;
    }
    let mode = resolve_mode(
        parsed.mode,
        parsed.theme_type,
        light_file,
        palette.get("background").map(String::as_str),
    );
    Some(OmarchyTheme {
        name,
        mode,
        palette,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use tempfile::TempDir;

    const TOKYO_NIGHT: &str = include_str!("../../testdata/omarchy/tokyo-night/theme/colors.toml");

    /// A folder laid out like `~/.local/state/omarchy/current/`.
    fn current(colors: Option<&str>, name: Option<&str>) -> TempDir {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("theme")).unwrap();
        if let Some(c) = colors {
            fs::write(dir.path().join("theme/colors.toml"), c).unwrap();
        }
        if let Some(n) = name {
            fs::write(dir.path().join("theme.name"), n).unwrap();
        }
        dir
    }

    fn read(dir: &TempDir) -> ThemeRead {
        OmarchyThemeSource::new(dir.path()).read()
    }

    fn theme(dir: &TempDir) -> OmarchyTheme {
        match read(dir) {
            ThemeRead::Theme(t) => t,
            other => panic!("expected a theme, got {other:?}"),
        }
    }

    const BASE: &str = "background = \"#101010\"\nforeground = \"#f0f0f0\"\n";

    // ---- AC1 -------------------------------------------------------------------------------------

    #[test]
    fn colors_and_name_give_name_mode_and_a_normalised_palette() {
        let dir = current(Some(TOKYO_NIGHT), Some("tokyo-night\n"));
        let t = theme(&dir);
        assert_eq!(t.name, "tokyo-night");
        assert_eq!(t.mode, ThemeMode::Dark);
        assert_eq!(t.palette["background"], "#1a1b26");
        assert_eq!(t.palette["accent"], "#7aa2f7");
        assert_eq!(t.palette.len(), PALETTE_KEYS.len());
        for (k, v) in &t.palette {
            assert!(PALETTE_KEYS.contains(&k.as_str()), "{k}");
            assert!(
                v.len() == 7 && v.starts_with('#') && v[1..].bytes().all(|b| b.is_ascii_hexdigit()),
                "{k} = {v}"
            );
            assert_eq!(v, &v.to_ascii_lowercase());
        }
    }

    #[test]
    fn short_long_and_upper_case_hex_are_normalised() {
        let dir = current(
            Some("background = \"#ABC\"\nforeground = '#F0F0F0'\naccent = \"#7aa2f7cc\"\nred = #ff0000 # inline\n"),
            None,
        );
        let t = theme(&dir);
        assert_eq!(t.palette["background"], "#aabbcc");
        assert_eq!(t.palette["foreground"], "#f0f0f0");
        assert_eq!(t.palette["accent"], "#7aa2f7");
        assert_eq!(t.palette["red"], "#ff0000");
    }

    #[test]
    fn legacy_ansi_colours_fill_the_semantic_keys() {
        let dir = current(
            Some("color0 = \"#000000\"\ncolor7 = \"#cccccc\"\ncolor1 = \"#cc0000\"\ncolor2 = \"#00cc00\"\n"),
            None,
        );
        let t = theme(&dir);
        assert_eq!(t.palette["background"], "#000000");
        assert_eq!(t.palette["foreground"], "#cccccc");
        assert_eq!(t.palette["red"], "#cc0000");
        assert_eq!(t.palette["green"], "#00cc00");
        assert!(!t.palette.contains_key("color0"));
    }

    #[test]
    fn mode_step_1_the_mode_key_wins() {
        let dir = current(
            Some(&format!("mode = \"light\"\ntheme_type = \"dark\"\n{BASE}")),
            None,
        );
        fs::write(dir.path().join("theme/light.mode"), "").unwrap();
        assert_eq!(theme(&dir).mode, ThemeMode::Light);
        let dir = current(Some(&format!("mode = \"dark\"\n{BASE}")), None);
        fs::write(dir.path().join("theme/light.mode"), "").unwrap();
        assert_eq!(theme(&dir).mode, ThemeMode::Dark);
    }

    #[test]
    fn mode_step_2_the_legacy_theme_type() {
        let dir = current(Some(&format!("theme_type = \"light\"\n{BASE}")), None);
        assert_eq!(theme(&dir).mode, ThemeMode::Light);
        // An invalid `mode` value does not count.
        let dir = current(
            Some(&format!("mode = \"sepia\"\ntheme_type = \"light\"\n{BASE}")),
            None,
        );
        assert_eq!(theme(&dir).mode, ThemeMode::Light);
    }

    #[test]
    fn mode_step_3_a_light_mode_file() {
        let dir = current(Some(BASE), None);
        fs::write(dir.path().join("theme/light.mode"), "").unwrap();
        assert_eq!(theme(&dir).mode, ThemeMode::Light);
    }

    #[test]
    fn mode_step_4_the_background_luminance() {
        let light = current(
            Some("background = \"#eff1f5\"\nforeground = \"#4c4f69\"\n"),
            None,
        );
        assert_eq!(theme(&light).mode, ThemeMode::Light);
        let dark = current(Some(BASE), None);
        assert_eq!(theme(&dark).mode, ThemeMode::Dark);
        // Omarchy's threshold: a channel sum above 382.
        assert_eq!(
            resolve_mode(None, None, false, Some("#7f7f81")),
            ThemeMode::Light
        );
        assert_eq!(
            resolve_mode(None, None, false, Some("#7f7f80")),
            ThemeMode::Dark
        );
    }

    #[test]
    fn mode_step_5_dark_without_anything_else() {
        assert_eq!(resolve_mode(None, None, false, None), ThemeMode::Dark);
    }

    #[test]
    fn no_folder_gives_none() {
        let dir = TempDir::new().unwrap();
        let source = OmarchyThemeSource::new(dir.path().join("does-not-exist"));
        assert_eq!(source.read(), ThemeRead::Missing);
        assert_eq!(source.read().theme(), None);
        assert_eq!(source.stamp().colors, None);
    }

    #[test]
    fn no_background_or_foreground_gives_none() {
        let dir = current(
            Some("foreground = \"#ffffff\"\naccent = \"#ff0000\"\n"),
            None,
        );
        assert_eq!(read(&dir), ThemeRead::Unusable);
        let dir = current(Some("background = \"#000000\"\n"), None);
        assert_eq!(read(&dir), ThemeRead::Unusable);
        // A background that is not a colour is no background.
        let dir = current(
            Some("background = \"var(--x)\"\nforeground = \"#ffffff\"\n"),
            None,
        );
        assert_eq!(read(&dir).theme(), None);
    }

    // ---- AC2 -------------------------------------------------------------------------------------

    #[test]
    fn values_that_are_not_hex_colours_are_dropped_key_by_key() {
        let long = format!("#{}", "a".repeat(4_000));
        let text = format!(
            "{BASE}red = \"red; background:url(http://x)\"\nyellow = \"var(--x)\"\ngreen = \"expression(alert(1))\"\n\
             cyan = \"{long}\"\nblue = \"#ääää\"\nmagenta = \"#12345\"\norange = \"#ff8800\"\naccent = \"rgb(1,2,3)\"\n\
             muted = \"#ff0000;}}\"\nselection = \"#1234567\"\n"
        );
        let dir = current(Some(&text), None);
        let t = theme(&dir);
        assert_eq!(
            t.palette.keys().collect::<Vec<_>>(),
            vec!["background", "foreground", "orange"]
        );
    }

    #[test]
    fn unknown_keys_are_ignored() {
        let text = format!(
            "{BASE}font = \"#ffffff\"\nbackground-image = \"#ffffff\"\ncolor16 = \"#ffffff\"\ncolor007 = \"#ffffff\"\n\
             bright_red = \"#ff0000\"\n__proto__ = \"#ffffff\"\n"
        );
        let t = theme(&current(Some(&text), None));
        assert_eq!(
            t.palette.keys().collect::<Vec<_>>(),
            vec!["background", "foreground"]
        );
    }

    #[test]
    fn a_file_over_16_kb_gives_none() {
        let big = format!("{BASE}# {}\n", "x".repeat(MAX_FILE_BYTES as usize));
        assert_eq!(read(&current(Some(&big), None)), ThemeRead::Unusable);
        // Exactly at the limit is still read.
        let pad = MAX_FILE_BYTES as usize - BASE.len() - 3;
        let edge = format!("{BASE}# {}\n", "x".repeat(pad));
        assert_eq!(edge.len() as u64, MAX_FILE_BYTES);
        assert!(read(&current(Some(&edge), None)).theme().is_some());
    }

    #[test]
    fn a_folder_in_place_of_the_file_gives_none() {
        let dir = current(None, None);
        fs::create_dir(dir.path().join("theme/colors.toml")).unwrap();
        assert_eq!(read(&dir), ThemeRead::Unusable);
    }

    #[test]
    fn a_fifo_gives_none_without_blocking() {
        let dir = current(None, None);
        let fifo = dir.path().join("theme/colors.toml");
        let c = std::ffi::CString::new(fifo.as_os_str().as_encoded_bytes()).unwrap();
        // SAFETY: a valid NUL-terminated path; mkfifo has no other preconditions.
        assert_eq!(unsafe { libc::mkfifo(c.as_ptr(), 0o600) }, 0);
        let (tx, rx) = std::sync::mpsc::channel();
        let path = dir.path().to_owned();
        std::thread::spawn(move || {
            let _ = tx.send(OmarchyThemeSource::new(path).read());
        });
        let got = rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .expect("reading a FIFO blocked");
        assert_eq!(got, ThemeRead::Unusable);
    }

    #[test]
    fn a_device_gives_none() {
        let dir = current(None, None);
        std::os::unix::fs::symlink("/dev/zero", dir.path().join("theme/colors.toml")).unwrap();
        assert_eq!(read(&dir), ThemeRead::Unusable);
    }

    #[test]
    fn a_file_that_is_not_utf8_gives_none() {
        let dir = current(None, None);
        let mut bytes = BASE.as_bytes().to_vec();
        bytes.extend_from_slice(b"accent = \"#ff0000\" \xff\xfe\n");
        fs::write(dir.path().join("theme/colors.toml"), bytes).unwrap();
        assert_eq!(read(&dir), ThemeRead::Unusable);
    }

    #[test]
    fn an_unreadable_file_gives_none() {
        // Root reads any file; the permission check means nothing then.
        // SAFETY: geteuid has no preconditions.
        if unsafe { libc::geteuid() } == 0 {
            return;
        }
        let dir = current(Some(BASE), None);
        let path = dir.path().join("theme/colors.toml");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();
        assert_eq!(read(&dir), ThemeRead::Unusable);
    }

    #[test]
    fn the_name_is_accepted_only_as_a_slug() {
        for (raw, want) in [
            ("tokyo-night\n", "tokyo-night"),
            ("catppuccin-latte", "catppuccin-latte"),
            ("a", "a"),
            (&"a".repeat(64), &"a".repeat(64)[..]),
            (&"a".repeat(65), ""),
            ("", ""),
            ("Tokyo Night", ""),
            ("tokyo_night", ""),
            ("<img src=x onerror=alert(1)>", ""),
            ("../../etc", ""),
            ("tökyo", ""),
            ("tokyo\nnight", ""),
        ] {
            let dir = current(Some(BASE), Some(raw));
            assert_eq!(theme(&dir).name, want, "{raw:?}");
        }
        // No name file: empty name, the theme still applies.
        assert_eq!(theme(&current(Some(BASE), None)).name, "");
        // A name file over the limit is not read.
        let dir = current(Some(BASE), Some(&"a".repeat(300)));
        assert_eq!(theme(&dir).name, "");
    }

    #[test]
    fn hex_validation() {
        assert_eq!(normalise_hex("#AbC").as_deref(), Some("#aabbcc"));
        assert_eq!(normalise_hex("#a1b2c3").as_deref(), Some("#a1b2c3"));
        assert_eq!(normalise_hex("#a1b2c3d4").as_deref(), Some("#a1b2c3"));
        for bad in [
            "",
            "#",
            "abc",
            "#ab",
            "#abcd",
            "#abcde",
            "#abcdefa",
            "#abcdefabc",
            "#ggg",
            " #abc",
            "#abc ",
            "#٣٣٣",
            "#ａｂｃ",
        ] {
            assert_eq!(normalise_hex(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn the_stamp_follows_generation_and_colors() {
        let dir = current(Some(BASE), None);
        let source = OmarchyThemeSource::new(dir.path());
        fs::write(dir.path().join("theme.generation"), "1-2\n").unwrap();
        let a = source.stamp();
        assert_eq!(a.generation.as_deref(), Some("1-2"));
        assert!(a.colors.is_some());
        fs::write(dir.path().join("theme.generation"), "1-3\n").unwrap();
        assert_ne!(source.stamp(), a);
        fs::remove_file(dir.path().join("theme/colors.toml")).unwrap();
        assert_eq!(source.stamp().colors, None);
    }

    /// The fixtures the mock core sends (src/features/theme/fixtures/) are what this core makes of
    /// the committed `colors.toml` files.
    #[test]
    fn the_ui_fixtures_are_the_core_reading_of_the_committed_themes() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        for name in [
            "tokyo-night",
            "catppuccin-latte",
            "fwu-dark",
            "low-contrast",
        ] {
            let dir = root.join("testdata/omarchy").join(name);
            let t = OmarchyThemeSource::new(&dir).read().theme().expect(name);
            let ui = fs::read_to_string(
                root.join("../src/features/theme/fixtures")
                    .join(format!("{name}.json")),
            )
            .unwrap();
            let ui: serde_json::Value = serde_json::from_str(&ui).unwrap();
            assert_eq!(serde_json::to_value(&t).unwrap(), ui, "{name}");
        }
    }
}
