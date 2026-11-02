VERDICT: PASS

## Findings
- [note] src/features/captures/useSuggestions.ts — suggestions arrive by 1 s polling, not an event (build.md explains: `src/config.test.ts` pins the event list). Acceptable; a new card can lag up to 1 s.
- [note] Screenshot live-suggest-de-1280.png: the tab row "Aufgaben 2" has a small clipped dot (pending-tab marker) at the tab edge. Cosmetic only; the dot is not text, and axe/overlap specs pass per build.md.

## Checked
- Spec ACs 4-6 against the UI: SuggestionCard, SuggestionStatus (all off/local/cloud/error lines, none modal, link to settings, top-bar chip with full text kept for screen readers), transcript chips, announce text.
- de.json copy: uses "du", messages name the cause and say suggestions are paused, not broken; the cloud line names Anthropic and that text leaves the device.
- Screenshot live-suggest-de-1280.png: pinned card with three 1-tap actions, highlighted source line with "Beschluss erkannt", cloud status line and top-bar chip match frame 21g. Test evidence in build.md (keyboard, focus, 48 px, axe, 5 viewports) was not re-run.
