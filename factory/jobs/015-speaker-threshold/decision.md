APPROVE
SAME_VOICE is now 0.55, thresholds.json is re-baselined, CI passed on HEAD, and the 7-voice relaxation follows the human decision in rework-1.

## Checks
- Tests: I did not re-run the suite. CI says success on 86d632d, which equals the worktree HEAD. The build reports the ignored real-model gate (`--ignored speaker_accuracy`) passing, 2 tests.
- Acceptance criteria:
  - AC1 ✓ (`diarize::tests::the_default_threshold_splits_at_0_55`)
  - AC2 ✓ (`run::tests::thresholds_were_measured_with_the_current_constants`, plus the existing 5-point test)
  - AC3 ✓ (real-model gate. de-name-round baseline DER is 1.35 %. The 7/6 voices are accepted via rework-1 and enforced by a new "at most one extra voice" check. The other scenes are unchanged from the 0.5 baseline.)
  - AC4 ✓ (`nameRoundMinSuggested` is 6, and the real-model workflow gets 6 of 6 right with de-f1 and de-f2 separate)
- Scope / factory files untouched: ✓. The diff has 4 files, all under src-tauri. The untracked `node_modules` and `native/lib` symlinks are not committed.
- Reviews: all four lenses PASS. The two [note] items need no human judgement. One is the hard-coded voice limit, which rework-1 covers. The other is the `measured` line parser, which fails loudly if it breaks.
