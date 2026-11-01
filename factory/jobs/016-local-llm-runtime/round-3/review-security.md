VERDICT: PASS

## Findings
- [note] scripts/ggml.mjs:34-36 and 188-189: `--prefix <dir>` is accepted by every command, including `build`, which runs `rmSync(prefix, { recursive: true, force: true })`. `node scripts/ggml.mjs build --prefix <wrong dir>` would delete that folder. This is a developer-only CLI, and only the person running it controls the argument, so it is not an exploitable path. If you want to harden it, honour `--prefix` only for `outputs`/`verify`/`path`, or refuse a prefix folder that has no `SOURCE` before `build` deletes it. Non-blocking.
- [note] The round-1/round-2 notes still apply and stay non-blocking: `catch_unwind` does not catch C++ aborts on crafted GGUF files (local DoS with the user's own file, pinned `=0.1.160`); `ggml.mjs verify` checks the stamp but does not hash the archives in a cached `prefix/`; there is no RAM check before a model loads.

## Checked
- Round-3 delta `83cc3ac..3f73115`: `scripts/ggml.mjs` (new `outputs` command, `--prefix` option), `src/config.test.ts` (hermetic fixtures in `mkdtemp` folders that are removed afterwards), `AGENTS.md`. No Rust, UI, CI, dependency or `.cargo/config.toml` change.
- `outputs` reads only `prefix/SOURCE` and the target dir; the existing `execFileSync` argument-array calls with no shell are unchanged. `verify` still fails closed: the prefix check first, then `outputs()`. The CI order (build, then verify, then the release build, then `ggml-check.mjs`) is unchanged, so AC1's one-ggml and no-HTTP-client guarantee holds.
- Earlier security reviews (round 1 and round 2 PASS) re-checked against the delta; nothing they relied on changed. No `docs.secure_coding` is configured, so the focus list is the checklist.
- `gitleaks.sh` on the worktree: no leaks found; the diff adds no allow-list entry or `.gitleaksignore`.

## Secure-coding checklist
| Rule | Result | Evidence |
|---|---|---|
| Input validation, injection (shell, SQL, path, HTML), unsafe deserialization | ok | No shell: `execFileSync` takes argument arrays. `--prefix` is a local CLI path that the developer controls (see the note). The test fixtures use `mkdtemp` paths. The prompt-injection handling in llama.rs is unchanged. |
| Secrets in code, config, logs or test fixtures; overly broad permissions | ok | gitleaks found no leaks. The fixture `STAMP` is a synthetic JSON string. No CI permission change. |
| AuthN/AuthZ, sessions/cookies, insecure defaults, rate/size limits | n/a | Build tooling and tests only. |
| Cryptography: established algorithms only | n/a | No crypto in the delta. |
| Errors and logs: no internals to users, no sensitive data in logs | ok | The new messages are build-time console output for developers and CI. The app's log callbacks are unchanged. |
| Personal data: minimisation, no real data in tests, role-based access, deletion | n/a | No personal data. The fixtures are synthetic folder trees. |
| New dependencies: necessary, maintained, licensed, pinned; audit | n/a | No new crate or npm package. The `=0.1.160` / `=0.16.0` pins are unchanged. |
| Security negative tests for what the change exposes | ok | src/config.test.ts: an unstamped whisper-rs-sys with its own ggml, an earlier-prefix stamp and a missing `SOURCE` all fail; a stamped target passes; a structural test checks that `verify` calls `outputs` and `build` calls `cleanStale`. |
| Secret scan (`secret_scan: true`) | ok | `gitleaks.sh` on the worktree: no leaks found, no allow-list entries. |
