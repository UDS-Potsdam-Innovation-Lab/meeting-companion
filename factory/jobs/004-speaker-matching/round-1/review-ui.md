VERDICT: CHANGES

## Findings
- [must-fix] src/styles.css:1542-1573 (.line-picker, .line-picker__options) — The per-line "Who said this?" picker is `position:absolute` inside the scrolling transcript, so it is cut off by the transcript's bottom edge. In screenshots/live-speakers-1280.png the list ends at "Lena Sommer", and in live-speakers-375.png "Jana Roth" is half cut. Yusuf, Jana, "Add guest" and any later options cannot be reached without scrolling the transcript behind the popover, and the live transcript auto-scrolls. A line near the bottom is the usual one to correct → open the picker upward when there is no room below, or portal it to the document with viewport-aware placement, or make the transcript pane scroll the opened picker into view. Check that every option, including the guest entry, is visible at 375 and 1280 px.
- [note] Frame 06 (design/screens/s6_speakers.png) vs screenshots/speakers-1280.png: the frame has a play button per voice ("tap a voice to hear it"), a per-voice confidence figure ("96% · Name round"), and a "Ask people to save their voice" toggle. The build has none of them, and the subtitle drops the "Tap a voice to hear it" part. The spec's Risks section implies voice profiles and playback are follow-ups, so I treat this as intended scope. Confirm that is deliberate.
- [note] screenshots/speakers-1280.png: the "Who spoke when" bars are tiny dots (about 6 px) in green and grey. The frame has wide per-voice coloured segments. The chart is hard to read as built.
- [note] screenshots/speakers-375.png and live-speakers-375.png: the header wraps to three rows (title, buttons, REC). It is legible and does not overflow, but it uses a lot of height. This is probably shared shell behaviour, not this job.
- [note] src/styles.css:1575-1581: picker options have `min-height:32px`. The app targets a touch smart board, so 40–44 px would be safer for touch.

## Checked
- Ran `npm run build:e2e` and `npm run screenshot` in the worktree. Opened speakers-1280, speakers-375, live-speakers-1280 and live-speakers-375, and compared the speakers screens with design/screens/s6_speakers.png. Copies of the screenshots are in round-1/screenshots/.
- Speakers view: no horizontal overflow at 375 px, the focal point is clear, the unsure row (Voice D) is highlighted in amber with the focus ring as in the frame, and the colour tokens (indigo, green, amber) match the frame.
- Not opened: the other speakers screenshots (speakers-empty-1280, speakers-no-model-1280, and the other sizes).

## Not judged
- Dark mode, hover states, and the no-model and empty states were not opened. Contrast was not measured.
- Picker keyboard behaviour was not exercised. I did not click through the picker or the guest form.
