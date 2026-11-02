# Build: 017-macos-support

## Summary
macOS (Apple Silicon) now builds, tests and smoke-tests in the existing `ci.yml`, matrix
`[ubuntu-latest, macos-latest]`, on every push and PR. `scripts/ggml.mjs` has one archive list per platform:
on macOS it adds `libggml-blas.a` (BLAS on Accelerate, Metal off, deployment target 13.3), and the whisper
hook copies the same list. `ggml-check` reads Mach-O (it detects the format from the magic number and strips the
leading underscore). The smoke test scans sockets on macOS with `lsof` (new `scripts/sockets.mjs`) and fails if
no scan succeeded. The unbundled binary embeds `src-tauri/Info.plist` (`main.rs`, `not(dev)`), and the new
`scripts/plist-check.mjs` checks it. README has "Set up on macOS", and AGENTS.md lists the macOS facts.

Decisions the reviewers should see:
- **Oldest macOS is 13.3** (`bundle.macOS.minimumSystemVersion`, `MACOSX_DEPLOYMENT_TARGET` in `.cargo/config.toml`,
  `CMAKE_OSX_DEPLOYMENT_TARGET` for ggml). Without it, `tauri build` targets 10.13 and llama-cpp-sys-2's
  `std::filesystem` does not compile. Accelerate's new LAPACK interface, which ggml uses, needs 13.3.
- **Level-rate tests skip themselves on coarse-timer Macs.** On `macos-latest`, a 25 ms sleep takes 92–121 ms and
  a 1 ms sleep takes 8–12 ms (measured in run 41420211846, also with `taskpolicy -l 0 -t 0`). A 25 Hz loop cannot
  hold its rate there. The four rate/latency tests in `level_tests.rs` measure the timer once (`coarse_timers()`,
  macOS only) and print a note when they skip. The fifth test, AC7, keeps its no-log/no-store checks with a lower
  count. Linux always runs them in full, and so does a Mac whose timers are precise.
- A race in an existing test (`switch_to_the_system_default_keeps_recording_and_the_elapsed_time`) failed once on
  the slow runner. It now waits for the switch event as well as the opened default.
- macOS-only clippy findings in `phone_view/tests.rs` are fixed: an unused import, and a field read only by a
  Linux-only test.
- The speaker-accuracy step stays on macOS. It took about 11 s there (comment in the step).
- On macOS the smoke scan lists all of the process's files (`lsof -a -p <pid> -n -P -F ftPnT -Tqs`). A good scan
  therefore always contains the `p<pid>` line, and "lsof found nothing" cannot pass silently. A UDP socket with a
  bound local port counts as open. An unbound `*:*` one does not.

## Acceptance criteria
| AC | Test | Result |
|----|------|--------|
| AC1 | src/config.test.ts::AC1 (job 017) builds and verifies ggml, ggml-base, ggml-cpu and ggml-blas on macOS, and the hook copies exactly those; …keeps the Linux and Windows lists…equal; …turns Metal and every other GPU backend off on every platform; …same oldest macOS as the app; CI step "Compile the desktop app" (`npm run tauri build -- --no-bundle`) on macos-latest | PASS |
| AC2 | src/config.test.ts::AC2 (job 017) passes the listing recorded from the macOS release app; fails on two-ggml.txt / no-llama.txt / curl.txt; would not find the engines in a Mach-O listing read as ELF; reads a binary's format from its magic number; CI step "One ggml, both engines and no HTTP client" on macOS (`ggml-check: … (10 symbols checked, macho)`) | PASS |
| AC3 | src/config.test.ts::AC3 (job 017) passes none.txt / outbound.txt; the outbound fixture really holds an established TCP connection; fails on tcp-listen.txt / udp-bound.txt; fails when the listing is not a scan of the app's process; the smoke test scans with lsof on macOS and fails when no scan succeeded; CI macOS smoke `smoke: no listening port (22 scans)` | PASS |
| AC4 | src/config.test.ts::AC4 (job 017) passes a binary whose __TEXT,__info_plist is src-tauri/Info.plist; fails on no section / no key / changed text / ELF; main.rs embeds src-tauri/Info.plist…; existing AC6 (job 003) bundle InfoPlist.strings test; CI step "The macOS app binaries declare the microphone use" (release and debug binary) | PASS |
| AC5 | src/config.test.ts::AC5 (job 017) runs ubuntu-latest and macos-latest, fail-fast off; triggers on every push and pull request, without filters; runs every build and check step on macOS too; caches the shared ggml per OS and architecture…; AC1 CI workflow (updated) | PASS |
| AC6 | src/config.test.ts::AC6 (job 017) names every step in order; AGENTS.md lists the macOS facts of the stack | PASS |

## Secure coding
The profile names no secure-coding guideline (`docs.secure_coding` is unset). NFR rules this change touches:
- Security, no listening ports: the smoke test now also checks macOS (listening TCP or bound UDP fails, and so does
  a scan that never succeeded). Its parser is tested on recorded `lsof` listings.
- Security, no HTTP client or llama-server: `ggml-check` now also runs on the Mach-O release binary in CI. The
  recorded macOS fixtures prove that the forbidden-symbol checks still apply once the underscore is stripped.
- Secrets: none added. The workflow keeps `permissions: contents: read`. Tests never touch the macOS Keychain. The
  fixtures hold only symbol names, a CI runner's private VM address and GitHub's public 443 endpoint.

## Test run
Local (Linux, a busy shared machine): `npm run lint` passed. `cargo test --manifest-path src-tauri/Cargo.toml` gave
322 passed, 7 ignored. `npx playwright test` gave 263 passed. `npx vitest run` passed 328/328 once. Later runs had
1–2 UI component tests time out (i18n speakers view, settings SoundWave) while other rustc jobs pushed the load
average to about 25–30. Those tests are untouched by this job, and they pass on both CI runners.

CI on the final commit 23303d6: https://github.com/UDS-Potsdam-Innovation-Lab/meeting-companion/actions/runs/41435606381
ubuntu-latest and macos-latest both green.

`npm test` on macos-latest gave vitest 328 passed, cargo 321 passed and 7 ignored (one test is Linux-only), and Playwright 263 passed:
```
 Test Files  22 passed (22)
      Tests  328 passed (328)
test result: ok. 321 passed; 0 failed; 7 ignored; 0 measured; 0 filtered out; finished in 71.59s
  263 passed (6.8m)
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 326 filtered out; finished in 11.64s
ggml-check: one ggml, both engines linked, no HTTP client (10 symbols checked, macho)
plist-check: src-tauri/target/release/meeting-companion declares NSMicrophoneUsageDescription (de)
plist-check: src-tauri/target/debug/meeting-companion declares NSMicrophoneUsageDescription (de)
SMOKE OK: agenda-setup rendered
smoke: no listening port (22 scans)
smoke: passed
```
On ubuntu-latest: vitest 328, cargo 322 passed / 7 ignored, Playwright 263, `ggml-check … (elf)`,
`smoke: no listening port (332 scans)`.

Secret scan: `bash $FACTORY_HOME/scripts/gitleaks.sh <worktree>` exited 0 (no leaks) before every push.

## Commits
```
23303d6 ci: drop the temporary macOS fixture recorder
e71fb35 docs: set up on macOS, macOS facts of the stack
c4c8281 test(017): pin the macOS ggml list, Mach-O ggml-check, lsof scan, plist check and CI matrix
0cc03b7 test(recording): wait for the switch event, not only the opened default
5b613b1 test(ggml-check): recorded macOS nm fixtures
6f6efc2 ci: drop the macOS timer diagnostics, npm test on both OSes
0d94ae7 build(macos): oldest macOS 13.3 for the app, its tests and ggml
e5ab08b test(level): skip the 25 Hz rate checks where macOS timers are too coarse
c5986af ci: temporary macOS timer diagnostics
f0c5e70 fix(test): no unused import or field in the phone view tests off Linux
9824409 ci: add macos-latest to the matrix (with temporary fixture recorder)
ddd5248 feat(macos): embed Info.plist in the unbundled binary, add plist-check
e74cd40 feat(smoke): scan the app's sockets with lsof on macOS
56fa8c8 feat(ggml-check): read Mach-O symbol tables
cf94dc6 feat(ggml): build and copy ggml-blas (Accelerate) on macOS, Metal off
```
