VERDICT: PASS

## Findings
- [note] The human gate (data-protection sign-off of the de/en privacy and consent wording) is outside this review and is still required before merge.

## Checked
- Rust `organisation.rs` and the `load_organisation` wiring in `lib.rs`. The size check runs before opening and the read is bounded. The schema is closed and only the kind of rejection is logged. The load happens on demand, so a bad file cannot block start-up.
- `App.tsx` focus-return and Escape flow. The views underneath stay mounted, so recording continues. Shortcuts go through the registry. tsc and eslint are clean. Help, legal, licence and shortcut vitest suites pass (43 tests).
- Every AC maps to a test in build.md. No edits to `.claude/` or `factory/` on the branch.
