ESCALATE
All checks pass, but the change adds run-state timestamps to the stored meeting file, which the profile's approver rule ("escalate anything that changes what is stored") sends to a human.

## Checks
- Tests: CI run 41110563740 → `CI: success` on 6298498525e54a487e8c5bc712c6a1621fb8e8d0, which equals worktree HEAD (confirmed via `gh run view`: headSha matches, conclusion success). Not re-run locally.
- Acceptance criteria: AC1 ✓ (LiveView.test.tsx "AC1 Start meeting and the timer card", including 0/79/100 %/overrun with FakeClock; run.test.ts), AC2 ✓ (LiveView.test.tsx "AC2 next, park and the last item"; e2e keyboard test), AC3 ✓ (LiveView.test.tsx "AC3 …"; run.test.ts ahead/exact/behind), AC4 ✓ (LiveView.test.tsx "AC4 +5 min" single, repeated, no buffer), AC5 ✓ (LiveView.test.tsx "AC5 time nudge": 79 %, 80 %, no repeat after dismissal, re-arm after +5, gone on item end), AC6 ✓ (Rust run_rejects_* tests for all five cases plus version_1 round-trip, file.rs restart test, lib.rs save rejection; e2e reload/End meeting; config.test.ts unchanged), AC7 ✓ (i18n no-literal + parity tests; e2e/live.spec.ts axe, scroll, targets, keyboard order; screenshot fixtures live/live-nudge/live-over/live-done)
- Scope / factory files untouched: ✓ (no paths under .claude/ or factory/; no changes to package.json, lockfiles, Cargo.toml, tauri.conf.json or capabilities; no new dependency, plugin, port or permission; diff stays within frame 01 Start button and frame 02 left column/top bar/nudge)

## For the human (ESCALATE only)
1. Stored data: the encrypted meeting file gains an optional `run` field (meeting start/end, per-item start/end, extra minutes, parked flag). No audio or transcript, nothing leaves the device, `SCHEMA_VERSION` stays 1 and v1 files load unchanged (no migration). Confirm this addition to what is stored is acceptable, and that you are fine with no version bump (spec open question 1–2).
2. Product judgement from the UI review: when the current item is over budget (timer card "2:10 over" in red), the overall line can still say "on track (+1 min)". This follows the AC3 formula (now + max(0, remaining) + upcoming planned minutes, with buffer absorbing the overrun), but the two lines can read as contradictory. Decide whether that is acceptable or needs a follow-up.
3. Minor, already justified by the builder: tab order puts "End meeting" first (visual order, WCAG 2.4.3) rather than last as AC7 lists. Accept or ask for a change.
If you accept item 1 (and are fine with 2 and 3), the branch is ready to merge as is.
