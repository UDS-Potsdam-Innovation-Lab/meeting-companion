# Build: 004-speaker-matching

## Summary
The app now tells voices apart on the device and matches each one to an invited person or a guest. A person confirms every name.
- **Core:** a `Diarizer` trait with a `ScriptedDiarizer` fake, and the real `SherpaDiarizer` (sherpa-onnx `SpeakerEmbeddingExtractor` only). Our own in-memory `VoiceClusterer`/`VoiceTracker` hands out labels `A`–`Z`.
- **Model scan:** a read-only scan finds sherpa-onnx speaker models in `<app_data>/models/` and the Hugging Face cache. It reads only the ONNX top level and metadata.
- **Pipeline:** a final segment reaches the UI at once with its sequence number. Its voice follows as a separate `transcript-voice` event once the record is stored, or the record is stored without a voice after 5 s.
- **Meeting file:** stores voice and line choices and guests (`guest: true`). Name-round suggestions are worked out when asked for and never stored.
- **UI:** frame 06 opens from the "Listening · N speakers" footer, in place of the live view. Transcript lines show the confirmed person, a muted "Voice X", or nobody, and open a non-modal "Who said this?" picker.
- **Stack:** `sherpa-onnx =2.0.1` (static), linked only from a SHA-256-checked archive.

**Merge of main (005-mic-lost-fix), as the coordinator asked.** The branch was never pushed, so I rebased it onto main. The diarizer sits on the speech side of the new two-thread worker:
- The speech thread hands clips to a separate diarizer thread through a bounded queue (8 clips). It stores lines in order as their voices arrive.
- The monitor thread (ticks, `since_last_push` loss detection) never touches the diarizer.
- `a_slow_diarizer_delays_neither_capture_ticks_nor_loss_detection` shows a 4 s-per-segment diarizer delays neither ticks nor loss detection (error within 2 s).

**Deviation from the stack decision (needs a human look).** The build uses `SHERPA_ONNX_LIB_DIR` instead of `SHERPA_ONNX_ARCHIVE_DIR`. With the archive as shipped, onnxruntime crashed on start (`free(): invalid pointer` in `std::regex`) in the same binary as whisper.cpp:
- onnxruntime is built with GCC 11, and whisper.cpp with the local GCC (16 here).
- They share weak `std::__detail` template symbols, and the linker keeps one copy for both.
- The fix: `scripts/sherpa-onnx.mjs fetch` checks the archive against the pin, unpacks it, and on Linux renames the libraries' weak C++ standard-library symbols (`objcopy --redefine-syms`, suffix `.mcsherpa`, type info kept).
- `.cargo/config.toml` points the build at that folder only; without it the build fails instead of downloading.
- `lib/SOURCE` records the pinned checksum, and `verify` checks it.

With this, both real engines work in one binary. I checked this by hand with the 3D-Speaker CAM++ model in the scratchpad: two voices got two stable labels at about 22 ms per segment, and the whisper ignored test passes too.

## Acceptance criteria
| AC | Test | Result |
|----|------|--------|
| AC1 | src-tauri/src/recording/tests.rs::three_scripted_voices_tag_the_final_segments_a_b_and_c | PASS |
| AC1 | src-tauri/src/engines/diarize.rs::short_segments_take_the_previous_voice_only_right_after_it | PASS |
| AC1 | src-tauri/src/recording/tests.rs::labels_stay_across_pause_and_resume_and_continue_after_a_restart | PASS |
| AC1 | src-tauri/src/recording/tests.rs::a_slow_diarizer_does_not_delay_the_transcript_line | PASS |
| AC1 | src-tauri/src/recording/tests.rs::a_segment_whose_voice_does_not_come_is_stored_after_5_s_without_one | PASS |
| AC1 | src-tauri/src/transcript/store.rs::job_003_records_without_a_voice_load_unchanged_and_voices_round_trip | PASS |
| AC1 | src-tauri/src/recording/tests.rs::voice_events_carry_only_the_label; src/features/speakers/Speakers.test.tsx::a voice that arrives later gets its line its voice | PASS |
| AC1 | src-tauri/src/recording/tests.rs::a_slow_diarizer_delays_neither_capture_ticks_nor_loss_detection (merge with 005) | PASS |
| AC2 | src-tauri/src/engines/diarize.rs::vectors_near_three_centroids_form_three_voices, a_vector_below_the_similarity_threshold_opens_a_new_voice, after_26_voices_a_new_vector_joins_the_nearest_voice | PASS |
| AC2 | src-tauri/src/engines/models.rs::a_speaker_model_is_listed_with_id_name_size_source_and_folder, other_onnx_models_ggml_truncated_and_foreign_files_are_not_speaker_models, a_speaker_model_linked_from_outside_the_folder_is_not_listed, the_speaker_scan_never_writes_copies_or_moves_anything, speaker_models_are_searched_in_the_app_folder_and_the_hugging_face_cache_only | PASS |
| AC2 | src-tauri/src/recording/tests.rs::without_a_speaker_model_recording_and_transcription_run_as_before; Speakers.test.tsx::no model: says so and lists the folders searched; the line picker still works | PASS |
| AC2 | src/config.test.ts::AC2 (job 004) the archive check (corrupted / unpinned archive fails); CI step "A corrupted sherpa-onnx archive fails the check" | PASS (CI step runs on push) |
| AC2 | src-tauri/src/engines/sherpa.rs::speaker_detection_with_a_local_model_tells_two_recorded_voices_apart (`#[ignore]`, `-- --ignored speaker`) | PASS by hand (CAM++, 2 voices → A, B; 22 ms/segment) |
| AC3 | Speakers.test.tsx::opens from the footer in the same window…, back to the meeting keeps the transcript where the reader scrolled to, filled…, empty… | PASS |
| AC4 | src-tauri/src/speakers/tests.rs::exactly_one_name_gives_a_suggestion, two_names_from_one_voice_or_one_name_from_two_voices_are_unsure, no_name_no_suggestion…, matching_is_case_insensitive_on_whole_words_with_umlauts_and_sharp_s_as_written, only_the_first_two_minutes…, transcript_text_is_untrusted…, a_suggestion_changes_nothing_until_a_person_confirms_it | PASS |
| AC4 | Speakers.test.tsx::transcript text renders literally and a suggestion changes nothing until confirmed | PASS |
| AC5 | speakers/tests.rs::apply_names_confirms_unique_suggestions…, every_choice_can_be_changed_back, commands_reject_malformed_labels_unknown_voices_participants_and_lines, a_guest_is_a_participant_with_a_trimmed_name_of_1_to_80_characters, the_transcript_file_is_byte_identical_and_choices_survive_a_reload | PASS |
| AC5 | src-tauri/src/lib.rs::a_save_from_the_ui_keeps_the_stored_speakers_and_guests; model tests meetings_without_speakers_load_and_save_unchanged, speakers_round_trip…, guest_names_are_at_most_80_characters | PASS |
| AC5 | Speakers.test.tsx::AC5 choices (voice picker, guest, Apply names, Who said this?); model.test.ts::lines show the confirmed person…; e2e/speakers.spec.ts::voice and line choices, and a guest, are stored in the meeting | PASS |
| AC6 | recording/tests.rs::a_session_with_speaker_detection_keeps_no_embedding_anywhere (only .meeting/.transcript, no marker after decryption, centroids dropped, log capture) | PASS |
| AC6 | speakers/tests.rs::the_transcript_file_is_byte_identical… (no names in logs); src/config.test.ts::AC6 (job 004) … (pin, ureq only a build dep, sherpa only through SpeakerEmbeddingExtractor, capability unchanged) | PASS |
| AC7 | e2e/speakers.spec.ts (axe/layout/24 px for speakers, speakers-empty, speakers-no-model, live-speakers, German; keyboard order; labels) | PASS |
| AC7 | src/i18n/i18n.test.tsx::AC7 (job 004) no literal strings…; catalogue parity | PASS |
| AC7 | `npm run screenshot` adds speakers, speakers-empty, speakers-no-model, live-speakers (+ speakers at the responsive sizes); scripts/smoke.mjs sets MEETING_COMPANION_DIARIZE=fake | PASS (smoke run left to CI, see below) |

## Secure coding
No secure-coding guideline is configured. These are the NFR rules this change touches:
- **NFR Privacy, stored only on device and encrypted at rest.** Voice labels live in the sealed transcript records. Choices and guests live in the encrypted meeting file. Nothing else is written; tests check the file list and that no embedding marker appears.
- **NFR Privacy, voice profiles only on opt-in.** None are made. Embeddings and centroids stay in memory, are kept across Pause and are dropped on stop, meeting end or recorder drop. A restart starts new labels.
- **NFR Privacy, nothing leaves the device.**
  - At runtime: no network, port, HTTP client or plugin. The capability file is still `core:default`.
  - At build time: only the pinned, checksum-verified archive from GitHub Releases. `ureq` appears only as a build dependency of `sherpa-onnx-sys`, and our build never lets it run, because `SHERPA_ONNX_LIB_DIR` is set.
- **NFR Security, transcript text is untrusted.** Name matching only splits text into words and compares them with invited names. The UI renders text as text, and an XSS test string renders literally.
- **NFR Security, input checks.** Core commands reject malformed voice labels, unknown voices, unknown participants, unknown sequence numbers, and empty, too long or duplicate guest names. Errors and logs carry no names or text.
- **NFR Security, model scan.** The scan is read-only. Links are followed only inside the scanned folder, and the core accepts only model ids from its own scan.
- **NFR Architecture, engines behind interfaces.** The UI and `ipc.ts` see voice labels only, never engine types.

## Test run
- `npx vitest run` → 140 passed.
- `cargo test --manifest-path src-tauri/Cargo.toml` → 133 passed, 3 ignored (keychain, whisper, speaker).
- `npm run lint` → clean.
- `npx playwright test` (run locally with a private config on port 4273, because another worktree, 006, holds 4173) → 66 passed, 3 failed. The 3 failures are the existing "no network request beyond its own assets" tests, which hard-code `http://localhost:4173` and so fail on any other port. On the committed config they run on 4173 in CI.
- `npm run tauri build -- --no-bundle` → built.
- Smoke run: not run locally, because `xvfb-run` is not installed and the human asked me not to open windows on the desktop. CI runs it.
- Secret scan: `gitleaks.sh` → no leaks.

```
 Test Files  11 passed (11)
      Tests  140 passed (140)
test result: ok. 133 passed; 0 failed; 3 ignored; 0 measured; 0 filtered out; finished in 18.87s
  ✘ e2e/agenda-setup.spec.ts:137 › the page makes no network request beyond its own assets (port 4273 ≠ 4173)
  ✘ e2e/live.spec.ts:156 › … no network request beyond its own assets (same)
  ✘ e2e/transcript.spec.ts:192 › … no network request beyond the app's own assets (same)
  66 passed (27.1s)
    Finished `release` profile [optimized] target(s) in 19.79s
       Built application at: src-tauri/target/release/meeting-companion
```

## Notes for review
- **Stored shape:** the source is stored as `nameRound | manual` (camelCase like the rest of the file; the spec wrote `name_round`). Every stored voice entry is a person's choice with `confirmed: true`. Suggestions come back from `load_speakers` and are never stored. "Unassigned" is stored as an entry with `participantId: null`, so a rejected suggestion does not come back.
- **Line sequence numbers:** a line's sequence number is its record position. Stored lines get it from their index and live finals carry `seq`. A line can be overridden once its record is stored, which is normally a few ms after it arrives and at most 5 s.
- **Speakers view top bar:** shows only the REC chip plus "Back to meeting", as in the frame. The language switch stays.
- **Footer:** the footer button also shows when recording is off but lines exist, so the speakers view stays reachable after a restart.
- **Frame line 2:** "Remote people come with their Teams / Zoom name" is shown as line 2 of "How names are found", as the spec lists it, although Teams names are a later job.
- **Focus order:** "Jump to latest" moved before the line list in the focus order, because every line now holds a button. `e2e/transcript.spec.ts` now reaches it with Shift+Tab.
- **Local-only files:** `playwright.local*.config.ts` are listed in `.git/info/exclude` and not committed.

## Commits
```
5946255 test(speakers): e2e, screenshots, config checks; diarizer beside the speech thread
dca6bf1 feat(speakers): speakers view, names on transcript lines and Who said this?
c429b2f feat(speakers): name-round suggestions and voice, line and guest choices
edd4690 feat(speakers): diarizer engine, speaker-model scan and voices in the pipeline
de38e22 chore(stack): establish sherpa-onnx 2.0.1 with a checksum-pinned archive
```

## Round 1 response

The pushed branch was updated by merge only: `ce74f59` merged main (no conflicts, factory files only). Nothing was rebased.

| Review item | What I did |
|---|---|
| review-ui [must-fix]: "Who said this?" is cut off by the transcript pane at 1280 and 375 px | The picker is now `position: fixed` and placed by `placePicker` (src/features/speakers/LineSpeaker.tsx). It opens below its line when it fits, else on the side with more room; at the bottom of the pane that means above. It stays clamped inside the window and scrolls inside only if neither side has room. It follows its line when the transcript or window scrolls or resizes, or when the guest form opens. The live transcript stops following new lines while a picker is open, so the line does not move away under it. DOM and focus order are unchanged: the picker still comes right after its button. **Tests:** `src/features/speakers/placePicker.test.ts` (below / flip above / scroll inside / horizontal clamp). `e2e/speakers.spec.ts › every option and Add guest are visible and usable at 1280 px` and `… at 375 px` open the picker on the last line and check that all 8 options are inside the viewport, at least 44 px high, and not covered (hit-tested at their centre). The tests then click "Add guest…", check that the input is focused and inside the viewport, add "Petra Sand", and see the line take the name. Screenshots live-speakers-1280/-375 now show the whole picker opening upward. |
| review-ui [note]: picker options 32 px, board is touch | Picker options, the guest name input and its buttons now have `min-height: 44px` (the e2e test checks the options). |
| coordinator note: error in the live view when a per-line choice fails | The transcript card shows `speakers.failed` ("The choice could not be saved on this device.") as `role="alert"`. **Test:** `Speakers.test.tsx › UI rework: a per-line choice that cannot be saved › says so in the live view`. |
| review-ux [note] / coordinator: why "Apply names to transcript" is disabled | When nothing can be applied, a hint shows under the button: "Nothing to apply: no voice has a name from the name round that waits for confirmation. Unsure voices need a person to pick." (de and en). It is linked to the button by `aria-describedby`. The Apply test asserts the description. |
| review-ui [note]: frame 06 play button, confidence figure, voice-profile toggle | Left out on purpose and kept out, as the coordinator confirmed. The play button needs stored audio, cosine scores are not probabilities, and voice profiles are the separate GDPR Art. 9 job (spec ## Scope, out). |
| review-ui [note]: Who-spoke-when bars are thin | Not changed. Bars are drawn to scale: a 4–10 s line in a 12-minute recording is narrow, with a 3 px minimum. Wider bars would misstate talk time. Can revisit with the UI owner. |
| review-ui [note]: top bar wraps to three rows at 375 px | Not changed: this is shared shell behaviour (TopBar), not this job. |

### Test run (round 1)
- `npm run lint` → clean.
- `npx vitest run` → 145 passed.
- `cargo test --manifest-path src-tauri/Cargo.toml` → 133 passed, 3 ignored.
- `npx playwright test` with the private-port config (4273) → 68 passed, 3 failed. The 3 are the hard-coded-4173 "no network request" tests; once port 4173 was free I ran them with the committed config (`npx playwright test -g "no network request"`) → 3 passed.
- Secret scan: no leaks.

```
      Tests  145 passed (145)
test result: ok. 133 passed; 0 failed; 3 ignored; 0 measured; 0 filtered out; finished in 17.62s
  68 passed (16.3s)   [+ 3 port-only, passed on 4173: 3 passed (3.6s)]
```

### Commits (round 1)
```
dc9ab54 fix(speakers): Who said this? stays inside the window; 44 px options
ce74f59 Merge branch 'main' into factory/004-speaker-matching
```

## Round 2 response

All round 2 reviews passed. This round handles round-2/ci.md and the coordinator's notes. The branch is pushed, so main came in with a merge (`218f04b`); nothing was rebased.

| Item | What I did |
|---|---|
| main moved: 006-settings-panel conflicts (recording/mod.rs and others) | Merged main and resolved 18 files. **Recording:** `run()` now holds all three parts. It keeps 005's speech thread and monitor thread. It keeps 006's `Fallback` (the "switch to the system default" runs on the monitor side and sends `microphone-switched`). It keeps the diarizer thread fed from the speech side. `StartOptions` and the device choice come from 006. A failed source start or open restores the engine, diarizer and voices. `EventSink::voice` is now a default method, like 006's `switched`/`mic_test`. **Log capture:** `log.rs` uses main's mechanism; my tests call it the same way. **UI:** `TranscriptPanel` takes both the speakers props and 006's `onOpenSettings`/`hidden`. The `Feed` keeps the scroll position for both the speakers view and the settings view. `RecordingControls` takes 006's optional callbacks and `DeviceChip`, plus `chipOnly` for the speakers top bar. `useRecording` subscribes to both voice and microphone-switched events. ipc, mock backend, fake core, fixtures and i18n are the union of both sides. **Styles:** I took main's styles.css and appended my rules. 006's style test forbids hex literals outside the token blocks, so I replaced mine with tokens: a new `--green-ink` in light and dark, plus `--line-strong`, `--shadow-small` and `--warn-line`. |
| Wire the speaker model into 006's settings (if small) | It was small, so it is done. **Core:** `Settings.speaker_model` / key `speakerModel` is accepted only if it is in the core's own speaker-model scan (`Catalog::speaker_models`). Stored files without the key load with the preferred model. **Recording:** the recorder loads the chosen model through `StartOptions.speaker_model`; a gone or unset id falls back to the preferred one through `choose_speaker`. The loaded diarizer is kept with its id and reloaded only when the choice changes. **UI:** "On this device" has the Speaker model card from frame 14d: a picker with size and source, "None found" with the folders searched, and "Not found any more" with the model used instead. **Tests:** `settings/tests.rs::the_speaker_model_is_accepted_only_from_the_scan_and_can_go_back_to_preferred`; `recording/tests.rs::the_speaker_model_from_the_settings_is_loaded_and_reloaded_only_when_it_changes`; `Settings.test.tsx › Job 004: the speaker model in On this device (frame 14d)` (3 tests); the existing settings round-trip, defaults, keyMode and axe tests now include the key and the card. |
| CI: "Post Run Swatinem/rust-cache@v2" failed with "No space left on device" | **First step:** "Free disk space (Linux)" removes toolchains this project never uses (dotnet, Android, GHC, CodeQL, PowerShell, Swift) and prunes Docker images; it prints `df` before and after. **Last step:** "Free disk space before the cache is saved" (`if: always()`) deletes what is rebuilt every run anyway: the app's own binary, deps, incremental and bundle output, `dist*`, the unpacked `src-tauri/native/lib`, and Playwright reports. The dependency cache is untouched. **Checksum steps:** unchanged, with the same archive cache, `fetch`, and the corrupted-archive check. No step uses `|| true` or `continue-on-error` (the config test still passes). |
| review-code [note]: duplicated comment in TranscriptPanel.tsx (~124) | Removed. |

### Test run (round 2)
- `npm run lint` → clean.
- `npx vitest run` → 170 passed.
- `cargo test --manifest-path src-tauri/Cargo.toml` → 160 passed, 3 ignored.
- `npx playwright test` with the committed config (port 4173 was free this time) → 117 passed.
- `npm run screenshot -g "settings|speakers"` → 48 passed.
- `npm run tauri build -- --no-bundle` → built.
- Smoke run: left to CI (no `xvfb-run` here).
- Secret scan: no leaks.

```
      Tests  170 passed (170)
test result: ok. 160 passed; 0 failed; 3 ignored; 0 measured; 0 filtered out; finished in 21.23s
  117 passed (26.4s)
    Finished `release` profile [optimized] target(s) in 15.81s
```

### Commits (round 2)
```
e8dcc26 feat(speakers): choose the speaker model in the settings; CI leaves disk for the cache
218f04b Merge branch 'main' into factory/004-speaker-matching
```
