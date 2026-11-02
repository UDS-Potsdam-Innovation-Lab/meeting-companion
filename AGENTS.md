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
- The app listens on no network port, except the opt-in phone web view (job 012): one private IPv4 address of
  the local network, only while a person opened it during a recording, behind a per-opening token.

## Application stack

STATUS: CONFIGURED

- Language: Rust (pinned in `rust-toolchain.toml`, edition 2021) for the core; TypeScript 5 for the UI.
  Node 22 LTS (`.nvmrc`), npm.
- Framework: Tauri 2 (desktop shell, system web view); React 19 + Vite 6 for the UI.
- Test command: `npm test` (runs `vitest run && cargo test --manifest-path src-tauri/Cargo.toml && playwright test`).
  Playwright needs Chromium once: `npx playwright install chromium`.
- Lint command: `npm run lint` (`tsc --noEmit`, ESLint, Prettier, `cargo fmt --check`, `cargo clippy -D warnings`).
- Build: `npm run tauri build -- --no-bundle`; smoke test of the built app: `node scripts/smoke.mjs`
  (on headless Linux: `xvfb-run -a node scripts/smoke.mjs`; on Linux and macOS it also fails if the running app
  has any listening TCP or bound UDP socket, and when no scan of its sockets succeeded: Linux reads `/proc`, macOS
  runs `lsof -a -p <pid> -n -P -F ftPnT -Tqs` (job 017; `scripts/sockets.mjs`, whose `--lsof <file> <pid>`
  parses the recorded listings in `scripts/fixtures/sockets/`, tested in `src/config.test.ts`)).
  `node scripts/ggml-check.mjs src-tauri/target/release/meeting-companion`
  (job 016; ELF on Linux, Mach-O on macOS (job 017: the format comes from the binary's magic number, and one
  leading underscore is stripped from every Mach-O name); needs the system `nm`) fails when a ggml/gguf symbol of its list is defined twice (a second ggml),
  when whisper.cpp's or llama.cpp's model loader is missing, or when any cpp-httplib, curl or llama-server
  symbol is linked; `--symbols <file> [--format elf|macho]` reads a recorded `nm` listing (the fixtures in `scripts/fixtures/ggml-check/`,
  macOS ones in `macos/`, tested in `src/config.test.ts`). CI runs it after the release build on both OSes.
  `node scripts/plist-check.mjs <binary>` (job 017, macOS) fails unless the binary's `__TEXT,__info_plist`
  section holds `NSMicrophoneUsageDescription` with the German text of `src-tauri/Info.plist` (it parses the
  Mach-O itself). The unbundled release binary gets the section from `src-tauri/src/main.rs`
  (`embed_info_plist!`, `not(dev)`), the `tauri dev` binary from `tauri::generate_context!`; CI checks both.
- Phone page (job 012): the second Vite entry `phone.html` + `src/phone/`, built on its own by
  `vite.phone.config.ts` into `dist/phone/` (part of `npm run build`; `npm run build:e2e` puts it in
  `dist-e2e/phone/`). `src-tauri/build.rs` embeds exactly those files in the core (a release build fails without
  them; a debug build without them serves 404 for the page). The page uses the app's tokens (`../styles.css`) and
  `phone.css`, follows the phone's language (`navigator.language`, de default) and light/dark setting, and stores
  nothing. e2e: `e2e/phone.spec.ts` opens `/phone/phone.html#t=…` and answers `/api/session` itself
  (`openPhone(page, "phone-open" | "phone-closed")` in `e2e/helpers.ts`); screenshots `phone-*-375.png`.
- Screenshots: `npm run screenshot` writes `screenshots/<view>-<width>.png` at 375, 1280 and 1920 px.
  It also writes `screenshots/<view>-<width>x<height>.png` for the responsive layout (1440×900, 1024×768,
  768×1024, 480×800, and short live windows 1024×600 and 768×480); `e2e/responsive.spec.ts` checks those sizes.
- Dev: `npm run tauri dev`. Browser-only build with a fake core (Playwright, screenshots): `npm run build:e2e`
  (`vite build --mode e2e`, `.env.e2e` sets `VITE_MOCK_IPC=1`; open `/?fixture=empty|filled|over|corrupt|locked|live|live-done`
  or the transcript fixtures `live-transcript|live-paused|live-mic-error|live-no-model`, the settings fixtures
  `settings|settings-no-model|settings-mic-test|settings-recording|settings-dark|settings-missing` (they open the
  settings view), the language model fixtures `settings-llm-off|settings-llm-local|settings-llm-none-found|settings-llm-claude|settings-llm-claude-nokey|settings-llm-error|settings-llm-local-failed`
  (they open frame 17; `&theme=dark` opens a settings fixture in the dark theme) and `live-mic-missing|live-switched`, the sound-wave fixtures `live-level-speech|live-level-silence|live-no-signal`
  (the mock core sends a fixed level sequence by the clock; wave screenshots install Playwright's clock and run the last 3 s on it),
  and the speaker fixtures `speakers|speakers-empty|speakers-no-model|live-speakers` (open frame 06 with the footer button),
  and the agenda-free fixtures `free` (setup) and `live-free|live-free-empty` (frame 16),
  and the capture fixtures `live-captures|live-captures-empty|live-captures-edit|live-captures-error|live-free-captures`
  (job 018, frames 21; `-error`: the mock core refuses every capture write with `storageFailed`; `&theme=dark` opens any
  fixture in the dark theme), and the capture suggestion fixtures `live-suggest|live-suggest-edit|live-suggest-many|live-suggest-off|live-suggest-local|live-suggest-cloud|live-suggest-error`
  (job 019, frames 21g/h/l/f/s: the language model setting, waiting suggestions, captures and an engine error the mock core holds);
  the live fixtures are meant for a fixed clock, see `LIVE_TIMES` and `FREE_TIMES` in `src/features/agenda/fixtures.ts`).
- Layout:
  - `src/` — React UI. `src/i18n/de.json` + `en.json` (flat keys, de default), `src/features/<feature>/`,
    `src/features/captures/` (job 018: the right column of frames 02/16 — `CapturesPanel.tsx` the column and its kind
    tabs, `CaptureList.tsx` cards and the inline editor, `Composer.tsx`, `UndoNotice.tsx`, `fields.tsx` kind/owner/date
    chips, `labels.ts` keys, targets and error texts; `useCaptures.ts` the core's list and the 8 s Undo by the clock
    (Undo of a delete sends only the ids, Undo of a confirmed suggestion calls `unconfirm_suggestion`); `model.ts`
    `/d` `/t` `/q`, grouping and counts; `fakeCore.ts` the core's capture and suggestion rules for the test fake and the
    mock backend; job 019: `SuggestionCard.tsx` the pinned card per tab, its inline editor and "1 weiterer Vorschlag",
    `SuggestionStatus.tsx` the status line under the composer and the top-bar chip, `suggestions.ts` pinning, line
    chips and the status, `useSuggestions.ts` reads `load_suggestions` every second by the clock (no core event: the
    event list is pinned in `src/config.test.ts`) and announces a new one once;
    below 1200 px, `src/lib/media.ts` `NARROW_LIVE_QUERY`, the list is the centre card's second tab "Captured n" and the
    composer sticks to the bottom), `src/ui/` shared components (`SoundWave.tsx`: the level wave of frame 02 and the settings meter, drawn through refs
    and `requestAnimationFrame`, a static bar under reduced motion), `src/app/` shell, `src/lib/ipc.ts` the only module that calls Tauri
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
    `SpeakerEmbeddingExtractor` only), `models.rs` the read-only search for whisper ggml, sherpa-onnx
    speaker models and GGUF language models (`ModelKind::Llm`) already on the device — the one list of model folders per OS;
    `llm.rs` `LanguageModel` + `ScriptedLanguageModel`, `Prompt::build` (fixed `&'static str` instructions, untrusted
    content cut at its limit, escaped and wrapped in `<untrusted_content>`), `run_cancellable`; `llama.rs` the local
    engine (job 016): `LlamaLocalProvider` (the scan, `available: true`; hands out a `LlamaLanguageModel` without
    loading), `ModelSlot` (at most one model in memory; loaded on the first call on the engine thread, released on
    Off/Claude/another model), `LlamaCppLoader` (GGUF metadata first: no GGUF or no `tokenizer.chat_template` is
    `Failed`; mapped read-only; panics caught), `ChatLayout` (the model's own chat template rendered by llama.cpp
    with stand-ins and split, so the instructions go into the system turn and the content into the user turn;
    only template text is tokenized with special tokens), `fit` (cuts the content to the context, `truncated`),
    `collect` (stops at end of turn or the token limit, looks at the cancel token before every token),
    `ContextSettings` (context ≤ 4096 tokens, `max(1, logical cores / 2)` threads) and `install_quiet_logs`
    (llama.cpp's and ggml's log output goes to a callback that drops it); `claude.rs` the Claude
    API engine behind the `Transport` trait (`UreqTransport`: ureq 3 + rustls, `https://api.anthropic.com/v1/messages` only,
    no proxy, 10 s connect / 60 s total, no retry)), `src/language_model.rs` (`build_engine` from the `languageModel`
    setting, never a fallback; `LocalLlmProvider`, filled by `engines::llama::LlamaLocalProvider` unless
    `MEETING_COMPANION_LLM=fake`; `LanguageModelService`: the settings view's cancellable "Test", `run_task` for the
    capture suggestions, and `setting_changed`, which releases a local model that is no longer chosen), `src/secrets.rs` (`SecretStore`: `KeychainSecretStore`, account
    `anthropic-api-key`, and `MemorySecretStore`; the UI only learns `{ set }`), `src/transcript/` (`Transcriber` pipeline, windows
    of at most 3 s; encrypted append-only `<id>.transcript` store, one record per final segment with an optional `voice`), `src/recording/`
    (`Recorder`: consent gate, transcript worker, diarizer thread, capture states, the chosen microphone and "switch to the system default",
    `mic_test.rs` the 10 s microphone test), `src/captures/` (job 018: quick capture; `load_captures`, `add_capture`,
    `update_capture`, `delete_capture`, `restore_capture` load the stored meeting, check the input with
    `model::validate_capture` and answer only after the meeting file is written; the core makes the id (`c-` + 64 random
    bits) and the time; closed schema `model::Capture` with `source: "typed" | "suggested"` and, for suggested ones,
    `segments` (source segment numbers only); `delete_capture` keeps the removed capture in memory (`UndoCopies`, one
    per meeting, never written or logged) and `restore_capture({ restore: { meetingId, captureId } })` puts back exactly
    that copy (closed `RestoreRequest`, no capture body); `add_suggested` for a confirmed suggestion; a save from the UI
    keeps the stored captures; no language model, no network, capture text never logged), `src/suggestions/` (job 019:
    `CaptureSuggester` on its own thread, fed by `SuggesterSink` (the recorder's events: final segments, voices, capture
    state); asks after 4 new final segments or 60 s with one (`CADENCE`), one request at a time, through `SuggestEngine`
    (`AppEngine`: the setting and `LanguageModelService::run_task`, `Busy` while a settings Test runs, no call for
    `none`); Pause, Stop, End meeting and a new `languageModel` cancel it and drop a late answer; `prompt.rs` the fixed
    `SUGGEST_TASK`, the content `#<seq> <m:ss since start> <speaker>: <text>` of the newest final segments (≤ 6000
    chars), and `parse_reply` (closed `SUGGESTIONS` … `END` frame, `kind|numbers|owner|text`, owner only for a to-do
    and only a participant's exact name, segments only from the request, at most 3); pending and dismissed suggestions
    in memory only, kind + segments never offered twice per meeting; `confirm` (only on a person's tap) stores through
    `captures::add_suggested`, `unconfirm` is Undo of a confirm; commands `load_suggestions`, `confirm_suggestion`,
    `dismiss_suggestion`, `unconfirm_suggestion`), `src/settings/` (`SettingsStore`: the sealed
    `<app_data>/settings` file, closed schema incl. `speakerModel`, `languageModel` (`"none"` | `{ "local": id }` | `"claude"`)
    and `claudeModel` (`sonnet` | `haiku` | `opus`), `SettingsService`), `src/engines/level.rs` (the input
    level measured in `AudioSink::push`, scaled RMS `min(1, rms × 4)`, sent as the `capture-level` event 25×/s while audio
    arrives, by the recording's monitor thread and the microphone test; numbers only, never stored or logged), `src/speakers/` (name-round suggestions and the voice/line choices stored in
    the meeting file), `src/log.rs` (the only log output; never content).
  - `src-tauri/src/phone_view/` — the opt-in phone web view (job 012): `PhoneViewServer` (open only while the
    meeting records; closes on `phone_view_close`, when recording stops or fails, when the meeting ends and on
    app exit, within 1 s, with the `phone-view-state` event), `server.rs` (axum 0.8 + hyper HTTP/1 on Tauri's
    tokio runtime; at most 32 connections, request deadline 10 s), `http.rs` (security headers, rate limit,
    `Host`/`Origin` checks, 4 KB bodies, bearer token, the consumer API `ConsumerRoutes` with `PhoneJson`,
    `PhonePath`, `PhoneId`, `PhoneSession`), `token.rs` (`PhoneViewToken`, 256 bits, constant-time compare,
    never logged), `net.rs` (`NetInterfaces` + `SystemNetInterfaces`/`FakeNetInterfaces`: one private RFC 1918
    address on an interface that is up, preferring the default route's interface), `rate.rs` (per-address
    limits on an injectable `Clock`), `qr.rs` (QR code SVG via `qrcodegen`), `assets.rs` (the embedded page).
    Consumers register `ConsumerRoutes::new("<name>")` under `/api/<name>/` before opening. Commands
    `phone_view_open(meetingId)` → `{ url, qrSvg }` or `{ key }`, `phone_view_close()`; the mock core returns
    `MOCK_PHONE_VIEW` (`src/lib/fixtures/phone-qr.svg` is the core's rendering of its URL, checked by a Rust
    test). Tests bind 127.0.0.1 only (`binding_loopback`) and hold one lock so the `/proc` port scan sees only
    their own sockets.
  - `e2e/` — Playwright specs (axe, keyboard, layout); `e2e/screenshots/` for `npm run screenshot`.
  - `.github/workflows/ci.yml` — lint, test, compile and smoke test, on every push and pull request, matrix
    `[ubuntu-latest, macos-latest]` (`fail-fast: false`; macOS is Apple Silicon arm64, job 017). On macOS the job
    runs the same steps (sherpa-onnx fetch + verify, shared ggml build + verify with `GGML_NATIVE=OFF` cached per
    OS/arch, Playwright, lint, test, the speaker-accuracy run, release build, `ggml-check` on the Mach-O binary,
    `plist-check` on the release and debug binary, corpus marker checks, smoke test with the `lsof` socket scan);
    only disk cleanup, apt and `xvfb-run` are Linux-only. Windows comes later (add `windows-latest`; OS-specific
    code stays in place). Intel Macs are not built.
- Settings: one sealed file `<app_data>/settings` (same data key, AAD binds the purpose "settings");
  the UI (`src/features/settings/`) caches only locale and theme in `localStorage` for the first paint
  (`public/theme-boot.js` sets `data-theme` before React). Colours come only from the token blocks at
  the top of `src/styles.css` (light `:root`, dark `:root[data-theme="dark"]`; `src/styles.test.ts`).
- Data at rest: meeting files (`<app_data>/meetings/<id>.meeting`) and transcripts
  (`<app_data>/meetings/<id>.transcript`, one sealed record per final segment) are encrypted; audio is
  never written. The data key lives only in the OS keychain (Linux: Secret Service; macOS: Keychain). Tests never touch the real keychain; the one keychain test
  is `#[ignore]` and run by hand (`cargo test --manifest-path src-tauri/Cargo.toml -- --ignored keychain`).
  Likewise the one test with a real speech model: `cargo test --manifest-path src-tauri/Cargo.toml
  --release -- --ignored whisper` (uses `MEETING_COMPANION_WHISPER_MODEL`, else the model the scan prefers),
  and the one with a real speaker model: `MEETING_COMPANION_SPEAKER_WAVS=<person-1.wav>,<person-2.wav>
  cargo test --manifest-path src-tauri/Cargo.toml --release -- --ignored speaker` (16 kHz mono WAVs, one
  person each; uses `MEETING_COMPANION_SPEAKER_MODEL`, else the model the scan prefers; prints the time
  per segment). Speaker models (sherpa-onnx ONNX with `framework` 3d-speaker/wespeaker/nemo, 16 kHz) are
  looked for in `<app_data>/models/` and the Hugging Face cache; nothing is downloaded.
- Speaker accuracy: `src-tauri/src/engines/speaker_eval/` (`#[cfg(test)]` only) mixes test meetings from the
  CC0 VoxPopuli clips in `src-tauri/testdata/speakers/` (`manifest.json` with source, licence and SHA-256 of
  every clip, `ATTRIBUTION.md`, `scenes.json`, `thresholds.json`; provenance scripts in `tools/`), runs
  them through the transcript windowing, a `Diarizer` and the real `VoiceTracker`, and measures DER (missed
  speech, false alarm, confusion; 0.25 s collar, optimal voice mapping) and line accuracy. The default
  suite checks the corpus, the scenes, the measures and the gate with fakes (no model). The real-model run
  is `#[ignore]`: fetch the pinned model once with `node scripts/speaker-model.mjs fetch` (CAM++
  `3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx`, Apache-2.0, checked against
  `src-tauri/native/speaker-model.sha256`, saved in `src-tauri/native/models/`; `verify [file]` exits 1
  for an altered copy), then `MEETING_COMPANION_SPEAKER_MODEL="$(node scripts/speaker-model.mjs path)"
  cargo test --manifest-path src-tauri/Cargo.toml -- --ignored speaker_accuracy`. It prints a table per
  scene and fails when a scene exceeds the thresholds committed for that model file (baseline + at most
  5 points; a model without thresholds is only printed), and it runs the name-round, "applied backwards"
  and "Who said this?" workflows on the real output. CI runs it after `npm test` with the cached model.
  After a deliberate change to `SAME_VOICE`, `MIN_SEGMENT_MS` or the model, re-measure and update
  `thresholds.json` from the `measured:` line the run prints. The test never downloads. The filter
  `--ignored speaker` of the two-WAV check above matches these tests too; they need the env var set.
- Native build dependencies on Linux: `libasound2-dev` (microphone), `cmake`, `clang`, `libclang-dev`
  (whisper.cpp and llama.cpp are compiled from source by `whisper-rs` and `llama-cpp-2`); CI installs them.
  On macOS (Apple Silicon): the Xcode command line tools (clang, libclang for bindgen, `nm`), Homebrew `cmake`;
  the system frameworks Accelerate (ggml's BLAS and CPU code), CoreAudio (cpal), Security (the Keychain through
  `keyring` apple-native; tests never touch it) and Foundation/Metal/MetalKit (linked by llama-cpp-sys-2 only;
  no Metal backend is built). Oldest macOS: 13.3 (`bundle.macOS.minimumSystemVersion` in `tauri.conf.json`,
  `MACOSX_DEPLOYMENT_TARGET` in `.cargo/config.toml` for `tauri dev`/`cargo test`, `CMAKE_OSX_DEPLOYMENT_TARGET` of
  the ggml build; Accelerate's new LAPACK interface needs 13.3). GitHub's macOS runners oversleep short sleeps
  (25 ms → about 100 ms), so the 25 Hz level-rate checks in `src/recording/level_tests.rs` skip themselves there
  with a note on stderr (`coarse_timers()`, macOS only; Linux always runs them). The macOS setup in order is in README.md ("Set up on macOS"); in `tauri dev` macOS
  asks for the microphone on behalf of the terminal app.
- One ggml (job 016). whisper.cpp (`whisper-rs = "=0.16.0"`, whisper-rs-sys 0.15.0, whisper.cpp 1.8.3, which
  vendors ggml 0.9.5) and llama.cpp (`llama-cpp-2`/`llama-cpp-sys-2 = "=0.1.160"`, ggml 0.26.0) would each build
  static `libggml*.a` under the same names, and the linker would silently keep one for both. Decision (option (a) of
  the spec, probed first): ggml is built **once**, from the ggml tree llama-cpp-sys-2 vendors, and both engines link
  that copy. Run `node scripts/ggml.mjs build` once per checkout (and after a change of the llama-cpp-sys-2 version):
  it builds and installs ggml into `src-tauri/native/ggml/prefix/` (static, PIC, CPU only, Metal off on every
  platform, no OpenMP; on macOS with the BLAS backend on Accelerate, because whisper-rs-sys asks rustc for
  `static=ggml-blas` and the Accelerate framework there: archives `libggml.a`, `libggml-base.a`, `libggml-cpu.a`,
  `libggml-blas.a`; elsewhere BLAS off and the first three; `node scripts/ggml.mjs plan [--platform <p>]` prints
  options and archives, and `src/config.test.ts` pins the hook's lists to them; `GGML_NATIVE`
  at ggml's default unless set in the environment; CI sets `OFF`), records the source and a build id in `prefix/SOURCE`. Both sys crates keep a copy of the archives in their build
  output, and cargo does not rerun their build scripts when `.cargo/config.toml` or the prefix changes. So CMake hooks
  (`whisper-shared-ggml.cmake`, `llama-shared-ggml.cmake`) stamp each crate's build folder with `prefix/SOURCE`, and
  `build` runs `cargo clean -p` for every profile whose whisper-rs-sys or llama-cpp-sys-2 output is unstamped or
  stamped by another build (e.g. a whisper-rs-sys with its own ggml restored by CI's Rust cache; it honours
  `CARGO_TARGET_DIR`). `verify` exits 1 unless the prefix holds the pinned crate's ggml and no stale output exists; `outputs` runs only
  the stale-output check (it reads `prefix/SOURCE` and the target dir, no cargo, no environment; `--prefix <dir>`
  points it at another prefix, as the hermetic tests in `src/config.test.ts` do). `.cargo/config.toml` points CMake's
  `find_package(ggml)` there for both crates (`CMAKE_PREFIX_PATH`): llama-cpp-sys-2 with its `system-ggml-static`
  feature, whisper.cpp with `WHISPER_USE_SYSTEM_GGML=ON` (it then compiles against ggml 0.26.0's headers). Because
  whisper-rs-sys still asks rustc for `static=ggml*` from its own build folder only, the CMake hook
  `src-tauri/native/ggml/whisper-shared-ggml.cmake` (`CMAKE_PROJECT_whisper.cpp_INCLUDE`) copies the same archives
  there; without the prefix the build stops with "run node scripts/ggml.mjs build". `src-tauri/native/ggml/CMakeLists.txt`
  adds ggml as a subproject (the crate does not ship ggml's standalone `ggml.pc.in`). A new whisper-rs or llama-cpp-2
  version needs the real speech test (below) and `ggml-check` again before it is merged.
- sherpa-onnx (`sherpa-onnx = "=2.0.1"`, static) links prebuilt libraries. Run
  `node scripts/sherpa-onnx.mjs fetch` once per checkout (and after a change of
  `src-tauri/native/sherpa-onnx.sha256`): it downloads the archive for this platform, checks it against
  the pinned SHA-256, and unpacks it into `src-tauri/native/lib/` (on Linux it gives the libraries' weak
  C++ standard-library symbols their own names, so they cannot clash with whisper.cpp's). `.cargo/config.toml`
  points the build there (`SHERPA_ONNX_LIB_DIR`); without it the build fails instead of downloading.
  After a new fetch: `cargo clean --manifest-path src-tauri/Cargo.toml -p sherpa-onnx-sys`.
  `node scripts/sherpa-onnx.mjs verify` checks archive and libraries; CI runs both and checks that a
  corrupted archive fails.
- Network: the only outbound connection is the Claude API (HTTPS to api.anthropic.com from `engines/claude.rs`), made
  only while a person has chosen "Claude API (cloud)" (the settings Test, and from job 019 the capture suggestions: a
  window of final transcript text with the speakers' display names or voice labels while a meeting records; the status
  line under the composer and the top-bar chip "Vorschläge: Anthropic (Cloud)" say so); `src/config.test.ts` pins the one HTTP client, its host and
  its settings. The local language model (llama.cpp, job 016) runs in the app's own process: no `llama-server`, no
  port, no socket, no other process, and no HTTP client (`llama-cpp-2` without `common`, so no cpp-httplib;
  `ggml-check` and `src/config.test.ts` check it). The real-model test is `#[ignore]`:
  `MEETING_COMPANION_LLM_MODEL=<file.gguf> cargo test --manifest-path src-tauri/Cargo.toml --release -- --ignored llama`
  (a GGUF with a chat template; it runs the German and English samples, an injection sample and a cancel, checks that
  the process holds no new or listening socket, and prints load and generation times). Nothing is downloaded.
- Rules: no literal user-facing strings in JSX (ESLint `react/jsx-no-literals` and a key-mode test);
  user text is rendered as text only (`react/no-danger`); no Tauri HTTP/shell plugins and a CSP whose
  `connect-src` allows only IPC (`src/config.test.ts`); no socket outside `src-tauri/src/phone_view/`, and no
  HTTP client crate (the phone view's axum/hyper are server-only, HTTP/1).
- Env flags of the built app: `MEETING_COMPANION_STORE=memory` (in-memory store), `MEETING_COMPANION_SMOKE=1`
  (smoke run: in-memory store, fake microphone and engine, exits 0 once the agenda setup view has rendered),
  `MEETING_COMPANION_AUDIO=fake` (generated tones instead of the microphone), `MEETING_COMPANION_STT=fake`
  (scripted German/English segments instead of whisper; no model needed), `MEETING_COMPANION_DIARIZE=fake`
  (scripted voices instead of the speaker model; no model needed), `MEETING_COMPANION_LLM=fake` (the scripted language
  model instead of Claude, and local GGUF models from the scan run by it instead of llama.cpp; also in the smoke run). The real keychain
  test of the API key is `#[ignore]` (`-- --ignored keychain`).
