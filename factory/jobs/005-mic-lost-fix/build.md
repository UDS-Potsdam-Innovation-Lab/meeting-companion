# Build: 005-mic-lost-fix

## Summary
`recording::run` is now two threads. The speech thread drains the sink and runs the engine. A monitor thread watches the device and sends ticks. Stall detection uses `AudioSink::since_last_push()`, the time since the device last delivered samples, so a slow engine only makes the transcript lag. A lost device is reported within about 1.75 s. The monitor gives the speech thread 250 ms to finish the cut-off utterance first, then reports the loss itself if the engine is still busy. Ticks keep coming during an engine window. Dev profile: `[profile.dev.package."*"] opt-level = 3`, and `src-tauri/.cargo/config.toml` sets `CMAKE_BUILD_TYPE=Release` (whisper-rs-sys forwards `CMAKE_*` env vars to CMake).

## Acceptance criteria
| AC | Test | Result |
|----|------|--------|
| AC1 | recording/tests.rs::a_slow_engine_does_not_stop_recording | PASS |
| AC2 | recording/tests.rs::a_dead_device_is_detected_within_2_s_while_the_engine_is_busy, ::a_device_error_is_reported_within_2_s_while_the_engine_is_busy; the two existing tests are unchanged and pass | PASS |
| AC3 | recording/tests.rs::a_lagging_engine_keeps_the_buffer_bounded_and_the_ticks_coming | PASS |
| AC4 | recording/tests.rs::dev_builds_optimise_whisper_cpp | PASS |

## Secure coding
No security-relevant surface. Audio stays in the bounded in-memory sink and is never written to disk.

## Test run
`cargo test` → 96 passed, 0 failed. `vitest run` → 118 passed. `npm run lint` → clean. gitleaks → no leaks. Playwright was not run (no UI change).

## Notes
- `Recorder::halt` still waits for the window in progress, as assumed in the spec's open questions. At stop, a backlog of up to 30 s is still transcribed. The AC3 test sets a "quick" flag on the fake engine before stopping so it does not wait that out.
- The AC3 test uses a Fast-paced fake that outruns the engine, because a real-time fill of the 30 s sink would take 30 s per test.

## Commits
See `git log --oneline main..HEAD` in the worktree.
