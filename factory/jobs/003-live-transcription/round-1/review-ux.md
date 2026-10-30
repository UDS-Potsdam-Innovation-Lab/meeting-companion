VERDICT: PASS

## Findings
- [note] src/features/transcript/TranscriptPanel.tsx:~190 — The "Start recording" button is disabled until the box is ticked. A visible hint (`consent.hint`) explains why, so this is fine. If no speech model is installed, the facilitator can still tick and press Start, and only then sees "No speech model installed". The model picker area shows this up front, so it is acceptable. Disabling Start when the scan found no model would save a tap.
- [note] The error text for `microphoneLost` ("The microphone stopped working.") has no recovery hint, unlike `noMicrophone` and `microphoneBlocked`. The "Resume recording" button sits right below it, so this is acceptable.
- [note] The model picker option text joins name, size, source and language in one string. It is long for a select, but it is readable, labelled and keyboard reachable.

## Checked
- Read the spec, the build report and the profile. Read TranscriptPanel.tsx, RecordingControls.tsx and the en.json recording, consent and transcript keys.
- Consent, error, off and paused states are inline and not modal. The REC chip shows state by dot, text and time, not by colour alone. Pause and Resume is one button, so focus stays on it. Resume after a restart takes one tap. The live region announces a count at most every 10 s. Transcript text is rendered as plain text. Copy is plain and gives the user a next step.
- I did not run the app or the tests. I relied on the build report, which lists axe, keyboard, 24 px target and no-horizontal-scroll checks in e2e/transcript.spec.ts, and the German strings are covered by the key-parity test.
