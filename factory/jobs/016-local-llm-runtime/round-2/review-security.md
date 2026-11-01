VERDICT: PASS

## Findings
- [note] scripts/ggml.mjs:154-171 (`cleanStale`): profile and triple names are taken from the target dir's folder names and passed to `cargo clean` as arguments. `run` uses `execFileSync` with an argument array and no shell, and the target dir is the developer's or runner's own folder, so this cannot inject a command. No action needed.
- [note] The round-1 notes still apply and stay non-blocking. (1) `catch_unwind` in `LlamaCppLoader::load` does not catch C++ aborts on crafted GGUF files. This is local denial of service with the user's own files, and safety depends on the pinned `=0.1.160`. (2) `ggml.mjs verify` checks the JSON stamp but does not hash the archives in the cached `prefix/`. The new `built` id and the per-crate stamps make stale detection stricter, but they are not an integrity check. Add SHA-256 of the three archives before release installers are built from a cached prefix. (3) There is no RAM check before a model loads.

## Checked
- Round-2 delta `b96fe4f..83cc3ac`: `.cargo/config.toml` (new `CMAKE_PROJECT_llama.cpp_INCLUDE` hook), `llama-shared-ggml.cmake` (new) and `whisper-shared-ggml.cmake`. These only `configure_file(... COPYONLY)` the prefix's `SOURCE` into the crate's own build folder and fail closed when the prefix is missing.
- `scripts/ggml.mjs`: `profileDirs`/`staleOutputs`/`cleanStale` read only under `CARGO_TARGET_DIR` or `src-tauri/target`. The `RegExp` is built from constant crate names. `cargo clean -p` is scoped per profile and per crate and runs through `execFileSync` without a shell. `verify` now fails closed on stale outputs. The fix makes sure the release binary links the one pinned ggml, which supports AC1's single-copy and no-HTTP-client checks. `ggml-check.mjs` still runs after the release build.
- `ci.yml`: the cache key now also hashes `llama-shared-ggml.cmake`. Permissions, secrets and the order of the `ggml-check` step are unchanged.
- The round-1 security review (PASS) was re-checked against the delta. No runtime, prompt, socket, log or UI code changed in round 2. `gitleaks.sh` on the worktree found no leaks. The diff adds no allow-list entries and no `.gitleaksignore`. No `docs.secure_coding` is configured, so the focus list is the checklist.

## Secure-coding checklist
| Rule | Result | Evidence |
|---|---|---|
| Input validation, injection (shell, SQL, path, HTML), unsafe deserialization | ok | The new script code uses `execFileSync` with argument arrays and no shell (ggml.mjs `run`). It reads `SOURCE` as a string compare, and `JSON.parse` runs inside try/catch on the project's own stamp. The prompt-injection and `{ local: id }` checks from round 1 are unchanged. |
| Secrets in code, config, logs or test fixtures; overly broad permissions | ok | gitleaks found no leaks. The `.cargo/config.toml` and CI changes add no secret, token or permission. |
| AuthN/AuthZ, sessions/cookies, insecure defaults, rate/size limits | n/a | The round-2 delta is build tooling only and has no auth surface. The runtime defaults from round 1 are unchanged. |
| Cryptography: established algorithms only | n/a | No crypto. The stamp is an identity marker, not an integrity hash (see the note). |
| Errors and logs: no internals to users, no sensitive data in logs | ok | The new messages are build-time console output with local paths, for developers and CI only. The app's log callbacks are unchanged (llama.rs). |
| Personal data: minimisation, no real data in tests, role-based access, deletion | n/a | The delta touches no personal data. The new config.test cases use synthetic target-dir fixtures. |
| New dependencies: necessary, maintained, licensed, pinned; audit | ok | The delta adds no new crate or npm package. `llama-cpp-2`/`-sys-2 =0.1.160` and `whisper-rs =0.16.0` stay pinned. Stale-output cleaning makes sure only the pinned crate's ggml is linked. |
| Security negative tests for what the change exposes | ok | `src/config.test.ts` covers a whisper-rs-sys with its own ggml and an output from an earlier prefix (both fail `verify`), plus a stamped target (passes). The round-1 GGUF, injection and ggml-check negative tests are unchanged. |
| Secret scan (`secret_scan: true`) | ok | `gitleaks.sh` on the worktree found no leaks and no allow-list entries. |
