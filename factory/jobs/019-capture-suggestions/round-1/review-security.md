VERDICT: PASS

## Findings
- [note] src-tauri/src/suggestions/mod.rs:326-347 (`on_segment`) together with mod.rs:556-570 (`next_job`): the suggester collects final segments whenever a meeting records, including while `languageModel` is `none`. If someone switches to Claude mid-meeting, the first request carries up to 20 lines (≤ 6000 chars) spoken while the status line still said "Vorschläge aus". The person chose Claude and the cloud line shows from that moment on, so this is within the spec ("a bounded window"). If the human wants a stricter reading of NFR Privacy, `setting_changed` could clear `lines`/`new` so that only text spoken after the switch goes out. Not blocking.
- [note] src-tauri/src/engines/llm.rs:203-213: `run_cancellable` checks the token once before it spawns the engine call. If a Pause arrives right after `next_job` hands out the job, one HTTP request can still start before the cancel lands. Its reply is dropped (mod.rs:598-604), and it only holds text from while recording, so no unannounced data leaves. Noted for completeness.
- [note] src-tauri/src/suggestions/mod.rs:464-484 (`unconfirm`) accepts any capture id and acts as `delete_capture`, typed captures included. It grants nothing beyond the existing delete command, keeps the Undo copy in the core, and only re-queues a suggestion that this session confirmed. Fine as is.
- [note] Secret scan: `gitleaks.sh` on the worktree exited 0 ("no leaks found"), and no allow-list entries were added.

## Checked
- The whole core diff: `captures/mod.rs` (UndoCopies, closed `RestoreRequest`, restore from the core's copy only, put_back on failed write), `suggestions/mod.rs` (cadence, generation/cancel, in-memory sessions, confirm only via a command, error kinds only in logs), `suggestions/prompt.rs` (fixed `&'static str` task, control chars flattened, closed reply parser with kind/segment/owner/length checks, truncated reply gives nothing), `language_model.rs::run_task` (Busy/NotConfigured before engine build), `lib.rs` commands and wiring, `model::Capture.segments` validation.
- The untrusted-content path: `Prompt::build`/`escape` in `engines/llm.rs` escape `<`, `>` and `&` so a fake `</untrusted_content>` cannot break out. `LlmError` Display is fixed strings, so `crate::log!("capture suggestions: {e}")` carries no model, response or key text.
- UI path: `save_from_ui` keeps the stored captures (lib.rs:243-254), so the UI cannot write a `suggested` capture without `confirm_suggestion`. `restoreCapture` in `src/lib/ipc.ts` sends ids only. No `dangerouslySetInnerHTML`/`innerHTML` in `src/` (lint holds `react/no-danger`). No change to capabilities, `tauri.conf.json`, `src/config.test.ts`, `package.json` or `Cargo.toml`/lock.
- NFR Architecture (engines behind interfaces: `SuggestEngine` → `LanguageModel` trait), Privacy (cloud only while `claude`, destination named in the status line and top-bar chip, pending/dismissed/Undo copy in memory only, confirmed captures in the sealed file), Security (transcript treated as untrusted model input, no new ports).

## Secure-coding checklist
No `docs.secure_coding` is configured, so this is one row per focus bullet.

| Rule | Result | Evidence |
|---|---|---|
| Input validation, injection, unsafe deserialization | ok | `RestoreRequest`/`Confirm` are `deny_unknown_fields` (captures/mod.rs:258-263, suggestions/mod.rs:143-155). Confirmed input goes through `validate_capture`. `segments` are typed `Vec<u64>` and checked sorted/≤20 (model/mod.rs:793-808). Prompt injection: fixed task, escaped content block, closed reply parser (prompt.rs:154-219). |
| Secrets in code/config/logs/fixtures; broad permissions | ok | gitleaks clean. No capability or CSP change. The API key stays in the existing keychain path of `engines/claude.rs`. |
| AuthN/AuthZ, sessions, insecure defaults, rate/size limits | ok | Off by default (`languageModel = none`). Cadence 4 segments/60 s with one request in flight. ≤6000 input chars, 600 output tokens, ≤3 entries per run, ≤20 pending. No phone route added, so the meeting-token surface is unchanged. |
| Cryptography | ok | Suggestion ids come from `OsRng` (suggestions/mod.rs:626). Captures are stored through the existing sealed store. No new algorithms. |
| Errors and logs | ok | Errors are field codes or `LlmError` kinds only. Logs carry `LlmError`/`StoreError` Display only (suggestions/mod.rs:579, 621). The build reports a log-capture test. |
| Personal data | ok | Real names go to Anthropic only with Claude chosen (human decision 2026-11-02) and are announced in the status line and chip. Pending/dismissed suggestions and the Undo copy stay in memory and are dropped at meeting end (lib.rs:368-372). Only segment numbers are stored, no text. |
| New dependencies | n/a | No change to package.json, Cargo.toml or the lock files. |
| Security negative tests | ok | Build lists tests for refused restore cases, a capture body refused, unknown/handled confirm stores nothing, the injection line plus fake closing tag, malformed/truncated replies, no request with none/local (fake Transport), no auto-confirm. |
| Secret scan (`secret_scan: true`) | ok | `gitleaks.sh` exit 0, "no leaks found". |
