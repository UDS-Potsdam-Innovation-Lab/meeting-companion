# Run on macOS (Apple Silicon)

## Problem
A developer on a Mac cannot rely on the repo today: macOS has not been built since the shared ggml of job 016,
two checks (`ggml-check`, the smoke test's socket scan) are Linux-only, and CI runs on Ubuntu only. Jan wants
the repo ready for a Mac: clone, set up, `npm run tauri dev`, `npm test`, build the app, with a macOS CI run
proving it, so macOS (a product target in the NFR, Architecture and Maintainability) does not rot again.

## Scope
- in: building the shared ggml and linking whisper-rs-sys and llama-cpp-sys-2 against it on macOS
  (Accelerate/ggml-blas as whisper-rs-sys requests it, Metal off); `scripts/ggml-check.mjs` for Mach-O;
  the smoke test's socket check on macOS; the microphone usage description in the unbundled binary
  (dev and `--no-bundle` release); `macos-latest` (arm64) in the matrix of the existing `ci.yml`, on every push and PR;
  "Set up on macOS" in README.md and the macOS facts in AGENTS.md (`## Application stack`).
- out: signing, notarisation, `.dmg`/`.app` installers and their CI (release job); Metal or other GPU
  backends; Intel (x86_64) in CI (the sherpa-onnx `osx-x64` mapping stays as is, untested); Windows; the
  phone view's default-route detection on macOS (`net.rs` keeps "first suitable interface"); any UI change;
  the real-model `#[ignore]` tests (whisper, speaker, llama, keychain) on macOS beyond what a person runs by hand.

## Stack
Status: EXISTING

## Acceptance criteria
- [ ] AC1: On macOS, `node scripts/ggml.mjs build` installs into `src-tauri/native/ggml/prefix/` every static
  archive the two sys crates link there (incl. `libggml-blas.a` with Accelerate when whisper-rs-sys requests
  `ggml-blas`; Metal off), `verify` checks that same per-platform list, and `whisper-shared-ggml.cmake` copies
  exactly that list; `npm run tauri build -- --no-bundle` then links on `macos-latest`. A hermetic test in
  `src/config.test.ts` (runs on Linux too) pins the darwin list in `ggml.mjs` and the hook to the same names and
  checks `GGML_METAL` is `OFF` on every platform.
- [ ] AC2: `node scripts/ggml-check.mjs <binary>` works on a Mach-O binary: it reads the symbols with the system
  `nm` and strips the Mach-O leading underscore, so the one-ggml, required-loader and forbidden-HTTP-client checks
  apply unchanged (NFR Security: no HTTP client/llama-server linked). Recorded macOS `nm` fixtures in
  `scripts/fixtures/ggml-check/` are tested: a clean listing passes, a listing with a ggml symbol defined twice,
  one without `llama_model_load_from_file`, and one with a `_curl_easy_init` each exit 1. CI runs the check on
  the macOS release binary.
- [ ] AC3: `node scripts/smoke.mjs` on macOS scans the running app's sockets (e.g. `lsof -a -p <pid> -i -n -P -F`)
  and fails when the app has a listening TCP or bound UDP socket, and when the scan cannot run (no `lsof`, no
  successful scan): never a silent pass (NFR Security: no listening ports). The parser is tested with recorded
  `lsof` fixtures: no socket passes, a `TCP *:1234 (LISTEN)` fails, a bound UDP fails, an outbound established
  TCP alone passes.
- [ ] AC4: The macOS app binary built without a bundle (`npm run tauri build -- --no-bundle`, and the debug
  binary of `tauri dev`) carries an embedded Info.plist with `NSMicrophoneUsageDescription` (German, as in
  `src-tauri/Info.plist`); CI checks the release binary's `__TEXT,__info_plist` section (e.g. `otool`/`launchctl
  plist`) for the key and fails without it. The bundle config still maps the de/en `InfoPlist.strings`
  (existing config test kept green).
- [ ] AC5: The existing `.github/workflows/ci.yml` matrix runs `[ubuntu-latest, macos-latest]` (macOS arm64) on
  every push and pull request, so the factory's CI gate (`ci_workflow: ci.yml`) waits for macOS too; no separate
  macOS workflow. On macOS the job runs: npm ci, sherpa-onnx fetch + verify (and the corrupted-archive check),
  shared ggml build + verify (`GGML_NATIVE=OFF`, cached per OS/arch), Playwright Chromium, `npm run lint`,
  `npm test`, `npm run tauri build -- --no-bundle`, `ggml-check` (AC2), the Info.plist check (AC4), the
  speaker-corpus marker checks and `node scripts/smoke.mjs` (AC3). Linux-only steps (disk cleanup, apt, `xvfb-run`)
  keep their `runner.os == 'Linux'` guard; the speaker-accuracy real-model step may stay Linux-only if it is too
  slow on macOS (the builder measures it once on the runner and records the choice in the step's comment). The
  "Linux only for now" comment above the matrix is replaced by the current state (Linux and macOS; Windows later).
  A test in `src/config.test.ts` parses `ci.yml` and pins: both runners in the matrix, `fail-fast: false`,
  triggers `push` and `pull_request` without branch or path filters, and that `ggml-check`, the Info.plist check
  and the smoke test run on macOS (no Linux-only `if` on them).
- [ ] AC6: README.md has a "Set up on macOS" section that names, in order: Xcode command line tools, Homebrew
  `cmake`, rustup (toolchain from `rust-toolchain.toml`), Node 22 (`.nvmrc`), `npm ci`,
  `node scripts/sherpa-onnx.mjs fetch`, `node scripts/ggml.mjs build`, `npx playwright install chromium`,
  `npm run tauri dev`, `npm test`, the build command, and that in `tauri dev` macOS asks for the microphone on
  behalf of the terminal app (grant it there; reset with `tccutil reset Microphone <bundle id of the terminal>`).
  AGENTS.md's `## Application stack` lists the macOS native dependencies, Mach-O `ggml-check`, the macOS socket
  scan and the macOS workflow. A test checks the README section exists and names each command.

## Design
Source: none
Status: NOT NEEDED

## Surfaces
- User-facing UI: no — build, CI, scripts and docs only; the macOS microphone prompt text is unchanged.
- Security-relevant: yes — the "no listening port" and "no HTTP client" checks are extended to macOS; the macOS
  keychain (`keyring` apple-native) becomes reachable in builds but tests never touch it; no new secrets
  (the CI workflow needs only `contents: read`); rules touched: none (no `docs.secure_coding`); NFR Security
  (no listening ports), Architecture (one codebase), Maintainability (CI on macOS).
- Human gate: no — no change to auth, secrets, permissions or stored data; the microphone usage description
  already exists and is only verified.
- Audio/transcript data: no — nothing new is recorded, stored or sent; tests use fake engines.
- Leaves the device: no — CI fetches only the already pinned sherpa-onnx archive and npm/cargo dependencies.
- Board (touch) layout: no
- AI speaks or contributes unasked: no

Size: normal

## Open questions
- Spec review 1 (2026-11-02, `stack-decision.md`): the repo is public, so macOS minutes are free; macOS joins the
  `ci.yml` matrix on every push and PR. Jan's request supersedes the "Linux only until the feature set is final"
  decision of 2026-10-30; the profile comment is already updated.
- Assumed whisper-rs-sys 0.15.0 asks for `static=ggml-blas` (and the Accelerate framework) on macOS, as the
  comment in `scripts/ggml.mjs` says, and that llama-cpp-sys-2 with `system-ggml-static` links the same set; the
  builder confirms the exact archive list on the runner before pinning it (AC1). If whisper-rs-sys also asks for
  `ggml-metal` even with Metal off, the fallback is turning BLAS/Metal off consistently for both crates via the
  env both build scripts honour.
- On macOS `phone_view::tests::listening()` returns nothing, so the in-process port test is weaker there than on
  Linux; extending it with `lsof` is left for a later job.
- Intel Macs: not built in CI; the `osx-x64` sherpa archive and darwin-x64 mapping stay, marked untested in
  the README.
