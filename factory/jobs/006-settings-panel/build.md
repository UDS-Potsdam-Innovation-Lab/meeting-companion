# Build: 006-settings-panel

## Summary
A settings view in the same window (top-bar "Settings" button / "Einstellungen" on setup and live, Ctrl+, / Cmd+,; Back or Escape returns focus to the button). It has three sections: Audio, On this device and General, laid out as in frame 14 (wide, 1920 board with 48 px targets, 768, 375, dark). The view underneath stays mounted, so recording, the transcript and its scroll position carry on, and the REC chip stays in the settings top bar.
Core: `src-tauri/src/settings/` holds a `SettingsStore` (file, memory and locked implementations). It is one sealed file `<app_data>/settings` with the data key, and the AAD binds `purpose=settings`. The schema is closed and checked field by field. Changes are validated against the core's own device list and model scan, and a `settings-changed` event goes out on each change.
Audio: there is a new `AudioDevices` engine trait (cpal by name, `FakeAudioDevices`). `Recorder` opens the chosen device or the default. A missing chosen device fails with `chosenMicrophoneMissing` and nothing else is opened. A 10 s microphone test keeps nothing. "Switch to the system default" is built on 005's monitor thread: the default device opens on the same sink, the state stays `Recording`, the elapsed time carries on, there is one switch per session, and a non-blocking notice appears in frame 02.
The speech-model picker moved here from the transcript column. `start_recording` takes the model, device and language from the store. The default meeting language is passed to `SpeechToText::set_language`, and the on-device chip shows DE/EN, DE or EN. The theme can be light, dark or system. Every colour in `styles.css` comes from a token, the dark tokens come from kit.py DARK (with an AA muted colour), and `public/theme-boot.js` handles the first paint.
**Not built: the speaker-model row of AC5.** 004-speaker-matching is not merged. As the spec says, the speaker part of AC5 moves to a follow-up: the speaker-model picker, the diarizer using the chosen model, and its "Not found any more" state.

## Acceptance criteria
| AC | Test | Result |
|----|------|--------|
| AC1 round trip | src-tauri/src/settings/tests.rs::every_setting_round_trips_through_the_file_and_the_memory_store | PASS |
| AC1 no plain values, AAD binds purpose | settings/tests.rs::the_file_holds_no_setting_in_plain_form_and_binds_the_purpose_settings | PASS |
| AC1 missing/corrupt/tampered/locked → defaults, file untouched until a change | settings/tests.rs::a_corrupt_tampered_foreign_or_locked_file_gives_the_defaults_and_is_left_alone, ::the_app_still_starts_when_the_settings_file_is_a_folder_or_unreadable, ::the_ui_cache_is_moved_into_a_missing_file_once | PASS |
| AC1 unknown fields dropped; enum / >256 chars / model not in scan refused | settings/tests.rs::unknown_fields_are_dropped_and_invalid_stored_fields_take_their_default, ::changes_outside_the_schema_are_refused_with_the_key_only | PASS |
| AC1 no values in logs/errors | settings/tests.rs::device_names_model_paths_and_values_never_reach_logs_or_errors; recording/device_tests.rs::a_microphone_test_opens_the_device_once_shows_its_level_and_keeps_nothing | PASS |
| AC1 old model key moved and removed; device/model never in localStorage | src/features/settings/Settings.test.tsx › AC1 moves job 003's model key into the store once… | PASS |
| AC2 button, Ctrl+, Cmd+, keyboard; Back/Escape; focus returns | Settings.test.tsx › AC2 (first two tests); e2e/settings.spec.ts › Ctrl+, opens the settings… | PASS |
| AC2 recording carries on, REC chip, scroll kept, no capture command | Settings.test.tsx › in the live view recording carries on…; e2e/settings.spec.ts › from the live view recording carries on… | PASS |
| AC2 sent at once, second view applies via event, no Save; survives reload | Settings.test.tsx › every change goes to the core at once…; e2e/settings.spec.ts › …a change survives a reload | PASS |
| AC3 `AudioDevices` trait + fake; list "System default" first | engines/devices.rs (cpal compiles in CI, not run); Settings.test.tsx › lists System default first… | PASS |
| AC3 chosen device opened / default opened | recording/device_tests.rs::the_chosen_device_is_opened_and_system_default_opens_the_default | PASS |
| AC3 missing at start → chosenMicrophoneMissing; "Use system default" (one tap, starts) / "Settings" | device_tests.rs::a_chosen_device_that_is_missing_at_start_records_from_no_other_device; Settings.test.tsx › chosenMicrophoneMissing in the live view…; e2e/settings.spec.ts › AC3 chosen microphone missing | PASS |
| AC3 lost: "Stop and tell me" as today (005 tests green) | device_tests.rs::stop_and_tell_me_behaves_as_before_when_the_device_is_pulled; recording/tests.rs (005, unchanged) | PASS |
| AC3 lost: "Switch" reopens default within 2 s, stays Recording, elapsed continues, never restarts while off/paused | device_tests.rs::switch_to_the_system_default_keeps_recording_and_the_elapsed_time, ::when_the_system_default_is_lost_too_recording_stops, ::with_the_system_default_chosen_a_loss_stops_even_with_the_switch_policy | PASS |
| AC3 notice (not colour alone), no consent prompt | Settings.test.tsx › AC3 switched to the system default…; e2e/settings.spec.ts › AC3 switched to the system default | PASS |
| AC3 device change while recording applies at next Start/Resume, panel says so | Settings.test.tsx › while recording, the panel says…; device_tests.rs (Resume uses the chosen device again) | PASS |
| AC4 start/stop once, no samples to STT/transcript, no new file but `settings` | device_tests.rs::a_microphone_test_opens_the_device_once_shows_its_level_and_keeps_nothing | PASS |
| AC4 stops after 10 s / Stop test / leaving view or section | device_tests.rs::a_microphone_test_stops_by_itself_after_10_s; Settings.test.tsx › runs with a visible label, countdown…; e2e/settings.spec.ts › AC4 | PASS |
| AC4 disabled while recording/paused with reason, meter shows recording; failure reason shown | device_tests.rs::no_test_while_a_meeting_records_or_is_paused…, ::a_device_that_fails_during_the_test_shows_its_reason; Settings.test.tsx › is disabled with the reason…, › a device that fails… | PASS |
| AC5 picker moved (gone from transcript column); same content | Transcript.test.tsx › job 006 AC5…; Settings.test.tsx › lists the speech models…, › shows the searched folders… | PASS |
| AC5 model from store, core rejects ids not in scan, gone → preferred + "Not found any more" | lib.rs::recording_takes_device_model_language_and_policy_from_the_settings, ::a_chosen_model_that_disappeared_falls_back_to_the_preferred_one; Settings.test.tsx › a chosen model that has disappeared… | PASS |
| AC5 language hint de/en/none; chip DE/EN, DE, EN | device_tests.rs::the_default_meeting_language_is_passed_as_a_hint, ::a_hinted_scripted_engine_labels_every_line_with_the_hint; Settings.test.tsx › the default meeting language sets the on-device chip… | PASS |
| AC5 storage folder read-only, selectable; no shell/opener plugin | Settings.test.tsx (same test); src/config.test.ts | PASS |
| AC5 speaker-model picker (004) | — | NOT BUILT: 004 not merged, moves to a follow-up |
| AC6 app language here = top bar, `<html lang>` | Settings.test.tsx › app language here and in the top bar… | PASS |
| AC6 data-theme; System follows change (Vitest + Playwright emulateMedia) | Settings.test.tsx › sets data-theme…; e2e/settings.spec.ts › System follows prefers-color-scheme… | PASS |
| AC6 no hex outside token blocks; dark sets every token | src/styles.test.ts | PASS |
| AC6 axe AA dark on setup, live-transcript, settings at 1280×800 | e2e/settings.spec.ts › dark theme has no WCAG 2.2 AA violation: filled / live-transcript / settings-dark | PASS |
| AC6 first paint uses cached theme | e2e/settings.spec.ts › the first paint uses the cached dark theme | PASS |
| AC7 no network/plugin; capability unchanged (`core:default`) | src/config.test.ts | PASS |
| AC7 strings from keys, parity | src/i18n/i18n.test.tsx › AC6 catalogues, › AC7 (job 006) no literal strings in the settings view… | PASS |
| AC7 axe, no h-scroll, targets ≥24 (≥48 at 1920) in 5 fixtures × 7 sizes; keyboard order + focus ring | e2e/settings.spec.ts › AC7 (35 size tests + section order) | PASS |
| AC7 screenshots | `npm run screenshot` adds settings, settings-device, settings-general, settings-no-model, settings-mic-test, settings-recording, settings-dark, settings-missing, live-mic-missing, live-switched, live-transcript-dark | PASS (smoke test: not run locally, CI runs it) |

## Secure coding
No secure-coding guideline is configured (`docs.secure_coding` is absent). The NFR rules this change touches:
- Privacy, encrypted at rest: settings are sealed with XChaCha20-Poly1305 and the keychain data key. The AAD `MCSETT01|purpose=settings` rejects swapped meeting or transcript records. A marker test shows no value is in plain form, and writes are atomic (temp file plus rename).
- Privacy, stored only on the device: `localStorage` holds only locale and theme. Device names and model ids never go there (component test). The old model key is removed after the move.
- Privacy, audio never written: the microphone test uses a 1 s in-memory sink that is measured and dropped. A test shows nothing reaches STT or the transcript, and no file other than `settings` is written. The test is refused while a meeting records or is paused.
- Privacy, recording indicator always visible: the REC chip shows in the settings view. A switch to the default device keeps `Recording` and shows a notice, and no source starts while off or paused. `halt` closes any source the worker switched to (no orphaned open microphone).
- Security, input validation: `update_setting` takes raw JSON. The key must be known, extra fields are refused, enums are closed, and device names must be connected, ≤256 characters, non-empty and without control characters. Model ids must be in the core's own scan. Errors carry the key only.
- Security, no listening ports and no network: no new crate, plugin or permission. The capability file still holds only `core:default`. The theme boot script is a `'self'` file, so the CSP is unchanged.
- Logging: only error kinds are logged. Log-capture tests check that no device name, model path or value appears.

## Test run
`npm test` → Vitest 140 passed; cargo 121 passed, 2 ignored (keychain, real whisper). Playwright was run separately with `npx playwright test` because port 4173 was taken by another worktree's run during `npm test`: 107 passed.
```
 Test Files  11 passed (11)
      Tests  140 passed (140)
test result: ok. 121 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 17.31s
[105/107] [chromium] › e2e/transcript.spec.ts:175:3 › … a microphone error shows the reason and Resume recording, without a REC chip
[106/107] [chromium] › e2e/transcript.spec.ts:183:3 › … End meeting stops recording first
[107/107] [chromium] › e2e/transcript.spec.ts:191:3 › … recording makes no network request beyond the app's own assets
  107 passed (24.5s)
```
`npm run lint` steps all pass (tsc, eslint, prettier, cargo fmt, clippy -D warnings). Gitleaks scanned 70 commits and found no leaks.
Notes:
- Under heavy machine load (load average around 20 while other worktrees compiled), a few existing Vitest and Playwright tests hit their 5 s and 30 s timeouts. They pass on rerun.
- The built-app smoke test (`tauri build` + `scripts/smoke.mjs`) was not run locally. CI runs it.

## Commits
```
cceb6f3 test(settings): wait for the stored transcript before checking the scroll position
292eb33 docs(agents): settings store, devices, theme tokens and fixtures
0283edc feat(audio): switch to the system default when the chosen microphone is lost
846a79d Merge branch 'main' into factory/006-settings-panel
2827341 feat(settings): dark theme tokens, settings layout, e2e fixtures and specs
d887e2d feat(settings): settings view with Audio, On this device and General
9e952bc feat(audio): choose the microphone, test it, and pass the meeting language
f521925 feat(settings): encrypted SettingsStore with a closed schema
```

## Open points for review
- The speaker-model row (AC5, 004) is not built. When 004 merges, it needs `speakerModel` in the schema (validated against 004's scan), the picker in "On this device", and the diarizer taking the chosen model.
- Frame 01's revised "Assistant settings" card (Transcription row with "Settings ›") is not in the app yet. The app's setup view has no assistant card (later job), so there is nothing that is set in two places.
- Spec open questions are left to the approver: whether the microphone test needs consent (assumed no, because it has its own visible label and keeps nothing), and the opt-in device switch (default is "Stop and tell me").
- The device switch is one per session. If the system default is lost too, recording stops with `MicrophoneLost`. When "System default" is the chosen device, a loss always stops, because there is nothing to switch to.
- Design difference: the speech model is shown as radio cards, as in frame 14d, not as a select (as in the spec text). The input device is a native `<select>` with the frame's icon and status line around it, not the frame's custom list, so it stays keyboard and screen-reader friendly.
