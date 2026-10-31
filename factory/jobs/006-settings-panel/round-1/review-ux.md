VERDICT: PASS

## Findings
- [note] src/features/settings/SettingsView.tsx (SECTIONS) — The speaker-model picker, its "Not found any more" state and the diarizer using the chosen model are not built. The spec allows this because 004 is not merged, and build.md says so. Make sure the follow-up is queued.
- [note] src/features/settings/SettingsView.tsx:~60 — The Escape handler is a window-level listener that skips events with defaultPrevented. A native select closing on Escape could also trigger "Back" in some browsers. Check this by hand once in the Tauri web view. This is non-blocking.
- [note] Copy: the error and empty states give a next step: "Connect it again, or use the system default", the "not saved" and "locked" banners, and the missing-model fallback. Each says what happened, and the missing and switched notices do not rely on colour alone. The copy fits non-technical facilitators. I found no must-fix problems.

## Checked
- Spec ACs 2 to 6 against the code, `build.md` and the en.json keys: entry from the top bar and by keyboard, Back and Escape, focus return, the recording carrying on, the test-microphone states and the device-lost choice.
- Accessibility structure in SettingsView.tsx: tablist with arrow-key, Home and End navigation, labelled rows and cards, a `role=status` banner. The e2e and axe coverage at the listed sizes and the dark theme is claimed in build.md. I did not run the suite or compare against the frame 14 PNG.
