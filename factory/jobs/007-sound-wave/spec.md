# Live sound wave while the app listens

## Problem
During a meeting, the facilitator and the people in the room want to see at a glance that the microphone is picking them up. Today the frame 02 footer has 12 bars. They are fed from the 200 ms capture tick, and that level is computed on the speech thread (`Transcriber::level()`). Since 005 split recording into a speech thread and a monitor thread, the level only changes when the engine finishes a window. The meter freezes for seconds while whisper works and does not follow speech. The app needs a real, smooth level display driven by the capture side. It should be flat when paused, show clearly when the microphone is gone, and be reusable for the microphone test in Settings (006).

## Scope
- in:
  - A level stream from the capture side. The level is computed where samples arrive (`AudioSink::push` or the 005 monitor thread), not on the speech thread. It is sent as its own lightweight event every 33–50 ms while recording and carries only numbers (RMS level 0..1, optionally a peak), never samples.
  - A shared `SoundWave` UI component in `src/ui/`, fed by that stream. It is drawn without re-rendering the transcript or live view per frame (`requestAnimationFrame` with a ref or a canvas, interpolating between samples at about 30 fps). It has these states: listening (speech / silence), paused (flat), no signal / microphone lost, and off.
  - It replaces `LevelMeter` in the frame 02 transcript footer ("Listening"). Placement next to the REC chip follows the approved frame (see Design).
  - Reduced motion: under `prefers-reduced-motion: reduce`, a static level bar replaces the wave. It is updated at most 4 times a second, with no transitions.
  - Reuse in the 006 Settings microphone test. The test meter and the "meter shows the running recording's level" state use `SoundWave`, and the test's level comes from the same capture-side computation.
  - Mock backend: a deterministic level stream for e2e. Fixtures for screenshots. New de/en keys.
- out:
  - Frequency bands / spectrum (FFT). This job uses one RMS level per block. See Open questions.
  - Any change to what is recorded, transcribed, stored or sent. Input gain, noise suppression and voice-activity tuning of the transcriber (`VOICE_RMS`) are also out.
  - The speakers view (frame 06) and the smart board mode (frame 05) beyond the responsive sizes below.
  - macOS/Windows CI.

## Depends on
- **005-mic-lost-fix** (in CI, not merged). Required. 005 moved speech-to-text to its own thread, added the monitor thread and `AudioSink::since_last_push()`, and is the reason the tick level is stale. This job edits the same code (`src-tauri/src/recording/mod.rs` `run`, `engines/audio.rs`). Build on `main` after 005 merges.
- **006-settings-panel** (in build). Overlaps: `recording/mic_test.rs` computes its own `level()` (scaled RMS ×4) and sends `mic-test` every `TICK / 2` (100 ms). 006 uses the existing `LevelMeter` in the Audio section, and its `device_tests.rs` and `mod.rs` edit the same recording loop. Build order: 005 → 006 → 007. If 006 has not merged when this job builds, build AC1–AC5 and AC7 first. Once 006 merges, merge `main` in for AC6. If 006 has not merged by the end of the build, AC6 moves to a follow-up.
- **004-speaker-matching** (in build). Small overlap only: 004 changes the footer text to "Listening · N speakers" as a button. `SoundWave` must sit next to that button without taking over its target. If 004 has merged first, keep its footer button. There is no functional dependency.

## Stack
Status: EXISTING

## Acceptance criteria
- [ ] AC1: The level comes from the capture side and keeps coming while the engine is busy. Rust test with `FakeAudioSource` at real-time pace and a fake `SpeechToText` that blocks for 2.5 s per window (as in 005 AC1). Over 6 s of recording:
  - Level events arrive at least 20 times per second on average, with no gap over 100 ms.
  - Each event carries the meeting id and a level in 0..1 (plus an optional peak), and nothing else: no samples, no arrays longer than 8 values.
  - A scripted tone → silence → tone sequence is followed within 100 ms: the level goes over 0.3 in tone blocks and under 0.05 in silence blocks.
  - The level uses the same scale as the existing meter (scaled RMS, `min(1, rms × 4)`, or one documented mapping shared with the mic test).

  The 200 ms `capture-state` tick and its `level` field stay as they are. (NFR Performance "UI stays responsive")
- [ ] AC2: Paused, stopped and lost are distinct, and no stale level remains.
  - On Pause, Stop or end of meeting, level events stop within 100 ms, and the last event sent has level 0.
  - On Resume, they start again.
  - When the fake device goes silent without an error, or fails, level events stop. The existing `MicrophoneLost` / device-error path of 005 is unchanged, and 005's tests pass unchanged.
  - In the UI (component tests with the mocked IPC):
    - Recording with level events shows the moving wave.
    - Paused shows the flat wave.
    - Recording with no level event for 500 ms shows a "No signal" state, with text and not colour alone (de "Kein Signal").
    - `Error` / `MicrophoneLost` shows the "Microphone lost" state of the frame.
  - None of these states holds a non-zero level from before.
- [ ] AC3: Smooth and cheap.
  - `SoundWave` animates with `requestAnimationFrame`, drawing through a ref or a canvas.
  - A Vitest test with a render counter shows that 25 level events per second cause no re-render of `TranscriptPanel` / `LiveView` (at most one per state change).
  - rAF is not scheduled while paused, off, in an error state, under reduced motion, or while `document.hidden` (fake rAF and `matchMedia` in Vitest).
  - Level events never go through React state of the whole capture context.
  - Core side: computing the level is O(n) over each pushed block, allocates nothing per block, and takes the sink's lock no longer than today's `push`. A Rust test with the 30 s sink full shows `push` still keeps up with real time.
- [ ] AC4: Reduced motion. Under `prefers-reduced-motion: reduce` (Playwright `emulateMedia` and a Vitest `matchMedia` mock), the wave is replaced by a static horizontal level bar:
  - it updates at most 4 times per second;
  - it has no CSS transition or animation (computed style check);
  - it shows the same states as AC2 (flat when paused, the "No signal" and "Microphone lost" text).
- [ ] AC5: Fits the frame, both themes and all window sizes.
  - In the frame 02 transcript footer, `SoundWave` replaces `LevelMeter` (the old component and its CSS are removed or become the reduced-motion bar).
  - The wave is `aria-hidden`, and the status text next to it ("Listening" / "Paused" / "No signal" / "Microphone lost") carries the meaning. The live status is announced once per state change, not per level event.
  - Colours come only from CSS custom properties (no hex literals outside the token blocks). The wave keeps at least 3:1 non-text contrast against the card in light and, once 006 has merged, dark theme.
  - Playwright + axe report no WCAG 2.2 AA violations and no horizontal scroll at 375, 1280×800 and 1920×1080, and at the responsive sizes of `e2e/responsive.spec.ts` (including the short live windows 1024×600 and 768×480). Fixtures:
    - `live-level-speech`
    - `live-level-silence`
    - `live-paused`
    - `live-no-signal`
    - `live-mic-error`
  - `npm run screenshot` adds them, using a fixed level sequence from the mock backend so screenshots are stable. All new strings come from `de.json`/`en.json` keys, and the parity and no-literal tests pass. (NFR Clients and usability, Internationalisation)
- [ ] AC6: Settings microphone test reuses it (after 006 merges).
  - The Audio section's meter is `SoundWave`, with the same states and reduced-motion behaviour.
  - The microphone test sends its level at the AC1 rate, from the same capture-side level function (one function, tested once). It no longer uses the separate `TICK / 2` path.
  - "Meter shows the running recording's level" uses the recording's level stream.
  - 006's AC4 tests still pass: `start` and `stop` are called once each, no samples reach `SpeechToText`, and no new file is written.
- [ ] AC7: Nothing new is kept or sent.
  - Level values are not written to disk and not logged. A log-capture test runs a recording with the fake source and finds no level values.
  - After a recording, the app data folder holds only the files it held before (`.meeting`, `.transcript`, and `settings` if 006 has merged).
  - The new event is listed in the capability file, and nothing else is added. `src/config.test.ts` passes, and no network, port or plugin is added.
  - `npm run lint`, `npm test` and the smoke test pass with no model, network or microphone. (NFR Privacy "nothing leaves the device"; Security)

## Design
Source: figcraft design/meeting-companion.figcraft. Additions to frame "02 Live meeting" (`design/screens/s2_live.png`, generator `design/build/s2_live.py`, footer "Listening" › "Level") and to frame "14 Settings" Audio (`design/build/s14_settings.py` `meter()`, `s14b_test`, `s14_settings` recording state).
Status: NEEDED
The frames have a static 12-bar meter only. They show no wave, no "No signal" or "Microphone lost" state in the footer, and no reduced-motion variant. Build the additions as "02 add · Sound wave" frames, following 006's "02 add · …" pattern: a generator such as `design/build/s15_wave.py` through `kit.py`, with PNGs `design/screens/s15*.png`. Use the existing style: accent `#4338CA` for the active wave, `line` for flat, `overrun` red only together with text. The FigCraft frames must show these additions:
- **Frame 02, transcript footer** (1280×800, plus a 375 px variant and a 1920×1080 board variant), as a state strip side by side:
  - Listening, speech: a high, irregular wave.
  - Listening, silence: a low, near-flat wave that still reads as "alive", distinct from paused.
  - Paused: flat, "Paused".
  - No signal: "No signal" text.
  - Microphone lost: matches the existing error notice in the centre card.
  - Reduced motion: the static bar, in the speech and paused states.

  Also show the footer next to 004's "Listening · 5 speakers" button, so the wave and the button do not compete for space at 375 px and at 768×480.
- **Frame 02, top bar**: whether a compact wave sits inside or next to the REC chip, which is visible on every view including Settings and Speakers. If it does, show it in recording, paused and lost states, in light and dark, and say how it relates to the red chip colour. If the frame says no, the footer wave is the only placement.
- **Shape**: what the wave draws, either a scrolling level history (about the last 2 s) or a mirrored bar wave of the current level. Also its size in the footer (height ≤ the current 18 px row, or a taller footer).
- **Frame 14 Settings, Audio** (wide and 375 px): the test meter (`s14b_test`) and the "test disabled, showing the recording's level" state (`s14_settings`) with the same component, at the larger settings size. Include the reduced-motion bar.
- **Dark**: the footer states and the Settings meter on the dark tokens of `s14p_dark02` / `s14j_dark`, at AA (3:1 for the graphic).

## Surfaces
- User-facing UI: yes. Frame 02 transcript footer (and possibly the REC chip in the top bar, as the frame decides), and the Settings Audio meter (frame 14).
- Security-relevant: no. There is one new core→UI event with a numeric level, no new input or command, and no auth, secrets or network. Rules touched: NFR Privacy "nothing leaves the device" (AC7). No `docs.secure_coding` is configured.
- Human gate: no. What is recorded, transcribed and stored is unchanged. The level is a derived number per 33–50 ms block, kept in memory only and shown locally. See Open questions.
- Audio/transcript data: yes, read only. The level is computed from the in-memory capture samples. No audio, level or transcript is newly stored. Audio stays in the bounded 30 s sink and is never written.
- Leaves the device: no.
- Board (touch) layout: yes. The live view at 1920×1080 must show the wave legibly from 3 m (size as in the board variant of the frame). No new touch target.
- AI speaks or contributes unasked: no.

Size: normal

## Open questions
- **Band levels vs one RMS.** The request allows "RMS or a few band levels". I chose one RMS level (plus an optional peak) per block. It is enough to tell speech from silence, it needs no FFT in the audio path, and it keeps CPU low on the board PC. If the frame needs a spectrum look, a follow-up can add 4–8 band levels; AC1 already caps the payload at 8 values.
- **Event rate.** I assumed 25 Hz (40 ms) from the core, with interpolation to about 30 fps in the UI. Sending 30+ Hz over Tauri IPC would cost more without visible gain.
- **Human gate.** The profile gates features that "record, store or send audio". This job only displays a coarse loudness envelope, in memory and on the device. A 25 Hz envelope does reveal speech rhythm, but nothing is stored or sent, so I set `no`. If the approver reads any new derivative of the audio as gated, flip it.
- **"No signal" threshold.** 500 ms without a level event while recording shows "No signal" before the core declares `MicrophoneLost` (about 1.75 s after 005). A device that delivers digital silence (all zeros) keeps sending events with level 0. It shows as silence, not "No signal", because the core cannot tell a muted mic from a quiet room.
- **REC chip placement** is left to the frame. The feature names both places. If the frame puts a compact wave in the REC chip, AC2–AC5 apply to it too.
- **Split if needed.** (a) AC1, AC2 core part and AC7: the capture-side level stream. (b) AC2 UI part, AC3–AC5: `SoundWave` in frame 02. (c) AC6: Settings reuse, after 006.
