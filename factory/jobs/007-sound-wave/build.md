# Build: 007-sound-wave

## Summary
The core now measures the input level where samples arrive: `AudioSink::push` feeds a `LevelCell` (`src-tauri/src/engines/level.rs`). The cell computes scaled RMS `min(1, rms × 4)` and the peak per 40 ms block in one pass, allocates nothing, and works outside the buffer's lock. The recording's monitor thread sends it as a new `capture-level` event (`{meetingId, level, peak}`), 25 times a second while audio arrives. When capture stops (pause, stop, end of meeting, a failed device, or 250 ms with no samples), it sends one last event with level 0. The microphone test uses the same function and the same pacer, and its `meetingId` is null. Its `TICK / 2` path is gone, and the `mic-test` state now comes every 200 ms for the countdown.
The UI has a shared `src/ui/SoundWave.tsx`, which replaces `LevelMeter` (deleted along with its CSS) in the frame 02 footer and the Settings Audio meter. It draws a scrolling mirrored-bar history: one bar per 100 ms, 20 in the footer (12 at phone width, 5/3/32 px on the board) and 30 in Settings (14 at phone width). It draws through refs and `requestAnimationFrame` at about 30 fps.
The states follow frame 15:
- listening
- paused: flat grey line
- No signal: dashed line, plus the text "No signal" with an amber "!", after 500 ms without a level event (`useNoSignal`)
- Microphone lost: flat line plus red text; the line is dropped at 375 px
- off
Under `prefers-reduced-motion` a static level bar takes the wave's place and updates at most every 250 ms. The status word in 004's speakers button follows the state ("No signal · 3 speakers"). A visually hidden `role=status` region announces the state once per change.
The mock core sends a fixed level sequence keyed to the clock. There are three new fixtures: `live-level-speech`, `live-level-silence` and `live-no-signal`. The wave screenshots install Playwright's clock, so they come out the same on every run (checked by md5).
In `FakeAudioSource`, real-time pace now keeps time against its start instead of sleeping 100 ms per chunk, so it no longer drifts.

## Acceptance criteria
| AC | Test | Result |
|----|------|--------|
| AC1 | src-tauri/src/recording/level_tests.rs::ac1_the_level_comes_from_the_capture_side_while_the_engine_is_busy (2.5 s blocking engine, 6 s real time: ≥20/s, no gap >100 ms, payload exactly meetingId/level/peak, tone >0.3 / silence <0.05 within 100 ms, same scale as the tick, ticks still sent) | PASS |
| AC1 | src-tauri/src/engines/level.rs::tests::level_is_scaled_rms, a_cell_publishes_the_scaled_rms_and_peak_of_each_block | PASS |
| AC2 core | level_tests.rs::ac2_pause_and_stop_end_the_stream_with_level_0_and_resume_starts_it_again, ac2_a_silent_device_stops_the_stream_before_it_counts_as_lost, ac2_a_failing_device_stops_the_stream_and_is_reported_as_before; 005's tests in recording/tests.rs pass unchanged | PASS |
| AC2 UI | src/features/transcript/SoundWave.panel.test.tsx (listening, paused flat, No signal after 500 ms incl. de "Kein Signal", MicrophoneLost); src/ui/SoundWave.test.tsx::"keeps no level from before", "AC2 No signal" | PASS |
| AC3 | SoundWave.panel.test.tsx::"25 level events a second re-render neither TranscriptPanel nor LiveView" (render counters via vi.mock; one render per state change); src/ui/SoundWave.test.tsx (rAF via ref; no rAF while paused/off/lost/noSignal, under reduced motion, or while document.hidden); level_tests.rs::ac3_a_full_30_s_sink_still_keeps_up_with_real_time | PASS |
| AC4 | src/ui/SoundWave.test.tsx::"AC4 reduced motion" (matchMedia mock, ≤4 writes/s, no frames, same states, follows setting changes); e2e/soundwave.spec.ts::"reduced motion: …" (emulateMedia, computed transition 0s / animation none, ≤9 writes in 2 s, states) | PASS |
| AC5 | e2e/soundwave.spec.ts (5 fixtures × 375, 1280×800, 1920×1080, 1440×900, 1024×768, 768×1024, 480×800, 1024×600, 768×480: state, aria-hidden, status text, no horizontal scroll, axe WCAG 2.2 AA; 3:1 contrast in light and dark; speech vs silence heights; German); src/styles.test.ts (no hex outside tokens); src/i18n/i18n.test.tsx (parity, no literals); `npm run screenshot` (168 passed, new views live-level-speech/-silence/live-no-signal/live-level-reduced) | PASS |
| AC6 | src/features/settings/SoundWave.settings.test.tsx (test meter is SoundWave, fed by meetingId null, No signal, Microphone lost, reduced motion; recording's level stream while a meeting records, flat when paused); level_tests.rs::ac6_the_microphone_test_sends_the_level_at_the_recording_rate_and_keeps_nothing; 006's device_tests.rs (start/stop once, nothing to STT, no file) unchanged | PASS |
| AC7 | level_tests.rs::ac7_level_values_are_neither_logged_nor_stored (log capture: no level value or "level" in any line; app data holds only .meeting/.transcript); src/config.test.ts::"AC7 (job 007) …" (event list = 7 events incl. capture-level, each named in the capability file, permissions still ["core:default"]); `npm run lint`, `npm test` | PASS |

Notes:
- **Capability file.** Tauri events need no permission beyond `core:default`, and 004's and 006's config tests require `permissions == ["core:default"]`. So `capture-level` is listed in the capability file's description, together with the other six events, and nothing is added to the permissions. A config test pins both.
- **"Microphone lost" in the footer.** The footer shows it for `microphoneLost`, and also for `noMicrophone` (no device when resuming), so the existing `live-mic-error` fixture shows the frame's lost state. Other errors (blocked, no model, …) show the footer flat with no status word, as before.
- **Smoke test** (`xvfb-run -a node scripts/smoke.mjs` after a release build) was not run locally. The change does not touch startup or the smoke path; CI runs it on the pushed branch.

## Secure coding
No `docs.secure_coding` is configured. Here is how each NFR rule this job touches is met:
- **Privacy, "nothing leaves the device".** The level is a derived number per 40 ms block. It is held in three atomics in memory and sent only over local IPC to the window. It is never written to disk and never logged (AC7 test). No network, port or plugin was added (config tests).
- **Audio is never written / bounded 30 s sink.** Nothing changed: the measurement reads the pushed block and keeps sums, not samples.
- **Logging never carries content.** No new log line. Covered by the AC7 log-capture test.
- **Only `ipc.ts` talks to Tauri.** `onCaptureLevel` lives in `src/lib/ipc.ts`, and the ESLint restriction is unchanged.

## Test run
`npm test` (vitest → cargo test → playwright) → vitest 193 passed (17 files); cargo 168 passed, 0 failed, 3 ignored; playwright 127 passed (after updating two `getByText("Listening"/"Paused")` lookups in e2e/transcript.spec.ts, which also matched the new hidden status region). `npm run lint` → exit 0. `npm run screenshot` → 168 passed. gitleaks over the full branch history → exit 0, no leaks.
```
 Test Files  17 passed (17)
      Tests  193 passed (193)
test result: ok. 168 passed; 0 failed; 3 ignored; 0 measured; 0 filtered out; finished in 25.21s
  ✓  127 [chromium] › e2e/transcript.spec.ts:192:3 › … recording makes no network request beyond the app's own assets (1.2s)
  ✓  123 [chromium] › e2e/transcript.spec.ts:131:3 › … consent, start, German and English lines, pause, resume and restart (4.4s)

  127 passed (33.7s)
```

## Commits
```
bd460ac docs(agents): level stream, SoundWave and the wave fixtures; e2e status text by the speakers button
62d0bd2 test(e2e): sound wave states, sizes, contrast and reduced motion; stable wave screenshots
9831745 feat(ui): SoundWave in the transcript footer and the settings meter
856997c feat(recording): level stream from the capture side (capture-level event)
```
