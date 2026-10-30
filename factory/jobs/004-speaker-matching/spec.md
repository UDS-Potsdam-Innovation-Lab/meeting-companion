# Speakers matched to attendees

## Problem
Job 003 shows the live transcript without speakers. A transcript is only useful for captures, owners and the wrap-up if it is clear who said what. The facilitator needs to see the voices the app has told apart and match each one to an invited person or a guest, without leaving the meeting. A name round at check-in should make this mostly a confirmation, and every name must apply to the whole transcript, including lines spoken before the match. The assistant only suggests; a person confirms every name (profile: "The assistant never decides").

## Scope
- in:
  - A `Diarizer` engine trait in `src-tauri/src/engines/` with a scripted fake (`ScriptedDiarizer`). It is fed the same audio windows as `SpeechToText` and returns voice turns (start/end offset, voice label `A`, `B`, …). Voice features are kept in memory only, for the current recording session.
  - The transcript pipeline tags each final segment with the voice whose turns overlap it most (optional `voice` field). The field is stored in the existing sealed transcript record. Records without the field (job 003 transcripts) load unchanged.
  - Built-app env flag `MEETING_COMPANION_DIARIZE=fake`. Without a real diarizer, the app runs as in job 003 (no voices) and the speakers view shows "Speaker detection is not available yet".
  - Speaker assignments stored in the meeting file (optional field: voice label → participant id, with the source `name_round` | `manual` and whether a person confirmed it). Guests are added as participants with an optional `guest: true` flag.
  - Name round: suggestions that come from the transcript text of the first 2 minutes of recorded audio. An invited person's name said by a voice suggests that person for the voice.
  - Frame 06 "Speakers" as a view inside the live meeting: voice list, person picker per voice (invited people, "Add guest…", "Unassigned"), "Who spoke when" timeline, "Invited" list with voice chips, "How names are found" card, "Apply names to transcript", "Back to meeting". The REC chip stays visible and recording continues.
  - Frame 02: transcript lines show the confirmed person (avatar initials and name in the person's colour), or "Voice B" in muted text while the voice is unconfirmed. The footer reads "Listening · N speakers" and opens the speakers view.
  - Mock backend support and e2e fixtures for voices, suggestions and assignments.
- out:
  - A real diarization engine (for example sherpa-onnx with a pyannote segmentation model and a speaker-embedding model) and its model provisioning. This is a follow-up job; see Open questions.
  - Voice profiles: remembering voices across meetings, the "Ask people to save their voice" toggle, the "Remembered voice" source, and per-person opt-in and deletion. These are biometric data and get their own job with a human gate (see Open questions). The toggle is not shown, not even disabled.
  - The play button on a voice row ("Tap a voice to hear it"). It needs stored audio, and audio is never written (job 003). The row shows the first quote instead.
  - Names from Teams or Zoom for remote people, and "In the room" / "Remote · Teams" labels (Teams job, frames 10–12). The invited list shows names only.
  - Confidence percentages ("96 %"). The name-round matcher yields no calibrated probability; rows show the source only.
  - Splitting one voice into two, or editing a single line's speaker. A wrong cluster is corrected by assigning the voice; merging works by assigning two voices to the same person.
  - Smart board layout (frame 05) and the voice cue.

## Stack
Status: EXISTING
Tauri 2 + Rust core, React 19 + Vite 6 UI, as listed in AGENTS.md "Application stack". `npm test`, `npm run lint`, `npm run screenshot`. No new runtime dependency is expected; the real diarizer and its native dependencies come with the follow-up job.

## Acceptance criteria
- [ ] AC1: Diarizer behind an interface. `Diarizer` is a Rust trait in `src-tauri/src/engines/` with a scripted fake, and the pipeline is tested with fakes only (no model, microphone or network). Covered by Rust tests:
  - scripted turns for three voices produce final segments tagged `A`, `B`, `C`; a segment spanning two turns gets the voice with the larger overlap; a segment with no turn has no voice
  - labels stay the same across Pause/Resume within one recording session
  - after a restart of recording, new voices get labels after the highest stored one, so no earlier label is reused for another voice
  - transcript records written by job 003 (no `voice`) still load
  - the UI and `src/lib/ipc.ts` see only the voice label and turn offsets, no engine types

  (NFR Architecture "diarization … behind interfaces"; profile: engines behind an interface with a fake)
- [ ] AC2: Speakers view (frame 06). From the live view, the footer "Listening · N speakers" opens the speakers view. It is a view in the same window, not a modal. "Back to meeting" returns to the live view, and the transcript scroll position is kept. Recording and the REC chip continue throughout (a component test asserts the chip on both views). The view shows:
  - the header "N voices detected · M matched" (M counts confirmed voices)
  - one row per voice with its label, share of talk time in % (from final segment durations, rounded; the shares add up to 100 ± 1) and its first final line, shortened
  - the "Who spoke when" timeline, one bar per voice, built from the segments
  - the "Invited" list, each person with the chip of the voice confirmed for them, "Voice D?" (amber) for an unsure suggestion, or no chip
  - the "How names are found" card, with lines 1, 2 and 4 from the frame (line 3 is about voice profiles and stays out with them)

  With no voices yet, the view shows "No voices detected yet". With no diarizer, it shows "Speaker detection is not available yet". Component tests cover the filled, empty and unavailable states.
- [ ] AC3: Name-round suggestions, never applied unasked. For each voice, the final segments in the first 2 minutes of recorded audio are matched against the invited participants' full names and first names (case-insensitive, whole words, German umlauts and ß matched as written).
  - Exactly one person matches: the voice gets a suggestion with the source "Name round".
  - Two or more people match: the row is highlighted amber and the picker shows "Unsure: Yusuf or Jana?".
  - No match: no suggestion.
  - The same person is never suggested for two voices; if two voices name the same person, both become unsure.

  A suggestion changes nothing in the transcript until a person confirms it (Vitest test on the live transcript: suggested, so it still reads "Voice A"). Transcript text is untrusted: a segment `<img src=x onerror=alert(1)> I'm Mara Klein` yields a suggestion only for the invited "Mara Klein" and renders literally in the voice row. Text naming someone not on the invite suggests nobody. Unit tests (Vitest or Rust, wherever the matcher lives) cover all of these cases. (NFR Security "text from transcripts is untrusted input"; profile: the assistant never decides)
- [ ] AC4: Manual assignment, applied backwards. The picker on each row lists the invited people, "Add guest…" and "Unassigned".
  - Picking a person confirms that voice at once.
  - "Add guest…" takes a name (1–80 characters, trimmed, rendered as text), adds a participant with `guest: true` and assigns it.
  - "Apply names to transcript" confirms every unique suggestion; unsure rows stay open.
  - A confirmed name appears on every line of that voice, both earlier and later lines, and remains editable: picking another person or "Unassigned" reverts it.
  - Two voices may be confirmed for the same person.
  - The assignment is stored in the meeting file (encrypted, existing store). Meetings without it load unchanged, and assignments survive an app restart (e2e: reload with the mock backend).
  - The `.transcript` file is not rewritten: a Rust test asserts it is byte-identical before and after assigning, reassigning and unassigning.
  - A core command that assigns a voice to an unknown participant id or a malformed voice label is rejected with an error.
- [ ] AC5: Names in the live transcript (frame 02). Final and partial lines of a confirmed voice show the person's initials avatar and name in that person's colour. Colours are stable per participant and the text meets WCAG AA contrast. Lines of an unconfirmed voice show "Voice B" in muted text with a neutral avatar; lines without a voice show no speaker, as in job 003. The footer shows "Listening · N speakers", where N is the number of detected voices. Renaming a voice updates the visible lines without a reload. Component tests cover confirmed, unconfirmed and no-voice lines.
- [ ] AC6: Nothing new leaves the device or stays longer than the meeting data. A Rust test runs a session with the fake audio, STT and diarizer, then lists the app data directory: only `.meeting` and `.transcript` files, no audio and no voice features or embeddings. The test also scans both files after decryption for a marker that the fake diarizer puts into its features, and finds it in neither. Voice features are dropped when recording stops or the meeting ends. Speaker names, guest names and transcript text never appear in logs or error messages (log-capture test with a known marker name). No network access, listening port, HTTP client crate or Tauri plugin is added; `src/config.test.ts` passes, and the capability file grants only the new commands and events. (NFR Privacy "stored only on the device, encrypted at rest", "Voice profiles are stored only for people who opted in", "Nothing leaves the device"; NFR Security "No listening network ports")
- [ ] AC7: Accessibility, i18n and screenshots. All new strings come from keys in `de.json` and `en.json`, and the key-parity and no-literal tests pass. Playwright + axe report no WCAG 2.2 AA violations at 1280×800 in the fixtures `speakers` (5 voices: 2 confirmed, 1 suggested, 1 unsure, 1 unassigned), `speakers-empty` and `live-speakers` (transcript with names). There is no horizontal scroll at 1280×800. The keyboard reaches "Back to meeting", every picker, "Add guest…" with its input, and "Apply names to transcript" in a logical order, with a visible focus ring. Each picker is a labelled control naming its voice ("Person for Voice A"). Targets are at least 24×24 px. The unsure state is not shown by colour alone: it carries a "?" and the text "Unsure". `npm run screenshot` adds these three fixtures. The smoke test runs with `MEETING_COMPANION_DIARIZE=fake`. (NFR Clients and usability, Internationalisation)

## Design
Source: figcraft design/meeting-companion.figcraft, frame "06 Speakers" (PNG `design/screens/s6_speakers.png`, generator `design/build/s6_speakers.py`); frame "02 Live meeting" for the transcript rows and footer (`design/screens/s2_live.png`)
Status: EXISTS
- "06 Speakers" › top bar: title, REC chip (from job 003), "Back to meeting". States: recording, paused.
- "06 Speakers" › header "Speakers" / "5 voices detected · 3 matched" / subline. The subline reads "Pick the person for each voice. Names apply to the whole transcript, also backwards." (no "tap a voice to hear it"). States: filled, empty ("No voices detected yet"), unavailable.
- "06 Speakers" › voice list: rows with label, the waveform glyph, "27% talk time" and the quote; no play button. Picker states: confirmed (avatar + name + source "Name round" / "Picked by hand"), suggested (same, with a "Suggested" marker and no confirmation), unsure (amber row, accent-bordered picker, "Yusuf Aydin?" / "Unsure: Yusuf or Jana?"), unassigned ("Add guest…" / "Not on the invite" as in Voice E), and the guest name input inline in the picker.
- "06 Speakers" › "Who spoke when" timeline, one bar per voice in the assigned person's colour, grey when unassigned; the right label reads "first 2 min · name round".
- "06 Speakers" › "Invited · N" card with voice chips (green confirmed, amber "Voice D?" unsure). There is no location subline and no "Teams name" chip.
- "06 Speakers" › "How names are found" card, lines 1, 2 and 4, renumbered.
- "06 Speakers" › "Apply names to transcript" primary button. The "Ask people to save their voice" card is omitted.
- "02 Live meeting" › transcript rows with avatar and coloured name (as in the frame), muted "Voice B" for unconfirmed voices; footer "Listening · 5 speakers" as a button. "Mark moment" stays omitted.

## Surfaces
- User-facing UI: yes. New speakers view (frame 06) inside the live meeting; speaker names in the frame 02 transcript and footer.
- Security-relevant: yes. Transcript text drives name suggestions (untrusted input); a new free-text guest name; new IPC commands that must validate voice labels and participant ids; voice features are personal data held in memory. Rules touched: NFR Privacy (stored only on device, encrypted at rest, voice profiles only on opt-in, nothing leaves the device); NFR Security (no listening ports, transcript text untrusted); NFR Architecture (diarization behind an interface). No secure-coding guideline is configured.
- Human gate: yes. The app now stores who said what: speaker labels per transcript record, plus name assignments and guest names in the meeting file. The profile requires a gate for features that store transcripts or touch voice data, and the approver escalates changes to what is stored.
- Audio/transcript data: yes. A voice label is added to each stored transcript record (encrypted `.transcript`). Voice-to-person assignments and guest names go into the encrypted `.meeting` file. Both are kept until meeting deletion exists. Voice features stay in memory for the recording session only and are never written. No audio is stored.
- Leaves the device: no.
- Board (touch) layout: no. Laptop layout from 1280 px; pickers and buttons are standard controls, so touch works. The board layout comes with frame 05.
- AI speaks or contributes unasked: no. Name suggestions appear only in the speakers view and change nothing until a person confirms.

Size: normal

## Open questions
- Split. The backlog item spans five things, so this job covers three of them: diarization through an interface with a fake, the name round, and manual assignment applied backwards. I propose two follow-up jobs:
  - (a) "Diarization engine": a real local `Diarizer` (sherpa-onnx segmentation + speaker embedding is the likely candidate) with model provisioning, together with the open "Speech model setup" from job 003. It gets one `#[ignore]` test with a real model.
  - (b) "Voice profiles (opt-in)": the frame-06 toggle, consent on each person's own device, encrypted storage of embeddings per person, deletion by that person, and the "Remembered voice" source. Voice embeddings are biometric data (GDPR Art. 9), so (b) needs its own human gate and probably a legal check.

  Until (a) lands, the shipped app shows "Speaker detection is not available yet".
- Restart. Voice features are kept in memory only. After an app restart or crash, the diarizer cannot recognise earlier voices, so new turns get new labels (for example `F` instead of `A`). The person then assigns the new voices again, and assigning two voices to one person covers this. Only voice profiles (b) would remove the problem.
- Name-round window. Assumed fixed at the first 2 minutes of recorded audio, as the frame's label says. Two alternatives: tie it to the first agenda item ("Check-in"), or add a "Start name round" action. Neither is in the frame.
- First-name matching can pick up a name that is mentioned rather than introduced ("Mara, can you…"). That is acceptable because the result is only a suggestion, and the "unique person per voice" rule turns conflicts into "unsure".
- "Add guest" adds a participant to the meeting. Guests appear in later features (owners of to-dos, export) like invited people, marked as guests.
- Play button and audio snippets: if the team wants "tap a voice to hear it", it needs a short encrypted audio clip per voice with a retention period. That would be a separate privacy decision.
