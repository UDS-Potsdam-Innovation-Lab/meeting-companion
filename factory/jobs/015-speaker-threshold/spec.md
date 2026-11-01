# Speaker threshold tuning

## Problem
With `SAME_VOICE` at 0.5, the pinned CAM++ speaker model puts two German women (`de-f1`, `de-f2`) into one voice. In the name round only 4 of 6 people then get a suggestion, and the facilitator has to sort out the rest by hand. The 013 sweep showed that 0.55 fixes this (de-name-round DER 16.7 % → 2.2 %) and leaves the other scenes unchanged, while 0.60 makes them worse. This job raises the threshold and re-baselines the accuracy gate so it holds the improvement.

## Scope
- in: `SAME_VOICE` in `src-tauri/src/engines/diarize.rs` from 0.5 to 0.55, with its doc comment updated to the current tuning command (`--ignored speaker_accuracy`, pinned model).
- in: re-measure with the pinned model and rewrite the entry for the pinned model in `src-tauri/testdata/speakers/thresholds.json`: baseline, maxima/minima (baseline ± `marginPp` 5), `measured` line, and `nameRoundMinSuggested`.
- in: a default-suite test that ties `thresholds.json` to the current `SAME_VOICE` and `MIN_SEGMENT_MS`, so a later change of either without re-baselining fails.
- in: the AGENTS.md "Speaker accuracy" paragraph, only if a command or file it names changes.
- out: `MIN_SEGMENT_MS`, `SHORT_GAP_MS`, the clustering algorithm, the model, the corpus and scenes, any UI, and a finer sweep (0.53, 0.57, …).

## Stack
Status: EXISTING

## Acceptance criteria
- [ ] AC1: `SAME_VOICE` is 0.55 and `VoiceClusterer::new` uses it. A unit test with fake embeddings (no model) pins the boundary: a segment whose cosine similarity to an existing centroid is 0.52 starts a new voice, and one at 0.57 joins the existing voice.
- [ ] AC2: `thresholds.json` for the pinned model holds the new baseline, measured with `SAME_VOICE` 0.55. Its `measured` line names `SAME_VOICE 0.55` and `MIN_SEGMENT_MS 1000`. A new default-suite test parses those two values from the `measured` line and fails if they differ from the constants in `diarize.rs`. The existing test `thresholds_cover_every_scene_for_the_pinned_model_within_5_points_of_the_baseline` still passes.
- [ ] AC3: The real-model gate (`#[ignore]`, run in CI with the cached pinned model, `--ignored speaker_accuracy`) passes against the new thresholds. In the new baseline, de-name-round DER is at most 5 % and shows 6 voices for 6 speakers. Every other scene (en-overlap, en-short-turns, en-return, de-noise) has DER no higher and line accuracy no lower than its 0.5 baseline in 013's `build.md`. If a measured run breaks this, the builder does not commit the change and reports the table instead.
- [ ] AC4: `nameRoundMinSuggested` is 6. The real-model name-round workflow suggests the right person for all 6 speakers and no wrong person, and `de-f1` and `de-f2` get separate voices.

## Design
Source: none
Status: NOT NEEDED

## Surfaces
- User-facing UI: no — the screens do not change; voice labels in the transcript get more accurate.
- Security-relevant: no — one constant and test data; rules touched: none (NFR Architecture: the diarizer stays behind `Diarizer`; no new engine type outside `sherpa.rs`)
- Human gate: no
- Audio/transcript data: no — nothing new is stored; embeddings stay in memory as before
- Leaves the device: no
- Board (touch) layout: no
- AI speaks or contributes unasked: no

Size: small

## Open questions
- Assumed 0.55 exactly ("~0.55" in the request). A finer sweep between 0.50 and 0.60 is left for later; this job does not tune further.
- Assumed "others unchanged" is strict: an untouched scene may not get worse at all (AC3). If the re-measure shows a small regression (under 1 point) in one scene, a person decides whether to accept it. Under AC3 the builder stops and reports; it does not loosen the check.
- The baseline is measured on the debug test profile on Linux x86-64, as in 013. CI is Linux only, so other platforms are not re-measured.
