# Captures: quick capture

## Problem
During a meeting, the facilitator and the team need decisions, to-dos and questions written down as they
happen, attached to the agenda item they belong to, so nothing is lost by the end. Today the right column of
frame 02 is empty. This job gives people a one-tap way to capture by typing, and to edit or remove what they
captured. Suggestions drawn from the transcript come in the follow-up job "Capture suggestions" (#19), which
builds on this column (split decided in spec review 1, `stack-decision.md`).

## Scope
- in:
  - Right column of the live view (frame 02, and the same column in the agenda-free frame 16). Tabs
    "Decisions n / To-dos n / Questions n" with counts, cards for confirmed captures, and the quick-capture
    field at the bottom.
  - Quick capture by typing. The kind is chosen with kind buttons, or with the commands `/d`, `/t`, `/q` in the
    field, as the design decides. To-dos have an optional owner (a meeting participant) and an optional due
    date. Each capture is attached to the running agenda item. In free mode it goes to the current topic, or to
    nothing if there is no current topic.
  - Captures stored in the sealed meeting file (`captures` in `src-tauri/src/model/`), with a closed schema
    validated by the core. Each capture records `source: "typed"`; the field is ready for #19's `"suggested"`.
    Edit, and delete with Undo.
  - Counts per item in the left column ("1 decision", "1 to-do"), as in frame 02.
  - Mock backend fixtures, de/en keys, screenshots.
- out:
  - **Capture suggestions from the transcript (#19, its own job, depends on 018, keeps the human gate).** It
    covers:
    - the `CaptureSuggester` on the `LanguageModel` trait, with its trigger cadence and cancellation
    - pending suggestion cards with Confirm / Edit / Dismiss, and the rule that nothing becomes a capture
      without a person's tap
    - the "detected" chips on transcript lines
    - prompt-injection handling and strict parsing of the model's reply
    - the status line (off / on this device / via Anthropic (cloud) / error)

    Spec review 1 already decided one point for that job: with Claude, real speaker names (as matched to
    attendees) are sent with the transcript text, and the status line says that the text goes to Anthropic.
  - Any use of the language model, any network access.
  - The voice cue ("Companion, note a to-do") and the full-screen board layout of frame 05 (Smart board mode job).
  - Capturing from the phone web view (job 012 consumer API).
  - Export targets ("→ Jira" in frame 02), wrap-up (frame 04), mind map leaves (frame 03), "Mark moment",
    the Notes tab, and parking-lot changes.

## Stack
Status: EXISTING

## Acceptance criteria
- [ ] AC1: Quick capture is saved durably. Typing text and pressing Enter (or Save) saves a confirmed capture of
  the chosen kind, attached to the current item (or topic in free mode). The field clears and focus stays in it.
  The capture appears under its tab, and the tab count and the item's count in the left column go up.
  - The UI shows the capture as saved only after the core has written the meeting file.
  - A Rust test with `FileMeetingStore` + `MemoryKeyProvider` reloads the store and finds the capture, including
    kind, text, owner, due date, item or topic id, `source: "typed"` and the capture time.
  - Meeting files written before this job (without `captures`) still load.

  (NFR Reliability "nothing that was confirmed"; Privacy "encrypted at rest")
- [ ] AC2: The core validates every capture. On bad input it returns a field error and stores nothing. Rust and
  component tests cover:
  - empty or whitespace-only text, and text over 500 characters after trimming
  - an unknown kind
  - an owner that is not a participant of this meeting, or an owner on a kind other than to-do
  - an invalid due date
  - an unknown item or topic id, or a capture id that already exists
  - a meeting that is not running

  The field shows the error by key next to the input (no modal), and the typed text is kept.
- [ ] AC3: Everything captured can be edited or undone.
  - Edit opens the capture's fields inline (not modal). Save writes the change; Esc or Cancel leaves the stored
    capture unchanged.
  - Delete removes the capture and shows a non-modal "Undo" for at least 5 s. Undo restores the capture with its
    original id, time and item.
  - Counts follow every change.
  - Rust tests check edit and delete against the reloaded sealed file. Component tests use the fake clock.

  (principle 4 "everything can be edited or undone")
- [ ] AC4: Capture text is user input and stays inert, and nothing leaves the device.
  - Capture text with markup or script is shown literally (component test; `react/no-danger` holds).
  - No capture text appears in log lines or error strings (Rust log-capture test).
  - `src/config.test.ts` passes unchanged: no new HTTP client, socket, Tauri plugin or CSP change.
  - This job makes no `LanguageModel` call: a Rust test with `ScriptedLanguageModel` records no request across
    capture, edit and delete.

  (NFR Security; Privacy "nothing leaves the device without a person sending it")
- [ ] AC5: Usable while talking, by touch and keyboard, in both languages.
  - Every new string has de and en keys (de default; the key-mode test passes).
  - Choosing a kind and saving are single taps.
  - Enter saves, Esc cancels an edit, and Tab reaches every control with a visible focus.
  - A saved capture is announced once through the existing polite live region.
  - axe reports no violations for the column in light and dark.
  - Touch targets are at least 48 px at 1920×1080.
  - The column lays out without overlap at 1280×800, 1024×768, 768×1024 and 375 px, following the approved frames.

  Playwright specs and `npm run screenshot` cover the fixtures `live-captures`, `live-captures-empty`,
  `live-captures-edit`, `live-captures-error` and `live-free-captures`.

  (NFR Clients and usability; Internationalisation; profile reviewer-ux "one tap, nothing modal")

## Design
Source: figcraft design/meeting-companion.figcraft (base: frame "02 Live meeting", `design/screens/s2_live.png`; board reference `s5_board.png`)
Status: NEEDED

The design is done once for the whole captures column, so that #19 "Capture suggestions" finds its design
already approved. This job builds only the quick-capture parts. Its column may show nothing about suggestions yet.

Frame 02 shows the happy path at 1440 px. Before building, the design gate needs FigCraft frames
(`design/build/s21*_captures*.py` → `design/screens/`) that answer the following.

For this job:
- Quick capture: how the kind is chosen (kind buttons next to the field vs. `/` commands), what owner and
  due-date entry for a to-do looks like, the saved feedback, and the validation error state.
- The edit state of a confirmed capture: inline fields for text, kind, owner and due date. Delete and the "Undo"
  notice.
- The empty column, and a tab with no entries.
- Many captures: how the column scrolls and in what order the captures appear.
- Layouts: 1280×800, 768×1024 (where does the column go?), 375 px (a tab or sheet?), 1920×1080 touch sizes,
  and dark theme.
- The agenda-free variant (frame 16): what label a capture gets when there is no current topic.

For #19, in the same frames:
- The pending suggestion card (Confirm / Edit / Dismiss) and its edit state, and where pending cards sit relative
  to confirmed ones.
- The status line states: suggestions off (with the Settings link), on this device, via Anthropic (cloud), and an
  engine error.
- The "detected" chip on a transcript line, and the link from it to the card.

## Surfaces
- User-facing UI: yes. Right column of the live view (frames 02/16), and the counts in the left column.
- Security-relevant: yes, but low. Typed user input is validated by the core and rendered as text only. There is
  no network, no language model, and no auth or secrets. Rules touched: no secure-coding guideline is configured.
  NFR Security and Privacy (encrypted at rest).
- Human gate: no. Nothing is sent off the device, and there are no auth, secret or permission changes and no data
  migration. The new optional `captures` field is backward compatible.
- Audio/transcript data: no audio and no transcript is read or stored by this job. Captures (text, kind, owner,
  due date, item/topic id, source, timestamps) are stored in the sealed `<id>.meeting` file until the meeting is
  deleted.
- Leaves the device: no.
- Board (touch) layout: yes. Targets of at least 48 px at 1920×1080. The full board mode of frame 05 is out of scope.
- AI speaks or contributes unasked: no. There is no AI in this job.

Size: normal

## Open questions
- **Who may capture.** The principles say "everyone can capture", but in this job only the person at the app
  captures. Phone capture comes later.
- **Capture ids and time.** I assumed the core generates the id and takes the capture time from its clock.
  The UI does not supply them.
- **Item attachment on edit.** I assumed an edit keeps the original item or topic, and that moving a capture to
  another item is not part of this job.
