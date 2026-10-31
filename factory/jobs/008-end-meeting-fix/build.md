# Build: 008-end-meeting-fix

## Summary
- UI: `LiveView.onEnd` ends the run and opens agenda setup at once. It asks for `stop_recording` but does not wait for it, and it ends only once (ref guard). `EndMeeting` disables the button after the confirm click and stops the 6 s auto-disarm from running.
- Core: `Recorder::halt` (used by stop, pause, start and drop) is now bounded. It sets `stopping`, closes the microphone, waits at most `STOP_WAIT` (1 s) plus 250 ms for the worker, then closes the shared `Delivery`. Every final segment already sent is stored, with no voice if it has none yet. A stuck worker is marked `abandoned` and left behind: it stores, sends and changes nothing more, and its engine is not reused. If it finishes later (a slow engine, not a stuck one), its engines are taken back on the next start through `left_behind`.
- `Delivery` is shared (`Arc<Mutex<…>>`) and is never held while an engine runs. `finish` waits for voices in 20 ms steps, up to the halt's `stop_by`. The diarizer thread returns its engine over a channel, with a bounded wait. A panic in speech-to-text now reports `EngineFailed` (and closes the source) instead of hanging the worker.
- `save_meeting` is now `#[tauri::command(async)]`, so it no longer runs on the main thread. Its logic is in `save_from_ui(store, recorder, edits, meeting, now)` so it can be tested without Tauri.
- Test fakes: speech engine and diarizer that block on a gate or panic (`recording/tests/stop.rs`). `FakeRecording.stop` in the Vitest fake core. The mock backend gets a `mock-backend.stop-delay-ms` setting.
- Open-question choices: final segments still waiting for a voice at stop get only the rest of `STOP_WAIT`, not the full `VOICE_WAIT`. The last few lines of a meeting may therefore have no speaker label. AC4 stays strict: nothing is written after `stop` returns.

## Acceptance criteria
| AC | Test | Result |
|----|------|--------|
| AC1 | src/features/live/LiveView.test.tsx › Job 008 › "AC1 the confirm click ends the meeting and opens setup without waiting for stop_recording" | PASS |
| AC2 | src/features/live/LiveView.test.tsx › Job 008 › "AC2 ends exactly once when stop_recording resolves after the 6 s disarm", "… rejects …", "AC2 the end button cannot end twice and does not disarm after the confirm click" | PASS |
| AC3 | src-tauri/src/recording/tests/stop.rs::stop_returns_within_2_s_when_the_speech_engine_blocks_forever_and_keeps_every_final_line, ::stop_returns_within_2_s_when_the_diarizer_blocks_forever_and_stores_lines_without_voice, ::stop_returns_within_2_s_after_the_speech_engine_panicked_and_a_fresh_one_records_next, ::stop_returns_within_2_s_after_the_diarizer_panicked (each checks < 2 s, state off, every opened source closed) | PASS |
| AC4 | stop.rs::stop_returns_within_2_s_when_the_diarizer_blocks_forever_and_stores_lines_without_voice (in-memory store; sent == stored in seq order, voices [A, None, None]; after the gate opens: no further record, segment, voice or state event), and the same checks in the blocking speech-engine test | PASS |
| AC5 | stop.rs::a_stuck_stop_blocks_neither_saving_the_ended_meeting_nor_the_status_nor_the_next_recording (`save_from_ui` < 2 s while the stop runs, `status()` < 100 ms, m-2 records with a second engine load) | PASS |
| AC6 | e2e/live.spec.ts › "job 008: with recording on and a slow stop, End meeting opens agenda setup within 1 s" (live-transcript, stop delayed 10 s); existing LiveView.test.tsx AC6 "End meeting asks for a second click inline…" still passes | PASS |

## Secure coding
No `docs.secure_coding` in the profile. NFR Privacy: the microphone still closes first, before any wait. A stuck or panicking worker cannot reopen or keep a source: the fallback switch checks `stopping` under the source lock, and `fail_unless` checks `abandoned` under the state lock. Clips held by a stuck worker are dropped and never stored. What is stored, and where, is unchanged.

## Test run
`npm test` → Vitest 174 passed (14 files); cargo 165 passed, 3 ignored (model/keychain, run by hand); Playwright 118 passed. `npm run lint` clean. gitleaks: no leaks (exit 0).
```
  ✓  117 [chromium] › e2e/transcript.spec.ts:184:3 › AC1–AC5 recording with the mock core › End meeting stops recording first (271ms)
  ✓  113 [chromium] › e2e/transcript.spec.ts:107:3 › AC7 transcript accessibility at 1280×800 › Jump to latest is reachable by keyboard after scrolling up (1.2s)
  ✓  110 [chromium] › e2e/transcript.spec.ts:43:3 › AC7 transcript accessibility at 1280×800 › paused state, in German too (1.9s)
  ✓  111 [chromium] › e2e/transcript.spec.ts:52:3 › AC7 transcript accessibility at 1280×800 › error state and no speech model (1.9s)
  ✓  118 [chromium] › e2e/transcript.spec.ts:192:3 › AC1–AC5 recording with the mock core › recording makes no network request beyond the app's own assets (1.0s)
  ✓  114 [chromium] › e2e/transcript.spec.ts:131:3 › AC1–AC5 recording with the mock core › consent, start, German and English lines, pause, resume and restart (4.3s)

  118 passed (26.4s)
```

## Commits
```
5bd1482 fix(live): end the meeting at once, without waiting for stop_recording
3472f99 fix(recording): bound stop and pause; never wait on a stuck engine
```
