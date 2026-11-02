VERDICT: PASS

## Findings
- [note] The build drops the font parts of AC5/AC7 (no `--font-ui`), as the human's spec review 1 in stack-decision.md allows. Not a defect.
- [note] src-tauri/src/theme/watch.rs: a poll with `colors.toml` missing before any theme was ever found is a no-op, and the 3-poll fallback applies only once a theme existed. This matches the AC3 wording.
- [note] useSettings.tsx: the startup race between the `omarchy_theme` answer and an early event is handled (`switched` flag). A `{theme:null}` answer correctly clears a stale cache.

## Checked
- Core (theme/mod.rs, watch.rs, lib.rs wiring): the poller's logic, the 3-poll missing fallback, the shared state set before the emit, no thread off Linux, and only a fixed log line. Read the build's test mapping for AC1–AC3; did not re-run the suite.
- UI wiring (useSettings.tsx, ipc.ts, theme-boot.js): the layout effect removes the tokens when the setting is light/dark, the cache is replaced or cleared on each report, and the boot script allow-lists token names and hex values per entry.
- Conventions: no edits to styles.css, `.claude/` or `factory/` on the branch; AGENTS.md updated; the settings schema is unchanged.
