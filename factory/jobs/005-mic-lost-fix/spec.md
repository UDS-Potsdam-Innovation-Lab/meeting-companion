# Recording no longer stops with "MicrophoneLost" while speech-to-text is busy

## Problem
A facilitator starts recording and a few seconds later it stops with "MicrophoneLost", though the microphone works. The worker loop in `src-tauri/src/recording/mod.rs` (`run`, around line 416) sets `last_audio` before it calls `transcriber.push()`. Whisper then takes about 2.5 s per 3 s window in release, and longer in a debug build. That time counts toward `STALL` (1.5 s), so after the first window the loop reports a lost device even though audio is waiting in the sink. In `tauri dev` the unoptimised whisper.cpp build makes this worse.

## Scope
- in: stall detection that measures only time without audio arriving from the device (for example a last-arrival time kept in `AudioSink`, or speech-to-text moved off the capture loop); a slow engine makes the transcript lag behind the audio but never stops recording; regression tests with fake engines; an optimised native build of whisper.cpp / `whisper-rs-sys` in the `dev` profile.
- out: model choice and speed tuning for release builds; UI changes; any change to what is recorded, stored or sent; macOS/Windows CI.

## Stack
Status: EXISTING

## Acceptance criteria
- [ ] AC1: A slow engine does not stop recording. Rust test with a live fake microphone (`FakeAudioSource`, real-time pace) and a fake `SpeechToText` that blocks for longer than `STALL` (e.g. 2.5 s) on every window. After at least 3 windows (≥ 8 s), the capture state is still `Recording` with no `reason`, no `MicrophoneLost` was ever emitted, the source was started once and never stopped, and final segments from the fake engine still arrive. (NFR Reliability, Performance)
- [ ] AC2: A dead device is still detected while the engine is busy. With the same slow fake engine, a fake microphone that goes silent without an error leads to `Error` / `MicrophoneLost` within 2 s of its last samples. A microphone that fails with an error mid-meeting leaves `Recording` within 2 s with its own reason. The existing tests `a_device_that_goes_silent_without_an_error_counts_as_lost` and `a_device_that_fails_mid_meeting_leaves_the_recording_state_within_2_s` still pass unchanged.
- [ ] AC3: A lagging engine stays bounded. If the fake engine is slower than real time over a simulated long run, the audio held in memory never goes past the 30 s sink capacity. The oldest samples are dropped and counted (`AudioSink::dropped() > 0`), recording continues, and capture-state ticks (`elapsed_ms`, `level`) keep arriving at least once per second while the engine is inside a window. Audio is still never written to disk. (NFR Performance "UI stays responsive", Privacy; job 003 AC3 bounded buffer)
- [ ] AC4: whisper.cpp is optimised in dev builds. `src-tauri/Cargo.toml` has a `[profile.dev.package."*"]` (or a `whisper-rs-sys`-specific) `opt-level` of at least 2, and the native CMake build of whisper.cpp gets an optimised (Release) build type in the dev profile. A test (Rust or Vitest) reads `Cargo.toml` and checks that setting is present. `npm run lint` and `npm test` pass, with no model, network or microphone needed.

## Design
Source: none
Status: NOT NEEDED

## Surfaces
- User-facing UI: no. The existing `MicrophoneLost` message and REC chip are unchanged; the false error just stops appearing.
- Security-relevant: no. No input handling, auth, secrets or network change. Rules touched: none (no `docs.secure_coding` configured).
- Human gate: no. Auth, secrets and permissions are unchanged, and no data is deleted or migrated. What is recorded and stored stays the same (see Open questions).
- Audio/transcript data: yes. Audio stays in memory only, in the existing bounded 30 s sink (oldest dropped), and is never written. Transcript storage (encrypted `<id>.transcript`) is unchanged.
- Leaves the device: no.
- Board (touch) layout: no.
- AI speaks or contributes unasked: no.

Size: small

## Open questions
- The profile asks for `Human gate: yes` on features that record audio. I read that rule as covering new recording or storage behaviour. This bugfix changes neither what is captured nor where it goes, so I set `no`. If the approver treats any change to the recording path as gated, flip it.
- When the engine falls more than 30 s behind, the oldest audio is dropped and never transcribed (as specified in 003). The user sees no notice of the gap. Assumption: no UI notice in this job; a "transcript is lagging" hint would be a separate UI job.
- `Recorder::halt` joins the worker. If speech-to-text stays on the worker thread, pausing or stopping waits for the window in progress (up to a few seconds in a debug build). Assumption: acceptable for this fix. If the builder moves speech-to-text to its own thread, pause and stop should not wait on it.
