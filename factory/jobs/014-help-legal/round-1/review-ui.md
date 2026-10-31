VERDICT: PASS

## Findings
- [note] Top bar at 375 px (help-375.png): the "On-device · DE/EN" chip wraps to its own row under "Back to setup", so the bar is four rows tall. The same layout is not new in this job and nothing is clipped. Optional: tighten it later.
- [note] The F1 shortcut is shown in the design frame (s19_help.png) but not bound, by design (design.md). The built list correctly omits it.
- [note] Dark mode: the "Back to settings" button turns white (help-live-dark-1280.png). This is consistent with the app's token set and reads as the primary action. No change needed.

## Checked
- I opened the builder's `npm run screenshot` output (same day, from the worktree): help-1280, help-375, legal-375, help-live-dark-1280. I compared them with design/screens/s19_help.png. The layout matches: left rail with tabs and "On this page", cards, icon chips, troubleshooting buttons, collapsed licence rows, and the select at 375 px.
- Hierarchy is clear (h1, card h2, item titles). There is no overflow or horizontal scroll at 375 px. Long paths wrap. The organisation block, the no-organisation placeholder and the bad-organisation notice are all visible. The REC chip stays visible in the live dark view.
- Icon-only help button at 375 px has `aria-label` and `title` (TopBar.tsx:88-89). Colours come from the existing tokens. Builder's e2e axe checks (light and dark, three widths) are reported as passing.

## Not judged
- I did not re-render the screenshots myself or click the controls. I relied on the existing screenshots and on the reported Playwright results. I did not open the 1920 px, German or 768 px variants.
