VERDICT: PASS

## Findings
- [note] src-tauri/src/lib.rs:477: `capture-level` is emitted app-wide with `emit`, the same way as the other six core events. The capability only allows the `main` window (src-tauri/capabilities/default.json:6), so nothing else receives it today. If a second webview is ever added (e.g. the phone web view), scope the level event to `main` with `emit_to`, because a 25 Hz envelope shows the rhythm of speech.
- [note] The spec's Open question on the human gate (a 25 Hz loudness envelope reveals speech rhythm) still applies. On the security side the level stays in memory (three atomics in `LevelCell`, src-tauri/src/engines/level.rs:55-61), is not logged and is not stored (level_tests.rs `ac7_…`). It is sent only over local IPC. I found no reason to raise the gate.

## Checked
- Core diff: `engines/level.rs` (new), `engines/audio.rs` (push → `LevelCell::measure`, outside the buffer lock), `recording/mod.rs` (pacer in the monitor thread, `stopping` flag), `recording/mic_test.rs` (samples dropped at once, the old level fn removed), `lib.rs` (new `EVENT_LEVEL`). The payload is `{meetingId, level, peak}` only. There are no samples, no new commands, no new input surface, no file I/O and no new log lines (grep over the added lines for log/print/fs/fetch/innerHTML/eval found only test code).
- Capability file: the description changed, and permissions stay `["core:default"]`, pinned by src/config.test.ts. No plugin, network or port was added. No dependency changes in package.json, Cargo.toml or the lockfiles.
- UI: `onCaptureLevel` is in src/lib/ipc.ts (the only Tauri boundary). The mock backend's `localStorage` level switch only loads under `VITE_MOCK_IPC === "1"` (src/main.tsx:11) and is removed from production builds. The AC7 log-capture and app-data test in src-tauri/src/recording/level_tests.rs passes, per build.md.
- Secret scan: `gitleaks.sh` on the worktree found no leaks (99 commits scanned, working tree clean). NFR Architecture, Privacy and Security were checked against the diff.

## Secure-coding checklist
No `docs.secure_coding` is configured, so the focus list is the checklist.

| Rule | Result | Evidence |
|---|---|---|
| Input validation, injection, unsafe deserialization | n/a | No new command or input. The new event is core→UI, numeric only (recording/mod.rs:160-178). No HTML sinks in SoundWave.tsx (drawn through refs). |
| Secrets in code/config/logs/fixtures; broad permissions | ok | gitleaks clean. Permissions unchanged `["core:default"]` (capabilities/default.json:6, pinned by config.test.ts). |
| AuthN/AuthZ, sessions, insecure defaults, rate/size limits | ok | No auth surface. The event rate is bounded by `LEVEL_EVERY` 40 ms and the payload is 3 fields (level.rs:15, mod.rs:162). |
| Cryptography | n/a | No crypto touched. |
| Errors and logs: no internals, no sensitive data in logs | ok | No new log lines. The AC7 log-capture test asserts that no level values appear in the logs (level_tests.rs `ac7_level_values_are_neither_logged_nor_stored`). |
| Personal data: minimisation, no real data in tests, deletion | ok | Only a derived RMS and peak per block, in memory, never stored. The app data folder holds only .meeting/.transcript after a recording (AC7 test). Tests use synthetic tones. |
| New dependencies | n/a | None added. |
| Security negative tests | ok | AC7: no logging, no files, capability unchanged. AC2: the stream stops on pause, stop, failure or silence, with no stale level. |
| Secret scan (secret_scan: true) | ok | `scripts/gitleaks.sh` found no leaks. |
| NFR Privacy "nothing leaves the device" / Security "no listening ports" | ok | Local IPC only. No network, port or plugin (config.test.ts, build notes). |
| NFR Architecture (engines behind interfaces) | ok | Measured in `AudioSink` and independent of the engine. The fake source and fake STT are used in tests. |
