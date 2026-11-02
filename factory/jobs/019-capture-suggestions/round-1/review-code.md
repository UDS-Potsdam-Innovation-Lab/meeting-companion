VERDICT: PASS

## Findings
- [note] src-tauri/src/suggestions/mod.rs:`unconfirm` + src-tauri/src/captures/mod.rs:`delete_capture` — Undo of a confirm goes through `delete_capture`, so the core also keeps a copy for `restore_capture`. A UI that then called `restore_capture` for that id would bring the capture back while the suggestion is pending again (capture and suggestion both present). Not reachable from the shipped UI and the capture is still a person's own copy; no change required.
- [note] src-tauri/src/lib.rs:`ReadByCommand` / `SuggestionEvents` — a trait whose app implementation is a no-op, kept because `config.test.ts` pins the event list. The one-second poll is a documented deviation and acceptable; if an event is wanted later it is a small change.
- [note] src-tauri/src/suggestions/mod.rs:`confirm` — the read of the pending suggestion and its removal are not one lock section, but the command holds `state.edit()` so confirms are serialized; no double-store possible.

## Checked
- Rust core: `captures` (UndoCopies, closed `RestoreRequest`, all five refusal cases return a field error and store nothing, put_back on write failure), `suggestions/mod.rs` (cadence, one in flight, generation-based drop of late replies, cancel on pause/stop/end/setting change, Busy/None paths, dedupe incl. dismissed, single `add_suggested` call site) and the `lib.rs` wiring and commands; no `.claude/` or `factory/` edits on the branch, no change to `config.test.ts` or capabilities.
- Tests map to every AC in build.md (Rust, vitest, Playwright, screenshots); I did not re-run the suite (CI does), and read the build's reported results (cargo 383, vitest 394, Playwright 315, lint, gitleaks).
- Architecture/Maintainability NFRs: engine only via the `LanguageModel` trait behind `SuggestEngine`/`run_task`; the 922-line CapturesPanel is split into focused modules; AGENTS.md updated.
