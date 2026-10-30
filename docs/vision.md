# Vision

A meeting companion that does what Meetily Pro does — local transcription, speaker separation, summaries,
exports — and adds structure: it asks for the agenda first, keeps time, and makes sure decisions and
next steps leave the room with an owner.

The screens are in `design/meeting-companion.figcraft`; frame numbers below refer to it.

## Before the meeting

- **Agenda setup (01).** Type, paste the calendar invite, or let the assistant draft the agenda from the
  last meeting's open items. Each item has a lead, a goal (inform, discuss, decide) and a time budget.
  The assistant points out items that ran over before.
- **Agenda-free mode (13).** No agenda: topics are detected from the conversation, time is kept for the
  whole meeting, and open topics are flagged at half time. Topics can be turned into an agenda later.

## During the meeting

- **Timekeeping (02, 05).** Timer per agenda item, +5 min, park a topic, next item; a nudge at 80 %.
- **Live transcript (02)** on the device, German and English, with speaker names.
- **Who is speaking (06).** Detected voices are matched to attendees: a name round at check-in, names
  from Teams for remote people, remembered voices only for people who opted in.
- **Captures (02).** Decisions, to-dos and questions are suggested from the transcript; a person confirms,
  edits or dismisses. Quick capture by typing, tapping or a voice cue ("Companion, note a to-do").
- **Mind map (03)** grouped by agenda item (or by topic in free mode), with a replay of how it grew.
- **Slides (07).** A deck shown on the board (HDMI, screen share, uploaded file) is followed slide by slide;
  what was said and decided is kept per slide, and the pace is checked against the time slot.
- **Smart board mode (05).** Full-screen touch layout with big targets.

## After the meeting

- **Team review (08, optional).** The team checks the notes and next steps together before anything is
  sent: suggested edits to the notes, owners accept their to-dos, propose another date or hand them over.
  On the board, a laptop or a phone (QR code). Closes on its own at a set time if nobody objects.
- **Wrap-up and export (04).** Summary, decisions, to-dos, time report; send to Jira, Planner, Teams,
  Confluence, email, Markdown or PDF.

## Teams calls (10–12)

A Teams meeting app: a side panel during the call, the companion shared to the meeting stage, and a
recap card in the meeting chat. Remote names come from the participant list; audio is recorded by the
local device rather than read from Teams' transcript (that would need tenant admin consent).

## AI participant (opt-in)

Beyond taking notes, the assistant can take part: it listens along and contributes without being asked.

- **Visual:** cards on the board or in the side panel — a fact from an earlier meeting or a document,
  a perspective nobody brought up, an unanswered question, a check of a number that was just said.
  The room takes a card up or waves it away; the facilitator sets how often it may contribute.
- **Voice:** it joins the spoken conversation. It answers when addressed, raises a hand on the board
  before speaking up on its own, and stops when someone talks over it. In a Teams call it can join as a
  visible participant.

Either way it stays a participant, not a decider: its contributions follow principle 1.

## Principles (09)

1. The assistant suggests, people decide.
2. Quiet by default: no speech output and no unasked contributions unless the AI participant mode is on;
   nudges are visual.
3. One facilitator owns agenda and clock; everyone can capture.
4. Everything can be edited or undone, and shows where it came from.
