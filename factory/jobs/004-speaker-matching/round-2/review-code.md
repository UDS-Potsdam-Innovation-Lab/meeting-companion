VERDICT: PASS

## Findings
- [note] src/features/transcript/TranscriptPanel.tsx:~124 — the comment "Follow the newest line unless the reader scrolled up." is now duplicated (old line kept above the new two-line comment). Remove one.
- [note] Earlier round-1 notes (Stop/Pause wait up to VOICE_WAIT, Linux-only sherpa lib workaround) still stand; no change in round 2.

## Checked
- Round-2 delta (5946255..HEAD): LineSpeaker.tsx `placePicker` (below / flip above / clamp horizontally / maxHeight scroll), listeners added and removed in the layout effect, state update skipped when unchanged; no loop risk.
- Transcript no longer auto-follows while a picker is open; `speakers.failed` alert shown in the live view; Apply hint wired by aria-describedby. Each has a test (placePicker.test.ts, Speakers.test.tsx, e2e at 1280 and 375 px) per build.md. I did not re-run the suite.
- Nothing under .claude/ or factory/ is touched by code changes (only job files from the orchestrator).
