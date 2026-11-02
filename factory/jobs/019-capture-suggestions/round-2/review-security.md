VERDICT: PASS

## Findings
- [note] Round-1 note 1 addressed: src-tauri/src/suggestions/mod.rs:348-358 (`setting_changed`) now clears `lines`, `new` and `last_run` along with cancelling the request. A newly chosen engine gets only lines spoken after the change, so nothing said under "Vorschläge aus" (or under another engine) reaches Anthropic. Covered by `suggestions/tests.rs::a_new_setting_sends_only_lines_spoken_after_the_change` (off → Claude, then Claude → local). This satisfies the stricter reading of NFR Privacy.
- [note] Round-1 notes 2 (`run_cancellable` race) and 3 (`unconfirm` acts like delete) were left as they are. Both were non-blocking and still hold.
- [note] The cloud chip moved into `RecordingControls` through the new `extra` slot (src/features/live/LiveView.tsx:352, src/features/transcript/RecordingControls.tsx:58). The display condition (`cloudChip`) did not change, so the cloud destination is still announced while recording.
- [note] Secret scan: `gitleaks.sh` on the worktree exited 0 ("no leaks found", 234 commits). The round-2 diff adds no allow-list entries.

## Checked
- The round-2 delta `157cadd..6069885`: `suggestions/mod.rs` (`setting_changed`), the new test in `suggestions/tests.rs`, `LiveView.tsx`/`RecordingControls.tsx` (chip placement), `styles.css` and `e2e/suggestions.spec.ts` (layout only).
- The full job against main: dependency, capability, `tauri.conf.json` and `.gitleaksignore` files are unchanged (`git diff main...HEAD --stat` is empty for them).
- My round-1 review: the one finding the builder acted on is fixed. All other round-1 checklist evidence still holds, because the delta does not touch captures, prompt, parser, logging or storage code.
- NFR Architecture, Privacy and Security: no new engine path, network path or storage path.

## Secure-coding checklist
No `docs.secure_coding` is configured, so this is one row per focus bullet.

| Rule | Result | Evidence |
|---|---|---|
| Input validation, injection, unsafe deserialization | ok | Unchanged since round 1: closed `RestoreRequest`/`Confirm` schemas, `validate_capture`, fixed task + escaped content block + closed reply parser. Round 2 changes no input path. |
| Secrets in code/config/logs/fixtures; broad permissions | ok | gitleaks is clean. No capability or CSP change. The API key stays in the keychain path. |
| AuthN/AuthZ, sessions, insecure defaults, rate/size limits | ok | Off by default. Cadence and limits are unchanged, and `setting_changed` restarts the count and timer (mod.rs:353-355). No phone route. |
| Cryptography | n/a | Round 2 touches no crypto. Round-1 evidence (OsRng ids, sealed store) is unchanged. |
| Errors and logs | ok | No new log or error text in the delta. |
| Personal data | ok | Data minimisation is improved: transcript lines from before a setting change are dropped and never sent (mod.rs:351-353, test at tests.rs:551). Everything stays in memory only. |
| New dependencies | n/a | package.json, Cargo.toml and the lock files are unchanged. |
| Security negative tests | ok | New negative test: no pre-change line ("VORHER") reaches the new engine, and no request is made before the count fills again (tests.rs:551-593). |
| Secret scan (`secret_scan: true`) | ok | `gitleaks.sh` exit 0, "no leaks found". |
