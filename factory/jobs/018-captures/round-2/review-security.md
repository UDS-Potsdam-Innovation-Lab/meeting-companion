VERDICT: PASS

## Findings
- [note] Round 2 (`4b0459f`, delta from round-1 head) changes layout and focus only. It touches `CapturesPanel.tsx`, `useCaptures.ts`, `LiveView.tsx`, `styles.css` and tests. This adds no security surface: no new IPC command, no new data path, no new rendering sink, and no network or log call.
- [note] src-tauri/src/captures/mod.rs (`restore_capture`). My round-1 note still stands, and build.md accepts it as deferred. Before job 012 or 019 lets other clients reach capture commands, the core should hold the removed capture or issue a restore token. Nothing to do in this job.

## Checked
- The round-2 delta (`git diff <round-1 head>..HEAD`):
  - The new document-level `focusin`/`pointerdown`/`pointerup` listeners in `CapturesPanel.tsx` only read `formRef.contains(target)` and set a boolean. They are removed on unmount.
  - The `editing` state moved into `useCaptures` and stays UI-only.
  - `LiveView.tsx` adds a `data-centre` attribute with a fixed set of values and a `scrollIntoView`.
  - The CSS changes are layout only.
- The e2e AC4 network check now compares request URLs against the page's own origin (`e2e/captures.spec.ts`). It is no weaker than before: any request to another origin still fails the test.
- Round-1 security review and build.md round responses: the one security note was answered (deferred, as suggested).
- Secret scan: `gitleaks.sh` over the worktree (193 commits) found no leaks.

## Secure-coding checklist
No `docs.secure_coding` is configured. This checklist follows the focus list. Rows marked "unchanged" were verified in round 1, and the round-2 delta does not touch them.

| Rule | Result | Evidence |
|---|---|---|
| Input validation, injection, unsafe deserialization | ok | Unchanged core validation. The round-2 UI adds no `innerHTML`, `eval` or `href` sinks. Capture text is still rendered only as React text nodes. |
| Secrets in code, config, logs, fixtures; broad permissions | ok | No secrets. gitleaks is clean. No change to Tauri capabilities or the CSP. |
| AuthN/AuthZ, sessions, insecure defaults, rate/size limits | ok | Unchanged: local IPC only, running meeting only, 500 characters and `MAX_CAPTURES` = 2000. The restore note is deferred (see Findings). |
| Cryptography | n/a | The round-2 delta has no crypto. The round-1 storage uses the existing XChaCha20-Poly1305 seal and `OsRng` ids. |
| Errors and logs | ok | The round-2 delta adds no logging. The round-1 log line has no content (captures/mod.rs:83). |
| Personal data | ok | No new data. The fixtures are unchanged and invented. |
| New dependencies | n/a | No change to Cargo.toml or package.json. |
| Security negative tests | ok | The round-1 negative tests still pass (cargo 345 passed per build.md). The AC4 no-network e2e check now uses the page's own origin. |
| Secret scan (`secret_scan: true`) | ok | `gitleaks.sh`: 193 commits scanned, no leaks found. |
