VERDICT: CHANGES
## Findings
- [must-fix] src/styles.css:4030-4045 and 4902-4910 — At 375 px (en) the "To-dos" tab breaks into "To-" / "dos" when it carries the waiting-suggestion dot, and "Decisions 1" runs to the pill's edge (screenshots/live-suggest-375.png, third tab row). The tab is a flex row with gap 8px, 8px side padding and the dot's extra 6px margin in a 1/3-width column; there is no `white-space: nowrap`. The approved frame s21l_375_suggest.png keeps every label on one line next to the dot. → Keep the label, count and dot on one line: `white-space: nowrap` on `.capture-tabs__tab`, drop the dot's `margin-left` (the gap already spaces it) or position the dot absolutely at the corner, and reduce side padding or gap below 480 px. Re-shoot live-suggest-375 (en and de) and check that no tab wraps.
- [note] Top bar at 375 px (live-suggest-375.png, live-suggest-de-375.png): the cloud chip "Anthropic (cloud)" adds a fourth stacked row of header controls (chip + language switch, Settings, REC + engine chip, Pause). Frame s21l_375_suggest.png has a compact two-row header. Probably most of this comes from 018/017 header wrapping, but the chip makes it worse. Consider moving the chip onto the REC row or hiding it below 480 px since the status line under the composer already says "Cloud".
- [note] 1280 px: the top-bar chip sits left of REC (live-suggest-cloud-1280.png); in s21g_suggest.png it sits right of the "On device · DE/EN" chip, next to Pause. Both read fine, so no change is requested.
- [note] German 375 view (live-suggest-de-375.png) shows English suggestion and line text ("Beta launches on 14 Nov without offline mode"). Fixture data only, not a defect.
- [note] Pinned card at 1280 matches s21g (accent border, kind chip, "From the transcript" link, Confirm filled, Edit and Dismiss outlined). The "1 more suggestion shows once this one is done" line (live-suggest-many-1280.png) and the editor (live-suggest-edit-1280.png) also match s21f/s21h. Dark (live-suggest-dark-1280.png) uses the tokens, and the chip and card text are readable.

## Checked
- Rebuilt the e2e bundle, served it on port 4190 and re-ran the suggestion screenshot specs into round-1/screenshots/ (39 files, 39 passed). I opened live-suggest-cloud-1280, live-suggest-edit-1280, live-suggest-many-1280, live-suggest-dark-1280, live-suggest-375 and live-suggest-de-375 and compared them with design/screens s21g, s21h, s21f, s21n, s21l.
- Read the tab, dot and card CSS in src/styles.css. Colours come from tokens.

## Not judged
- Hover/focus/disabled states and a real click-through of Confirm/Edit/Dismiss were not exercised. The status line states "off" and "error" (live-suggest-off/error) and s21s_states.png were not opened. Contrast was judged by eye, not measured.
