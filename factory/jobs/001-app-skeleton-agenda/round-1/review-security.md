VERDICT: PASS

## Findings
- [note] .github/workflows/ci.yml:24,27,37 — third-party actions (`actions/checkout@v4`, `actions/setup-node@v4`, `Swatinem/rust-cache@v2`) are pinned by tag, not by commit SHA. Permissions are already `contents: read` and the workflow handles no secrets, so the risk is low. Consider SHA pinning when release signing secrets arrive.
- [note] `cargo audit` is not installed locally, so the Rust dependency tree (src-tauri/Cargo.lock) was not audited. `npm audit` (all and `--omit=dev`) reports 0 vulnerabilities. Consider adding `cargo audit` (or `cargo deny`) to CI in a later job.
- [note] vite.config.ts:10-12 / src-tauri/tauri.conf.json:9 — the Vite dev server listens on localhost:1420, but only during `tauri dev`. The shipped app loads assets through the custom protocol and opens no port, so this is consistent with NFR Security "no listening network ports".
- [note] Spec open question, not a defect: participant names (personal data) are stored unencrypted as JSON in app data. The spec defers encryption at rest to job 3. NFR Privacy names only audio, transcripts and notes, so this is an approver/human decision.

## Checked
- Rust core: src-tauri/src/lib.rs (3 commands: `load_latest_meeting`, `save_meeting`, `view_ready`; the env flags only switch to the in-memory store or exit; logs carry only the error kind or file name, never meeting content), src-tauri/src/model/mod.rs (server-side validation, length and count limits, `is_valid_id` = `[A-Za-z0-9-]{1,64}`, which prevents path traversal through ids used as file names), src-tauri/src/store/file.rs (temp file then atomic rename, 4 MB read cap, an id mismatch or failed validation on load counts as corrupt, the file is never modified; test `unknown_ids_and_foreign_files_are_ignored` covers `../etc/passwd`).
- Attack surface config: tauri.conf.json CSP (`default-src 'self'`, `connect-src ipc: http://ipc.localhost`, object/frame/base/form-action `'none'`, `freezePrototype`, `withGlobalTauri: false`); capabilities/default.json grants only `core:default`; Cargo.toml has no network or shell plugins; no `fetch`/`WebSocket`/XHR in src (only localStorage for the locale, which is checked against an allow-list in src/i18n/index.tsx:32-38).
- UI rendering: no `dangerouslySetInnerHTML`/`innerHTML`/`eval` in src; ESLint `react/no-danger`; XSS literal tests in MeetingCard.test.tsx and Rust. The mock IPC backend is only in `--mode e2e` (confirmed absent from `dist/`). Fixture names are fictional names from the frame.
- Secret scan: `gitleaks.sh` over the worktree exits 0, "no leaks found" (9 commits). `npm audit`: 0 vulnerabilities. CI uses `permissions: contents: read` and no secrets.

## Secure-coding checklist
No `docs.secure_coding` is configured in the profile, so this checklist uses the focus list.

| Rule | Result | Evidence |
|---|---|---|
| Input validation, injection (shell, SQL, path, HTML), unsafe deserialization | ok | src-tauri/src/model/mod.rs `validate` re-checks every save in the core; `is_valid_id` blocks path traversal (store/file.rs `load`, `entries`); React renders text only, no-danger lint, XSS test; serde into typed structs with a 4 MB cap (store/file.rs:11,57) |
| Secrets in code, config, logs or fixtures; overly broad permissions | ok | gitleaks clean; capabilities/default.json only `core:default`; CI `permissions: contents: read` |
| AuthN/AuthZ, sessions, insecure defaults, rate/size limits | ok | No auth surface (local single-user app). Size limits: 200/100/200 chars, 100 participants/items, 4 MB file; env test hooks only narrow to the in-memory store |
| Cryptography | n/a | No crypto in this change; encryption at rest is deferred to job 3 per spec |
| Errors and logs | ok | lib.rs:55,77 log only the error kind/file name; UI shows translated codes, not internals (ipc.ts maps to `corrupt`/`unreadable`/`io`) |
| Personal data: minimisation, no real data in tests, access, deletion | ok | Only names entered by the facilitator, stored in OS app data; fixtures use fictional names; deletion is out of scope (spec) — see note on encryption |
| New dependencies: necessary, maintained, licensed, pinned, audited | ok | Minimal runtime deps (tauri, serde, serde_json, react, @tauri-apps/api, fontsource); lockfiles committed; npm audit 0; cargo audit not run (note) |
| Security negative tests | ok | Rust `ids_cannot_escape…`/`unknown_ids_and_foreign_files_are_ignored`, corrupt and foreign-id files, invalid input never written; UI XSS literal; config.test.ts asserts no HTTP plugin and the CSP connect-src; e2e no-network test |
| Secret scan (secret_scan: true) | ok | `gitleaks.sh` exit 0, no leaks, no allow-list entries added |
| NFR Architecture (local-first, one codebase, engines behind interfaces) | ok | No network; engines/mod.rs placeholder for trait-based engines; MeetingStore trait with a fake |
| NFR Privacy (stored only on device, nothing leaves, secrets in keychain) | ok | File store in app_data_dir; no network capability; no secrets handled |
| NFR Security (no listening ports; untrusted text) | ok | No server or socket in the Rust source (config.test.ts); dev server is dev-only; text treated as untrusted and rendered as text |
| Profile watch: phone web view without token; prompt injection | n/a | Neither exists in this change |
