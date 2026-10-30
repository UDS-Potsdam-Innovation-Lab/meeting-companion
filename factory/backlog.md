# Backlog

`/factory next` runs the first unchecked item. The orchestrator marks it `[~]`
while running and `[x] … → <job-id> (<stage>)` when done.

- [x] App skeleton and agenda setup (frame 01): desktop app that starts on macOS, Windows and Linux, creates a meeting with title, time slot, participants and agenda items (lead, goal, minutes), stores it locally; CI that builds and tests on all three OSes → 001-app-skeleton-agenda (merged)
- [x] Timekeeping in the live meeting (frame 02, left column): timer per agenda item, next item, +5 min from the buffer, park a topic, nudge at 80 %, planned vs actual per item → 002-live-timekeeping (merged)
- [~] Local live transcription (frame 02, centre): microphone capture, on-device speech-to-text in German and English behind an engine interface, transcript written to disk continuously; recording only after the facilitator confirms everyone was informed
- [ ] Speakers matched to attendees (frame 06): diarization, name round at check-in, manual assignment, names applied backwards, opt-in voice profiles
- [ ] Language model engine: local model or Claude API behind one interface, API key in the OS keychain
- [ ] Captures (frame 02, right column): quick capture of decisions, to-dos and questions; suggestions from the transcript that a person confirms, edits or dismisses
- [ ] Live mind map (frame 03): topics grouped by agenda item, decisions/to-dos/questions/parked as leaves, topic details with transcript links
- [ ] Wrap-up (frame 04): summary, decisions, to-dos with owner and due date, time report; export as Markdown and PDF
- [ ] Team review (frame 08): notes with suggested edits, owners accept / re-date / hand over their to-dos; on a phone via QR code over the local network
- [ ] Export connectors (frame 04): Jira, Microsoft Planner, Teams channel post, Confluence, email recap
- [ ] Smart board mode (frame 05): full-screen touch layout at 1920×1080, big targets, voice cue "Companion, …"
- [ ] Agenda-free mode (frame 13): topic detection, whole-meeting timer, half-time nudge, turn topics into an agenda
- [ ] Slides (frame 07): follow a deck from HDMI/screen share or an uploaded PPTX/PDF, notes and captures per slide, pace check
- [ ] Proactive AI participant, visual (opt-in): listens along and contributes on screen without being asked — relevant facts from earlier meetings and documents, a missing perspective, an open question nobody answered, a check of numbers that were just said; each contribution as a card the room can take up or wave away, with how often it may speak set by the facilitator
- [ ] Proactive AI participant, voice (opt-in): the agent takes part in the spoken conversation — answers when addressed, raises a hand on the board before speaking up on its own, speaks with text-to-speech, stops when someone talks over it; in Teams calls it can join as a visible participant
- [ ] Teams meeting app (frames 10–12): side panel, share to stage, organizer-only nudges, recap card in the meeting chat
- [ ] Omarchy theme compatibility: on Omarchy (Linux), the app follows the active Omarchy theme (colours, fonts, light/dark) and switches live when the theme changes; falls back to the default design tokens elsewhere
