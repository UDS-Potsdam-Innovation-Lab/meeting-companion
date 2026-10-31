VERDICT: PASS

## Findings
- [note] src/features/live/TopicsCard.tsx:76 — Tapping the current topic stops it; this is only discoverable via the "No topic is current" hint afterwards. Acceptable (one tap, undoable by tapping again).
- [note] src/features/live/TopicsCard.tsx:~108 — After "Add", the field closes and focus returns to "Add topic": good for adding several topics in a row.

## Checked
- Spec ACs 1-7 against build.md and the UI code: mode switch (aria-pressed plus tick), free setup explainer and kept-items note, timer card (text "min over", not colour only), non-modal half-time nudge with a single Dismiss.
- Topics card: empty state, inline add with errors by key, Enter and Esc, 100-topic limit with a reason, "talking now" shown as text. de and en keys are in parity, with copy suited to non-technical users.
- Did not run the app. I relied on the build's reported test results (vitest, cargo, Playwright with axe and tab order).
