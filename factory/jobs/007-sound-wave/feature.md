Live sound wave while the app listens (requested by the human): while recording, show a proper animated sound wave / level visualisation so people can see the microphone is picking them up.

- Where: the live view (frame 02) next to the REC chip / in the transcript card footer ("Listening"), and the microphone test in Settings (job 006) can reuse the same component.
- Real level, not a fake animation: driven by the actual input level, smooth (about 30 fps in the UI), responsive to speech vs. silence; flat/quiet when paused; a clear state when the microphone is lost.
- The level must come from the capture side, not the speech thread: after 005 the tick values only advance when the engine finishes a window, so the core needs a level stream from the audio callback/monitor (e.g. RMS or a few band levels every ~33–50 ms), carrying no audio content.
- Respect prefers-reduced-motion (static level bar instead of animation), keep CPU low, works in light and dark theme and at all window sizes.
- Design as a FigCraft frame addition to frame 02 (and the settings test), per the project rule.
