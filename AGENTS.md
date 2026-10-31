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
  It also writes `screenshots/<view>-<width>x<height>.png` for the responsive layout (1440×900, 1024×768,
  768×1024, 480×800, and short live windows 1024×600 and 768×480); `e2e/responsive.spec.ts` checks those sizes.
- Dev: `npm run tauri dev`. Browser-only build with a fake core (Playwright, screenshots): `npm run build:e2e`
  (`vite build --mode e2e`, `.env.e2e` sets `VITE_MOCK_IPC=1`; open `/?fixture=empty|filled|over|corrupt|locked|live|live-done`
  or the transcript fixtures `live-transcript|live-paused|live-mic-error|live-no-model`, the settings fixtures
  `settings|settings-no-model|settings-mic-test|settings-recording|settings-dark|settings-missing` (they open the
  settings view) and `live-mic-missing|live-switched`,
  and the speaker fixtures `speakers|speakers-empty|speakers-no-model|live-speakers` (open frame 06 with the footer button),
  and the agenda-free fixtures `free` (setup) and `live-free|live-free-empty` (frame 16);
  the live fixtures are meant for a fixed clock, see `LIVE_TIMES` and `FREE_TIMES` in `src/features/agenda/fixtures.ts`).
- Layout:
  - `src/` — React UI. `src/i18n/de.json` + `en.json` (flat keys, de default), `src/features/<feature>/`,
    `src/ui/` shared components, `src/app/` shell, `src/lib/ipc.ts` the only module that calls Tauri
    (`src/lib/mockBackend.ts` is its fake for the e2e build). Unit/component tests sit next to the code
    as `*.test.ts(x)` (Vitest + Testing Library, Tauri mocked with `@tauri-apps/api/mocks`).
  - `src-tauri/` — Rust core: `src/model/` (meeting + validation), `src/store/` (`MeetingStore` trait,
    `FileMeetingStore`, `MemoryMeetingStore`, `LockedMeetingStore`), `src/crypto/` (XChaCha20-Poly1305
    encryption at rest; `KeyProvider` trait with `KeychainKeyProvider` for the app and
    `MemoryKeyProvider` for tests), `src/lib.rs` (Tauri commands and events), `src/engines/` (engines,
    each behind a trait with a fake: `audio.rs` `AudioSource` + `FakeAudioSource` and the bounded 30 s
    `AudioSink`, `cpal_source.rs` the microphone and `CpalAudioDevices`, `devices.rs`
    `AudioDevices` + `FakeAudioDevices` (input devices by name), `stt.rs` `SpeechToText` + `ScriptedSpeechToText`,
    `whisper.rs` whisper.cpp, `diarize.rs` `Diarizer` + `ScriptedDiarizer` and the in-memory
    `VoiceClusterer`/`VoiceTracker` (voice labels `A`–`Z`), `sherpa.rs` `SherpaDiarizer` (sherpa-onnx
    `SpeakerEmbeddingExtractor` only), `models.rs` the read-only search for whisper ggml and sherpa-onnx
    speaker models already on the device — the one list of model folders per OS), `src/transcript/` (`Transcriber` pipeline, windows
    of at most 3 s; encrypted append-only `<id>.transcript` store, one record per final segment with an optional `voice`), `src/recording/`
    (`Recorder`: consent gate, transcript worker, diarizer thread, capture states, the chosen microphone and "switch to the system default",
    `mic_test.rs` the 10 s microphone test), `src/settings/` (`SettingsStore`: the sealed
    `<app_data>/settings` file, closed schema incl. `speakerModel`, `SettingsService`), `src/speakers/` (name-round suggestions and the voice/line choices stored in
    the meeting file), `src/log.rs` (the only log output; never content).
  - `e2e/` — Playwright specs (axe, keyboard, layout); `e2e/screenshots/` for `npm run screenshot`.
  - `.github/workflows/ci.yml` — lint, test, compile and smoke test. Linux (`ubuntu-latest`) is the only
    CI-tested target for now; macOS and Windows are deferred until the feature set is final (add them to
    the matrix; OS-specific code stays in place).
- Settings: one sealed file `<app_data>/settings` (same data key, AAD binds the purpose "settings");
  the UI (`src/features/settings/`) caches only locale and theme in `localStorage` for the first paint
  (`public/theme-boot.js` sets `data-theme` before React). Colours come only from the token blocks at
  the top of `src/styles.css` (light `:root`, dark `:root[data-theme="dark"]`; `src/styles.test.ts`).
- Data at rest: meeting files (`<app_data>/meetings/<id>.meeting`) and transcripts
  (`<app_data>/meetings/<id>.transcript`, one sealed record per final segment) are encrypted; audio is
  never written. The data key lives only in the OS keychain (Linux: Secret Service). Tests never touch the real keychain; the one keychain test
  is `#[ignore]` and run by hand (`cargo test --manifest-path src-tauri/Cargo.toml -- --ignored keychain`).
  Likewise the one test with a real speech model: `cargo test --manifest-path src-tauri/Cargo.toml
  --release -- --ignored whisper` (uses `MEETING_COMPANION_WHISPER_MODEL`, else the model the scan prefers),
  and the one with a real speaker model: `MEETING_COMPANION_SPEAKER_WAVS=<person-1.wav>,<person-2.wav>
  cargo test --manifest-path src-tauri/Cargo.toml --release -- --ignored speaker` (16 kHz mono WAVs, one
  person each; uses `MEETING_COMPANION_SPEAKER_MODEL`, else the model the scan prefers; prints the time
  per segment). Speaker models (sherpa-onnx ONNX with `framework` 3d-speaker/wespeaker/nemo, 16 kHz) are
  looked for in `<app_data>/models/` and the Hugging Face cache; nothing is downloaded.
- Native build dependencies on Linux: `libasound2-dev` (microphone), `cmake`, `clang`, `libclang-dev`
  (whisper.cpp is compiled from source by `whisper-rs`); CI installs them.
- sherpa-onnx (`sherpa-onnx = "=2.0.1"`, static) links prebuilt libraries. Run
  `node scripts/sherpa-onnx.mjs fetch` once per checkout (and after a change of
  `src-tauri/native/sherpa-onnx.sha256`): it downloads the archive for this platform, checks it against
  the pinned SHA-256, and unpacks it into `src-tauri/native/lib/` (on Linux it gives the libraries' weak
  C++ standard-library symbols their own names, so they cannot clash with whisper.cpp's). `.cargo/config.toml`
  points the build there (`SHERPA_ONNX_LIB_DIR`); without it the build fails instead of downloading.
  After a new fetch: `cargo clean --manifest-path src-tauri/Cargo.toml -p sherpa-onnx-sys`.
  `node scripts/sherpa-onnx.mjs verify` checks archive and libraries; CI runs both and checks that a
  corrupted archive fails.
- Rules: no literal user-facing strings in JSX (ESLint `react/jsx-no-literals` and a key-mode test);
  user text is rendered as text only (`react/no-danger`); no Tauri HTTP/shell plugins and a CSP whose
  `connect-src` allows only IPC (`src/config.test.ts`).
- Env flags of the built app: `MEETING_COMPANION_STORE=memory` (in-memory store), `MEETING_COMPANION_SMOKE=1`
  (smoke run: in-memory store, fake microphone and engine, exits 0 once the agenda setup view has rendered),
  `MEETING_COMPANION_AUDIO=fake` (generated tones instead of the microphone), `MEETING_COMPANION_STT=fake`
  (scripted German/English segments instead of whisper; no model needed), `MEETING_COMPANION_DIARIZE=fake`
  (scripted voices instead of the speaker model; no model needed).
