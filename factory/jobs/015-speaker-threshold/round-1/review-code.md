VERDICT: PASS

## Findings
- [note] src-tauri/src/engines/speaker_eval/real.rs:77 — the voice-count limit (speakers + 1) is hard-coded for de-name-round. This follows the human decision in rework-1, so it is fine as is.
- [note] The `measured` parser in run.rs reads digits and dots up to the next separator. It works for "SAME_VOICE 0.55, MIN_SEGMENT_MS 1000", but a trailing period after a number would break it. It fails loudly, so it is not blocking.

## Checked
- Diff main...HEAD: SAME_VOICE is 0.55 and the doc comment is updated. The boundary test covers 0.52 and 0.57. The new default-suite test ties the `measured` line to SAME_VOICE and MIN_SEGMENT_MS. thresholds.json holds the new de-name-round baseline, with maxima and minima at baseline ± 5 points, and `nameRoundMinSuggested` is 6.
- build.md and rework-1.md: the test results reported there are consistent with the spec after the relaxed voice-count rule. I did not run any tests myself.
- The diff touches nothing in `.claude/` or `factory/`. AGENTS.md needs no change.
