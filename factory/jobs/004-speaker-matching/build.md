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
