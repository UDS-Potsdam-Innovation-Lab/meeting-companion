# Settings panel: audio, on-device and general settings

## Problem
Settings are spread around the app or missing. The speech-model picker sits in the transcript column (job 003). The language switch sits in the top bar. The microphone is always the system default, so a facilitator with a USB conference mic or a board microphone array cannot use it. When the device disappears, recording stops and nothing else can happen. Facilitators need one place, reachable from the top bar and the keyboard, where they can pick and test the microphone and see the on-device models and where data lives. It should also hold the app language, the theme and the default meeting language. Changes apply at once and are stored on the device, encrypted where they say something about the person or the room.

## Scope
- in:
  - A settings view that opens in the same window, not as a modal dialog. It opens from a top-bar button on both the setup view and the live view, and with the shortcut Ctrl+, (Cmd+, on macOS). "Back" or Escape returns to the view it was opened from, and a running recording carries on. It has three sections: **Audio**, **On this device** and **General**. Later sections (language model engine, export connectors, AI voice) are added by their own jobs as new sections. Nothing is shown for them now, not even as dead controls.
  - A core `SettingsStore`. All settings live in one sealed file, `<app_data>/settings`, encrypted with the existing data key. Every value is validated against a closed schema, and missing fields take defaults. A `settings-changed` event lets every view apply a change at once. The two `localStorage` keys from job 003 (locale, speech model) are moved into the store once. After that, `localStorage` keeps only locale and theme, as a cache for the first paint.
  - **Audio**:
    - Input device: "System default" or one named device. The list comes from a new `AudioDevices` engine trait with a fake. The `cpal` implementation lists input devices by name.
    - Live level meter and "Test microphone": opens the chosen device for at most 10 s, shows the level, and keeps nothing.
    - "When the microphone disappears": "Stop recording and tell me" (the default, today's behaviour) or "Switch to the system default".
  - **On this device**:
    - Speech model picker, moved here from the transcript column (job 003). It shows the found models with name, folder found in, language and size, and the folders searched when nothing is found.
    - Speaker model picker, the same for job 004's speaker-model scan.
    - Default meeting language: "German + English (detect per line)" (default), "German", "English". It is the language hint for new recordings, and the "On-device · …" chip shows it.
    - Where meetings and transcripts are stored: the folder path, read-only.
  - **General**:
    - App language de/en. The same setting as the top-bar switch, which stays.
    - Theme: light / dark / system. System follows `prefers-color-scheme` live. Dark tokens come from the design (see Design).
  - Mock backend support, e2e fixtures and screenshots. New de/en keys.
- out:
  - Input gain and noise suppression. `cpal` exposes no gain control, and whisper.cpp has no noise filter. A software gain or denoiser would be new signal processing. See Open questions.
  - Changing the storage folder. That moves encrypted meeting data, which is a data migration and needs its own human-gated job.
  - Data retention ("how long data is kept") and any automatic deletion. Audio is never written, and the NFR keeps transcripts and notes "until deleted". A retention setting only makes sense together with meeting deletion, which does not exist yet. It goes to a separate human-gated job, "Delete meetings and retention".
  - Downloading or bundling models ("Model setup" follow-up), and choosing an output device.
  - Sections for the language model engine, export connectors and AI voice (their own jobs).
  - Omarchy theme following (backlog item). This job provides the light/dark/system switch that item builds on.
  - Smart board (frame 05) layout of the settings view beyond the responsive sizes below.

## Depends on
- **004-speaker-matching** (not merged). The speaker-model scan (`models.rs` model kind `speaker`, the speaker-model check) and its IPC listing feed the speaker-model picker (AC5). The diarizer must take the model chosen here instead of "the preferred model the scan finds". If 004 is not merged when this job builds, the speaker-model row is left out and AC5's speaker part moves to a follow-up.
- **005-mic-lost-fix** (not merged). It changes the recording loop in `src-tauri/src/recording/mod.rs` and how a dead device is detected (`STALL`, last-arrival time in `AudioSink`). AC3's device-lost handling ("switch to the system default") builds on that detection. Both jobs edit the same worker loop. Build on top of 005, after it merges.
- Job 003 (merged): `ModelPicker` in `TranscriptPanel.tsx`, `useRecording.ts` (`MODEL_STORAGE_KEY`), `engines/models.rs`, `engines/cpal_source.rs` (`default_input_device`).

## Stack
Status: EXISTING

## Acceptance criteria
- [ ] AC1: Settings are stored on the device, encrypted and validated in the core. The `SettingsStore` trait has a file implementation and a memory implementation. Rust tests:
  - Round trip of all settings.
  - The file `<app_data>/settings` never holds a device name, model path or other setting value in plain form (marker test). Its associated data binds the purpose "settings", so a meeting or transcript record swapped in is rejected.
  - A missing, corrupt or tampered file, or a locked keychain, gives the defaults. The app still starts, and the file is not overwritten until the user changes a setting.
  - Unknown fields are dropped. Commands reject values outside the schema: unknown enum values, a device name over 256 characters, and a model id that is not in the core's own current scan.
  - Device names, model paths and setting values never appear in logs or errors (log-capture test).

  After the one-time move from `localStorage`, the old model key is gone. Device name and model id are never written to `localStorage` (component test). (NFR Privacy "stored only on the device, encrypted at rest"; Security; profile reviewer-security)
- [ ] AC2: Reachable, non-modal, applies at once. A top-bar button labelled "Settings" (de "Einstellungen") opens the settings view on the setup view and on the live view. So do Ctrl+, and Cmd+, (component test for both, and for the button by keyboard). Escape and "Back" return to the previous view, focus goes back to the settings button, and in the live view the transcript scroll position is kept. Opening or closing settings never pauses, stops or starts recording: the REC chip stays visible on the settings view, and a component test checks the capture state with the fake core. Every change is sent to the core and broadcast as `settings-changed`. A second mounted view applies it without a reload (component test), and the value survives a page reload (e2e with the mock backend). No "Save" button.
- [ ] AC3: Choosing the microphone and what happens when it disappears. `AudioDevices` is a Rust trait with a fake (the `cpal` implementation compiles in CI and is not run in tests). The device list shows "System default" first, then the names from the fake. Rust tests with `FakeAudioSource`/fake devices:
  - With a device chosen, `Recorder` opens that device, and with "System default" it opens the default.
  - A chosen device that is missing at start does not record silently from another one. The start fails with a new reason, `chosenMicrophoneMissing`, and the centre column offers "Use system default" (one tap, then recording starts) or "Settings".
  - When the device is lost mid-recording, the setting decides. "Stop recording and tell me" behaves as today: `Error` / `MicrophoneLost` within 2 s, and 005's tests stay green. "Switch to the system default" reopens the default device within 2 s. The capture state stays `Recording`, and the elapsed time does not reset. The live view shows a non-blocking notice ("Switched to the system microphone") that does not use colour alone. No second consent prompt appears, and recording never starts while it is off or paused.

  Changing the device while recording takes effect at the next Start/Resume, and the panel says so. (NFR Reliability; Privacy "recording indicator always visible")
- [ ] AC4: Level meter and microphone test without recording. In the Audio section, "Test microphone" opens the chosen device through `AudioSource`. The level meter (the existing `LevelMeter`, 12 bars) moves, and a visible "Microphone test running" label with a countdown is shown. The test stops after 10 s, on "Stop test", when the user leaves the view, or when the view closes. Rust tests with the fake source:
  - `start` is called once and `stop` once per test.
  - No samples reach `SpeechToText` or the transcript store.
  - After a test, the app data folder holds no new file apart from `settings`.

  While a meeting is recording or paused, "Test microphone" is disabled with the reason given in text, and the meter shows the running recording's level. A device that fails during the test shows its reason in the section. (NFR Privacy "audio never written", "recording indicator is always visible"; profile: engines behind an interface with a fake)
- [ ] AC5: On-device section. The speech-model picker is gone from the transcript column. It lives here with the same content as in job 003 (name, size, found in, language, English-only hint, the "none found" state with the searched folders). `startRecording` takes the model from the settings store, and the core still rejects ids that are not in its own scan. The speaker-model picker (job 004) lists the speaker models found, or "No speaker model found on this device" with the searched folders. The diarizer uses the chosen model. A model that has disappeared since it was chosen falls back to the scan's preferred model and is shown as "Not found any more" (Rust and component tests). Default meeting language:
  - "de" and "en" pass a language hint to `SpeechToText` (the scripted fake records the hint it received).
  - "German + English" passes none.
  - The on-device chip reads "On-device · DE/EN", "· DE" or "· EN".

  The storage folder is shown as text and is selectable. No shell or opener plugin is added. (NFR Architecture, Internationalisation)
- [ ] AC6: General section. Choosing the app language here and in the top bar sets the same setting, and `<html lang>` follows. Theme light / dark / system:
  - It sets `data-theme` on the root.
  - "System" follows a `prefers-color-scheme` change without a reload (Playwright `emulateMedia`).
  - Every colour comes from CSS custom properties, with a dark set from the design. A Vitest test finds no hex literal outside the token blocks in `styles.css`.
  - Playwright + axe find no WCAG 2.2 AA contrast violations in dark theme on the setup, live (`live-transcript`) and settings fixtures at 1280×800.
  - The first paint uses the cached theme, so a light flash in dark mode does not happen (e2e checks the background colour at first paint).
- [ ] AC7: Nothing leaves the device; accessible and responsive. No network access, listening port, HTTP client crate or Tauri plugin is added. `src/config.test.ts` passes, and the capability file grants only the new commands and events. All new strings come from `de.json`/`en.json` keys, and the parity and no-literal tests pass. Playwright + axe report no WCAG 2.2 AA violations, with no horizontal scroll, at 1280×800, 1920×1080, 375 px and the responsive sizes of `e2e/responsive.spec.ts`, in these fixtures:
  - `settings` (devices and models found)
  - `settings-no-model`
  - `settings-mic-test`
  - `settings-recording` (test disabled, REC chip)
  - `settings-dark`

  The keyboard reaches every control in section order with a visible focus ring. Radio groups and selects are labelled. Targets are at least 24×24 px, and at least 48 px at 1920×1080. `npm run screenshot` adds the fixtures, and the smoke test still passes. (NFR Clients and usability, Internationalisation, Security "no listening ports")

## Design
Source: figcraft design/meeting-companion.figcraft, new frame "14 Settings" (to be built by `design/build/s14_settings.py` through `design/build/kit.py`, like the other frames; PNG export `design/screens/s14_settings.png`). Style reference: frames 01, 02 and 06 (`s1_setup.png`, `s2_live.png`, `s6_speakers.png`)
Status: NEEDED
No frame covers an app settings view, and the design has no dark palette. Frame "14 Settings" is drawn in FigCraft, not as an HTML prototype (human decision 2026-10-30). It uses the existing frame style: warm neutral background, white cards, indigo accent `#4338CA`, Inter, muted 12 px hints, ghost and primary buttons as in frame 01, and the top bar of frames 01 and 02. The frame shows these states and window sizes, as variants side by side in the frame. The builder implements them, and the UI reviewer compares against the PNG export.
- **Entry and frame** (wide window, 1280×800):
  - The top bar of frame 01 (setup) and of frame 02 (live, REC chip visible) with the new "Settings" button next to the language switch, plus its focus state.
  - The settings view opened from the live meeting. It is not modal and the REC chip stays in the top bar. Show "Back".
- **Section layout**:
  - Wide (1280×800 and 1920×1080 board): a left section list (Audio, On this device, General) with the active section highlighted, and the section content in white cards on the right. At 1920×1080 every target is at least 48 px.
  - Narrow (375 px and 768×1024): the section list becomes a stacked list or tabs at the top, cards are full width, and nothing scrolls sideways.
  - The layout must take later sections (language model, export connectors, AI voice) without empty placeholders.
- **Audio** (wide and narrow):
  - Device select with "System default" first, idle level meter.
  - Test running: 12-bar meter, "Microphone test running" label, countdown, "Stop test".
  - Test disabled while a meeting records: the reason in text, the meter showing the recording's level, and the hint that a device change applies at the next Start/Resume.
  - Chosen device missing.
  - The radio group "When the microphone disappears".
- **On this device** (wide):
  - Speech-model select with name, size, found in, language, and the English-only hint.
  - Speaker-model select.
  - "None found" with the searched folders in muted 12 px, in the style of 003's no-model state.
  - "Not found any more".
  - Default meeting language radio group.
  - Storage folder path as read-only text.
- **General** (wide): app language (de/en) and theme (light/dark/system).
- **Frame 02 additions**:
  - The non-blocking "Switched to the system microphone" notice.
  - The `chosenMicrophoneMissing` state in the centre card with "Use system default" and "Settings".
- **Dark theme**:
  - Tokens for background, cards, ink, muted, line, accent and the decision/to-do/question/overrun colours, all at WCAG AA.
  - Dark versions of the settings view (wide) in frame 14. Also dark variants of frames 01 and 02, added through `kit.py` tokens, so the UI reviewer has a reference.
- Open for the frame to answer: how the per-meeting "Assistant settings" card in frame 01 relates to these app settings, so nothing is set in two places.

## Surfaces
- User-facing UI: yes. A new settings view, a top-bar button in frames 01 and 02, the speech-model picker removed from the transcript column, a device-switched notice and a new start-failure state in frame 02, and a dark theme across the app.
- Security-relevant: yes.
  - A new encrypted settings file holds device names, which can be personal ("Jan's AirPods") and say where the room is.
  - New IPC commands take user-chosen values (device name, model ids, enums), and the core validates them.
  - A microphone test opens the microphone outside the meeting consent gate.
  - The model scans read outside the app folder (unchanged from 003/004).

  Rules touched: NFR Privacy (stored only on the device, encrypted at rest, recording indicator always visible, nothing leaves the device), NFR Security (no listening ports), NFR Architecture (engines behind interfaces). No secure-coding guideline is configured.
- Human gate: yes. This job changes which microphone is recorded and lets recording switch device on its own after a loss. It opens the microphone for a test outside the meeting consent gate and adds a new encrypted file at rest. The profile gates features that record or store audio-related data, and the approver escalates changes to what is recorded.
- Audio/transcript data: yes.
  - Audio from the microphone test stays in memory only, at most 10 s, and is never transcribed or written.
  - Recording audio and transcript storage are unchanged.
  - New stored data: the settings file (device name, model ids, language, theme, device-lost policy), encrypted, kept until the app data is removed. Locale and theme are also cached in `localStorage`.
- Leaves the device: no.
- Board (touch) layout: yes. The settings view must work at 1920×1080 with 48 px targets. The full smart board mode (frame 05) stays out.
- AI speaks or contributes unasked: no.

Size: normal

## Open questions
- **Split.** The request covers more than one small job. I kept the criteria at 7 by moving out gain/noise, the storage folder change and retention. The job is still large. If it has to shrink, split it into:
  - (a) settings store, view and General section with the dark theme (AC1, AC2, AC6, AC7)
  - (b) Audio section (AC3, AC4), after 005 merges
  - (c) On this device (AC5), after 004 merges
- **Gain and noise handling.** Assumed out: `cpal` has no hardware gain control on any target, and whisper.cpp has no denoiser. Options for a later job are a software gain stage in the `AudioSink` path, or a bundled denoiser (RNNoise, Apache/BSD). Either needs a measurement against the 3 s latency NFR.
- **Retention.** "How long data is kept" is left out. The NFR's 30-day default applies to audio, which this app never writes, and transcripts stay "until deleted". It belongs with meeting deletion in a human-gated job.
- **Device-lost default.** I assumed "Stop recording and tell me", as today. Switching silently to another microphone could pick up a different room (for example a laptop in a hallway). So the switch is opt-in and shows a notice.
- **Microphone test vs. consent.** I assumed a level-only test with nothing kept needs no meeting consent, but it gets its own visible indicator. The approver should confirm.
- **Device identity.** `cpal` names devices but has no stable id on every OS. The setting matches by name, so two identical devices with the same name cannot be told apart.
- **Default meeting language** is a hint for the whole recording. Choosing "German" turns off per-segment English detection, so mixed meetings should keep the default. Per-meeting override is out (it would belong to frame 01's assistant settings).
- **Settings with a locked keychain** fall back to defaults. In that case locale and theme come from the `localStorage` cache.
