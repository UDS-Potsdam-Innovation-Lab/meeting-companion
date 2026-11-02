# Build: 018-captures

## Summary
Quick capture in the right column of frames 02 and 16, following frames 21. The core stores captures in the sealed meeting file: `model::Capture`, a closed schema with `deny_unknown_fields` and `source: "typed"`, checked by `model::validate_capture`. Five commands in `src-tauri/src/captures/` handle them: `load_captures`, `add_capture`, `update_capture`, `delete_capture` and `restore_capture`. The core makes the id and the time, answers only after the file is written, keeps the stored captures when the UI saves the meeting, and never logs capture text. Meeting files without `captures` load unchanged.

The UI part lives in `src/features/captures/`. It has kind tabs with counts, cards grouped by item or topic (running item first, newest first), the inline editor (Delete is only in there), the 8 s Undo notice for save and delete (timed by the clock), and the composer. The composer has kind buttons, `/d` `/t` `/q`, owner and date chip rows (no popovers, "More (n)" past 6 people), the target line and Enter to save. "just saved" shows only after the core answered. Each row in the left column shows its counts ("1 decision · 2 to-dos"), in Topics so far too.

Below 1200 px the list becomes the centre card's second tab "Captured n", and the composer sticks to the bottom of the window. I chose 1200 px because a third column below that leaves the transcript under 470 px, so 1024 px uses the tab pattern as the design allows.

Mock fixtures are `live-captures`, `-empty`, `-edit`, `-error` and `live-free-captures`. `&theme=dark` now works for every fixture. All new strings have de and en keys, and the German copy uses "du".

Changes outside the job's own files, each needed to keep existing checks green:
- **`placePicker` (speakers).** A "Who said this?" picker that fits the window but fits neither side of its line is now moved up until it is whole. Before, it scrolled inside. The sticky composer changed the 375 px geometry, and `e2e/speakers.spec.ts` requires every option to be visible. Unit test added.
- **`src/i18n/i18n.test.tsx` (job 004 key-mode test).** It now accepts the `noSignal` footer word as well as `listening`. That word appears after 500 ms of *real* time (`useNoSignal`), and with the extra column the full run passed that point. The test checks keys, not timing, so it still tests the same thing.
- **`captures/tests.rs`.** It does not spell out the HTTP client crate's name, because `src/config.test.ts` (unchanged) pins that word to `engines/claude.rs`.

## Acceptance criteria
| AC | Test | Result |
|----|------|--------|
| AC1 saved to sealed file, reload finds all fields | src-tauri/src/captures/tests.rs::a_typed_capture_is_in_the_sealed_file_after_a_reload | PASS |
| AC1 free mode: running topic / no topic | captures/tests.rs::a_free_meeting_captures_to_the_current_topic_or_to_no_topic; src/features/captures/Captures.test.tsx::"in agenda-free mode a capture goes to the running topic, otherwise to No topic"; e2e/captures.spec.ts::"agenda-free: captures go to the running topic…" | PASS |
| AC1 old files without `captures` load | captures/tests.rs::a_meeting_file_written_before_this_job_still_loads; model::tests::captures_round_trip_in_camel_case_and_are_left_out_while_empty | PASS |
| AC1 UI saves keep stored captures | captures/tests.rs::a_save_from_the_ui_keeps_the_stored_captures | PASS |
| AC1 Enter saves, field clears + keeps focus, tab and left counts go up | Captures.test.tsx::"Enter saves a decision to the running item…"; "/t switches kind and tab…" | PASS |
| AC1 shown as saved only after the core wrote | Captures.test.tsx::'shows the capture and "just saved" only after the core answered' | PASS |
| AC1 durable across reload (mock core) | e2e/captures.spec.ts::"AC1 + AC3 a capture survives a reload…" | PASS |
| AC2 empty/whitespace, >500 after trim | captures/tests.rs::bad_text_is_refused_and_nothing_is_stored; Captures.test.tsx::"an empty or too long text is refused…" | PASS |
| AC2 unknown kind | captures/tests.rs::an_unknown_kind_is_refused; Captures.test.tsx::"maps the core's field codes…" | PASS |
| AC2 owner not a participant / not a to-do | captures/tests.rs::the_owner_must_be_a_participant_and_only_on_a_todo | PASS |
| AC2 invalid due date | captures/tests.rs::an_invalid_due_date_is_refused | PASS |
| AC2 unknown item/topic, duplicate id | captures/tests.rs::an_unknown_item_or_topic_is_refused; a_capture_id_that_already_exists_is_refused | PASS |
| AC2 meeting not running | captures/tests.rs::only_a_running_meeting_takes_captures | PASS |
| AC2 closed schema | captures/tests.rs::the_input_schema_is_closed; model::tests::captures_need_a_run_unique_ids_and_valid_fields | PASS |
| AC2 error by key next to the field, text kept, no modal | Captures.test.tsx::"a write the core could not do says so; the text stays"; e2e/captures.spec.ts::"AC2 a refused save…" | PASS |
| AC3 edit inline, Esc/Cancel unchanged, Save writes (reloaded file) | captures/tests.rs::an_edit_is_written_and_keeps_id_time_and_item; Captures.test.tsx::"edit opens inline; Esc leaves…" | PASS |
| AC3 delete only in editor, Undo 8 s restores id/time/item | captures/tests.rs::delete_and_undo_restore_the_capture_with_its_original_id_time_and_item; Captures.test.tsx::"delete lives in the editor; Undo within 8 s…" (FakeClock) | PASS |
| AC3 Undo of a new capture, notice gone after 8 s, counts follow | Captures.test.tsx::"a new capture's Undo removes it again; the notice goes after 8 s" | PASS |
| AC4 markup shown literally | Captures.test.tsx::"markup and script are shown literally"; e2e/captures.spec.ts::"AC4 markup…"; captures/tests.rs::markup_in_capture_text_is_stored_verbatim | PASS |
| AC4 no capture text in logs or errors | captures/tests.rs::capture_text_never_reaches_the_log_or_an_error | PASS |
| AC4 config.test.ts unchanged and passing | src/config.test.ts (no diff) | PASS |
| AC4 no LanguageModel request | captures/tests.rs::capture_edit_and_delete_make_no_language_model_request | PASS |
| AC5 de/en keys, de default, "du", key mode | Captures.test.tsx::"is German by default and uses du"; "empty column, cards, editor, error and notice show only keys and user data"; src/i18n/i18n.test.tsx (all live views) | PASS |
| AC5 single taps, Enter saves, Esc cancels, Tab order with visible focus | Captures.test.tsx::"Tab reaches every control of the composer in order…"; e2e/captures.spec.ts::"AC5 the keyboard reaches tabs, cards, the notice and the composer with a visible focus" | PASS |
| AC5 announced once via the polite live region | Captures.test.tsx::"announces a saved capture once through the polite live region" | PASS |
| AC5 axe light and dark, 5 fixtures | e2e/captures.spec.ts::"AC5 axe reports no violations…" (10 tests) | PASS |
| AC5 ≥ 48 px targets at 1920×1080 | e2e/captures.spec.ts::"AC5 a kind is one tap and Enter saves; the board has 48 px targets" | PASS |
| AC5 layout at 1920/1440/1280 (3 columns) and 1024×768, 768×1024, 375 (centre tab + sticky composer) | e2e/captures.spec.ts::"AC5 the column lays out without overlap" (6 tests); e2e/responsive.spec.ts; Captures.test.tsx::"below 1200 px the captures are the centre card's second tab…" | PASS |
| AC5 screenshots | `npx playwright test --config playwright.screenshot.config.ts -g captures`: 35 screenshots (live-captures, -de, -saved, -edit, -deleted, -empty, -error, live-free-captures, -dark at 375/1280/1920, plus live-captures and -edit at 1440×900, 1024×768, 768×1024, 480×800) | PASS |

## Secure coding
No secure-coding guideline is configured (`docs.secure_coding` is not in the profile). The rules from AGENTS.md and the NFRs that this change touches:
- **Untrusted text is rendered as text only.** Capture text is rendered through React text nodes only, with no `dangerouslySetInnerHTML` (`react/no-danger` holds). Tested with `<img onerror>`, `<script>` and `<b>` in vitest and Playwright.
- **The core validates every input.** Closed schema (`deny_unknown_fields` on `Capture`, `NewCapture` and `CaptureChange`). The id and time come from the core. Restore re-validates the whole capture, including its id, source and trimming. Length is limited to 500 characters and the list to 2000 captures.
- **No content in logs.** `CaptureError` carries field names and codes only. The only log line is the store error kind. A log-capture test checks this.
- **Encrypted at rest.** Captures live inside the sealed `<id>.meeting` file (XChaCha20-Poly1305). A test checks that the plaintext is not in the file.
- **No network, no new plugin, no CSP change, no language model.** The captures module imports no engine. `src/config.test.ts` is unchanged and passes.
- **Ids used in file names.** Capture ids are never used in paths. Their format is still restricted (`is_valid_id`), and new ids are `c-` plus 64 random bits.
- **Secret scan.** `gitleaks.sh` over the branch history: no leaks found.

## Test run
`npm test` → vitest 321 passed (24 files); cargo test 345 passed, 7 ignored (the existing `#[ignore]` real-model and keychain tests); Playwright 285 passed. `npm run lint` is clean (tsc, ESLint, Prettier, cargo fmt, clippy `-D warnings`).
```
 RUN  v5.0.5 /home/uds2027/code/meeting-companion/.worktrees/018-captures
 Test Files  24 passed (24)
      Tests  321 passed (321)
test result: ok. 345 passed; 0 failed; 7 ignored; 0 measured; 0 filtered out; finished in 25.64s
  ✓  283 [chromium] › e2e/transcript.spec.ts:176:3 › AC1–AC5 recording with the mock core › a microphone error shows the reason and Resume recording, without a REC chip (393ms)
  ✓  278 [chromium] › e2e/transcript.spec.ts:52:3 › AC7 transcript accessibility at 1280×800 › error state and no speech model (2.4s)
  ✓  284 [chromium] › e2e/transcript.spec.ts:184:3 › AC1–AC5 recording with the mock core › End meeting stops recording first (386ms)
  ✓  285 [chromium] › e2e/transcript.spec.ts:192:3 › AC1–AC5 recording with the mock core › recording makes no network request beyond the app's own assets (1.1s)
  ✓  281 [chromium] › e2e/transcript.spec.ts:131:3 › AC1–AC5 recording with the mock core › consent, start, German and English lines, pause, resume and restart (4.4s)

  285 passed (1.3m)
```
Not run locally: the release build, smoke test and ggml-check. No native code or dependencies changed; CI runs them.

## Commits
```
7db29dc docs: captures module, fixtures and narrow layout in AGENTS.md
10dc87a test(e2e): capture fixtures, specs and screenshots
9be55a0 fix(speakers): show a picker whole when it fits the window
eda9f48 feat(ui): captures column with quick capture, edit, delete and Undo
770ac2f test(core): name no HTTP client in the captures source check
67168fc feat(core): store captures in the sealed meeting file
```

Notes for review:
- **Edit and Undo.** An edit keeps the original item or topic (open question 3 of the spec). Edits have no Undo notice: the spec asks for one only after a save and after a delete. Esc or Cancel discards an edit.
- **Narrow windows.** Below 800 px, `fullPage` screenshots show the sticky composer over the list. That comes from how a full-page capture handles sticky elements. The window-sized screenshots (`live-captures-768x1024.png`, `-480x800.png`) show the real layout.
- **Shared scratch files.** Job 020's builder writes to the same scratchpad and uses port 4173. One full-suite log was overwritten by its run, and I re-ran the suite with a job-specific log name. If CI or a reviewer runs two worktrees' Playwright suites at once, they will fight over port 4173.

## Round 2 response

Reviews in `round-1/`: security, code and ux PASS; ui CHANGES with two must-fix items and one note. CI run 41427707411 (round 1) passed.

| Requested change | What I did |
|---|---|
| ui must-fix 1: at 1280×800 the editor's Löschen/Abbrechen/Speichern were cut off under the always-open composer (frame s21c) | Done. At rest the composer shows only the kind buttons and a one-line field (frames 21s "Rest" and 21c). The Wer/Bis rows, the target line and Save appear when the composer gets focus or a tap, or while it holds a draft. While a card's inline editor is open the composer stays closed, and a draft is kept. Opening the editor scrolls its action row into the list's view (`scrollIntoView` nearest, clear of the bottom fade). The open/close change waits until a tap's click has finished: the composer is pinned to the bottom, so resizing it during a tap would move the button under the pointer. A Playwright run caught this for the kind buttons and for Undo. The `editing` state moved into `useCaptures` so the composer can read it. On the board, the one-line field keeps 48 px. |
| ui must-fix 2: at 375×812 the "Festgehalten" tab content was hidden behind the sticky composer and the time-up nudge (frame s21k) | Done. Below 800 px, opening "Festgehalten" scrolls the centre card to the top of the window. The card then fills the window above the composer (`100dvh` minus the measured composer height) and the list scrolls inside it. The resting composer is about 110 px instead of 216 px. While "Festgehalten" is open, the nudge stays in the page flow below the card instead of sticking over it. The timer card still shows the overrun, and the nudge sticks as before on the transcript tab. |
| ui note: no hint that the list scrolls | Done. The list fades out over its last 20 px and has matching bottom padding, so the end of the list is never faded. |
| ui notes on dark mode and 768/1024 | No change needed. |
| code note: `CapturesPanel.tsx` is large | Declined for now. Splitting the composer and editor fits better with job 019, which adds suggestion cards next to them. |
| security note: `restore_capture` takes the whole capture from the UI | No change, as the reviewer suggested. It is local IPC only and fully re-validated. Before job 012 or 019 opens capture commands to other clients, the core should hold the removed capture or issue a restore token. |

New checks:
- `e2e/captures.spec.ts` › "round 2 (UI review)", 3 tests:
  - At 1280×800 with an editor open, the composer is at rest, and Löschen, Abbrechen and Speichern are inside the window, not covered (checked with `elementFromPoint`) and above the composer.
  - At 375×812, both while running and with the time-up nudge (`LIVE_TIMES.over`): the kind tabs and the first card are in the window and not covered, the card ends above the composer, and the last card can be scrolled into view uncovered.
- `src/features/captures/Captures.test.tsx` › "round 2: the composer rests as one line…": the rest state, opening with focus, a draft keeping it open, and an editor closing it.
- The AC4 network check in `e2e/captures.spec.ts` now compares against the page's own origin instead of a fixed port.

Test run: `npm run lint` is clean. `npm test` (job-specific log; port 4173 was free) gives vitest 322 passed, cargo 345 passed and 7 ignored, Playwright 288 passed. The capture screenshots were re-run (35 passed). Not pushed.

Commit: `4b0459f fix(ui): resting composer and a readable captures tab on narrow windows`.
