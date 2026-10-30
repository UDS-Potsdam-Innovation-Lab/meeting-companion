# Timekeeping in the live meeting

## Problem
A facilitator runs the meeting while talking, so they cannot do time arithmetic in their head. They need to see how much time is left for the current agenda item, move on with one tap, take a few minutes from the buffer, park a topic that is going nowhere, and get a quiet heads-up before an item runs out. Afterwards the team needs to see how long each item actually took against the plan. Job 001 built the agenda (frame 01). This job adds "Start meeting" and the left column of frame 02, "Live meeting".

## Scope
- in:
  - The "Start meeting" button at the bottom of the right column in frame 01. It is enabled only when the meeting is valid and has at least one agenda item.
  - The live view of frame 02 with:
    - the top bar showing the meeting title and "End meeting"
    - the left column: the dark "current item timer" card ("NOW · ITEM 02", title, remaining time, "left of 15:00", progress bar, "+5 min", "Park it", "Next ›"), the agenda list with done/now/next states and planned vs actual per item, the parking lot with count and list, and the overall line "Meeting ends HH:MM · on track / behind"
    - the time nudge at 80 % (the toast overlay with "Wrap up" and "+5 min")
  - Run state (start time, per-item start/end, extensions, parked items, end time) is stored in the meeting through the existing encrypted `MeetingStore`. A running meeting resumes after a restart.
  - A `Clock` interface (UI side) with a fake clock for tests.
  - New de/en keys, and e2e fixtures and screenshots for the live states.
- out (leave these elements of frame 02 out entirely rather than showing dead controls):
  - the REC chip, the "On-device · DE/EN" chip and "Pause" (they come with transcription, job 3)
  - the centre column (transcript, mind map and notes tabs, "Listening", "Mark moment")
  - the right column (captures, quick capture)
  - the capture counts in item rows ("· 1 decision", "· 1 to-do") and in the nudge ("One decision captured…")
  - pausing the timer
  - taking a parked topic back into the agenda, or reordering and editing items during the meeting
  - wrap-up and time report (frame 04)
  - smart board layout (frame 05) and its voice cue
  - agenda-free mode (frame 13)
  - restarting an ended meeting

## Stack
Status: EXISTING
Tauri 2 + Rust core, React 19 + Vite 6 UI, as listed in AGENTS.md "Application stack". `npm test`, `npm run lint`, `npm run screenshot`. No new dependencies are expected.

## Acceptance criteria
- [ ] AC1: "Start meeting" in frame 01 is disabled, with a visible reason, while the meeting has validation errors or no items. Pressing it records the start time, starts item 01, and switches to the live view. The timer card shows the item number, title, remaining time as `m:ss` ("left of 15:00"), and a progress bar. Remaining time is computed from stored timestamps and the injected `Clock`, not by counting ticks, so it does not drift when the window is hidden or the machine sleeps. After the budget is used up, the card shows the overrun as text ("2:10 over") in the overrun colour, so the state is not shown by colour alone. Component tests drive this with the fake clock: 0 %, 79 %, 100 % and overrun.
- [ ] AC2: "Next ›" ends the current item, records its actual duration and starts the next one. "Park it" does the same but marks the item as parked and adds it to the parking lot. The parking lot shows the count and, when opened, the parked titles with the minutes spent. On the last item, "Next ›" and "Park it" end the agenda: the card says the agenda is done, and only "End meeting" remains. Each action is one tap or click with no confirmation, and each is reachable by keyboard. Tests cover next, park, and the last item.
- [ ] AC3: The agenda list shows each item's state with an icon or number plus text, not colour alone:
  - done: "6 of 5 min", in the amber/overrun style when actual > planned
  - now: "12 of 15 min", live
  - parked: marked as parked, with the minutes spent
  - upcoming: "20 min"

  Minutes are rounded down, and planned minutes include any "+5 min" extensions. Below the list, "Meeting ends HH:MM" shows the scheduled end. Next to it, "on track (+N min)" in green when the projected end is not after the scheduled end, else "N min behind" in the overrun colour. The projected end is now + the current item's remaining time (at least 0) + the planned minutes of upcoming items. Unit tests cover ahead, exact and behind.
- [ ] AC4: "+5 min", in the timer card and in the nudge, adds 5 minutes to the current item's budget and reduces the buffer by 5 minutes. The progress bar, the remaining time and the overall line update at once. It stays available when the buffer is smaller than 5 minutes or already used up. The overall line then reports the meeting as behind. Repeated presses add up, and tests cover a single press, repeated presses, and a press with no buffer left.
- [ ] AC5: When the current item reaches 80 % of its (extended) budget, a nudge appears: "N minutes left for item 02", with "Wrap up" and "+5 min". The nudge is not modal and does not take focus. Everything behind it stays usable, and it is announced once through a polite live region. "Wrap up" dismisses it. It appears at most once per item and budget. "+5 min" re-arms it for the new 80 % mark, and it disappears when the item ends. The nudge is plain timer logic, not AI output. Tests use the fake clock to cover: no nudge at 79 %, a nudge at 80 %, no repeat after dismissal, and re-arming after "+5 min". (NFR Clients and usability; profile: "nudges never block")
- [ ] AC6: Every timekeeping action (start, next, park, +5, end) is saved at once through `MeetingStore`. The run state is stored inside the meeting as an optional field. Version 1 files without it still load unchanged, so no migration is needed. The Rust core validates the run state on save and rejects these cases with field errors, each covered by a Rust test:
  - unknown item ids
  - item end before start
  - more than one current item
  - negative or absurd extensions (more than 240 min per item)
  - a run on a meeting without items

  After an app restart (e2e: page reload with the mock backend), a meeting that is running reopens in the live view on the same item, with the remaining time recomputed from the stored timestamps. "End meeting" asks for a second click inline (no modal dialog). It then records the end time, and the app opens a new meeting in setup. An ended meeting never reopens in the live view. No new network access, listening port or Tauri plugin is added (`src/config.test.ts` still passes). (NFR Reliability "nothing that was confirmed is lost", Privacy "stored only on the device, encrypted at rest", Security)
- [ ] AC7: All new strings come from keys in `de.json` and `en.json`, and the existing key-parity and no-literal tests pass. Times use the active locale. Playwright + axe report no WCAG 2.2 AA violations in the live view at 1280×800, for both the normal and the nudge state. There is no horizontal scroll at 1280×800. The keyboard reaches "+5 min", "Park it", "Next ›", the parking lot, the nudge buttons and "End meeting" in a logical order, with a visible focus ring. Targets are at least 24×24 px. `npm run screenshot` adds live-view fixtures (`live`, `live-nudge`, `live-over`, `live-done`) at a fixed clock, using Playwright's clock API. (NFR Clients and usability, Internationalisation)

## Design
Source: figcraft design/meeting-companion.figcraft, frame "02 Live meeting" (PNG `design/screens/s2_live.png`, generator `design/build/s2_live.py`), plus the "Start meeting" button of frame "01 Agenda setup" (`design/screens/s1_setup.png`, `s1_setup.py` key `start`)
Status: EXISTS
- "01 Agenda setup" › "Start meeting": the primary button at the bottom of the right column. States: enabled, and disabled with its reason.
- "02 Live meeting" › top bar: brand, meeting title, "End meeting" (dark). REC, the on-device chip and Pause are omitted. States: normal, and the inline second-click confirmation.
- "02 Live meeting" › "Current item timer" (dark card, 300 px column). States:
  - running (as in the frame: 3:12 left of 15:00, bar at 79 % in amber)
  - early (bar in accent/neutral)
  - overrun ("over" text, overrun red)
  - agenda done (no item, only "End meeting" in the top bar)
- "02 Live meeting" › "Agenda list": rows in the done (green check, muted title, "6 of 5 min" amber when over), now (accent-soft row, filled accent dot, "12 of 15 min") and next (outlined number, "20 min") states, plus a parked state. A parked row uses the parking-lot glyph and the muted style; the frame does not show it.
- "02 Live meeting" › "Parking lot" row with count chip. States: zero, and N with the list open.
- "02 Live meeting" › "Overall" line: "Meeting ends 11:00", with "on track (+1 min)" in green, or "N min behind" in red.
- "02 Live meeting" › "Time nudge" toast (dark, bottom of the centre area, "⏱", title, "Wrap up", "+5 min"). The subtitle drops the capture count and reads "Wrap up, or take 5 min from the buffer?".

With the centre and right columns out of scope, the space to the right of the left column stays empty (background only). The nudge keeps its position over that area. The builder must not invent placeholders there. Style per the profile: warm neutral background, white cards, accent `#4338CA`, Inter, overrun red.

## Surfaces
- User-facing UI: yes. The "Start meeting" button in frame 01, and the left column, top bar and nudge of frame 02 in the desktop app.
- Security-relevant: yes, but low. The run state is new data that the UI sends to the Rust core over IPC and that the core stores encrypted. It is treated as untrusted and validated in Rust (AC6). There is no new network access, port, plugin or secret. Rules touched: NFR Security "no listening network ports"; NFR Privacy "stored only on the device, encrypted at rest", "nothing leaves the device". No secure-coding guideline is configured.
- Human gate: no. Nothing changes auth, secrets or permissions. Nothing is deleted. The stored shape gains an optional field, and version 1 files load unchanged with no migration.
- Audio/transcript data: no. Only timestamps of agenda progress (start and end per item, extensions, parked flags, meeting start and end) are added. They are stored inside the existing encrypted meeting file until meeting deletion exists.
- Leaves the device: no.
- Board (touch) layout: no. This job builds the laptop layout at 1280 px and up. Board mode is frame 05, but touch works because all controls are standard buttons.
- AI speaks or contributes unasked: no. The 80 % nudge is deterministic timer logic shown only to the app's user. No AI is involved.

Size: normal

## Open questions
- The schema gains an optional `run` field without bumping `SCHEMA_VERSION`, because old files stay valid. If the team prefers a version bump to 2 with a v1→v2 migration, that counts as migrating data and needs the human gate.
- The profile tells the approver to escalate "anything that changes what is stored". This job adds meeting-progress timestamps to the encrypted meeting file. That is not audio or transcript data, but the approver may still want a human to confirm it.
- "+5 min" stays enabled when the buffer is exhausted, and the overall line then shows "behind". The other option, disabling it, would block the facilitator mid-discussion.
- "Wrap up" only dismisses the nudge. It does not end the item.
- "Pause" in frame 02 is left for the transcription job, where it pauses recording. Whether it should also pause the timer is a product decision for that job.
- Taking a parked topic back into the agenda is left out. Parked topics are meant to go to wrap-up (frame 04).
- After "End meeting" the app opens a new meeting in setup, because wrap-up (frame 04) does not exist yet. The ended meeting stays stored with its actuals for that later job. Meetings cannot be listed yet, so for now nobody can reach the ended meeting from the UI.
- Changes to the wall clock during a meeting (time zone, NTP jumps) are not handled specially. Remaining time follows the wall clock, and negative durations are clamped to 0.
- If the job has to shrink, split it into (a) start, timer card, next/park, planned vs actual and persistence (AC1–AC3, AC6, AC7) and (b) "+5 min", the overall projection and the 80 % nudge (AC4, AC5).
