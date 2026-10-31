VERDICT: PASS

## Findings
- [note] src/features/transcript/TranscriptPanel.tsx (WaveStatus) — "Microphone lost" is left to the error notice's alert, so the live region is empty in that state. This is deliberate and avoids a double announcement. Make sure the notice really has role=alert in both the microphoneLost and noMicrophone cases.
- [note] src/ui/SoundWave.tsx — The footer status text carries the meaning in all five states: "Listening", "Paused", "No signal", "Microphone lost" and off. The "No signal" and "Microphone lost" states are shown in text, not by colour alone. The wave is aria-hidden.

## Checked
- I read the diff of SoundWave.tsx, TranscriptPanel.tsx and the de/en keys. I did not run the app, a browser or the tests.
- States against the spec: the wave is flat when paused, off or lost. "No signal" appears after 500 ms without a level event. Under reduced motion, SoundWave swaps to a static level bar. rAF is halted when `document.hidden`. Levels go through refs, not React state.
- New strings live under the footer and wave keys in en.json (and de.json). The mic test is reused in Settings, with a "paused" copy added.
