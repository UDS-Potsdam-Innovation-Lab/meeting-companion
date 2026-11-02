APPROVE
macOS (arm64) builds, tests and smoke-tests in the one ci.yml matrix, green on both runners at HEAD 23303d6; every AC has a matching hermetic test, and the change adds no dependency, data, auth or secret.

## Checks
- Tests: round-1/ci.md `CI: success`, run 41435606381 on 23303d65e6c24cd8a9c21c14cfa5a73de1927658 = `git rev-parse HEAD` (ubuntu-latest and macos-latest). I did not re-run anything: the tests in src/config.test.ts plainly exercise their ACs.
- Acceptance criteria:
  - AC1 ✓ (config.test.ts "AC1 (job 017)": the darwin `plan` list equals the `elseif(APPLE)` hook list including libggml-blas.a, `verify` uses `archives()`, GGML_METAL/CUDA/VULKAN/BACKEND_DL are OFF on darwin/linux/win32; CI `tauri build --no-bundle` links on macos-latest)
  - AC2 ✓ (the recorded macOS nm fixtures: clean passes; two-ggml, no-llama and curl exit 1; read as ELF it fails, which proves the underscore stripping matters; CI ggml-check step has no Linux guard)
  - AC3 ✓ (the lsof fixtures: none and outbound pass; tcp-listen and udp-bound fail; a wrong pid or empty listing fails; smoke fails on zero scans)
  - AC4 ✓ (plist-check is tested on synthetic Mach-O: pass, no section, no key, changed text, ELF; main.rs embeds Info.plist for non-dev builds; CI checks the release and debug binaries on macOS; the existing InfoPlist.strings test is kept)
  - AC5 ✓ (ci.yml is parsed: both runners, fail-fast false, push/pull_request without filters, contents: read, every check without a Linux guard, the ggml cache keyed by OS and arch, GGML_NATIVE=OFF; the speaker-accuracy step stays on macOS, about 11 s, noted in its comment)
  - AC6 ✓ (the README section is checked for every step in order, plus the terminal and tccutil note; AGENTS.md is checked for the macOS facts)
- Scope / factory files untouched: ✓ (no path under .claude/ or factory/; no Cargo.toml or package.json change; the stack decision's amendment is followed: a matrix in ci.yml, no separate workflow). Three side changes the macOS build or `npm test` needed, documented in build.md and accepted by review-code:
  - minimumSystemVersion / MACOSX_DEPLOYMENT_TARGET 13.3, required by Accelerate's new LAPACK interface
  - the level-rate tests skip only on coarse-timer Macs; Linux runs them in full
  - a race fix in a device test, plus clippy fixes for the macOS build
- Reviewer notes: none needs a human call. The WebKit helper processes are not covered by the socket scan, and that is equally true on Linux.

## For the human (ESCALATE only)
n/a. On your real-Mac test after the merge, check that `npm run tauri dev` prompts for the microphone. That dev path relies on tauri's own plist embedding, which CI does not exercise: the CI debug check uses a plain `cargo build`.
