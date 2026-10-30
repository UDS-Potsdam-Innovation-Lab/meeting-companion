APPROVE
Stall detection now measures time since the device last delivered audio, so a slow engine no longer triggers a false MicrophoneLost, and all four ACs have passing tests.

## Checks
- Tests: CI (round-1/ci.md) is `CI: success` on commit 63cb820, which equals the worktree HEAD. Build report: 96 Rust tests, 118 Vitest tests, lint clean. I did not re-run the suite.
- Acceptance criteria: AC1 ✓ (a_slow_engine_does_not_stop_recording), AC2 ✓ (two new busy-engine tests, plus the two existing tests unchanged), AC3 ✓ (a_lagging_engine_keeps_the_buffer_bounded_and_the_ticks_coming), AC4 ✓ (dev_builds_optimise_whisper_cpp). The code reviewer confirmed each test would fail without the change.
- Scope / factory files untouched: ✓. The diff has 5 files (audio.rs, recording/mod.rs, tests.rs, Cargo.toml, .cargo/config.toml). Nothing is under `.claude/` or `factory/`. There are no new dependencies, no change to what is recorded, stored or sent, and no auth change.
- Reviewer notes: all four lenses PASS. The only follow-up is the non-blocking `done` flag note: if the engine panics, the monitor loop never ends and `halt` would hang. This is not a human judgement call.
## For the human (ESCALATE only)
n/a
