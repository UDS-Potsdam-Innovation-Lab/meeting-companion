VERDICT: PASS

## Findings
- [note] src-tauri/src/model/mod.rs:493-541 — `validate_topics` does not check that a span starts at or after the run's `endedAt`, or that spans of one topic don't overlap. Neither is in AC5, and neither can cause harm: the data is the user's own, it stays in the encrypted file, and the per-topic span cap of 1000 limits its size. Not blocking.
- [note] src-tauri/src/model/mod.rs:127-133 — every topic may hold up to 1000 spans (100 × 1000 span records per meeting). That limits how large an IPC payload or file can get, and it is consistent with the existing `MAX_LINE_CHOICES`. Fine as it is.

## Checked
- Rust validation of the new untrusted IPC fields (`mode` and `source` as closed string sets, title length 1–200 by chars, id rule `is_valid_id` that blocks `../x`, the 100-topic and 1000-span caps, the span rules, at most one open span, agenda/free exclusivity). There is a Rust test for every AC5 case, plus the lib.rs `save` path test that confirms a bad payload is rejected and not written.
- UI rendering and logging: topic titles render only as React text (TopicsCard.tsx:83), there is no `dangerouslySetInnerHTML`, `innerHTML`, `console.*`, `fetch` or `window.open` in the diff, and the UI mirror of the rules is in `model.ts` `areTopicsValid`.
- Privacy and recording: the free view reuses the unchanged TranscriptPanel and RecordingControls (consent gate, REC chip, encrypted `<id>.transcript`), and `onEnd` stops capture before the meeting ends. No Cargo, package, capabilities or tauri.conf changes, so no new dependency, plugin, permission, port or network access.
- Secret scan: `gitleaks.sh` on the worktree exited 0 ("no leaks found", 103 commits scanned).

## Secure-coding checklist
No `docs.secure_coding` is configured. The checklist below follows the focus list, together with the NFR sections Architecture, Privacy and Security.

| Rule | Result | Evidence |
|---|---|---|
| Input validation, injection (shell, SQL, path, HTML), unsafe deserialization | ok | model/mod.rs:327-331 and 493-541 validate `mode` and topics as untrusted; the topic id uses `is_valid_id` (no path characters); titles are React text only (TopicsCard.tsx:83); serde uses typed structs |
| Secrets in code, config, logs or fixtures; broad permissions | ok | gitleaks clean; no capability or permission changes; the fixtures (agenda/fixtures.ts) contain only made-up meeting data |
| AuthN/AuthZ, sessions, insecure defaults, rate/size limits | ok | no auth surface added; size limits MAX_TOPICS=100, MAX_SPANS=1000 and TITLE_MAX=200 are enforced in the core (model/mod.rs:27-30) |
| Cryptography | n/a | no crypto changes; topics are stored in the existing encrypted `<id>.meeting` file |
| Errors and logs | ok | errors are field codes only (e.g. `run.topics[0].title` / `tooLong`); no new log lines, and neither topic titles nor transcript text are logged |
| Personal data (minimisation, test data, deletion) | ok | new data is limited to the mode, typed topic titles and timestamps, kept on the device in the encrypted file; test data is synthetic |
| New dependencies | n/a | no Cargo.toml or package.json changes |
| Security negative tests | ok | Rust tests reject an unknown mode (including `<script>`), a bad or duplicate id, a bad source, title length, too many topics or spans, and bad spans; a UI test checks that markup in a title stays text |
| Secret scan (secret_scan: true) | ok | `gitleaks.sh` exit 0, no findings |
| NFR Privacy (on device, encrypted, consent before recording, REC visible) | ok | LiveView.tsx uses the unchanged TranscriptPanel and RecordingControls; e2e/free.spec.ts checks for no foreign request |
| NFR Security (no listening ports; transcript as untrusted LLM input) | n/a | no ports or network added; there is no language model in this job |
| NFR Architecture (engines behind interfaces, ipc.ts the only Tauri caller) | ok | no new IPC command; the existing save path is reused through MeetingStore |
