# Backlog

`/factory next` runs the first unchecked item. The orchestrator marks it `[~]`
while running and `[x] … → <job-id> (<stage>)` when done.

- [x] App skeleton and agenda setup (frame 01): desktop app that starts on macOS, Windows and Linux, creates a meeting with title, time slot, participants and agenda items (lead, goal, minutes), stores it locally; CI that builds and tests on all three OSes → 001-app-skeleton-agenda (merged)
- [x] Timekeeping in the live meeting (frame 02, left column): timer per agenda item, next item, +5 min from the buffer, park a topic, nudge at 80 %, planned vs actual per item → 002-live-timekeeping (merged)
- [x] Local live transcription (frame 02, centre): microphone capture, on-device speech-to-text in German and English behind an engine interface, transcript written to disk continuously; recording only after the facilitator confirms everyone was informed → 003-live-transcription (merged)
- [x] Speakers matched to attendees (frame 06): diarization, name round at check-in, manual assignment, names applied backwards, opt-in voice profiles → 004-speaker-matching (merged)
- [x] Speaker model in Settings (follow-up of 006, after 004): `speakerModel` setting checked against 004's scan, picker with "None found" / "Not found any more" states (frame 14d), the diarizer uses the chosen model → done in 004-speaker-matching (merged)
- [~] Voice profiles (opt-in, frame 06 toggle): remember a person's voice across meetings; consent on that person's own device, encrypted embeddings per person, deletion by that person. Biometric data (GDPR Art. 9): legal check before building, human gate
- [x] Speaker threshold tuning (follow-up of 013): raise `SAME_VOICE` from 0.5 to ~0.55 — 013's sweep merged two German female speakers at 0.5 (name-round DER 16.7 % → 2.2 % at 0.55, others unchanged; 0.60 worse); re-baseline thresholds.json → 015-speaker-threshold (merged)
- [x] Language model engine: local model or Claude API behind one interface, API key in the OS keychain → 011-language-model-engine (merged)
- [x] Local language model runtime (follow-up of 011): fill the `LocalLlmProvider` slot — whisper-rs and llama-cpp-2 each ship their own libggml under the same names, so one copy silently wins at link time; needs one shared ggml build, or llama-server on loopback (own security review, no vendored HTTP client) → 016-local-llm-runtime (merged)
- [~] Captures (frame 02, right column): quick capture of decisions, to-dos and questions; suggestions from the transcript that a person confirms, edits or dismisses
- [ ] Capture suggestions (follow-up of 018): suggestions from the transcript that a person confirms, edits or dismisses, through the LanguageModel trait (local or Claude); with Claude, the transcript text and real speaker names go to Anthropic (human decision 2026-11-02); the captures column says whether suggestions are off, on this device or in the cloud. Human gate. Design: frames from 018.
- [ ] Live mind map (frame 03): topics grouped by agenda item, decisions/to-dos/questions/parked as leaves, topic details with transcript links
- [ ] Wrap-up (frame 04): summary, decisions, to-dos with owner and due date, time report; export as Markdown and PDF; in agenda-free meetings, seed the next meeting's agenda from the topics
- [ ] Team review (frame 08): notes with suggested edits, owners accept / re-date / hand over their to-dos; on a phone via QR code over the local network
- [ ] Export connectors (frame 04): Jira, Microsoft Planner, Teams channel post, Confluence, email recap
- [ ] Smart board mode (frame 05): full-screen touch layout at 1920×1080, big targets, voice cue "Companion, …"
- [x] Agenda-free mode (frame 13): start without topics, whole-meeting timer, half-time nudge, topics by hand → 009-agenda-free-mode (merged)
- [ ] Agenda-free mode: detected topics (after Language model engine): topic detection as suggestions a person confirms, half-time text naming topics without an outcome, "Go back to…" / "Park both"
- [ ] Slides (frame 07): follow a deck from HDMI/screen share or an uploaded PPTX/PDF, notes and captures per slide, pace check
- [ ] Proactive AI participant, visual (opt-in): listens along and contributes on screen without being asked — relevant facts from earlier meetings and documents, a missing perspective, an open question nobody answered, a check of numbers that were just said; each contribution as a card the room can take up or wave away, with how often it may speak set by the facilitator
- [ ] Proactive AI participant, voice (opt-in): the agent takes part in the spoken conversation — answers when addressed, raises a hand on the board before speaking up on its own, speaks with text-to-speech, stops when someone talks over it; in Teams calls it can join as a visible participant
- [ ] Real AI voice model (optional): wherever the companion speaks (voice participant, "Companion, …" answers), let the facilitator switch from plain local text-to-speech to a real AI voice model — natural speech-to-speech or neural TTS, local or cloud (e.g. a realtime voice API) — behind one voice-engine interface; off by default, API keys in the OS keychain, clear notice when audio leaves the device
- [ ] Teams meeting app (frames 10–12): side panel, share to stage, organizer-only nudges, recap card in the meeting chat
- [~] Omarchy theme compatibility: on Omarchy (Linux), the app follows the active Omarchy theme (colours, fonts, light/dark) and switches live when the theme changes; falls back to the default design tokens elsewhere
- [ ] Consistent "du" in German copy: the language model settings (frame 17) and any other German strings using "Sie" switch to "du", as the live view and captures do (decision 2026-11-02)
