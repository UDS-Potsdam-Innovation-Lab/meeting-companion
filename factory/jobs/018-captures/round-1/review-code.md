VERDICT: PASS

## Findings
- [note] src/features/captures/CapturesPanel.tsx is 878 lines. It is not blocking, but splitting out the composer and the editor would help later when job 019 adds suggestion cards.
- [note] src-tauri/src/captures/mod.rs: `restore_capture` takes the whole Capture from the UI, so a stale Undo can bring back a capture whose item or topic no longer exists. `validate_capture` catches that case, so the failure is a clean field error and the UI shows `undoFailed`. No change needed.

## Checked
- Rust core: `captures/mod.rs`, the `model` schema and validation, and the `lib.rs` commands. All commands run under the edit mutex and answer only after `store.save`. `save()` keeps the stored captures, so a save from the UI cannot erase or forge them. `captures` is `#[serde(default)]` and skipped while empty, so old files load. Run validation already pins items and topics, so a capture cannot end up pointing at an item that was removed.
- UI: `useCaptures.ts` shows the list only from the core's answer. Notices run on the clock, so the fake clock can test them. I did not re-run the suite, because CI does that. The build.md AC table maps each AC to a named test, and that matches the diff.
- Conventions: no edits to `.claude/` or `factory/` on the branch. The AGENTS.md layout and fixtures sections are updated. The scope matches the spec, with no LanguageModel use and no new network or plugin.
