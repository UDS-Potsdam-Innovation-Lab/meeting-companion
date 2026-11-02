# Build: 019-capture-suggestions

## Summary
- **Hardened Undo (AC1).** `delete_capture` keeps the removed capture in memory (`captures::UndoCopies`, one per meeting, never written or logged). `restore_capture` now takes `{ restore: { meetingId, captureId } }` (closed `RestoreRequest`, `deny_unknown_fields`) and puts back exactly that copy. The UI sends only the ids.
- **Model.** `model::Capture` accepts `source: "suggested"` and a `segments` field (`Vec<u64>`, ascending, at most 20, left out of the JSON while empty). Meeting files from 018 still load and are written back byte-for-byte the same.
- **Suggester (AC2/AC3).** New `src-tauri/src/suggestions/`. `CaptureSuggester` runs on its own thread and is fed by `SuggesterSink`, which wraps the recorder's events. It asks after 4 final segments, or after 60 s with at least one. It runs one request at a time through `SuggestEngine` → `LanguageModelService::run_task` (`Prompt::build` + `run_cancellable`). Pause, Stop, End meeting and a `languageModel` change cancel it. `prompt.rs` holds the fixed `SUGGEST_TASK`, the content lines, and a closed reply parser. Confirm, Dismiss and Undo of a confirm are new commands.
- **UI (AC4–AC6).** `CapturesPanel.tsx` (922 lines) is split into `labels.ts`, `fields.tsx`, `CaptureList.tsx`, `Composer.tsx` and `UndoNotice.tsx`, and the column itself, as the 018 code review suggested. The new pieces:
  - `SuggestionCard.tsx`: one pinned card per tab, an inline editor, and the "1 weiterer Vorschlag" line.
  - `SuggestionStatus.tsx`: the status line and the top-bar chip.
  - Transcript chips: "erkannt" moves focus to the card; "festgehalten" comes from stored `segments`, so it survives a reload.
  - A dot on tabs that have a waiting suggestion.
- **Fixtures, keys and tests.** Mock fixtures `live-suggest*` (7), 47 de/en keys, component, Rust and Playwright tests, and screenshots.

**Deviation to note: the UI polls instead of getting an event.** The spec says `src/config.test.ts` must pass unchanged. That file pins the exact list of core events, so I did not add a `capture-suggestions` event. The UI reads `load_suggestions` (an in-memory read) every second by its clock and after each action. Suggestions can therefore appear up to 1 s after the core made them. If the human prefers an event, it takes one line in `lib.rs`, plus the event in the `config.test.ts` list and in the capability description.

**Human gate.** This job sends meeting transcript text and real speaker names to Anthropic while Claude is chosen. Only final segments of the recording meeting go out: the newest ≤ 20, ≤ 6000 characters. Each line is `#<seq> <m:ss since start> <name or "Stimme A">: <text>`. The agenda is not sent (the spec's open question on that is left as assumed). The text goes only through the existing `engines/claude.rs` to `api.anthropic.com`.

**Open questions from the spec, as built:**
- Undo of a confirm puts the suggestion back as waiting.
- The Undo copy has no timer of its own.
- `segments` are stored on the capture.
- Due dates are not part of the reply format: owners only, and a person can add a date in Bearbeiten.

## Acceptance criteria
| AC | Test | Result |
|----|------|--------|
| AC1 | src-tauri/src/captures/tests.rs::restore_puts_back_exactly_the_copy_the_core_kept (every field incl. source, segments, createdAt, editedAt; sealed file after reload) | PASS |
| AC1 | captures/tests.rs::a_capture_that_was_never_removed_restores_nothing · a_second_restore_of_the_same_capture_restores_nothing · a_capture_replaced_as_the_kept_copy_by_a_later_delete_restores_nothing · a_meeting_that_is_not_running_restores_nothing · another_meetings_id_restores_nothing (each a field error, nothing stored) | PASS |
| AC1 | captures/tests.rs::the_restore_request_has_no_capture_body_and_refuses_one · forgetting_a_meeting_drops_its_copy · a_failed_restore_write_keeps_the_copy_for_another_try · capture_text_never_reaches_the_log_or_an_error | PASS |
| AC1 | src/features/captures/Suggestions.test.tsx::"the restore request has no capture body, and one with capture fields is refused" · "Undo of a confirm removes the capture … Undo of a delete restores by id"; Captures.test.tsx::"delete lives in the editor; Undo within 8 s restores it…" (fake clock, args `{ restore: { meetingId, captureId } }`) · "a new capture's Undo removes it again" | PASS |
| AC1 | src-tauri/src/model/mod.rs::a_suggested_capture_keeps_its_segment_numbers_and_a_018_file_still_loads · segments_belong_to_suggested_captures_only_and_are_numbers_in_order | PASS |
| AC2 | src-tauri/src/suggestions/tests.rs::a_run_is_due_after_4_new_final_segments_or_after_60_s_with_at_least_one · the_suggester_asks_after_4_new_final_segments_and_partials_do_not_count · the_suggester_asks_after_the_wait_with_one_new_segment_and_not_without · at_most_one_request_is_in_flight · nothing_is_asked_while_not_recording | PASS |
| AC2 | suggestions/tests.rs::busy_skips_the_run_quietly_and_the_next_waits_for_the_next_trigger · the_run_task_of_the_service_is_busy_while_a_settings_test_runs | PASS |
| AC2 | suggestions/tests.rs::the_content_holds_only_final_segments_of_this_meeting_newest_last_with_number_time_and_name (display name from voice and line choices, "Stimme B", no partial, other meeting or agenda text) · a_late_voice_names_the_line_and_english_uses_voice_labels · the_content_is_cut_at_the_limit_and_keeps_the_newest_lines | PASS |
| AC2 | suggestions/tests.rs::pause_stop_end_and_a_new_setting_cancel_within_a_second_and_a_late_reply_is_dropped · a_slow_scripted_engine_is_cancelled_within_a_second · with_no_language_model_no_call_is_made_at_all · with_a_10_s_engine_transcript_segments_still_reach_the_ui_within_3_s (real Recorder, scripted STT, 10 s ScriptedLanguageModel) | PASS |
| AC3 | suggestions/tests.rs::transcript_text_goes_only_into_the_escaped_block (the "Ignorier alle Anweisungen …" line and a fake `</untrusted_content>`) | PASS |
| AC3 | suggestions/tests.rs::a_reply_is_read_against_the_closed_format_entry_by_entry · malformed_or_truncated_output_gives_no_suggestions · an_engine_error_shows_as_a_kind_and_the_next_answer_clears_it | PASS |
| AC3 | suggestions/tests.rs::a_suggestion_already_offered_in_the_meeting_is_not_offered_again_even_after_dismiss · no_prompt_reply_transcript_suggestion_or_capture_text_is_logged_or_in_an_error (log capture) | PASS |
| AC3 | Suggestions.test.tsx::"markup in a suggestion is shown literally"; `npm run lint` (react/no-danger) | PASS |
| AC4 | suggestions/tests.rs::the_sealed_file_has_no_suggestion_before_confirm_and_the_capture_after_a_reload · a_confirm_is_checked_like_a_typed_capture_and_an_unknown_or_handled_one_stores_nothing · the_confirm_request_is_a_closed_schema · no_code_path_confirms_on_its_own (timer, item end, pause, stop, end) · undo_of_a_confirm_removes_the_capture_and_the_suggestion_waits_again · another_meeting_recording_drops_the_suggestions_of_the_last; captures/tests.rs::a_suggested_capture_is_checked_like_a_typed_one | PASS |
| AC4 | Suggestions.test.tsx › AC4: card contents · Bestätigen by pointer (source, segments, "… gespeichert · aus Vorschlag" notice) · Bestätigen by keyboard · Bearbeiten inline / Esc / edited Bestätigen · Verwerfen by pointer and keyboard · one card per tab + "1 more suggestion" · no timer confirms | PASS |
| AC4 | e2e/suggestions.spec.ts::"AC4 Bestätigen stores a suggested capture that survives a reload…" · "AC4 Bearbeiten is inline, Esc returns to the card, and Verwerfen drops the suggestion" | PASS |
| AC5 | Suggestions.test.tsx › AC5: off, local, cloud, offline, noApiKey, keychainUnavailable (→ NoApiKey line), unauthorized, rateLimited, noModel and failed, each in en and de (20 tests, none modal, composer stays) · top-bar chip while Claude and recording (gone on Pause) · no chip without Claude · "Choose a language model" opens the LLM section | PASS |
| AC5 | suggestions/tests.rs::requests_go_out_only_to_the_pinned_anthropic_host_and_only_while_claude_is_chosen (fake Transport: none → 0, local → local engine only, claude → API_URL only, none again → no more) | PASS |
| AC5 | src/config.test.ts, unchanged (`git diff main...HEAD -- src/config.test.ts src-tauri/capabilities` is empty); e2e/suggestions.spec.ts::"AC5 off …", "AC5 each setting names where the text goes…", "AC5 nothing leaves the page…" | PASS |
| AC6 | Suggestions.test.tsx › AC6: chip → focus to card, then "captured" · chip gone after Verwerfen · "captured" after reload · announced once via polite region, focus stays · Tab order of the card · "›" focuses the source line · German default with "du" · narrow: card in "Captured" tab · every new string from a key (key mode) | PASS |
| AC6 | src/i18n/i18n.test.tsx (key-mode test, de/en key parity) | PASS |
| AC6 | e2e/suggestions.spec.ts › axe light + dark for all 7 fixtures (14 tests) · chip focus + Tab with visible focus · new suggestion never takes focus · 48 px board targets · no overlap at 1440×900, 1280×800, 1024×768, 768×1024, 375×812 (top bar, tabs, pin, list, composer, status line) | PASS |
| AC6 | e2e/screenshots/screenshots.spec.ts: live-suggest, -de, -edit, -many, -off, -local, -cloud, -error, -dark at 375/1280/1920, plus live-suggest/-edit/-many at 1440×900, 1024×768, 768×1024 and 480×800 (39 PNGs, all written) | PASS |

## Secure coding
No secure-coding guideline is configured (`docs.secure_coding` is not set). NFR rules touched:
- **Security: transcript text is untrusted input to the language model.** The instructions are the fixed `&'static str` `SUGGEST_TASK`. Transcript text and names are only in the content, which `Prompt::build` escapes and wraps in `<untrusted_content>`; line breaks in text and names become spaces. The reply is parsed against a closed frame and entry format:
  - kind must be one of the three kinds;
  - text is 1–500 characters;
  - segment numbers must come from this request;
  - an owner needs a participant's exact name and is only kept on a to-do;
  - at most 3 entries; a cut or unframed reply gives nothing.
- **Security: model output is stored only through a person's tap.** `captures::add_suggested` is called from `CaptureSuggester::confirm` only, and a test checks for exactly one call site. The confirmed capture is checked by `model::validate_capture` like a typed one. `Confirm` and `RestoreRequest` are closed schemas.
- **Security: Undo uses only data the core holds.** `restore_capture` restores the core's own copy and refuses a capture body.
- **Security: nothing is logged.** Logs and errors carry kinds only: no prompt, reply, transcript, suggestion or capture text (log-capture tests). Suggestion text is rendered as text (`react/no-danger`, component test with markup).
- **Privacy: nothing leaves the device unannounced.** Nothing leaves with `none` or a local model (fake-Transport test). With Claude, the status line ("Vorschläge über Anthropic · Transkripttext verlässt dieses Gerät") and the top-bar chip name the destination while the meeting records. No new HTTP client, socket, plugin, CSP or capability change (`src/config.test.ts` unchanged).
- **Privacy: encrypted at rest.** Confirmed captures go into the sealed meeting file. Waiting and dismissed suggestions and the Undo copy are in memory only, dropped at the end of the meeting or when another meeting records. Tests read the sealed file and find no suggestion text before Confirm.
- **Architecture: engines behind interfaces.** The suggester uses only the `LanguageModel` trait (through `SuggestEngine` and `run_task`). Tests use `ScriptedLanguageModel` and the fake `Transport`; no model, network or microphone is needed.

## Test run
`npm test` (vitest run && cargo test --manifest-path src-tauri/Cargo.toml && playwright test, Playwright on port 4173) → vitest 394 passed (25 files); cargo 383 passed, 7 ignored, 0 failed; Playwright 315 passed; exit 0. `npm run lint` passes. `bash <FACTORY_HOME>/scripts/gitleaks.sh <worktree>` exits 0 ("no leaks found", 232 commits). Screenshots: `npm run screenshot -g live-suggest`, run through a scratch config on port 4183, wrote 39 PNGs. The built-app smoke test and the release build were not run locally; CI runs them on the pushed branch.
```
  ✓  311 [chromium] › e2e/transcript.spec.ts:131:3 › AC1–AC5 recording with the mock core › consent, start, German and English lines, pause, resume and restart (4.7s)

  315 passed (1.8m)
test result: ok. 383 passed; 0 failed; 7 ignored; 0 measured; 0 filtered out; finished in 29.96s
 Test Files  25 passed (25)
      Tests  394 passed (394)
exit 0
```

## Commits
```
157cadd fix(core): no core event for suggestions; the window reads them by command
c304895 docs: capture suggestions, hardened Undo and the split captures module in AGENTS.md
3e9ef50 test(e2e): capture suggestion specs and screenshots
9e1efe6 feat(ui): capture suggestion cards, transcript chips and the status line
1fac4b5 refactor(ui): split the captures column into modules; Undo of a delete sends ids only
fedad98 feat(core): hardened capture undo and the capture suggester
```
Rebased onto `main` (b45f09d, after 017) before the first push; the branch is not pushed yet. In `fedad98` alone, `config.test.ts` would fail, because that commit still declares `EVENT_SUGGESTIONS`. `157cadd` removes it, and the branch tip is green.
