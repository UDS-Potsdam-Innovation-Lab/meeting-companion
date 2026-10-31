VERDICT: PASS

## Findings
- [note] src-tauri/src/recording/mod.rs:~498-503 — the doc comment of `run` ("The worker. Two threads: ...") now sits above `struct Fallback`, so it documents the wrong item and `run` has none. Move `Fallback` above that comment.
- [note] Speaker-model row (AC5, depends on 004) is not built. The spec allows this when 004 is not merged, and build.md says so. Needs a follow-up job.
- [note] The speech model is shown as radio cards, not a select (build.md names the difference from the spec text). It follows frame 14d, so I accept it.
- [note] One switch to the default per session; losing the default as well stops with `MicrophoneLost`. This is sensible and documented.

## Checked
- Settings core (`settings/mod.rs`, `file.rs`): closed schema, field-by-field defaults, key-only errors, a single AAD "purpose=settings", no overwrite on a corrupt or locked file, the cache move only when there is no readable file. All as AC1 requires.
- Recorder changes: device choice and `ChosenMicrophoneMissing`, the fallback switch on the same sink (`recover`, capture state kept), `halt` closing a switched source, mic test serialised with start through `inner()` and refused while recording or paused, and the 1 s sink. The language hint reaches the STT engines through `set_language`. The `cpal` code only adds named-device lookup.
- `localStorage` in the app code is only locale and theme, plus the legacy key's removal. The rest is in the mock backend. No `.claude/` or `factory/` edits on the branch. Test coverage across Rust, Vitest and e2e looks complete for AC1 to AC7 by name and count. I did not rerun the suites (CI gates them).
