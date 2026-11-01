VERDICT: PASS

## Findings
- [note] src/features/help/HelpView.tsx:~97 — On the Help view the top-bar "Help & legal" button only moves focus to the active tab. That is acceptable, and it carries aria-current. No change needed.
- [note] Licence chunk is about 950 KB, loaded only when Legal notes opens. Fine offline.
- [note] Native-library licence IDs were written from memory (see build.md). A person should check them against upstream. This is outside the UX lens.

## Checked
- spec, build.md, profile; HelpView.tsx (tabs with arrows/Home/End, Escape and Back, focus return, "On this page" list that becomes a select when narrow, view underneath stays mounted so REC and timer continue); TopBar help button (icon-only name via aria-label, aria-current).
- de copy for help and troubleshooting: plain, actionable, each troubleshooting entry has an "open settings" button; the facilitator is addressed as "du", consistent with the newer screens.
- Tests cover entry from every view, offline, de/en switch, axe at three widths, 48 px targets and 375 px reflow (per build.md). I did not re-run them.
