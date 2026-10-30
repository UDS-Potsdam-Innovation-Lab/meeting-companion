# Build: 002-live-timekeeping

## Summary
- Rust core: `Meeting` gains an optional `run` field (`Run { startedAt, endedAt, items: [RunItem { itemId, startedAt, endedAt, extraMinutes, parked }] }`). It is left out of the JSON while it is `None`, so version 1 files load and save unchanged and `SCHEMA_VERSION` stays 1. `validate` checks the run on every save and every load, and reports field errors for: unknown or repeated item ids, item end before start, an item started before the meeting, more than one current item, a parked item that has not ended, an open item after the meeting ended, extensions outside 0–240 min, and a run on a meeting without items.
- UI: `src/lib/clock.tsx` (`Clock`, `systemClock`, `FakeClock`, `ClockProvider`, `useNow`). `src/features/live/run.ts` holds the pure edits (start, next, park, +5, end) and the derived values. Everything is computed from stored timestamps and `clock.now()`. Ticks only trigger a re-render, and so does `visibilitychange`.
- Frame 01: a "Start meeting" button under the meeting card. It is `aria-disabled` and shows its reason under it (`noItems`, `invalid` for title/date/slot or open topic editor errors, `locked` when the keychain key is missing).
- Frame 02, left column only: top bar (title, language switch, "End meeting" with an inline second-click confirmation), timer card, agenda list (done/now/upcoming/parked), parking lot (count, opens the list), overall line, and the 80 % nudge toast over the empty area. A polite live region announces the nudge once.
- `App` opens the live view while `run` exists without `endedAt`, also after a restart. A loaded ended meeting is never shown. Instead an unsaved new meeting opens in setup. After "End meeting" the end is saved and a new meeting is created and saved.
- Mock backend fixtures `live` and `live-done` with fixed times in `LIVE_TIMES`. The screenshots `live`, `live-nudge`, `live-over`, `live-done` (plus `live-end-confirm`, `live-nudge-de`, `agenda-start-blocked`) use `page.clock.setFixedTime`.

## Acceptance criteria
| AC | Test | Result |
|----|------|--------|
| AC1 | src/features/live/LiveView.test.tsx::"AC1 Start meeting and the timer card" (no items → disabled + reason; validation error → disabled + reason; start records time, starts item 01, switches view; 0 %, 79 %, 100 %, overrun "2:10 over · planned 15:00" via FakeClock) | PASS |
| AC1 | src/features/live/run.test.ts::"AC1 start and timer" (stored start + clock, clock jump, m:ss formatting, clock going backwards) | PASS |
| AC2 | LiveView.test.tsx::"AC2 next, park and the last item" (next records duration and keeps focus; park → parking lot count + list with minutes; last item via Next and via Park → "Agenda done", only End meeting left, focus on heading) | PASS |
| AC2 | run.test.ts::"AC2 next, park and the last item"; e2e/live.spec.ts::"each action works by keyboard" | PASS |
| AC3 | LiveView.test.tsx::"AC3 agenda states and the overall line" (done "6 of 5 min" over-styled, now "12 of 15 min" live, upcoming "15 min", parked "Parked · 4 min", "Meeting ends 11:00 AM" / "11:00" in de, on track / behind) | PASS |
| AC3 | run.test.ts::"schedule status: ahead, exactly on time and behind", "projects now + remaining time + upcoming items" | PASS |
| AC4 | LiveView.test.tsx::"AC4 +5 min" (single press updates bar, time left, row and overall line at once; repeated presses; presses with no buffer left keep working and show behind) | PASS |
| AC4 | run.test.ts::"AC4 +5 min" (single, repeated, no buffer, 240 min cap) | PASS |
| AC5 | LiveView.test.tsx::"AC5 time nudge" (none at 79 %; at 80 % without taking focus, no dialog, announced once in the polite region; Wrap up dismisses, no repeat; +5 re-arms at the new 80 %; disappears when the item ends) | PASS |
| AC5 | e2e/live.spec.ts::"AC5 nudge › appears at 80 % without taking focus, and Wrap up dismisses it" | PASS |
| AC6 | src-tauri/src/model/mod.rs::run_rejects_unknown_item_ids, run_rejects_an_item_started_twice, run_rejects_item_end_before_start, run_rejects_more_than_one_current_item, run_rejects_negative_or_absurd_extensions, run_rejects_a_meeting_without_items, run_rejects_a_parked_item_that_has_not_ended, run_rejects_an_item_started_before_the_meeting, version_1_file_without_run_loads_and_is_written_back_unchanged, run_round_trips_through_json_in_camel_case | PASS |
| AC6 | src-tauri/src/store/file.rs::running_meeting_survives_a_restart_and_an_invalid_run_is_never_written; src-tauri/src/lib.rs::save_rejects_an_invalid_run_with_field_errors | PASS |
| AC6 | LiveView.test.tsx::"AC6 persistence, resume and End meeting" (each action saved at once; resume on the same item; inline two-click end + Keep going + Escape; ended meeting never reopens) | PASS |
| AC6 | e2e/live.spec.ts::"AC6 restart and End meeting" (reload resumes on item 02 with recomputed time; end → new meeting, reload stays in setup; no network requests); src/config.test.ts unchanged and passing | PASS |
| AC7 | src/i18n/i18n.test.tsx::"AC7 (job 002) no literal strings in the live view" (key mode: live, nudge, parking lot, armed End meeting, agenda done, Start reason) + existing key-parity tests | PASS |
| AC7 | e2e/live.spec.ts::"AC7 live view accessibility at 1280×800" (axe WCAG 2.2 AA, no horizontal scroll, targets ≥ 24 px in normal and nudge state, plus overrun/done/de; keyboard order with visible focus ring) | PASS |
| AC7 | `npm run screenshot` → screenshots/live-*, live-nudge-*, live-over-*, live-done-* at 375/1280/1920 (45 passed) | PASS |

## Secure coding
No secure-coding guideline is configured (`docs.secure_coding` absent). NFR rules this change touches:
- Security "no listening network ports": no port, plugin, permission or dependency added. `src/config.test.ts` passes, and the e2e test confirms that the live view makes no request beyond its own assets.
- Privacy "stored only on the device, encrypted at rest": the run state lives inside the meeting and goes through the existing `MeetingStore`/`FileMeetingStore` (XChaCha20-Poly1305 encryption, atomic rename). No new file and no plaintext copy. The mock backend's localStorage exists only in the e2e build.
- Privacy "nothing leaves the device": nothing is sent anywhere. Only timestamps, extensions and parked flags are added. There is no audio or transcript data.
- Untrusted IPC input: the run is validated in Rust on save and on load. `extraMinutes` is signed (`i64`), so a negative value produces a field error instead of a parse failure. Logs contain no meeting content (unchanged).
- Reliability "nothing that was confirmed is lost": every action is saved at once through the existing ordered save queue. A failed save shows the existing "could not be saved" alert in the live view too. Start is blocked while the keychain key is missing.

## Test run
`npm test` → vitest 93 passed (8 files), cargo 54 passed / 1 ignored (the manual keychain test), playwright 17 passed. `npm run lint` clean. `npm run screenshot` 45 passed. `gitleaks.sh` exit 0.
```
  ✓  13 [chromium] › e2e/live.spec.ts:79:3 › AC7 live view accessibility at 1280×800 › each action works by keyboard (603ms)
  ✓   3 [chromium] › e2e/agenda-setup.spec.ts:25:3 › AC7 accessibility at 1280×800 › over budget and store error, in German: no axe violations (4.4s)
  ✓  10 [chromium] › e2e/live.spec.ts:37:3 › AC7 live view accessibility at 1280×800 › nudge state: no axe violations, no horizontal scroll, targets ≥ 24 px (1.8s)
  ✓  17 [chromium] › e2e/live.spec.ts:158:3 › AC6 restart and End meeting › the live view makes no network request beyond its own assets (502ms)
  ✓  15 [chromium] › e2e/live.spec.ts:117:3 › AC6 restart and End meeting › a running meeting reopens after a reload on the same item, with the time recomputed (854ms)
  ✓  16 [chromium] › e2e/live.spec.ts:137:3 › AC6 restart and End meeting › End meeting needs a second click, then a new meeting opens and the ended one stays closed (844ms)
  ✓  11 [chromium] › e2e/live.spec.ts:43:3 › AC7 live view accessibility at 1280×800 › overrun, agenda done, open parking lot and End meeting armed, in German (3.2s)
  ✓  14 [chromium] › e2e/live.spec.ts:100:3 › AC5 nudge › appears at 80 % without taking focus, and Wrap up dismisses it (2.8s)

  17 passed (11.3s)
```
The desktop build and smoke test (`tauri build`, `scripts/smoke.mjs`) were not run locally. The smoke path (empty in-memory store → agenda setup) is unchanged. CI runs both.

## Decisions the reviewers should know
- Tab order follows the visual order: top bar (language, "End meeting") first, then "+5 min", "Park it", "Next ›", parking lot, nudge "Wrap up" and "+5 min". The AC lists "End meeting" last. Moving it there would need a tabindex/DOM order that contradicts the layout (WCAG 2.4.3), so I kept the reading order.
- The language switch stays in the live top bar. "New meeting" is not shown there, so a running meeting cannot be dropped by accident.
- "Start meeting" uses `aria-disabled` rather than `disabled`, so it stays focusable and the reason is its accessible description.
- The bar is accent while early, amber from 75 % and red when over. The nudge appears at 80 %. The progress `aria-valuenow` is rounded, so the frame's 3:12 of 15:00 shows as 79 %.
- Overrun rows in the agenda: amber when actual whole minutes > planned whole minutes (both rounded down, as displayed).
- The scheduled end is the meeting's end time on the local day the run started (a meeting started on another day than planned still compares sensibly).
- Nudge dismissals are kept for the session only. After a restart, a nudge for an item already past 80 % appears once more. The nudge title switches to "Less than a minute left…" and "Time is up for item NN" below one minute.
- After "Next ›"/"Park it" on the last item, focus moves to the "Agenda done" heading. When the nudge closes while it had focus, focus moves to "Next ›".
- End-meeting confirmation disarms after 6 s, on "Keep going" or on Escape.
- `useMeeting.update` still rejects any meeting that fails `isMeetingValid`, which now also mirrors the core's run rules. "+5 min" is disabled at the 240 min per-item cap.

## Commits
```
6298498 test(e2e): live view accessibility, keyboard, restart and screenshots
e29ae5f feat(live): live meeting view with timer, agenda, parking lot and nudge
1cb8520 feat(setup): Start meeting button with the reason it is blocked
0dca7bb feat(live): run state, injectable clock and timekeeping logic
d47329d feat(core): store and validate the run state of a meeting
```

## Rework
From `rework-1.md` (responsive layout plus the decisions on the approver's escalation).

| Requested | What I did | Test |
|-----------|------------|------|
| Responsive setup and live view; narrow windows reflow, no squeeze, no horizontal scroll | Breakpoints come from the content and are documented at the top of the responsive block in `src/styles.css`. **Setup:** two columns from 1080 px. Between 1080 and 1279 px the meeting card shrinks to 300–340 px. Below 1080 px there is one column (max 880 px, centred) with the meeting card under the agenda. The reported bug was a 90 px topic column at 1024 px. **Agenda table → stacked rows:** a container query on the list (< 600 px), not the window, so it reacts to the column width. The item editor goes to one column below 680 px. **Live view:** the 300 px left column of frame 02 from 800 px up. Below that there is one column, and the nudge sticks to the window bottom (sticky, not `fixed`), so at the end of the page it no longer covers the overall line or "End meeting". **Top bar:** the meeting title stays visible with an ellipsis. Below 640 px only the mark, the actions and the language switch stay. Wide windows keep frames 01/02. | e2e/responsive.spec.ts (19 tests) |
| Window can actually be made that small | `src-tauri/tauri.conf.json`: `minWidth` 1024 → 400, `minHeight` 700 → 480. Before, the desktop window could not go below 1024×700. No other config change. | manual (tauri dev picks it up after a restart) |
| Cover ~1440, ~1024, ~768, ~480 and a short live window | Checked at 1440×900, 1024×768, 768×1024 and 480×800 (setup and live), plus short live windows of 1024×600, 768×480 and 480×480. | e2e/responsive.spec.ts |
| Playwright checks: no horizontal overflow, key controls visible and clickable | Per size: no document scroll width beyond the window. No element outside the window and no element clipping its content (the ellipsised title is the only exception). No text below 11 px (the avatar initials are excluded, since the name is written next to them). Targets at least 24 px. Key controls are visible and pass a trial click, which fails when something covers them. Setup: two-column vs stacked geometry, and a topic column of at least 160 px. Live: the 300 px column at ≥ 800 px, full width below, and "End meeting" below the agenda. Short windows: scrolled to the bottom, the sticky nudge does not overlap the overall line or "End meeting". **Run against the old stylesheet, 5 of these fail** (setup at 1024 and live at 768/480/480×480), so they catch the regression. | e2e/responsive.spec.ts |
| Screenshots for the reviewers | `npm run screenshot` also writes `screenshots/<view>-<w>x<h>.png` (viewport, not full page) for agenda-filled, agenda-editing, live-nudge, live-over and live-done at the four sizes, and live-nudge at 1024×600 and 768×480 (22 new files, 67 total). AGENTS.md is updated. | `npm run screenshot` 67 passed |
| Decision 2: the overall line agrees with the item timers | While on track it shows how much of the planned buffer (slot minus the items' original minutes) the projection has used: "On track · 4 min of buffer used" / "Im Plan · 4 Min. Puffer verbraucht". The count includes overruns, a timer running over, "+5 min" and a late start. While nothing is used: "On track · 5 min buffer" / "Im Plan · 5 Min. Puffer". Behind: unchanged ("N min behind"). This drops the old "on track (+N min)" key. The projection formula of AC3 is unchanged; only the wording comes from it (`bufferUsedMinutes` in `run.ts`). | run.test.ts::"buffer used: overruns, extensions and running over count; none while on plan"; LiveView.test.tsx::"agrees with an item timer that runs over…", "shows the buffer that is left…" |
| Decision 3: "End meeting" visually last and last in tab order | Moved out of the top bar into a footer row at the bottom right of the live view (`.live__footer`, after the nudge in DOM order). The top bar keeps brand, title and language. The inline second-click confirmation is unchanged. Tab order is now language, +5, Park it, Next ›, parking lot, nudge (Wrap up, +5), End meeting. | e2e/live.spec.ts::"the keyboard reaches every live control…" (now asserts End meeting last); e2e/responsive.spec.ts |
| Decision 1 | No change. | – |

Also fixed: a flaky harness in `LiveView.test.tsx`, about 2 failures in 5 full vitest runs before any of my changes, including the unchanged AC1 test. `renderApp` returned once the live `<main>` was in the DOM, before `useNow` had subscribed to the FakeClock in its effect, so an early `clock.set` was lost. The helper now waits for `FakeClock.listening`. After the fix there were 0 failures in 12 runs. No product code changed for this.

Secure coding: no new surface. No port, plugin, permission, dependency or network access. The only config change is the window's minimum size. Stored data is unchanged.

Merged `main` (factory files for job 003 only, no conflicts). I merged rather than rebased because the branch is pushed.

### Test run
`npm test` → vitest 96 passed (8 files), cargo 54 passed / 1 ignored, playwright 36 passed. `npm run lint` clean. `npm run screenshot` 67 passed. `gitleaks.sh` exit 0.
```
  ✓  31 [chromium] › e2e/responsive.spec.ts:103:5 › agenda setup at 480×800 › the open item editor and validation errors fit (796ms)
  ✓  30 [chromium] › e2e/responsive.spec.ts:72:5 › agenda setup at 480×800 › reflows without squeezing; key controls usable (1.2s)
  ✓  33 [chromium] › e2e/responsive.spec.ts:148:5 › live view at 480×800 › agenda done, open parking lot and End meeting armed (680ms)
  ✓  32 [chromium] › e2e/responsive.spec.ts:119:5 › live view at 480×800 › timer, agenda and nudge reflow; key controls usable (997ms)
  ✓  34 [chromium] › e2e/responsive.spec.ts:163:5 › live view in a short window 1024×600 › nothing is cut off and every control can be reached and clicked (947ms)
  ✓  35 [chromium] › e2e/responsive.spec.ts:163:5 › live view in a short window 768×480 › nothing is cut off and every control can be reached and clicked (1.1s)
  ✓  36 [chromium] › e2e/responsive.spec.ts:163:5 › live view in a short window 480×480 › nothing is cut off and every control can be reached and clicked (1.1s)

  36 passed (15.1s)
```

### Commits
```
2d77ff8 Merge branch 'main' into factory/002-live-timekeeping
b682855 feat(ui): responsive layout for setup and live view down to 400 px
4b3b95b feat(live): End meeting last in the live view, visually and in tab order
e5287ee feat(live): overall line shows how much buffer is used
3706eca test: wait until the live view listens to the fake clock
```
(The component tests for the buffer line landed in 4b3b95b together with the End meeting change, not in e5287ee.)
