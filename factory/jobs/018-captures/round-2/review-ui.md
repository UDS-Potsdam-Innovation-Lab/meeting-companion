VERDICT: PASS

## Findings
- [note] Round 1 must-fix 1 fixed: at 1280x800 the composer rests at 108 px (kind buttons + one-line field, as in s21c_edit); with the editor open its action row (Loeschen / Abbrechen / Speichern) ends at y=515 and the composer starts at y=615, all in view (screenshots/r2-1280-edit.png). The composer opens to 216 px on focus (measured) without overlap.
- [note] Round 1 must-fix 2 fixed: at 375x812 "Festgehalten" opens with tabs, group label and the card fully visible above the composer (screenshots/r2-375-tab.png, r2-375-nudge.png), matching s21k_375. No horizontal overflow at 375 or 1280 (scrollWidth = innerWidth).
- [note] Round 1 notes: the bottom fade hint on the list is visible at 1280 with several cards (r2-1280-edit.png); dark mode holds (r2-1280-dark.png, r2-375-tab-dark.png).

## Checked
- Own preview on port 4192 (stopped afterwards), live-captures fixtures at fixed clock, de locale; opened r2-375-tab, r2-375-nudge, r2-1280, r2-1280-edit; also rendered r2-1280-focus, r2-1280-dark, r2-375-tab-dark (screenshots/).
- Compared with design/screens/s21c_edit.png and s21k_375.png: resting composer, editor visible whole, captures card filling the narrow window match.

## Not judged
- The time-up nudge did not appear in my 375 shot (clock not advanced past the threshold); the builder's e2e covers that case, I did not re-run it.
- Contrast not measured numerically.
