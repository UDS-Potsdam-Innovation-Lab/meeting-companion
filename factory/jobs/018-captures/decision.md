ESCALATE
All checks pass, but the job adds a new kind of stored data (captures in the sealed meeting file), and the profile's approver rule says to escalate anything that changes what is stored.

## Checks
- Tests: not re-run. CI run 41429394429 (workflow CI, branch factory/018-captures) → success, headSha 4b0459f813368fe6c468bc2e82237e81dc8ca9da = worktree HEAD. round-2/ci.md has no commit line, so I checked the commit with `gh run view`.
- Acceptance criteria:
  - AC1 ✓ (captures/tests.rs::a_typed_capture_is_in_the_sealed_file_after_a_reload: reloads FileMeetingStore with MemoryKeyProvider and checks kind, text, owner, due date, item, source "typed" and created_at, and that the text is not readable in the file; a_meeting_file_written_before_this_job_still_loads; Captures.test.tsx "just saved only after the core answered")
  - AC2 ✓ (captures/tests.rs: bad_text, unknown_kind, owner, invalid_due_date, unknown_item_or_topic, capture_id_already_exists, only_a_running_meeting; Captures.test.tsx shows field errors and keeps the text)
  - AC3 ✓ (an_edit_is_written_and_keeps_id_time_and_item; delete_and_undo_restore…; Captures.test.tsx edit/Esc, delete/Undo 8 s and new-capture Undo with the fake clock)
  - AC4 ✓ (markup shown literally in vitest and e2e; capture_text_never_reaches_the_log_or_an_error; capture_edit_and_delete_make_no_language_model_request; src/config.test.ts unchanged)
  - AC5 ✓ (Captures.test.tsx for de default, "du", key mode, Tab order and live region; e2e/captures.spec.ts for axe light/dark, 48 px targets and layouts at 1280/1024/768/375; screenshots for the 5 fixtures)
- Scope / factory files untouched: ✓. Nothing under .claude/ or factory/ changed. No change to package.json, Cargo.toml, the CSP or capabilities, so no new dependency. Changes outside the job are small and explained in build.md: placePicker fix, a timing-tolerant regex in the job-004 i18n test, and TranscriptPanel centre tabs for the narrow layout. All four reviewers PASS in round 2. Only open notes: the deferred restore_capture hardening and the large CapturesPanel.tsx.

## For the human (ESCALATE only)
The profile's approver section says "Escalate anything that changes what is recorded, stored, or sent off the device." This job stores something new: decisions, to-dos and questions with text, kind, owner (participant id), due date, item or topic id, source and timestamps. They go into the encrypted `<id>.meeting` file (optional `captures` field, backward compatible) and are kept until the meeting is deleted. Nothing leaves the device and no model is used.

Your spec review 1 already set "durable storage … Human gate: no" for this job. If that covers it, approve and merge `factory/018-captures` (HEAD 4b0459f).

Also decide whether to accept a follow-up for the security note before job 012 or 019 opens capture commands to other clients. Today `restore_capture` accepts a whole capture from the UI and re-validates it. Before then, the core should hold the removed capture itself or issue a restore token.
