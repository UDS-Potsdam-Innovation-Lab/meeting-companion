# Build: 020-omarchy-theme

## Summary
On Linux the core now reads the active Omarchy theme read-only from `~/.local/state/omarchy/current/` (`src-tauri/src/theme/`). It accepts only hex colours of known keys and a slug, and it polls `theme.generation` and the `colors.toml` mtime once a second. It emits `omarchy-theme` once per switch and answers the new command `omarchy_theme`. Other platforms have no source and start no thread.
When the setting is "System" and a theme is present, the UI maps the palette onto every colour token of `:root` (`src/features/theme/omarchy.ts`, a pure function). It sets the tokens as inline properties on `<html>` together with `data-theme`. "Light" and "Dark" remove them in the same layout effect. The settings hint names the theme ("Follows Omarchy · now Tokyo Night" / "Folgt Omarchy · jetzt Tokyo Night").
The last token map (colours and mode only) is cached, and `public/theme-boot.js` applies it before React. The boot script accepts known token names and hex values only.
Following stack-decision.md (AMENDED), this build changes colours only: no `--font-ui` token, no monospace switch, and `src/styles.css` is untouched, so it cannot collide with job 018. The settings schema is unchanged.
The mock core takes `&omarchy=<fixture>` and has `window.__mockOmarchy(name|null)` for switches at run time. Fixtures: tokyo-night, catppuccin-latte, fwu-dark, low-contrast and junk. There are screenshots for tokyo-night (dark) and catppuccin-latte (light).
Decisions worth a look:
- The two shadow tokens (`--shadow`, `--shadow-small`) are shadow lists, not colours. They follow `data-theme` from the token blocks, so the inline properties stay pure hex.
- Coloured text tokens are moved toward white or black (the foreground side) instead of toward `foreground`, so their hue stays put.
- If the palette's accent is within 30° of red, yellow or green, the accent gives way to the palette's blue. This hits fwu-dark: its orange accent sits between red and yellow, so fwu-dark shows blue as accent and question colour. That is what AC4's hue rule demands.

## Acceptance criteria
| AC | Test | Result |
|----|------|--------|
| AC1 | src-tauri/src/theme/omarchy.rs::tests::colors_and_name_give_name_mode_and_a_normalised_palette, ::short_long_and_upper_case_hex_are_normalised, ::legacy_ansi_colours_fill_the_semantic_keys | PASS |
| AC1 | omarchy.rs::tests::mode_step_1_the_mode_key_wins, ::mode_step_2_the_legacy_theme_type, ::mode_step_3_a_light_mode_file, ::mode_step_4_the_background_luminance, ::mode_step_5_dark_without_anything_else | PASS |
| AC1 | omarchy.rs::tests::no_folder_gives_none, ::no_background_or_foreground_gives_none | PASS |
| AC1 | src-tauri/src/theme/mod.rs::tests::other_platforms_never_have_a_theme_and_start_no_thread (`cfg(not(linux))`, runs on macOS/Windows builds); src/config.test.ts › "the file source exists only on Linux" | PASS (Linux part); macOS test compiles in only there |
| AC2 | omarchy.rs::tests::values_that_are_not_hex_colours_are_dropped_key_by_key, ::unknown_keys_are_ignored, ::hex_validation | PASS |
| AC2 | omarchy.rs::tests::a_file_over_16_kb_gives_none, ::a_fifo_gives_none_without_blocking, ::a_device_gives_none, ::a_folder_in_place_of_the_file_gives_none, ::a_file_that_is_not_utf8_gives_none, ::an_unreadable_file_gives_none | PASS |
| AC2 | omarchy.rs::tests::the_name_is_accepted_only_as_a_slug | PASS |
| AC2 | src-tauri/src/theme/watch.rs::tests::nothing_from_the_files_is_logged, ::an_unusable_theme_falls_back_at_once_and_logs_one_fixed_line | PASS |
| AC2 | src/features/theme/Omarchy.test.tsx › "AC2 nothing but hex colours reaches <html>" (3 tests); src/features/theme/omarchy.test.ts › "AC2 the UI rejects every value that is not a hex colour" | PASS |
| AC3 | watch.rs::tests::a_switch_on_disk_is_reported_once_within_two_polls (real files, injectable tick clock), ::the_switch_arrives_on_the_first_poll_after_it, ::nothing_is_read_or_sent_while_nothing_changes | PASS |
| AC3 | watch.rs::tests::a_folder_missing_during_a_swap_keeps_the_previous_theme, ::three_missing_polls_in_a_row_fall_back_to_the_default_tokens, ::missing_polls_that_are_not_in_a_row_do_not_count | PASS |
| AC3 | e2e/omarchy.spec.ts › "AC3 live switch › tokyo-night → catppuccin-latte while the live view is open, without a reload"; Omarchy.test.tsx › "AC3 a switch arrives without a reload" | PASS |
| AC4 | src/features/theme/omarchy.test.ts › "AC4 the mapping covers the token set" (token list read from `:root` in styles.css; every fixture incl. low-contrast) | PASS |
| AC4 | omarchy.test.ts › "AC4 WCAG 2.2 AA with <fixture>": text tokens ≥ 4.5:1 on bg/surface/sunken/own soft, on-accent, line-strong and focus ring ≥ 3:1, hue distance of green/amber/accent/overrun | PASS |
| AC4 | e2e/omarchy.spec.ts › "AC4 axe: <view> with <theme>": 6 views × tokyo-night, catppuccin-latte, fwu-dark, low-contrast | PASS |
| AC5 | Omarchy.test.tsx › "AC5 the setting decides who wins" (System + palette with name in en and de; Light/Dark remove every inline token in the same step, System reapplies; System without palette = prefers-color-scheme; stored Light keeps own tokens) | PASS |
| AC5 | src/styles.test.ts (unchanged, passes); no `--font-ui` per spec review 1 | PASS |
| AC6 | e2e/omarchy.spec.ts › "AC6 no flash at start-up" (computed `--bg` and `data-theme` at DOMContentLoaded; junk cache ignored) | PASS |
| AC6 | Omarchy.test.tsx › "AC6 the token cache and the boot script" (boot list = mapping list, junk entries ignored per entry, cache replaced or cleared on each core report) | PASS |
| AC7 | e2e/omarchy.spec.ts › "AC7 tokyo-night at 375×812, 1280×800, 1920×1080, 1024×600, 768×480" (no horizontal scroll, no clipped button label, targets ≥ 24 px, settings controls ≥ 48 px at board size; font stays Inter) | PASS |
| AC7 | screenshots: `omarchy-tokyo-night-*` and `omarchy-catppuccin-latte-*` at 375/1280/1920, plus `omarchy-tokyo-night-live-1024x600` and `-768x480` (e2e/screenshots/screenshots.spec.ts) | written |
| — | omarchy.rs::tests::the_ui_fixtures_are_the_core_reading_of_the_committed_themes (UI JSON fixtures = core parse of src-tauri/testdata/omarchy/) | PASS |
| — | src/config.test.ts › "Job 020 …": no process, no file write, no socket in `src-tauri/src/theme/`, no file-watch crate; event `omarchy-theme` listed in the capability description | PASS |

## Secure coding
No `docs.secure_coding` is configured. These NFR rules are touched:
- **Untrusted input (theme files):** the core opens each file with `O_NONBLOCK`. It accepts only regular files of at most 16 KB in valid UTF-8, read through `take(limit+1)`. Otherwise the result is "unusable", so a FIFO, a device or a folder never blocks. Only known keys pass, each value only as `#rgb`/`#rrggbb`/`#rrggbbaa` and normalised to `#rrggbb`. The name passes only as `[a-z0-9-]{1,64}`, otherwise it is empty.
- **Untrusted input (UI):** `cleanPalette` and `TOKEN_VALUE` re-check every value before `style.setProperty`, and only names from `TOKEN_NAMES` are set. The cache reader and `theme-boot.js` apply the same allow-list per entry. The theme name is rendered as text through i18n interpolation.
- **Logging:** the only log line is the fixed `omarchy theme: unreadable`, written once per transition. A test checks that file content never reaches the log.
- **Local-first / no network / no process:** the code reads files only, with no `Command`, no socket and no new HTTP or watcher crate. `libc` is a Linux-only direct dependency for `O_NONBLOCK`; it is already in the lock file. A config test guards all of this. CSP and capabilities are unchanged (`core:default`). Only the description lists the new event.
- **Stored data:** `localStorage` holds only `{ mode, tokens }` (hex colours). No meeting, audio or transcript data is involved.

## Test run
`npm test` → vitest 359 passed (24 files); cargo 354 passed, 7 ignored (the existing `#[ignore]` real-model and keychain tests); playwright 300 passed.
`npm run lint` → clean (tsc, ESLint, Prettier, cargo fmt, clippy `-D warnings`). The gitleaks scan over the branch history exited 0.
```
 Test Files  24 passed (24)
      Tests  359 passed (359)
test result: ok. 354 passed; 0 failed; 7 ignored; 0 measured; 0 filtered out; finished in 25.33s
  ✓  299 [chromium] › e2e/transcript.spec.ts:184:3 › AC1–AC5 recording with the mock core › End meeting stops recording first (429ms)
  ✓  300 [chromium] › e2e/transcript.spec.ts:192:3 › AC1–AC5 recording with the mock core › recording makes no network request beyond the app's own assets (1.2s)
  ✓  296 [chromium] › e2e/transcript.spec.ts:131:3 › AC1–AC5 recording with the mock core › consent, start, German and English lines, pause, resume and restart (4.5s)

  300 passed (1.5m)
```
The tests ran before the rebase onto `main`. The commits that `main` gained since then touch only `factory/`.

## Commits
```
a9fcca9 docs(agents): the Omarchy theme source, mapping and fixtures
ccd6ddb test(e2e): Omarchy fixtures in the mock core, live switch, axe and layouts
a8f59c6 feat(settings): System follows the Omarchy theme, live and without a flash
392b762 feat(ui): map an Omarchy palette onto the colour tokens
294c40e feat(core): read and poll the active Omarchy theme (Linux)
```
