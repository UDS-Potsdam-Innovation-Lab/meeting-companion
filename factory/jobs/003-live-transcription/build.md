# Build: 003-live-transcription

## Summary
- Rust core: `AudioSource` (cpal microphone + `FakeAudioSource`) and `SpeechToText` (whisper.cpp via `whisper-rs` + `ScriptedSpeechToText`) in `src-tauri/src/engines/`. Audio goes into a bounded in-memory sink (30 s max, oldest dropped) and through a `Transcriber` that sends the engine windows of at most 3 s (partials every 1 s of speech, final after 600 ms silence or at 3 s). A `Recorder` runs it on its own thread and emits `capture-state` and `transcript-segment` events; nothing engine-typed crosses IPC.
- Consent gate in the core: `confirm_recording_consent` stores `recordingConsentAt` in the meeting (optional field, old files load unchanged); `start_recording` is refused (`noConsent`) without it, and `save_meeting` always keeps the stored value, so the UI cannot set or skip it. Recording never starts on its own; after a restart the view shows "Resume recording" (one tap, no second prompt).
- Transcript storage: `<app_data>/meetings/<id>.transcript`, append-only, one XChaCha20-Poly1305 record per final segment with the existing data key; AAD = magic ‖ meeting id ‖ 0 ‖ seq. Each record is `sync_data`'d before the segment is sent to the UI. A torn last record is ignored and cut before the next append; tampered, reordered or foreign records fail the load (file left untouched). The writer keeps only the file, seq and last offset.
- **Spec review 1 (human, stack-decision.md):** `engines/models.rs` finds whisper ggml models already on the device, read-only: app `<app_data>/models/`, Voxtype, whisper.cpp folders, pywhispercpp, Buzz, MacWhisper (macOS), Hugging Face hub cache (`HF_HUB_CACHE`/`HF_HOME` honoured), per OS in one `locations_for()`. A file counts only if its 48-byte header is a whisper ggml header (magic + whisper hyper-parameters); links are followed only to files inside the scanned folder, linked folders are never entered; depth/entry limits. Multilingual (n_vocab ≥ 51865) is preferred, then smaller size. The live view's engine area shows name, size, where it was found and language, lets the facilitator pick another (remembered in the web view's localStorage), and with no model says "No speech model installed" plus every folder searched. The core only loads ids from its own scan. GGUF files are deliberately not listed: the bundled whisper.cpp loads only `GGML_FILE_MAGIC`, so they could never be used.
- UI (frame 02): top bar REC chip (red dot + "REC" + `hh:mm:ss`, driven by core events), "Paused" neutral chip with frozen time, "On-device · DE/EN" chip, one Pause/Resume button; centre card "Transcript" only, inline consent prompt (checkbox, "Start recording", "Audio stays on this device."), off/error areas with "Resume recording", final lines with locale `HH:MM`, muted "speaking…" partial, Jump to latest, polite count announcement ≤ once per 10 s, footer with 12-bar level meter and "Listening"/"Paused". End meeting stops capture before saving the ended run. Nudge floats over the card bottom as in the frame. macOS `NSMicrophoneUsageDescription` (Info.plist + de/en `InfoPlist.strings`). CI installs `libasound2-dev cmake clang libclang-dev`.

## Acceptance criteria
| AC | Test | Result |
|----|------|--------|
| AC1 | src-tauri `recording::tests::no_audio_source_starts_before_consent_and_one_starts_after` (starts 0 → refused `NoConsent` → 1) | PASS |
| AC1 | src-tauri `lib::tests::consent_is_stored_by_the_core_only_and_kept_by_later_saves`, `model::tests::consent_is_optional_kept_and_needs_a_run` | PASS |
| AC1 | src-tauri `recording::tests::without_a_speech_model_the_microphone_is_not_opened_and_the_reason_is_shown`, `no_microphone_or_a_blocked_one_is_reported_as_the_reason`, `a_meeting_that_is_not_running_or_unknown_is_refused` | PASS |
| AC1 | `src/features/transcript/Transcript.test.tsx` › "AC1 consent before recording" (inline prompt, left column usable, no start before confirmation; restart → Resume recording, no auto-start; reasons without REC chip; no-model folders) | PASS |
| AC1 | `e2e/transcript.spec.ts` › "consent, start, German and English lines, pause, resume and restart" | PASS |
| AC2 | src-tauri `recording::tests::a_device_that_fails_mid_meeting_leaves_the_recording_state_within_2_s`, `a_device_that_goes_silent_without_an_error_counts_as_lost`, `pause_closes_the_microphone_freezes_the_time_and_resume_continues`, `ending_the_meeting_stops_capture` | PASS |
| AC2 | `Transcript.test.tsx` › "AC2 …" (recording / paused / error / stopped from events; agenda timer keeps running; End meeting calls stop before the ended save) | PASS |
| AC3 | src-tauri `transcript::tests::scripted_audio_gives_partials_then_finals_in_order_with_both_languages`, `first_partial_arrives_within_3_s_of_speech_start_and_windows_never_exceed_3_s`, `audio_held_stays_bounded_over_a_simulated_two_hour_meeting`; wall-clock check in `recording::tests::pause_closes_…` | PASS |
| AC3 | `engines::whisper::tests::whisper_transcribes_a_window_with_a_local_model` (`#[ignore]`, run by hand with `--release -- --ignored whisper`: picked `~/.local/share/voxtype/models/ggml-base.bin`, 3 s window in 2.5 s) | PASS (by hand) |
| AC3 | `recording::tests::errors_and_states_serialise_without_engine_types`; UI imports only `src/lib/ipc.ts` types (ESLint `no-restricted-imports`) | PASS |
| AC4 | `Transcript.test.tsx` › "AC4 transcript column" (HH:MM per locale, partial replaced, `<img src=x onerror=alert(1)>` literal and no element, Listening/Paused meter, announcements ≤ 1 per 10 s, Jump to latest, unreadable transcript) | PASS |
| AC5 | src-tauri `transcript::store::tests::round_trip_of_many_records_across_writers`, `a_file_cut_in_the_middle_of_the_last_record_keeps_every_complete_record`, `a_tampered_reordered_or_foreign_record_is_rejected`, `the_file_never_contains_transcript_text_in_plain_form`, `appending_never_rewrites_earlier_bytes`; "stored before sent" check in `recording::tests::pause_closes_…` | PASS |
| AC5 | `e2e/transcript.spec.ts` › restart part of the flow test (reload shows the transcript in full) | PASS |
| AC6 | src-tauri `recording::tests::a_recording_session_writes_only_meeting_and_transcript_files_and_logs_no_text` (file store, marker phrase, error paths) | PASS |
| AC6 | `src/config.test.ts` › "AC6 (job 003) …" (no HTTP crate in the engines' dependency closure, capability still `core:default` only, NSMicrophoneUsageDescription de/en) + existing no-socket/CSP tests | PASS |
| AC7 | `src/i18n/i18n.test.tsx` parity + "AC7 (job 003) no literal strings …" (consent, recording, paused, error, no-model) | PASS |
| AC7 | `e2e/transcript.spec.ts` › "AC7 transcript accessibility at 1280×800" (axe, no h-scroll, targets ≥ 24 px in consent/recording/paused/error/no-model; tab order; Jump to latest by keyboard); `e2e/responsive.spec.ts` › "transcript at …" | PASS |
| AC7 | `npm run screenshot` → `live-consent`, `live-transcript`, `live-paused`, `live-mic-error` (+ `live-no-model`, `live-transcript-de`) at 375/1280/1920 and the responsive sizes | PASS (93 shots) |
| Spec review 1 | src-tauri `engines::models::tests::*` (8 tests on temp folders with fake headers: preference, non-models ignored, read-only, missing folders, HF snapshot links, links out of the folder, duplicates, per-OS locations); `Transcript.test.tsx` › "speech model picker" | PASS |

## Secure coding
No secure-coding guideline is configured (`docs.secure_coding` absent). NFR rules this change touches:
- Privacy, consent before recording: enforced in the core (`Recorder::start` checks the stored `recordingConsentAt`; `save` cannot set it); the microphone opens last, after the meeting, consent, transcript and model checks.
- Privacy, recording indicator always visible: REC chip with dot + text + time, from core `capture-state` events; leaves REC within 2 s on device failure or silence (stall watchdog 1.5 s).
- Privacy, stored only on the device / encrypted at rest: transcript records sealed with the keychain data key; audio only in a bounded RAM buffer, never on disk (test lists the data dir).
- Privacy/Security, nothing leaves the device, no listening ports: no HTTP/network crate added (checked over the engines' dependency closure), no plugin, no new capability permission; whisper.cpp built CPU-only, no GPU/network features.
- Logs and errors: new `log.rs` is the only log path; messages carry kinds only; whisper.cpp logging redirected away from stderr; test with a marker phrase.
- Security, transcript text is untrusted: rendered as text only (no `dangerouslySetInnerHTML`, ESLint `react/no-danger`), clipped to 2 000 chars in the core, `pre-wrap` with `overflow-wrap`.
- Model scan reads outside the app folder: read-only, 48-byte header only, no writes, symlinks constrained to the scanned folder, depth/entry limits; the core loads only paths from its own scan (a UI-supplied id is matched against it).

## Test run
`npm test` → vitest 118 passed; cargo 91 passed, 2 ignored (keychain, whisper); playwright 61 passed. `npm run lint` clean. `npm run screenshot` 93 passed. gitleaks: no leaks (exit 0).
```
      Tests  118 passed (118)
test result: ok. 91 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 6.73s
  ✓  60 [chromium] › e2e/transcript.spec.ts:183:3 › AC1–AC5 recording with the mock core › End meeting stops recording first (246ms)
  ✓  53 [chromium] › e2e/transcript.spec.ts:43:3 › AC7 transcript accessibility at 1280×800 › paused state, in German too (1.7s)
  ✓  56 [chromium] › e2e/transcript.spec.ts:107:3 › AC7 transcript accessibility at 1280×800 › Jump to latest is reachable by keyboard after scrolling up (1.1s)
  ✓  54 [chromium] › e2e/transcript.spec.ts:52:3 › AC7 transcript accessibility at 1280×800 › error state and no speech model (1.7s)
  ✓  61 [chromium] › e2e/transcript.spec.ts:191:3 › AC1–AC5 recording with the mock core › recording makes no network request beyond the app's own assets (1.0s)
  ✓  57 [chromium] › e2e/transcript.spec.ts:130:3 › AC1–AC5 recording with the mock core › consent, start, German and English lines, pause, resume and restart (4.2s)

  61 passed (13.8s)
```
Not run locally: `npm run tauri build -- --no-bundle` and the smoke test (no xvfb here; running the app would open a window on the human's desktop next to their `tauri dev`). CI runs both; `scripts/smoke.mjs` now sets `MEETING_COMPANION_AUDIO=fake` and `MEETING_COMPANION_STT=fake`.

Notes for reviewers and the human gate:
- New stored data: `<id>.transcript` (time offsets, wall-clock start, text, language per final segment) and `recordingConsentAt` in the meeting file. New OS permission: microphone. New reads outside the app folder: model headers in the listed folders.
- Performance: whisper `base` on this machine takes ~2.5 s for a 3 s window (release, 4 threads). Previews now skip language detection, but with previews every second a slow CPU will fall behind; the sink then drops the oldest audio (bounded at 30 s). Model size vs. the 3 s NFR belongs to the follow-up "Speech model setup" job, as the spec says.
- Elapsed REC time after an app restart continues from the last stored segment's end offset (paused/unspoken tail before the crash is not counted).

## Commits
```
828c102 docs(agents): engines, transcript store, recording flags and native build deps
36720c0 perf(core): whisper previews reuse the last detected language
bc55936 test: recording fixtures in the mock core, component, e2e and screenshot coverage
c3cbad6 feat(live): transcript column, consent prompt, model picker and REC indicator
c529389 style(core): rustfmt the transcript store tests
7c84b85 feat(core): consent-gated recording with engines behind traits, encrypted transcript
```
