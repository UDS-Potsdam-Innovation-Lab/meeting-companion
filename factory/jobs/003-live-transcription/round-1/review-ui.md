VERDICT: PASS

## Findings
- [note] Frame 02 shows speaker avatars/names, "Decision detected" tags, a Search tab and Mind map/Notes tabs; the build shows a single "Transcript" tab and plain lines with HH:MM. Fits the spec (no diarization or detection in this job); not a deviation to fix.
- [note] Header at 375 px stacks language switch, REC/On-device chips and Pause over three rows (live-transcript-375); usable, no overflow, but tall. Taste only.
- [note] Pause is an outlined button, where frame 02 has a filled neutral one; same position and weight, minor.

## Checked
- Ran `npm run screenshot` (93 passed); opened live-transcript-1280/375, live-consent-1280, live-paused-1280, live-mic-error-375, live-no-model-375 against design/screens/s2_live.png. REC chip (red dot, text, time), On-device chip, Pause/Resume, partial "speaking…" in muted text, level meter footer all match the frame's style and tokens.
- No horizontal overflow or clipping at 375 px; long folder paths wrap in the no-model state; error card has a fix (Resume recording); disabled Start has the hint "Tick the box first."; paused meter is visibly static/grey.

## Not judged
- 1920 px board shots, dark mode (app has none), hover/focus states by pointer (axe/keyboard covered by the build's e2e, not re-run).
