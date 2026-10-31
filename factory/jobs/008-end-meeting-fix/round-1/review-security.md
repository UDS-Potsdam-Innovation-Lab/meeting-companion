VERDICT: PASS

## Findings
- [note] src/features/live/LiveView.tsx:144 — the UI now shows recording as off before the core has confirmed the stop. This is acceptable for NFR Privacy ("recording indicator matches reality") because `Recorder::halt` closes the source before it waits on anything (src-tauri/src/recording/mod.rs:675-680). `save_meeting` → `stop_meeting` (src-tauri/src/lib.rs:282-284) also stops the ended run's recording as a backstop if the IPC stop fails. Not blocking.
- [note] src-tauri/src/recording/mod.rs:1003-1009 — the fallback device switch checks `stopping` under the source lock and stops a newly opened source. `fail_unless` checks `abandoned` under the state lock (mod.rs:269-281). A worker left behind therefore cannot reopen the microphone, keep it open, or close the next session's source. That closes the privacy race the change could have introduced.
- [note] The mock backend's `mock-backend.stop-delay-ms` localStorage key (src/lib/mockBackend.ts:68, 577-591) exists only in builds with `VITE_MOCK_IPC=1` (src/main.tsx:11). It is not reachable in production builds.

## Checked
- The full diff `main...HEAD`: src-tauri/src/recording/mod.rs (bounded halt, Session stopping/abandoned flags, shared Delivery, close/settle with the `closed` guard, fallback switch, left_behind reclaim), src-tauri/src/lib.rs (`save_from_ui`, async `save_meeting`), EndMeeting.tsx, LiveView.tsx, mockBackend.ts, and the new tests in recording/tests/stop.rs.
- NFR Architecture, Privacy and Security in docs/non-functional-requirements.md. The microphone closes first. Stored data and its location are unchanged (the encrypted `.transcript`). Clips held by a stuck worker are dropped and not written. A closed Delivery sends no further segment or voice events. Log lines record only `Reason` and fixed text, never transcript content.
- Secret scan: `gitleaks.sh` on the worktree found no leaks (exit 0). No new dependencies. No new network, IPC input or ports.

## Secure-coding checklist
| Rule | Result | Evidence |
|---|---|---|
| Input validation, injection, unsafe deserialization | n/a | No new input. `save_meeting` keeps the same `Meeting` type and the same `save` path (lib.rs:274-299) |
| Secrets in code/config/logs/fixtures; broad permissions | ok | gitleaks clean. New log lines (mod.rs:701-717, 1171, 1192-1197) hold no data. No capability or permission changes |
| AuthN/AuthZ, sessions, insecure defaults, rate/size limits | n/a | No auth surface. The bounded `STOP_WAIT` (mod.rs:61) removes an unbounded wait. The diarizer queue limit `DIARIZE_QUEUE` is unchanged |
| Cryptography | n/a | No crypto changes. The transcript writer and encryption are untouched |
| Errors and logs | ok | Stop failures are swallowed in the UI, with no internal details shown (LiveView.tsx:144). Core logs name only the event and `Reason` |
| Personal data (minimisation, test data, deletion) | ok | No more data is kept. Audio from a stuck worker is dropped. Voices are dropped at stop as before. Test fixtures use synthetic text, not real recordings |
| New dependencies | n/a | No package.json or Cargo.toml changes |
| Security negative tests | ok | stop.rs tests a blocking/panicking STT and diarizer: source closed before stop returns, no writes or events after stop. LiveView tests cover a rejected stop |
| Secret scan (secret_scan: true) | ok | `scripts/gitleaks.sh` found no leaks, exit 0 |
