VERDICT: PASS

## Findings
- [note] src/features/settings/LanguageModelSection.tsx (model card intro, local-failed-375.png) — at 375 px the card intro text wraps at about 215 px although the card is about 310 px wide, probably because the "On-device" badge reserves space. Pre-existing layout, not caused by this change. Not blocking.
- [note] local-failed-375.png — long model paths ("/home/user/.local/share/de.udspotsdam.me/etingcompanion/models") break mid-word. They stay inside the card with no overflow. Not blocking.

## Checked
- The change's UI surface is small: "On this device" is no longer disabled, and one new error Notice (`localFailed`, en and de) appears in the Test card. The diff reuses the shared `Notice` component (tone="error") and adds no one-off styles.
- Opened screenshots/local-failed-375.png and screenshots/local-failed-1280.png. The error Notice has an icon, a bold title and a body that names the file and says what to do ("Choose another GGUF file"). It has no clipping or overflow at 375 or 1280 px. The radio cards, the "Test again" button and the hierarchy match the surrounding cards.
- The model name is interpolated as text only. The strings are keyed in both locales, and the label starts with a verb ("Test again").
- This was a read-only review of the two existing screenshots, which came from the earlier run. I did not re-render.

## Not judged
- Dark mode, focus and hover states, and the other settings-llm fixtures were not re-rendered by me. The "unavailable" hint removal was checked only in the diff.
- I did not click the controls myself.
