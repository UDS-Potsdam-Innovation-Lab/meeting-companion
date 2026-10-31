VERDICT: PASS

## Findings
- [note] .github/workflows/ci.yml:94 — the new `actions/cache@v4` step is pinned by tag, not by commit SHA. This matches the existing steps (`actions/checkout@v4`, `actions/setup-node@v4`, `Swatinem/rust-cache@v2`), so the job adds no new risk. Pinning all actions by SHA would be a project-wide follow-up. A poisoned cache cannot inject a model either: `fetch` re-verifies a cached file against the pinned SHA-256 (scripts/speaker-model.mjs:89).
- [note] src-tauri/testdata/speakers/manifest.json — each clip records its VoxPopuli speaker id and transcript (European Parliament speeches, CC0-1.0). These ids are opaque public dataset ids. ATTRIBUTION.md states that the tests never try to identify a speaker, and nothing in the code does. No real user data is in the fixtures. The licence and terms decision is the human gate's (spec: Human gate yes), not this lens's.

## Checked
- The whole diff against `main`: ci.yml, scripts/speaker-model.mjs, src-tauri/native/speaker-model.sha256, the `#[cfg(test)] mod speaker_eval;` line in engines/mod.rs, speaker_eval/*.rs (corpus path handling, real.rs model/env handling, log capture, tempdir use), the tools/*.py provenance scripts, ATTRIBUTION.md and manifest.json.
- Supply chain: the model is downloaded only by the Node script over HTTPS from the k2-fsa GitHub release. It is written to a `.part` file, checked against the committed SHA-256 and only then renamed. A mismatch deletes the file and exits 1. CI tests a corrupted copy. Test code makes no network call and has no download fallback (real.rs:31-48 panics naming the env var). The workflow keeps `permissions: contents: read`, and it adds no secrets.
- Privacy/leakage: the corpus and harness are test-only. CI checks for the corpus marker in the test build and its absence in the release binary. Audio stays in memory, and the workflow test writes only to a `tempfile::tempdir()` (real.rs:349). `assert_logs_clean` checks captured `crate::log!` output for names, turn text and decimal numbers (real.rs:148-169). Corpus paths reject `..`/empty segments, and the walk does not follow symlinks (corpus.rs:65,117), so no path traversal is possible.
- Secret scan: `bash FACTORY_HOME/scripts/gitleaks.sh <worktree>` → exit 0, no leaks (130 commits), with no allow-listed lines added.

## Secure-coding checklist
No `docs.secure_coding` in the profile, so this checklist uses the focus list. NFR sections checked: Architecture, Privacy, Security.

| Rule | Result | Evidence |
|---|---|---|
| Input validation, injection, unsafe deserialization | ok | manifest/scene JSON is parsed with serde into typed structs in test code only. Clip paths are validated as plain relative paths (corpus.rs:117), with a negative test (corpus.rs:291). The CI shell steps use only fixed paths. |
| Secrets in code, config, logs, fixtures; broad permissions | ok | gitleaks clean. The workflow keeps `contents: read` and adds no secret. The fixtures hold no credentials. |
| AuthN/AuthZ, sessions, insecure defaults, rate/size limits | n/a | No runtime surface changes, and no listening port or web view is touched (NFR Security). There is a corpus size cap of 15 MB (corpus.rs:300). |
| Cryptography (established algorithms only) | ok | SHA-256 via node:crypto in the script and a test-only SHA-256 (sha256.rs) checked against known vectors. Both are used for integrity only. |
| Errors and logs: no internals, no sensitive data | ok | A log-capture assertion covers names, text and embeddings (real.rs:148-169, 221-225, 451-452). |
| Personal data: minimisation, no real user data in tests | ok | Only public CC0 VoxPopuli speech is used, with opaque speaker ids and no app user data. Speaker identification is explicitly not attempted (ATTRIBUTION.md). |
| New dependencies: necessary, pinned, licensed | ok | No new crate or npm package. The model artefact (Apache-2.0) is pinned by SHA-256 in src-tauri/native/speaker-model.sha256 and checked on fetch, on cache hit and in the test before thresholds apply. |
| Security negative tests | ok | Unlisted, altered, missing, wrongly licensed and path-escape corpus cases (corpus.rs:255-300). CI fails on a corrupted model copy (ci.yml). The test fails without the env var (real.rs:31-37). |
| Secret scan (`secret_scan: true`) | ok | gitleaks exit 0, no findings |
| NFR Privacy: nothing leaves the device | ok | No app runtime change (only the `#[cfg(test)]` module line in engines/mod.rs). The only download is at CI or setup time, by the script. |
| NFR Architecture: engine behind interface | ok | The evaluation goes through `Diarizer` and `VoiceTracker`. `SherpaDiarizer` is constructed only in the `#[ignore]` test. |
| NFR Security: no listening ports; transcript text untrusted | n/a | Not touched by this change. |
