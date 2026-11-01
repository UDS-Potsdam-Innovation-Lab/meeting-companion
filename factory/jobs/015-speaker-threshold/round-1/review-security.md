VERDICT: PASS

## Findings
- [note] The change has no security-relevant surface: one clustering constant (`SAME_VOICE` 0.5 → 0.55, src-tauri/src/engines/diarize.rs:22), an extra test-only gate check (src-tauri/src/engines/speaker_eval/real.rs:77), a default-suite test (src-tauri/src/engines/speaker_eval/run.rs:494) and re-baselined test numbers (src-tauri/testdata/speakers/thresholds.json). Nothing new is stored, logged, sent, or exposed.
- [note] The worktree has two untracked symlinks (`node_modules`, `src-tauri/native/lib`) that are not committed. Not part of the change; nothing to fix for this lens.

## Checked
- `git diff main...HEAD` (4 files) and spec/build/rework notes; the security surface is declared "no" in the spec and confirmed by the diff.
- NFR Architecture (diarizer stays behind `Diarizer`, no new engine type), Privacy (no new audio/transcript/embedding storage; embeddings stay in memory), Security (no ports, no LLM input): all unaffected.
- The new test parses the repo's own `thresholds.json` with `find`/`parse` and panics on bad input; test-only, no untrusted input.
- Secret scan: `gitleaks.sh` on the worktree, exit 0, no leaks found.

## Secure-coding checklist
| Rule | Result | Evidence |
|---|---|---|
| Input validation, injection, unsafe deserialization | n/a | Only test code reads a checked-in JSON fixture; no user input path changed |
| Secrets in code/config/logs/fixtures; broad permissions | ok | thresholds.json holds only metrics and a model sha256; gitleaks clean |
| AuthN/AuthZ, sessions, insecure defaults, rate/size limits | n/a | No auth, network or web-view code touched |
| Cryptography | n/a | No crypto; sha256 pin unchanged |
| Errors and logs | n/a | New messages are test-failure strings only (real.rs:79, run.rs:505) |
| Personal data | ok | No new data stored; test fixtures are the existing synthetic corpus, unchanged |
| New dependencies | n/a | No Cargo.toml / package.json change |
| Security negative tests | n/a | No new exposed surface to misuse |
| Secret scan (secret_scan: true) | ok | gitleaks.sh exit 0, "no leaks found" |
