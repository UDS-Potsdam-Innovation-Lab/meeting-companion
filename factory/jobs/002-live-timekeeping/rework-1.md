# Rework after round 1 (human)

When the app window is made smaller, the content gets squeezed instead of adapting. The UI must be responsive.

- Both screens: meeting setup (agenda) and the live meeting view.
- Narrow windows reflow instead of compressing: multi-column layouts stack into one column, nothing gets cut off or overlaps, no horizontal scrolling, text stays readable and controls keep usable target sizes.
- Wide windows keep the frame 01/02 layout.
- Pick breakpoints from the layout itself and cover at least ~1440, ~1024, ~768 and ~480 px wide windows (and a short window height for the live view).
- Add Playwright checks at those widths (no horizontal overflow, key controls visible and clickable) and screenshots for the reviewers.

## Decisions on the approver's escalation (human, 2026-10-30)

1. Stored data: the optional `run` field is accepted as is; SCHEMA_VERSION stays 1.
2. Overrun line: the overall line must agree with the item timers. When an item runs over and the buffer absorbs it, show buffer use, e.g. "On track · 2 min of buffer used" (German string too).
3. Tab order: place "End meeting" visually last in the live view, so it is also last in tab order (keeps WCAG 2.4.3 and matches AC7).
