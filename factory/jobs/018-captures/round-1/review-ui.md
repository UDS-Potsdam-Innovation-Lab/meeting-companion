VERDICT: CHANGES

## Findings
- [must-fix] src/styles.css (composer, sticky at the bottom of the captures column) — at 1280x800 the composer is always fully expanded (kind buttons, field, Who row, Due row, footer = 217 px, measured). The captures list above it gets only ~355 px, and while a card is being edited the editor (Who, Due, Delete / Cancel / Save) is cut off: the editor shows only its title, kind buttons, field and the first Who row, and its action buttons are not visible without scrolling inside the list (screenshots/vp-live-captures-edit-1280-light.png). Frame s21c_edit.png shows the composer collapsed to a one-line field while the editor is open, so the whole editor with Löschen/Abbrechen/Speichern is in view. → Collapse the composer to kind buttons + one-line field (hide Who/Due rows until it is focused or has text) while an inline editor is open, or generally when the field is empty and unfocused; the editor's action row must be visible without scrolling at 1280x800.
- [must-fix] src/styles.css (narrow layout < 800 px, sticky composer) — at 375x812 the "Festgehalten" tab content is hidden behind the sticky composer (216 px) and the time-up nudge: in screenshots/vp-live-captures-375-light.png the kind tabs and every card sit under the composer; only a sliver of the tab bar shows. Frame s21k_375.png has timer compact, the captures card filling the screen and the composer below it. → At < 800 px reserve space for the composer (bottom padding on the scroll area equal to the composer height) and keep the nudge from covering the captures; collapse the composer as in finding 1. Needs the captures card to be readable when "Festgehalten" is opened, without scrolling past the whole agenda first (or scroll it into view when the tab opens).
- [note] screenshots/live-captures-1280.png — the first card is cut by the composer with no visible hint that the list scrolls (design s21_captures shows a free gap between cards and composer). A bottom fade or a visible scrollbar would help.
- [note] Dark mode (screenshots/live-captures-dark-1280.png, vp-live-captures-375-dark.png): tokens hold, no contrast issue seen; the active Decision pill border and the green Beschlossen chip read clearly.
- [note] 768 px and 1024 px (not drawn) use the narrow tab pattern as decided; no horizontal overflow at 375, 768 or 1280 (scrollWidth equals innerWidth, measured).

## Checked
- Rendered the build (own preview on port 4181) with the e2e fixtures: screenshots/live-captures{,-de,-saved,-edit,-deleted,-empty,-error,-dark}-{375,1280,1920}, 480/768/1024/1440 sizes, live-free-captures; copied to round-1/screenshots/. Opened live-captures-1280, live-captures-375 (full page), live-captures-edit-1280, and viewport shots vp-live-captures-375-light/-dark, vp-live-captures-edit-1280-light.
- Compared against design/screens/s21i_1280, s21_captures, s21c_edit, s21k_375: kind pill colours, card anatomy (kind badge, time, edit icon, owner, due chip), tabs with counts, group label, composer chips and footer match the language; deviations are the two above.
- No horizontal overflow at 375/768/1280.

## Not judged
- Hover/focus/click-through of the new controls beyond what the fixtures render (the builder's e2e covers keyboard/axe; I did not re-run them).
- Contrast numbers: judged visually only, not measured.
