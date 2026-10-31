VERDICT: PASS

## Findings
- [note] src/app/TopBar.tsx, src/styles.css (top bar at 375 px) — The settings top bar at 375 px takes three rows: title and Settings, then Back and DE/EN, then the REC and On-device chips. Frame s14i_375 has two rows, with the page title "Settings" and no wordmark or meeting name. Nothing overflows or clips, and axe and the layout tests are green, so this does not block. Consider dropping the meeting name and the Settings button (the current page) on narrow settings screens.
- [note] The Settings button in the top bar keeps its highlighted style while you are on the settings view, so it looks like the primary action next to the dark "Back" button. It is the current page, and Back is clearly the stronger action. Taste only.
- [note] The input-device row has no "USB ·" transport line, which frame s14b_test shows. The mock data has no transport, so this is not a defect.

## Checked
- Ran `npm run screenshot` in the worktree (134 passed). Opened settings-1280, settings-375, settings-dark-1280, settings-recording-375 and live-switched-1280. Compared them with design/screens/s14b_test.png and s14i_375.png.
- Layout matches the design: left section nav at wide widths, segmented tabs at 375, and white cards with a clear hierarchy of title, help text and control. The recording state shows the REC chip, the disabled test with its reason in text, and the "applies at next Start or Resume" info with an icon. Dark tokens are consistent, with a readable muted colour. The switched-microphone notice carries an icon and text, not colour alone. No horizontal scroll in the captures.
- build.md reports axe AA in 5 fixtures at 7 sizes, dark axe checks and the hex-literal test as passing. I did not re-run them.

## Not judged
- Hover and focus states were not captured. They are covered only by the e2e focus-ring test. The settings-general, settings-device, settings-no-model, settings-missing and 1920 captures were generated but not opened.
