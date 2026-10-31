APPROVE
CI is green on bd460ac, every AC has a test that covers it, and the diff stays in scope; the level is an in-memory number over local IPC, so nothing new is recorded, stored or sent off the device.

## Checks
- Tests: CI run 41199101650 (workflow CI, branch factory/007-sound-wave) → success, headSha bd460ac1bd6fd217699ba54ec47f27425c49fb8e = worktree HEAD = round-1/head (ci.md has no commit line, so I checked the run with `gh run view`). I did not re-run the suite.
- Acceptance criteria: AC1 ✓ (level_tests.rs ac1_… with a blocking engine: ≥20/s, gap ≤100 ms, payload keys exactly level/meetingId/peak, tone >0.3 / silence <0.05, scale check; level.rs unit tests), AC2 ✓ (level_tests.rs ac2_pause/stop/resume, silent device, failing device; SoundWave.panel.test.tsx and src/ui/SoundWave.test.tsx for the UI states incl. "Kein Signal"), AC3 ✓ (render-counter test in SoundWave.panel.test.tsx; rAF gating in SoundWave.test.tsx; ac3_a_full_30_s_sink_still_keeps_up_with_real_time; measure runs after the buffer lock is dropped in AudioSink::push), AC4 ✓ (SoundWave.test.tsx "AC4 reduced motion"; e2e/soundwave.spec.ts emulateMedia), AC5 ✓ (e2e/soundwave.spec.ts: fixtures × sizes, axe, contrast, no scroll; styles/i18n tests; screenshots; LevelMeter.tsx deleted), AC6 ✓ (SoundWave.settings.test.tsx; ac6_the_microphone_test_…; 006 device_tests unchanged), AC7 ✓ (ac7_level_values_are_neither_logged_nor_stored; config.test.ts pins permissions ["core:default"] and the event list)
- Scope / factory files untouched: ✓ (no paths under .claude/ or factory/ in main...HEAD; no dependency or lockfile changes; capability file changes only its description, permissions stay ["core:default"]; the FakeAudioSource pacing fix is a test-only fake that AC1's timing needs)
- Reviewer notes: all four lenses PASS. The notes need no human call now. Security's emit_to suggestion only matters if a second webview is added later. The spec's human-gate question was checked against the profile rule ("escalate anything that changes what is recorded, stored, or sent off the device"): the level is derived, kept in memory and shown locally, so the rule does not apply.

## For the human (ESCALATE only)
n/a
