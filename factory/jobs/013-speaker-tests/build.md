# Build: 013-speaker-tests

## Summary
- Corpus: 34 single-speaker clips (6 German, 4 English speakers; 9.4 MB) from the **VoxPopuli** transcribed test split (CC0-1.0), as spec review 1 decided. They are under `src-tauri/testdata/speakers/clips/`, along with `manifest.json` (source, VoxPopuli speaker and utterance id, transcript, licence, SHA-256), `ATTRIBUTION.md` and provenance scripts in `tools/`. No LibriSpeech fallback was needed.
- `scenes.json` holds 5 meetings: `de-name-round` (6 speakers), `en-overlap` (3), `en-short-turns` (2), `en-return` (4) and `de-noise` (3, seeded pink noise at 10 dB SNR). The builder mixes them in memory and bit-identically.
- `src-tauri/src/engines/speaker_eval/` is `#[cfg(test)]` only. It has the corpus check, the scene builder, the measures (DER with missed speech, false alarm and confusion, 0.25 s collar, Hungarian one-to-one mapping, line accuracy), the run harness, and the oracle and one-voice fakes. The run harness uses the real `Transcriber` windowing with `ScriptedSpeechToText`, then a `Diarizer` and the real `VoiceTracker`. The thresholds and the `#[ignore]` real-model tests are in the same module.
- `scripts/speaker-model.mjs` fetches and verifies the pinned CAM++ model, pinned in `src-tauri/native/speaker-model.sha256`. `ci.yml` caches the model, checks that a corrupted copy fails, runs the accuracy gate after `npm test` and checks the corpus marker. `AGENTS.md` documents the commands. `.gitignore` now lists `src-tauri/native/models/`.
- No product behaviour changed: `SAME_VOICE`, `MIN_SEGMENT_MS`, clustering, model preference and UI are untouched. The only product-source edit is the `#[cfg(test)] mod speaker_eval;` line in `engines/mod.rs`.

### Deviations and findings the reviewers should know
1. **AC5 name round is not fully met by the current product.** With the pinned model and `SAME_VOICE` 0.5, two German female speakers (`de-f1`, `de-f2`) end up in one voice. `name_round` therefore marks that voice as unsure, and only 4 of the 6 speakers get a suggestion. Changing the threshold is out of scope, so the test asserts these instead:
   - no suggestion names the wrong person;
   - a speaker who shares a voice with another gets no suggestion, and the test reports it;
   - every other speaker gets the right person;
   - at least `nameRoundMinSuggested` (4, the baseline in `thresholds.json`) are suggested right.

   For a follow-up job, a one-off sweep that was not committed:

   | SAME_VOICE | de-name-round DER | Other scenes |
   |---|---|---|
   | 0.55 | 2.2 % (was 16.7 %) | unchanged |
   | 0.60 | — | worse (en-overlap 26 %, de-noise 18 %) |
2. **The AC3 oracle check needed one extra exclusion.** "No confusion outside overlaps and short segments" also leaves out segments that span a change of speaker. The real windowing (no 600 ms pause, or a 3 s cut) can put the end of one turn and the start of the next into one segment, and that is not a diarizer error.
3. **How "applied backwards" (AC5) is checked:** after `choose_voice` at the end, the person shown for every line equals its voice's person, including the earliest lines. In the earlier half and in the later half separately, person-based line accuracy equals voice-mapping line accuracy. Equal accuracy between the two halves cannot be guaranteed with a real model, so the test does not demand it.
4. **AC7 release-binary check:** CI checks that the marker string `meeting-companion-speaker-corpus-v1` is absent from the release app. As a positive control, it first checks that the test build does contain the marker. Locally I checked the debug app binary (no marker; no "VoxPopuli" either), not a release build.
5. **The real-model tests require `MEETING_COMPANION_SPEAKER_MODEL`.** They have no scan fallback, so the thresholds stay tied to the pinned file. They also check the model's SHA-256 when thresholds exist for its name. The old hand-run filter `--ignored speaker` now matches these tests too, which is noted in AGENTS.md.
6. **Commit `e908112` does not pass its own tests on its own.** It reads `native/speaker-model.sha256`, which only arrives in the next commit (`8c1989d`). The branch head is green.

## Acceptance criteria
| AC | Test | Result |
|----|------|--------|
| AC1 | `engines::speaker_eval::corpus::tests::the_committed_corpus_is_licence_clean_and_verifiable` | PASS |
| AC1 | `engines::speaker_eval::corpus::tests::unlisted_altered_missing_or_wrongly_licensed_files_fail` (unlisted, altered, missing, other licence, CC-BY without attribution, path escape, missing source, > 15 MB) | PASS |
| AC1 | `engines::speaker_eval::sha256::tests::known_vectors`, `wav::tests::encoded_pcm_reads_back` | PASS |
| AC2 | `engines::speaker_eval::scene::tests::scenes_are_deterministic` | PASS |
| AC2 | `engines::speaker_eval::scene::tests::scenes_cover_languages_sizes_overlap_short_turns_returns_few_words_noise_and_name_round` | PASS |
| AC2 | `engines::speaker_eval::scene::tests::helpers_measure_overlap_gaps_and_speech_on_a_fixture` | PASS |
| AC3 | `engines::speaker_eval::measures::tests::*` (8 fixtures: optimal mapping, permuted labels, extra voice, unlabelled lines, false alarm, overlap, 0.25 s collar, scored stretches) | PASS |
| AC3 | `engines::speaker_eval::run::tests::an_oracle_diarizer_through_the_real_tracker_has_no_confusion_outside_overlaps_and_short_segments` | PASS |
| AC3 | `engines::speaker_eval::run::tests::a_degraded_diarizer_fails_the_gate_naming_scene_and_measure`, `check_reports_each_broken_threshold`, `windows_are_final_segments_of_at_most_3_s_in_time_order` | PASS |
| AC4 | `engines::speaker_eval::real::speaker_accuracy_with_the_pinned_model_stays_within_the_thresholds` (`#[ignore]`) | PASS (pinned model, local) |
| AC4 | `engines::speaker_eval::run::tests::thresholds_cover_every_scene_for_the_pinned_model_within_5_points_of_the_baseline` | PASS |
| AC4 | `engines::speaker_eval::real::without_a_model_the_accuracy_run_names_the_env_var` | PASS |
| AC5 | `engines::speaker_eval::real::speaker_accuracy_workflows_on_real_diarizer_output` (`#[ignore]`) | PASS, with the name-round scope in deviation 1 |
| AC6 | `scripts/speaker-model.mjs fetch` and `verify <corrupted copy>` (exit 1), run locally; CI steps "Cache the speaker model", "Fetch and verify…", "A corrupted speaker model fails the check" and "Speaker accuracy…" | PASS locally; CI not yet run |
| AC7 | Log capture with no names, turn text or decimal numbers in both `#[ignore]` tests; no audio written (the workflow's sealed files go to a `tempfile` dir); CI steps "The corpus marker check finds the marker in the test build" and "The release app holds no speaker corpus" | PASS locally (debug app binary); CI pending |

Baseline with the pinned model (`3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx`, debug test profile, Linux x86-64). Two runs gave identical numbers.

```
scene                DER  missed  f.alarm  confus.  lines  voices/spk  per segment
de-name-round     16.7 %   0.1 %   0.8 %  15.8 %  83.0 %   6/6     22.9ms
en-overlap        14.3 %  10.8 %   0.4 %   3.2 %  95.5 %   4/3     24.1ms
en-short-turns     8.6 %   1.0 %   6.1 %   1.5 %  89.5 %   3/2     19.7ms
en-return          4.4 %   1.8 %   2.6 %   0.0 % 100.0 %   4/4     22.7ms
de-noise          12.9 %   0.0 %   6.2 %   6.7 %  91.7 %   5/3     23.8ms
en-return: few-words speaker has its own voice
en-return: returning voice Some('A') → Some('A')
speaker workflows: 53 lines, 6 voices, 5 suggestions, 4 of 6 speakers suggested right, line accuracy 83.0 %
```
Thresholds are the baseline plus 5 percentage points (the maximum allowed). They are recorded with the baseline and model SHA-256 in `src-tauri/testdata/speakers/thresholds.json`.

## Secure coding
No secure-coding guideline is configured (`docs.secure_coding` absent). Rules from the spec's surfaces:
- **NFR Privacy (nothing leaves the device):**
  - The tests make no network calls; only `scripts/speaker-model.mjs` downloads, at CI or setup time.
  - The model is checked against a pinned SHA-256, and the test checks it again before applying thresholds.
  - No app runtime behaviour changes.
  - Audio stays in memory; the workflow test's sealed files live in a removed temp dir.
  - A log-capture assertion checks for names, text and embeddings.
- **NFR Architecture (engine behind `Diarizer`):** all evaluation goes through the `Diarizer` trait and `VoiceTracker`. No sherpa type is used outside `sherpa.rs`, apart from the `#[ignore]` test constructing `SherpaDiarizer`.
- **Third-party recordings:** the clips are CC0-1.0 (VoxPopuli), and the licence allowlist and SHA-256 are enforced by a test. No Common Voice. The tests never try to identify the speakers.
- **Supply chain (CI artefact):** the model is pinned by SHA-256, cached by the checksum file, and a corrupted copy is checked to fail, the same pattern as the sherpa-onnx archive.

## Test run
`npm test` → exit 0. Vitest: 233 passed (19 files). Cargo: 212 passed, 0 failed, 5 ignored. Playwright: 149 passed. `npm run lint` passes (tsc, ESLint, Prettier, `cargo fmt --check`, clippy `-D warnings`).
```
 Test Files  19 passed (19)
      Tests  233 passed (233)
test store::file::tests::failed_write_keeps_the_previous_version ... ok
test result: ok. 212 passed; 0 failed; 5 ignored; 0 measured; 0 filtered out; finished in 23.75s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  149 passed (36.7s)
```
`MEETING_COMPANION_SPEAKER_MODEL="$(node scripts/speaker-model.mjs path)" cargo test --manifest-path src-tauri/Cargo.toml -- --ignored speaker_accuracy` → 2 passed, 0 failed (5.6 s; about 23 ms per segment).

Secret scan: `bash $FACTORY_HOME/scripts/gitleaks.sh <worktree>` → exit 0, no leaks (130 commits).

## Commits
```
8c1989d ci(speakers): fetch the pinned speaker model and run the accuracy gate
e908112 test(speakers): gate speaker accuracy on real-model regression thresholds
fded368 test(speakers): mix test meetings and measure DER and line accuracy
10a1a47 test(speakers): add a CC0 VoxPopuli speaker corpus with a verified manifest
```
