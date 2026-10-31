VERDICT: PASS

## Findings
- [note] The new Speaker model card (settings, "On this device") matches the Speech model card above it. It uses the same card, title, hint and label/control layout at 1280 px. At 375 px it stacks cleanly with no overflow (screenshots/settings-device-375.png, settings-device-1280.png).
- [note] At 375 px the long model file name in the picker is cut with an ellipsis ("3dspeaker_speech_campplu…"). The full name shows at 1280 px. This is acceptable.
- [note] Still open from earlier rounds, non-blocking: frame 06 voice playback, confidence figure and save-voice toggle are absent because voice profiles are a follow-up.

## Checked
- Ran `npm run screenshot -- -g settings` (32 passed). Opened settings-device-375.png and settings-device-1280.png (copies in round-3/screenshots/).
- Compared the new card with the existing Speech model and Default meeting language cards for spacing, type scale and tokens. No deviation seen.

## Not judged
- Not rendered this round: the "None found" and "Not found any more" states of the Speaker model card, the dark mode version, and keyboard use of the picker. Contrast was not measured. The speakers view and picker are unchanged since round 2.
