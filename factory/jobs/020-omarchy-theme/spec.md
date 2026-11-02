# Omarchy theme compatibility

## Problem
People who run the app on Omarchy (Arch Linux + Hyprland) have one palette, one font and one light/dark mode
across the whole desktop. The app still shows its own warm-paper and indigo look there, so it looks like a
foreign window. They switch themes often (`omarchy theme set …`, the theme picker). When they have chosen
the "System" theme, the app should look like the active Omarchy theme and switch along with it. Everywhere
else, including on Omarchy with an explicit Light or Dark, the app keeps its own design tokens.

## Scope
- in:
  - **Theme source in the core** (Linux only, `#[cfg(target_os = "linux")]`). A read-only reader behind a
    `ThemeSource` trait, with `OmarchyThemeSource` and a fake. It reads the files Omarchy itself maintains
    (checked on this machine, Omarchy 4.x):
    - `$HOME/.local/state/omarchy/current/theme/colors.toml`: flat `key = "value"` lines. Palette keys:
      `accent`, `background`, `foreground`, `dark_background`, `darker_background`, `lighter_background`,
      `dark_foreground`, `light_foreground`, `bright_foreground`, `muted`, `selection`, `red`, `yellow`,
      `orange`, `green`, `cyan`, `blue`, `magenta`. Older themes also have `color0`…`color15`. The file can
      also hold `mode = "light"|"dark"` or the legacy `theme_type`.
    - `light.mode`: an optional marker file next to `colors.toml`.
    - `$HOME/.local/state/omarchy/current/theme.name`: the theme's slug, e.g. `tokyo-night`.
    - `$HOME/.local/state/omarchy/current/theme.generation`: a token that `omarchy-theme-set` rewrites on
      every switch, right after it swaps the theme folder with `rm -rf` + `mv`.
  - **Mode resolution** in the same order as Omarchy's `omarchy-theme-color`: the `mode` key, then the
    legacy `theme_type`, then a `light.mode` file, then the luminance of `background`, then dark.
  - **Live switching.** A core thread polls `theme.generation` and the mtime of `colors.toml` once a second.
    When either changes, it emits the `omarchy-theme` event with the parsed palette (or `null`). It does not
    use a new file-watch crate and does not start a process: no `omarchy-*`, `fc-match` or `gsettings`.
  - **Token mapping in the UI** (`src/features/theme/omarchy.ts`, a pure function). It turns the palette into
    a value for every colour token of the `:root` block in `src/styles.css` (except `--preview-*`):
    - The base tokens come from the palette (`background`, `foreground`, `accent`, `green`, `yellow`, `red`,
      `cyan`, `muted`, …).
    - Soft tints and lines are mixed from the palette.
    - Any token that fails contrast is adjusted toward `foreground` (or `background`) until it passes.

    The mapping is applied as inline custom properties on `<html>` via `style.setProperty`. CSSOM is allowed
    by the CSP's `style-src 'self'`. It also sets `data-theme` from the mode.
  - **Font.** Omarchy has one desktop font: `omarchy-font-set` writes it into fontconfig as the `monospace`
    family. In Omarchy mode a new token `--font-ui` (added to the `:root` token block; default: the current
    Inter stack) becomes the CSS generic `monospace`, so the system web view resolves it through fontconfig.
    Font sizes stay the same.
  - **Which setting follows Omarchy.** The theme setting `system` follows Omarchy when a valid Omarchy theme
    is found; otherwise it follows `prefers-color-scheme` as today. `light` and `dark` keep the app's own
    tokens. The settings schema does not change.
  - **Settings hint.** The hint under "System" names the theme, e.g. "Folgt Omarchy · jetzt Tokyo Night" /
    "Follows Omarchy · now Tokyo Night". New de/en keys; the name is rendered as text.
  - **First paint.** The last applied Omarchy token map is cached in `localStorage`, and
    `public/theme-boot.js` applies it before React so the window does not flash indigo. It accepts only
    known token names and hex values.
  - **Mock backend.** A query parameter `omarchy=<fixture>` sends a committed palette, and the mock backend
    can switch it at run time. There are fixtures from bundled themes (`tokyo-night` dark,
    `catppuccin-latte` light, `fwu-dark` with its own `mode` key) and two adversarial ones (low contrast;
    junk values). Screenshots for one dark and one light Omarchy fixture.
- out:
  - The phone page (`phone.html`). It keeps following the phone's own light/dark setting.
  - Omarchy's `shell.toml`: font sizes, spacing, per-surface colours, alpha values.
  - Backgrounds, icons, `hyprland.*`, and any write to Omarchy files or hooks (no `theme-set.d` hook).
  - macOS, Windows and other Linux desktops (GNOME/KDE accent colours).
  - Any edit to `src/styles.css` outside the two token blocks at the top (job 018 edits the rest in
    parallel), and any change to the live view's components.
  - A separate "Omarchy" choice in the settings, which would change the settings schema (see Open questions).

## Stack
Status: EXISTING

## Acceptance criteria
- [ ] AC1: The core reads the active Omarchy theme. Rust tests against temp folders laid out like
  `~/.local/state/omarchy/current/` check:
  - `colors.toml` + `theme.name` give `{ name, mode, palette }`, with every value normalised to `#rrggbb`.
  - The mode follows the order in Scope (`mode`, `theme_type`, `light.mode`, luminance, dark), one test per
    step.
  - No folder, or no `background`/`foreground` key, gives `None`. The app then keeps the default tokens.
  - On macOS/Windows builds the source always returns `None` and starts no thread.
- [ ] AC2: The theme files are treated as untrusted input; the core accepts only colours and a slug
  (NFR Security: "untrusted input"; Architecture: local-first). Each of these is a Rust test:
  - Any value that is not `#rgb`, `#rrggbb` or `#rrggbbaa` is dropped key by key, e.g.
    `red; background:url(http://x)`, `var(--x)`, `expression(…)`, an over-long string or a non-ASCII string.
  - Unknown keys are ignored.
  - A file over 16 KB, a non-regular file (FIFO, device, folder) or one that is not valid UTF-8 gives `None`
    without blocking.
  - `theme.name` is accepted only as `[a-z0-9-]{1,64}`; otherwise the name is empty.
  - Nothing from the files is logged, only "omarchy theme: unreadable".
  - The UI mapping also rejects any non-hex value before `setProperty`. A component test passes such a palette
    and checks that no inline property contains anything but a hex colour.
- [ ] AC3: The app switches live. The core thread notices a switch within 2 s and emits `omarchy-theme` once
  per switch; nothing is emitted while nothing changes.
  - Rust test on an injectable clock: rewrite `theme.generation` + `colors.toml`, and the event comes with the
    new palette.
  - The theme folder may be missing in the middle of a swap (`rm -rf` then `mv`). That keeps the previous
    palette. The app falls back to the default tokens only after the file has been missing on 3 polls in a row.
  - e2e (mock backend): switch from `tokyo-night` to `catppuccin-latte` while the live fixture is open.
    `--bg`, `--accent` and `data-theme` change without a reload, and an open meeting's state is untouched.
- [ ] AC4: The mapping covers the whole token set and keeps WCAG 2.2 AA (NFR Clients and usability). A unit
  test reads the colour-token list of the `:root` block from `src/styles.css`, the same way
  `src/styles.test.ts` does. For every fixture palette, including the low-contrast one, it checks:
  - every token except `--preview-*` gets a value;
  - `--ink`, `--ink-2`, `--muted`, `--accent-ink`, `--teal-ink`, `--amber-ink`, `--green-ink`, `--warn-ink`
    and `--overrun-ink` reach ≥ 4.5:1 on `--bg`, `--surface` and `--sunken`, and on their own `-soft` tint
    where one exists;
  - `--on-accent` reaches ≥ 4.5:1 on `--accent`;
  - `--line-strong` and the focus ring colour reach ≥ 3:1 on `--surface`.

  The decisions/to-dos/questions/overrun colours stay distinguishable: green, amber, accent and overrun differ
  pairwise by hue. `npm test`'s axe run on the Omarchy screenshot fixtures reports no contrast violation.
- [ ] AC5: The setting decides who wins. Component tests check:
  - With `theme: "system"` and a palette present, the Omarchy tokens and `--font-ui: monospace` are applied,
    and the settings hint names the theme ("Tokyo Night", rendered as text, in de and en).
  - Switching to `light` or `dark` removes every inline token and `--font-ui` override in the same frame, so
    the app's own tokens show. Switching back to `system` reapplies them.
  - With `system` and no palette, the behaviour is the same as today (`prefers-color-scheme`).
  - `src/styles.test.ts` still passes, and `--font-ui` sits in the `:root` block.
- [ ] AC6: There is no flash at start-up. With a cached Omarchy token map and `system`, `public/theme-boot.js`
  sets the cached tokens and `data-theme` before the first paint. A Playwright test checks the computed
  `--bg` of `<html>` on `DOMContentLoaded`. The boot script ignores cached entries with unknown names or
  non-hex values; a test fills `localStorage` with junk. The cache is replaced or cleared when the core
  reports another palette or `null`.
- [ ] AC7: Layouts hold with the Omarchy font. `e2e/responsive.spec.ts` and the screenshot run also use the
  `omarchy=tokyo-night` fixture (monospace UI font) at 375, 1280 and 1920 px and at the short live sizes. The
  checks are no horizontal overflow, no clipped button labels and touch targets ≥ 48 px on the board size.

## Design
Source: figcraft design/meeting-companion.figcraft
Status: NOT NEEDED
No new screen and no new layout. The app's existing frames are re-coloured by the user's own desktop theme,
through the token layer that job 006 already uses for the dark theme. The settings hint is one line of text
in the existing theme card of the settings view. The UI reviewer compares the Omarchy screenshots for
structure against `design/screens/s2_live.png` and the settings frame, not for colour, and checks contrast
through AC4.

## Surfaces
- User-facing UI: yes. All views are re-coloured through the tokens; the settings view gets the theme-card
  hint and the font change. There are no structural changes.
- Security-relevant: yes. The app reads files from the user's home folder that can come from a theme
  cloned from a stranger's git repo (Omarchy's `omarchy theme install`), and their values end up in CSS
  custom properties and `localStorage`. Covered by: strict hex validation in core and UI, a size limit, regular
  files only, no logging of content, no process, no network. Rules touched: NFR Security ("untrusted
  input"), NFR Architecture (local-first); no `docs.secure_coding` is configured.
- Human gate: no. Auth, secrets and permissions do not change, and no data is deleted or migrated (the
  settings schema is unchanged).
- Audio/transcript data: no. Nothing about audio or transcripts changes. Only the last token map (colours)
  is cached in `localStorage`.
- Leaves the device: no.
- Board (touch) layout: no change. The board PC is not an Omarchy machine; AC7 still checks the board size
  with the Omarchy font.
- AI speaks or contributes unasked: no.

Size: normal

## Open questions
- **Font scope (assumed: the whole UI).** Omarchy's only font setting is the system `monospace` family, and
  the Omarchy desktop uses it everywhere, so I assumed the whole UI switches to it in Omarchy mode (AC7
  guards the layouts). The alternative is to keep Inter for text and use the Omarchy font only for numbers
  (timers, counts). That reads better on the board, but it would mean editing the live view's
  `tabular-nums` rules, which collides with job 018.
- **Trigger (assumed: "System" follows Omarchy).** A separate fourth choice "Omarchy" would be more explicit,
  but it adds a settings value, which is a schema change and needs a migration test. If the human prefers
  that, it adds one criterion; the rest stays the same.
- **Polling vs. watching.** I assumed polling once a second (two `stat`s and one small read) instead of
  adding an inotify crate. The reason: `omarchy-theme-set` replaces the whole folder, which watchers handle
  badly. Revisit if someone wants faster switching than 2 s.
- **Paths.** I assumed the fixed path `$HOME/.local/state/omarchy/current`, as Omarchy itself hardcodes it
  (it does not use `XDG_STATE_HOME`). Older Omarchy releases (before 4.x) kept the theme in
  `~/.config/omarchy/current/theme`; reading that path as a fallback is cheap. I left it out because the old
  layout cannot be checked on this machine.
- **Merge with 018.** This job edits only the two token blocks at the top of `src/styles.css` (one new
  `--font-ui` token, and `font-family` in `:root` pointing at it). If 018 merges first and adds colour tokens,
  AC4's test picks them up automatically and the mapping has to give them values.
