VERDICT: PASS

## Findings
- [note] build.md deviation 1 (AC5 name round): the spec asks for a suggestion per speaker. The test accepts 4 of 6, because de-f1 and de-f2 share a voice at SAME_VOICE 0.5. It does assert that no suggestion is wrong and that the count stays at or above the baseline in thresholds.json. Changing the threshold is out of scope, so this is acceptable. The 0.55 sweep result is worth a follow-up job.
- [note] Deviation 3 (AC5 "applied backwards"): the spec asks for equal line accuracy before and after. The test checks that every earlier line shows the assigned person, and that person-based accuracy equals voice-mapping accuracy in each half. That is the achievable form of the criterion with a real model.
- [note] Deviation 2 (AC3 oracle): an extra exclusion for segments that span a change of speaker. This is justified by the real windowing.
- [note] ci.yml: the model-fetch and corrupted-copy steps, the accuracy gate after `npm test`, and the marker check all look right. The positive control runs on the test build, and the release-app check runs after `tauri build`. Neither has run on CI yet, so the first CI run is the real confirmation.
- [note] Commit e908112 does not pass its tests on its own, because the sha256 file arrives in 8c1989d. The branch head is fine.

## Checked
- The diff of ci.yml, scripts/speaker-model.mjs, AGENTS.md and engines/mod.rs. The only product-source change is the `#[cfg(test)] mod speaker_eval;` line. Nothing under factory/ or .claude/ is on the branch.
- build.md against each AC: tests exist for AC1 to AC3 in the default suite, the real-model tests are `#[ignore]`d with the name containing `speaker_accuracy`, and thresholds are the baseline plus at most 5 points. All CC0 licences are in the allowlist, and the corpus is 9.4 MB, under the 15 MB limit.
- I did not re-run the suite, as instructed. I relied on the reported `npm test` and lint results.
