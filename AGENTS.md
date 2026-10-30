# Meeting Companion

A local AI meeting companion. It structures a meeting (agenda, timekeeping), transcribes it on the device,
captures decisions, to-dos and questions, draws a live mind map of the topics, lets the team review the
notes and next steps, and hands the results to other apps (Jira, Planner, Teams, Confluence, email).

It runs as a **local desktop app** on macOS, Windows and Linux, and on the embedded PC of a Huawei
touch smart board. There is no server we operate: audio, transcripts and notes stay on the device unless
a person sends them somewhere. Releases are installers on GitHub Releases.

Product brief: [docs/vision.md](docs/vision.md). Non-functional requirements:
[docs/non-functional-requirements.md](docs/non-functional-requirements.md).

## Layout

- `design/meeting-companion.figcraft` — the approved prototype (FigCraft), 13 frames, 3 click-through flows.
- `design/screens/` — PNG exports of every frame, named after the frame (`s2_live.png` = "02 Live meeting").
- `design/build/` — the Python generator that builds the frames through FigCraft's control port
  (`figcraft --control 7979`, then `python3 run.py s2_live:1540:0`). Rebuilding a frame replaces hand edits.
- `factory/` — the software factory: `profile.md`, `backlog.md`, `jobs/`.

## Conventions

- UI strings in German and English, referenced by key; German is the default.
- Everything the assistant produces is a suggestion until a person confirms it.
- No network access without a setting that names where data goes.

## Application stack

STATUS: CONFIGURED

- Language: Rust (pinned in `rust-toolchain.toml`, edition 2021) for the core; TypeScript 5 for the UI.
  Node 22 LTS (`.nvmrc`), npm.
- Framework: Tauri 2 (desktop shell, system web view); React 19 + Vite 6 for the UI.
- Test command: `npm test` (runs `vitest run && cargo test --manifest-path src-tauri/Cargo.toml && playwright test`).
  Playwright needs Chromium once: `npx playwright install chromium`.
- Lint command: `npm run lint` (`tsc --noEmit`, ESLint, Prettier, `cargo fmt --check`, `cargo clippy -D warnings`).
- Build: `npm run tauri build -- --no-bundle`; smoke test of the built app: `node scripts/smoke.mjs`
  (on headless Linux: `xvfb-run -a node scripts/smoke.mjs`).
- Screenshots: `npm run screenshot` writes `screenshots/<view>-<width>.png` at 375, 1280 and 1920 px.
- Dev: `npm run tauri dev`. Browser-only build with a fake core (Playwright, screenshots): `npm run build:e2e`
  (`vite build --mode e2e`, `.env.e2e` sets `VITE_MOCK_IPC=1`; open `/?fixture=empty|filled|over|corrupt|locked`).
- Layout:
  - `src/` — React UI. `src/i18n/de.json` + `en.json` (flat keys, de default), `src/features/<feature>/`,
    `src/ui/` shared components, `src/app/` shell, `src/lib/ipc.ts` the only module that calls Tauri
    (`src/lib/mockBackend.ts` is its fake for the e2e build). Unit/component tests sit next to the code
    as `*.test.ts(x)` (Vitest + Testing Library, Tauri mocked with `@tauri-apps/api/mocks`).
  - `src-tauri/` — Rust core: `src/model/` (meeting + validation), `src/store/` (`MeetingStore` trait,
    `FileMeetingStore`, `MemoryMeetingStore`, `LockedMeetingStore`), `src/crypto/` (XChaCha20-Poly1305
    encryption at rest; `KeyProvider` trait with `KeychainKeyProvider` for the app and
    `MemoryKeyProvider` for tests), `src/lib.rs` (Tauri commands), `src/engines/` (later engines, each
    behind a trait with a fake).
  - `e2e/` — Playwright specs (axe, keyboard, layout); `e2e/screenshots/` for `npm run screenshot`.
  - `.github/workflows/ci.yml` — lint, test, compile and smoke test. Linux (`ubuntu-latest`) is the only
    CI-tested target for now; macOS and Windows are deferred until the feature set is final (add them to
    the matrix; OS-specific code stays in place).
- Data at rest: meeting files (`<app_data>/meetings/<id>.meeting`) are encrypted; the data key lives only
  in the OS keychain (Linux: Secret Service). Tests never touch the real keychain; the one keychain test
  is `#[ignore]` and run by hand (`cargo test --manifest-path src-tauri/Cargo.toml -- --ignored keychain`).
- Rules: no literal user-facing strings in JSX (ESLint `react/jsx-no-literals` and a key-mode test);
  user text is rendered as text only (`react/no-danger`); no Tauri HTTP/shell plugins and a CSP whose
  `connect-src` allows only IPC (`src/config.test.ts`).
- Env flags of the built app: `MEETING_COMPANION_STORE=memory` (in-memory store), `MEETING_COMPANION_SMOKE=1`
  (smoke run: in-memory store, exits 0 once the agenda setup view has rendered).
