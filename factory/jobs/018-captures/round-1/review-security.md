VERDICT: PASS

## Findings
- [note] src-tauri/src/captures/mod.rs:224-257 — `restore_capture` takes the whole `Capture` from the UI, including `createdAt` and `editedAt`. They are checked (id format, uniqueness, kind, text length and trim, owner, due date, item/topic, `source == "typed"`, `editedAt >= createdAt`), but the core does not check that the restored capture is the one it removed: the UI can set any past `createdAt`. The only caller is the local webview, so this is not a trust boundary in this job. Before job 012 or 019 lets other clients reach capture commands, consider having the core hold the last removed capture (or a short-lived restore token) and restore from that.
- [note] src-tauri/src/captures/mod.rs:83 — the only new log line logs `StoreError`'s Display. For `Corrupt` and `Io` that string includes the file name and the OS error, not capture content. This complies with the NFR "no content in logs". The test `capture_text_never_reaches_the_log_or_an_error` covers it.

## Checked
- The core: `src-tauri/src/captures/mod.rs`, the `Capture` schema and `validate_capture`/`validate_captures` in `model/mod.rs`, the five Tauri commands and the `save()` change in `lib.rs`. The UI cannot overwrite stored captures through `save_meeting`. Ids come from `OsRng`. Meeting ids are checked by `is_valid_id` before any path is built (`store/file.rs:177`). Capture ids are never used in paths.
- UI: `src/features/captures/*`, `src/lib/ipc.ts`, `media.ts` and `mockBackend.ts`. They have no `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`href` sinks and no `console.*` of capture text. `captureError` keeps only well-typed field/code pairs.
- NFR Architecture/Privacy/Security: captures are stored inside the sealed `<id>.meeting` file. The change adds no network code, no new port and no `LanguageModel` use. `phone_view` does not serialise `Meeting`, so captures are not exposed there. Fixtures use invented sample data.
- Secret scan: `gitleaks.sh` over the worktree (192 commits) found no leaks.

## Secure-coding checklist
No `docs.secure_coding` is configured. This checklist follows the focus list.

| Rule | Result | Evidence |
|---|---|---|
| Input validation, injection, unsafe deserialization | ok | `deny_unknown_fields` on `NewCapture`, `CaptureChange` and `Capture` (captures/mod.rs:20,38; model/mod.rs:97). Text is trimmed and at most 500 characters. Kind, owner, due date and item/topic are checked against the meeting (model/mod.rs `validate_capture`). Text is rendered only as React text nodes. No path, shell or SQL use. |
| Secrets in code, config, logs, fixtures; broad permissions | ok | No secrets. gitleaks is clean. No new Tauri plugin or capability, and the CSP is unchanged (config.test.ts has no diff). |
| AuthN/AuthZ, sessions, insecure defaults, rate/size limits | ok | The commands are local IPC only. Only a running meeting takes captures (`load_running`). Size limits: 500 characters per text and `MAX_CAPTURES` = 2000. See the restore note above. |
| Cryptography | ok | Ids come from `OsRng`. The data is stored with the existing XChaCha20-Poly1305 seal. No new primitives. |
| Errors and logs | ok | `CaptureError` holds only codes and field names (captures/mod.rs:58-75). The one log line has no content (mod.rs:83). |
| Personal data | ok | Owner is a participant id, not a name. Captures are kept in the sealed meeting file and are deleted with the meeting. Fixtures are invented. |
| New dependencies | n/a | No change to Cargo.toml or package.json. |
| Security negative tests | ok | captures/tests.rs covers bad text, unknown kind, wrong owner, invalid date, unknown item/topic, duplicate id, a meeting that is not running, a closed schema, markup stored verbatim, no text in logs or errors, and no LM request. Captures.test.tsx covers markup rendered literally. |
| Secret scan (`secret_scan: true`) | ok | `gitleaks.sh`: 192 commits scanned, no leaks found. |
