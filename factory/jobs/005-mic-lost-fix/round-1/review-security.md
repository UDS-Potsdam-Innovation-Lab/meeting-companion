VERDICT: PASS

## Findings
- [note] The change has almost no security-relevant surface. It moves stall detection from consumer time to device arrival time (`src-tauri/src/engines/audio.rs` `last_push`/`since_last_push`/`peek`) and splits `recording::run` into a speech thread and a monitor thread (`src-tauri/src/recording/mod.rs:396-503`). Nothing new is recorded, stored, logged or sent. The sink capacity (30 s, oldest dropped) and the encrypted transcript writer are unchanged.
- [note] `src-tauri/.cargo/config.toml:4` sets `CMAKE_BUILD_TYPE=Release` through `[env]` for every Cargo build in `src-tauri`, not only for whisper-rs-sys. This is a build-performance setting with no security effect, and it does not override variables already set in the environment.
- [note] A device failure or stall is still reported exactly once (`reported` swap, mod.rs `report`), and the speech thread still flushes and stores the cut-off utterance before it stops. No audio path was added that bypasses the bounded sink.

## Checked
- `git diff main...HEAD` for all 5 files: audio sink, recorder threads, Cargo dev profile, `.cargo/config.toml`, and the new tests in `recording/tests.rs`. The tests use fake engines, `MemoryKeyProvider`, no network and no real data.
- NFR Architecture, Privacy and Security (`docs/non-functional-requirements.md`): engines stay behind interfaces, audio stays in memory only, no ports, no secrets, nothing leaves the device.
- Profile watch list: no audio or transcript egress, no secrets outside the keychain, no web-view or token change, no LLM input path touched.
- Secret scan: `gitleaks.sh` on the worktree found no leaks (0 findings).

## Secure-coding checklist
| Rule | Result | Evidence |
|---|---|---|
| Input validation, injection, unsafe deserialization | n/a | No new input parsing. Only in-process sample buffers and atomics (mod.rs:404-503). |
| Secrets in code, config, logs, fixtures; broad permissions | ok | gitleaks clean. `.cargo/config.toml` holds only `CMAKE_BUILD_TYPE`. Tests use `MemoryKeyProvider`. |
| AuthN/AuthZ, sessions, insecure defaults, rate/size limits | ok | No auth surface. The 30 s sink bound is kept: `push` still drops overflow (audio.rs:106-110), and the AC3 test checks it. |
| Cryptography | n/a | No crypto change. Transcript encryption is untouched. |
| Errors and logs | ok | The only log line is the existing "could not store a transcript segment" message, which contains no transcript content. Reasons shown to users are unchanged. |
| Personal data | ok | Audio stays in memory and is never written to disk (existing walk-based test). No real recordings in the tests. |
| New dependencies | n/a | No new crates. Only a dev-profile `opt-level` (Cargo.toml:33-36). |
| Security negative tests | ok | Silent-device and device-error tests run while the engine is busy (AC2). The bounded-buffer test runs under a lagging engine (AC3). |
| Secret scan (`secret_scan: true`) | ok | `gitleaks.sh`: no leaks found. |
