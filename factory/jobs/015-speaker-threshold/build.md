# Build: 015-speaker-threshold

## Summary
STOPPED, nothing committed. Per AC3 ("if a measured run breaks this, the builder does not commit the change and reports the table instead"). With SAME_VOICE 0.55 on the pinned model (sha verified), de-name-round DER falls from 16.7 % to 1.4 % and all 6 speakers get the right suggestion (de-f1/de-f2 separate), but the scene shows 7 voices for 6 speakers, not 6 as AC3 requires. The other four scenes are identical to the 0.5 baseline.

The edits (SAME_VOICE 0.55 + doc comment, boundary unit test 0.52/0.57, default-suite test tying the `measured` line to the constants) are left uncommitted in the worktree; thresholds.json and AGENTS.md are NOT yet updated.

## Acceptance criteria
| AC | Test | Result |
|----|------|--------|
| AC1 | diarize::tests::the_default_threshold_splits_at_0_55 | written, not run, uncommitted |
| AC2 | speaker_eval::run::tests::thresholds_were_measured_with_the_current_constants | written, would fail until thresholds.json is re-baselined |
| AC3 | real::speaker_accuracy_with_the_pinned_model_stays_within_the_thresholds | FAIL on "6 voices for 6 speakers" (7/6) |
| AC4 | real::speaker_accuracy_workflows_on_real_diarizer_output | measured: 6 of 6 suggested right (not yet gated at 6) |

## Measured table (SAME_VOICE 0.55, MIN_SEGMENT_MS 1000, debug profile, Linux)
```
scene                DER  missed  f.alarm  confus.  lines  voices/spk
de-name-round      1.4 %   0.1 %   0.8 %   0.4 %  98.1 %   7/6
en-overlap        14.3 %  10.8 %   0.4 %   3.2 %  95.5 %   4/3
en-short-turns     8.6 %   1.0 %   6.1 %   1.5 %  89.5 %   3/2
en-return          4.4 %   1.8 %   2.6 %   0.0 % 100.0 %   4/4
de-noise          12.9 %   0.0 %   6.2 %   6.7 %  91.7 %   5/3
```
Workflows: 53 lines, 7 voices, 6 suggestions, 6 of 6 speakers suggested right, line accuracy 98.1 %.

## Decision for a person
Either accept 7 voices (one extra voice in de-name-round; the 013 baseline at 0.5 also had 6 voices only by merging de-f1/de-f2 and splitting another) and relax AC3's "6 voices" wording, or tune further. The "voices 7/6" is in the 013 table too for the other scenes (4/3, 3/2, 5/3), so extra voices are common. Then thresholds.json can be re-baselined from the `measured:` line above.

## Secure coding
No security-relevant surface.

## Test run
Only `cargo test ... -- --ignored speaker_accuracy` run (both passed; the gate passed against the old 0.5 thresholds, which are looser). Full suite and secret scan not run.

## Commits
None.
