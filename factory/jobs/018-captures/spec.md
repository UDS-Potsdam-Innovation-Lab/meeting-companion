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
    field (frames 21). To-dos have an optional owner (a meeting participant) and an optional due
    date. Each capture is attached to the running agenda item. In free mode it goes to the current topic, or to
    "Ohne Thema" if there is no current topic.
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
  Choosing a kind (button or `/d` `/t` `/q`) switches the list to that kind's tab, so the saved capture is
  visible at once. The tab count and the item's count in the left column go up. "gerade gespeichert" appears
  only after the write.
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
  - Delete is offered only inside the inline editor. It removes the capture and shows a non-modal "Undo"
    notice for 8 s. Undo restores the capture with its original id, time and item.
  - Saving a new capture shows the same 8 s Undo notice. Undo there removes the new capture again.
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
  - The column lays out without overlap at 1280×800, 1024×768, 768×1024 and 375 px, following frames 21.
    Below 800 px, captures are the second tab "Festgehalten n" in the centre card, with the composer at the bottom.
  - The German copy uses "du".

  Playwright specs and `npm run screenshot` cover the fixtures `live-captures`, `live-captures-empty`,
  `live-captures-edit`, `live-captures-error` and `live-free-captures`.

  (NFR Clients and usability; Internationalisation; profile reviewer-ux "one tap, nothing modal")

## Design
Source: figcraft design/meeting-companion.figcraft, frames "21 Captures" (approved 2026-11-02, see `design.md`; builders `design/build/s21*.py`)
Status: EXISTS

One design covers the whole captures column. This job builds the quick-capture frames below; the suggestion
parts belong to #19: `s21g_suggest`, `s21h_suggest_edit`, `s21l_375_suggest`, the pinned suggestion in
`s21f_many`, the status line and transcript chips in `s21s_states`, and the top-bar cloud chip.

Frames this job implements (`design/screens/`), with the states each must show:
- `s21_captures.png`: the column at 1440 px, with tabs and counts, cards grouped by agenda item (running item first, newest first), and the composer.
- `s21b_saved.png`: right after Enter, showing "gerade gespeichert" (shown only after the core wrote the file) and the 8 s Undo notice.
- `s21c_edit.png`: the inline editor of a confirmed capture (text, kind, owner, due date, Save / Cancel, Delete).
- `s21d_delete.png`: after Delete, the card is gone and the 8 s Undo notice is shown.
- `s21e_empty.png`: the empty column and an empty tab.
- `s21f_many.png` without the pinned suggestion: many captures, the list scrolls, tabs and composer stay pinned.
- `s21i_1280.png`: 1280×800.
- `s21j_768.png` and `s21k_375.png`: below 800 px, captures are a second tab "Festgehalten n" in the centre card, with the composer stuck to the bottom.
- `s21m_board.png`: 1920×1080 with touch targets of at least 48 px.
- `s21n_dark.png` without the suggestion: the dark theme.
- `s21o_free.png`: agenda-free mode. A capture goes to the running topic, otherwise to "Ohne Thema".
- `s21s_states.png`: the composer, card and notice parts only.

Decisions (human, 2026-11-02):
- **Kinds and composer:**
  - Kind buttons Beschluss / Aufgabe / Frage sit above the field, plus the commands `/d` `/t` `/q`.
  - Choosing a kind switches the list to that kind's tab, so a saved capture is visible at once.
  - Owner ("Wer") and due date are chip rows inside the composer, with no popovers. Enter saves.
- **Saved, Undo and delete:**
  - "gerade gespeichert" shows only after the core has written the file.
  - The Undo notice stays 8 s, for both save and delete.
  - Delete exists only inside the inline editor.
- **German copy:** it uses "du", as the live view does.
- **Left to the builder, within the design language:**
  - 1024 px uses the narrow tab pattern.
  - A "Weitere …" overflow when the "Wer" row has more than about 6 people.

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
