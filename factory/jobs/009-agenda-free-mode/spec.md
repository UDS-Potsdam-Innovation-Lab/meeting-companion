# Agenda-free mode: meetings without agenda topics (first part, without the language model)

## Problem
Many meetings (quick syncs, stand-ups, ad-hoc calls) have no agenda, and today the facilitator cannot start a meeting until they invent at least one agenda item. They still want the companion to keep time for the whole meeting, warn them at half time, and record and transcribe as usual. Frame 13 also shows topics being detected from the conversation and turned into an agenda, but that needs the Language model engine, which is not built yet (backlog). This job ships everything in agenda-free mode that works without a language model. The facilitator adds the topics by hand.

## Scope
- in:
  - Frame 01: the "With agenda / Agenda-free" switch next to "Step 1 of 2". The meeting stores a `mode` (`agenda` | `free`; a missing field reads as `agenda`). In agenda-free mode the agenda list, the budget line and the draft prompt are hidden. "Start meeting" no longer needs an agenda item. Items that were already typed stay in the draft unchanged, and they show again when the facilitator switches back to "With agenda".
  - The agenda-free live view (frame 13, laptop layout):
    - top bar: meeting title with "· no agenda", the "Free mode" chip, the existing REC chip, recording controls and "End meeting".
    - left column: the dark whole-meeting timer card ("NO AGENDA · 60 MIN SLOT", minutes left, "ends 11:00", progress bar) and the "Topics so far" card.
    - centre column: the existing transcript panel from frame 02, unchanged.
  - Topics added during the meeting by hand: "Add topic" (typed title). Tap a topic to make it "talking now". Each topic shows the minutes spent on it. Topics are stored with the run in the encrypted meeting file.
  - A half-time nudge: deterministic timer logic, visual only, never blocking.
  - Recording and transcription exactly as in jobs 003/004 (consent gate, REC indicator, encrypted transcript, speakers view).
  - Rust validation of the new fields. New de/en keys, plus e2e fixtures and screenshots.
- out (left out entirely, with no dead or placeholder controls):
  - Topic detection from the transcript, the "detected" label and the per-topic progress bars that compare topics with each other. These wait for the Language model engine (backlog) and a follow-up job, "Agenda-free mode: detected topics".
  - The topic-aware half-time text ("Two topics have no outcome yet…") and its "Go back to…" / "Park both" actions. They need captures (backlog) and detected topics.
  - "Turn topics into an agenda". What it should do is still a product question (see Open questions). It moves to the follow-up job.
  - Frame 13's mind map and notes tabs, the "Captured" card, the "no outcome yet" / "1 decision" badges and the "How free mode works" card. They come with the mind map and captures jobs.
  - Renaming, reordering or deleting topics. Parking topics.
  - Switching a running meeting between modes. The smart board layout (frame 05).

## Stack
Status: EXISTING
Tauri 2 + Rust core, React 19 + Vite 6 UI, as listed in AGENTS.md "Application stack". `npm test`, `npm run lint`, `npm run screenshot`. No new dependencies, engines, plugins or IPC permissions are expected.

## Acceptance criteria
- [ ] AC1: Frame 01 shows a two-option switch, "With agenda" / "Agenda-free". It is reachable by keyboard and has a pressed or selected state that does not rely on colour alone. Choosing "Agenda-free" saves `mode: "free"`, hides the agenda list, the budget line and the draft prompt, and keeps any typed items in the stored meeting. Switching back shows them again, unchanged. In free mode "Start meeting" is enabled for a meeting that has no items and no other validation errors, and it opens the free live view. In agenda mode the "noItems" reason still blocks the start. A meeting file without `mode` loads as an agenda meeting, so no migration and no version bump are needed. Component tests cover the toggle round trip with items kept, starting with zero items in free mode, and the unchanged block in agenda mode.
- [ ] AC2: The free live view shows the whole-meeting timer card: "NO AGENDA · <slot> MIN SLOT", the whole minutes left, "ends HH:MM" in the active locale, and a progress bar. Elapsed time is `now − run.startedAt`. The time available is `scheduledEnd − run.startedAt`, so a late start shortens it. All values are computed from stored timestamps and the injected `Clock`, not by counting ticks. Once the scheduled end has passed, the card shows "N min over" as text in the overrun colour, so the state is not shown by colour alone. If the meeting starts at or after its scheduled end, it is "over" from the first second. Unit and component tests with the fake clock cover 0 %, 49 %, 50 %, 100 %, overrun and a late start. (NFR Reliability: resumes after a restart with values recomputed)
- [ ] AC3: When elapsed reaches 50 % of the time available, a nudge appears. Its title is "Half the time is gone" and its body is "N min left, ends HH:MM". It has one dismiss action. It uses the frame 02 nudge pattern: not modal, takes no focus, blocks nothing, and is announced once through the polite live region. It appears at most once per run while the view is open, and it does not appear at all when the time available is zero or less. It is not AI output. Tests with the fake clock cover: no nudge at 49 %, a nudge at 50 %, no repeat after dismissal, and none for a meeting that starts after its end. (Profile: nudges never block, nothing modal during the meeting)
- [ ] AC4: The "Topics so far" card starts empty, with a short empty-state hint. "Add topic" takes a title with the same rules as an agenda item title (trimmed, 1–200 characters, inline error by key) and allows up to 100 topics. A new topic is added at the end of the list and becomes "talking now". Tapping or pressing Enter on another topic row makes that one "talking now". This closes the open span of the previous topic and opens one for the tapped topic. Tapping the current topic again stops it, so no topic is current. Each row shows the title, a "talking now" marker as text on the current topic, and the whole minutes spent, summed over all of the topic's spans and rounded down. "End meeting" closes the open span. Each action is one tap with no confirmation. Unit tests cover adding, switching, returning to an earlier topic (minutes add up), stopping, and the 100-topic limit. Topic titles are rendered as text only.
- [ ] AC5: Every change (mode, topic added, current topic switched or stopped, end) is saved at once through `MeetingStore`. Topics are stored inside the run as `{ id, title, source: "manual", spans: [{ startedAt, endedAt | null }] }`. The Rust core treats the IPC payload as untrusted and rejects each of the following with a field error, each case covered by a Rust test:
  - an unknown `mode`
  - a free run that has `run.items`
  - topics on an agenda run
  - a topic title that is empty or longer than 200 characters
  - more than 100 topics
  - a duplicate topic id
  - a `source` other than `manual`
  - a span that starts before the run starts, or ends before it starts
  - more than one open span
  - an open span after the run has ended

  An agenda run without items is still rejected ("noItems"). A free run without items is accepted. After a reload (e2e with the mock backend), a running free meeting reopens in the free live view with the same current topic and recomputed times. (NFR Reliability "nothing that was confirmed is lost"; Privacy "stored only on the device, encrypted at rest")
- [ ] AC6: Recording in a free meeting works exactly as in an agenda meeting. Recording starts only after the facilitator confirms that everyone was informed. The REC indicator stays visible while recording. Transcript segments go to the existing encrypted `<id>.transcript` store, and no audio is written. The speakers view opens from the free live view as it does from frame 02. No network access, listening port, Tauri plugin or new IPC permission is added (`src/config.test.ts` still passes), and nothing that the topics or the transcript contain is logged. Tests: a component test showing that the free live view shows the consent gate before recording, and an e2e run with the fake STT that shows transcript lines in the free view. (NFR Privacy "recording starts only after the facilitator confirms…", "recording indicator always visible", "nothing leaves the device"; NFR Security "no listening network ports")
- [ ] AC7: All new strings come from keys in `de.json` and `en.json`, and the key-parity and no-literal tests pass. Playwright + axe report no WCAG 2.2 AA violations in frame 01 free mode and in the free live view (normal and nudge state) at 1280×800. There is no horizontal scroll at 1280×800, and the free live view passes the sizes in `e2e/responsive.spec.ts`. The keyboard reaches the mode switch, "Start meeting", "Add topic", the topic rows, the nudge's dismiss button, the recording controls and "End meeting" in a logical order, with a visible focus ring. Targets are at least 24×24 px. `npm run screenshot` adds the fixtures `free` (setup), `live-free`, `live-free-half` and `live-free-over` at a fixed clock. (NFR Clients and usability, Internationalisation)

## Design
Source: figcraft design/meeting-companion.figcraft, frame "13 Agenda-free meeting" (`design/screens/s13_free.png`, `design/build/s13_free.py`) and the mode switch of frame "01 Agenda setup" (`design/screens/s1_setup.png`, `s1_setup.py` keys `mode_*`)
Status: NEEDED

What exists and this job follows: frame 13's top bar ("Free mode" chip, REC, "End meeting"), the dark timer card ("NO AGENDA · 60 MIN SLOT", "30 min left · ends 11:00", bar at 50 %), the "Topics so far" rows with their "talking now" state, the amber half-time card, and frame 01's "With agenda / Agenda-free" switch.

What no frame shows, and what the FigCraft design gate must answer before the build (frames built by `design/build/` scripts, style per the profile):
1. Frame 01 with "Agenda-free" selected: what replaces the agenda list, the budget line and the draft prompt? Does the heading change ("What's on the agenda?" no longer fits)? Does the right column (toggles, "Start meeting") stay the same?
2. Frame 13 reduced to what ships: the centre column showing the frame 02 transcript panel with no Mind map or Notes tabs, the right column with only the nudge, or empty when there is no nudge (no "Captured" card and no "How free mode works" card), and the "Topics so far" card without "detected", progress bars, outcome badges or "Turn topics into an agenda".
3. The "Add topic" control in the "Topics so far" card: an inline field or a button that opens a field. Also its error state and its position, so it stays reachable with many topics.
4. The empty "Topics so far" state at the start of a meeting.
5. The half-time nudge without topic awareness (title, "N min left, ends HH:MM", one dismiss action). Frame 13 places it as an amber card at the top right, while frame 02's nudge is a dark toast. Pick one for this view.
6. The timer card's overrun state ("N min over") and the state where no topic is current.
7. The free live view at 1024×768 and 768×1024, using the existing responsive layout of frame 02.

## Surfaces
- User-facing UI: yes. The mode switch in frame 01, and the free live view (frame 13: top bar, left column, centre transcript, half-time nudge).
- Security-relevant: yes, low. New UI-to-core data (`mode`, topics with typed titles and timestamps) is validated in Rust as untrusted input (AC5). Topic titles are rendered as text only. There is no new network access, port, plugin or secret (AC6). Rules touched: NFR Security "no listening network ports"; NFR Privacy "stored only on the device, encrypted at rest", "recording starts only after the facilitator confirms…", "nothing leaves the device". No secure-coding guideline is configured.
- Human gate: yes. A free meeting records audio and stores a transcript, and the profile's spec-writer rule makes any feature that records or stores transcripts gated. The stored meeting shape also gains optional fields (`mode`, `run.topics`), and the approver is told to escalate changes to what is stored. Nothing is deleted or migrated, and nothing changes auth, secrets or permissions.
- Audio/transcript data: yes. This job adds no new kind: audio is processed in memory as in job 003 and never written, and the transcript goes to the existing encrypted `<app_data>/meetings/<id>.transcript` until deletion exists. New stored data: the meeting `mode`, plus typed topic titles and their time spans in the encrypted `<id>.meeting` file, kept until meeting deletion exists.
- Leaves the device: no.
- Board (touch) layout: no. Laptop layout only; frame 05 is a later job. The controls are standard buttons, so touch works.
- AI speaks or contributes unasked: no. Topics are typed by a person, and the half-time nudge is timer logic. The deferred topic detection will contribute unasked suggestions, and its job must add the profile's criteria for that: visible to everyone, off by default, rate-limited, and suggestions confirmed by a person.

Size: normal

## Open questions
- What waits for the Language model engine: topic detection, and the topic-aware half-time nudge (which also needs captures). The follow-up job "Agenda-free mode: detected topics" would add a `TopicDetector` engine trait with a scripted fake. Detected topics appear as suggestions that a person accepts, renames or dismisses (`source: "detected"` only after a person confirms). Transcript text is untrusted input to the model (NFR Security). That job also needs the AI-unasked criteria from the profile.
- "Turn topics into an agenda" is deferred because it can mean two things. (a) Convert the running meeting into an agenda meeting: topics become items and time continues per item. This clashes with the run model, where an item runs once and a topic can be returned to. (b) Seed the next meeting's agenda from these topics, for example from "End meeting" or wrap-up (frame 04). I would pick (b) with wrap-up. A person should decide, and the design gate should draw the result.
- Free mode keeps typed agenda items in the draft rather than discarding them, and a free run ignores them. If the team prefers that "Agenda-free" clears the items, that needs an inline confirmation.
- The time available is measured from the actual start to the scheduled end, so a late start moves half time earlier in wall-clock terms. The other option is half of the planned slot.
- Dismissing the half-time nudge is kept in memory, as for the 80 % nudge in job 002. After a restart past half time it shows again once.
- The schema gains optional fields without bumping `SCHEMA_VERSION` (as job 002 did for `run`). A version bump would mean a migration.
- Possible split if the job has to shrink: (a) mode switch, start without items, timer card, half-time nudge, persistence and validation of `mode` (AC1–AC3, AC5 without topics, AC6, AC7); (b) manual topics (AC4 and the topic parts of AC5).
