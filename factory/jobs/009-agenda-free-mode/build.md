# Build: 009-agenda-free-mode

## Summary
Agenda-free mode without the language model. Frame 01 gets a "With agenda / Agenda-free" switch (toggle buttons with `aria-pressed` and a tick). In free mode the agenda list, budget line and prompt are replaced by the frame 16a explanation and a "N agenda items you typed are kept" note. "Start meeting" no longer needs items there.
The free live view (frame 16) has the same top bar plus "· no agenda" and a "Free mode" chip, the same transcript column, recording and speakers view, and "End meeting" stays where it was (orchestrator note). The left column has the dark whole-meeting timer card (slot, whole minutes left / "N min over · slot ended HH:MM", bar) and "Topics so far" (empty hint, "talking now" tint plus text, minutes, "No topic is current" hint, "Add topic" pinned at the bottom with an inline field, Enter adds, Esc cancels, an error by key, disabled at 100 with a reason). The half-time nudge uses frame 02's dark toast with one "Dismiss".
Stored shape: optional `mode` (`agenda`|`free`) on the meeting and `run.topics[]` = `{ id, title, source: "manual", spans: [{ startedAt, endedAt|null }] }`. Both fields are left out of the JSON when unset or empty, so there is no version bump or migration. Rust validates every rule in AC5. The pure logic is in `src/features/live/free.ts`.
Also changed: below 1200 px the recording controls move to a second row of the top bar (this used to happen below 900 px). At 1024 px the REC chip, device chip and Pause slid under the language switch even in the agenda view, and the new chip would have hidden Pause completely. "Settings" now stays after the language switch when the bar wraps.

## Acceptance criteria
| AC | Test | Result |
|----|------|--------|
| AC1 | src/features/live/FreeLive.test.tsx::"AC1 the With agenda / Agenda-free switch in frame 01" (5 tests: keyboard + pressed state, round trip with items kept, start with zero items opens the free view, agenda mode still blocked by noItems, file without `mode` = agenda); src/features/live/free.test.ts::"AC1 …" (3); e2e/free.spec.ts::"switching back and forth keeps the typed items…"; src-tauri model::tests::a_file_without_mode_loads_as_an_agenda_meeting_and_is_written_back_without_it | PASS |
| AC2 | src/features/live/free.test.ts::"AC2 whole-meeting timer from stored timestamps" (0 %, 49/50/100 %, overrun, late start, started at/after end, recompute after restart); FreeLive.test.tsx::"AC2 the whole-meeting timer card" (4 tests, fake clock) | PASS |
| AC3 | FreeLive.test.tsx::"AC3 the half-time nudge" (no nudge at 49 %, nudge at 50 % without focus, announced once, no repeat after Dismiss, keyboard Dismiss keeps focus, none after a start after the end / once over) | PASS |
| AC4 | free.test.ts::"AC4 topics added by hand" (add, switch, return with minutes adding up, stop, rounding, 100 limit, End closes span); FreeLive.test.tsx::"AC4 + AC5 Topics so far…" (6 tests incl. inline errors by key, Enter on a row, text-only titles); e2e/free.spec.ts::"each topic action is one key press" | PASS |
| AC5 | src-tauri/src/model/mod.rs tests: rejects_an_unknown_mode, rejects_a_free_run_with_run_items, rejects_topics_on_an_agenda_run, topic_titles_are_1_to_200_characters, rejects_more_than_100_topics, rejects_a_duplicate_or_malformed_topic_id, rejects_a_topic_source_other_than_manual, rejects_a_span_before_the_run_or_ending_before_it_starts, rejects_more_than_one_open_span, rejects_an_open_span_after_the_run_has_ended, an_agenda_run_without_items_is_still_rejected, a_free_run_without_agenda_items_is_accepted (+ round-trip and span-count tests); src-tauri/src/lib.rs::a_free_meeting_from_the_ui_is_saved_with_its_topics_and_bad_ones_get_field_errors; free.test.ts::"AC5 the run rules…"; e2e/free.spec.ts::"a running free meeting reopens in the free view with the same current topic and recomputed times" | PASS |
| AC6 | FreeLive.test.tsx::"shows the consent gate before recording, and starts only after confirmation"; e2e/free.spec.ts::"consent first, then transcript lines in the free view, with no foreign request" (fake STT, also opens the speakers view); src/config.test.ts unchanged and passing | PASS |
| AC7 | src/i18n/i18n.test.tsx::"AC7 (job 009) no literal strings in agenda-free mode" (2) + key parity; e2e/free.spec.ts axe / no horizontal scroll / ≥ 24 px for frame 01 free (en, de), the free live view normal, nudge, add error, de, over and empty; tab order for setup and live; e2e/responsive.spec.ts "agenda-free mode at …" (4 sizes) and "free live view in a short window …" (3 sizes); `npm run screenshot` writes free, live-free, live-free-half, live-free-over (+ live-free-empty, live-free-adding, -de) | PASS |

## Secure coding
No secure-coding guideline is configured (`docs.secure_coding` not set). NFR rules this change touches:
- Untrusted input: the Rust core treats `mode` and `run.topics` from IPC as untrusted. `mode` and `source` are strings checked against a closed set, so a bad value is a field error and not a parse failure. Titles are 1–200 characters, ids use the store's id rule, at most 100 topics and 1000 spans per topic, and the span rules of AC5 apply.
- Rendering: topic titles are rendered only as React text. There is no `dangerouslySetInnerHTML`, and a test checks that markup in a title stays text.
- Stored only on the device, encrypted at rest: topics live in the run, inside the existing encrypted `<id>.meeting` file. Nothing new is written anywhere else.
- Recording starts only after the facilitator confirms, and the indicator stays visible: the free view uses the unchanged consent gate, REC chip and transcript store. Tests cover both.
- Nothing leaves the device and no ports are opened: there is no new dependency, plugin, IPC command, permission or network access (`src/config.test.ts` passes). The e2e test finds no foreign request.
- Logs: no new log lines. Topic titles and transcript text are never logged.
- Secret scan: `gitleaks.sh` exits 0 over the branch.

## Test run
`npm test` → vitest 206 passed (16 files); cargo test 176 passed, 3 ignored; playwright 138 passed. The first `npm test` stopped at Playwright because another worktree's preview server held port 4173. I re-ran `npx playwright test` once the port was free, and everything passed. `npm run lint` → exit 0. `npm run screenshot` → 190 passed.
```
 Test Files  16 passed (16)
      Tests  206 passed (206)
test result: ok. 176 passed; 0 failed; 3 ignored; 0 measured; 0 filtered out; finished in 21.11s
  ✓  134 [chromium] › e2e/transcript.spec.ts:131:3 › AC1–AC5 recording with the mock core › consent, start, German and English lines, pause, resume and restart (4.3s)
  138 passed (35.0s)
```

Decisions and deviations worth a look:
- When the half-time nudge shows: it appears from 50 % only while the scheduled end has not passed. If the view is opened again after the end, the nudge does not say "0 min left", because the timer card already shows "N min over". Dismissing it only lasts while the view is open, so after a restart past half time (and before the end) it shows once more, as the spec planned.
- After "Add topic" the field closes and focus goes back to "Add topic", ready for the next topic. If the update fails, the field still closes.
- End times are shown in the locale's format ("11:00 AM" in English, "11:00" in German), the same as the existing "Meeting ends" line.
- Switching modes on a running meeting is ignored (`setMode` returns the meeting unchanged).

## Commits
```
f332146 test(e2e): agenda-free setup, free live view, reload and recording
0a4d602 test(ui): agenda-free mode, timer, half-time nudge and topics
f0695ef feat(ui): free fixtures, screenshots, and a two-row top bar below 1200 px
88e2c0e feat(ui): agenda-free mode switch, whole-meeting timer, half-time nudge and manual topics
f506f44 feat(core): validate agenda-free mode and manual topics
```
