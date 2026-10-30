# Speakers matched to attendees

## Problem
Job 003 shows the live transcript without speakers. A transcript is only useful for captures, owners and the wrap-up if it is clear who said what. The facilitator needs the app to tell voices apart on the device and match each one to an invited person or a guest, without leaving the meeting. A name round at check-in should make this mostly a confirmation, and every name must apply to the whole transcript, including lines spoken before the match. The assistant only suggests; a person confirms every name (profile: "The assistant never decides").

Revised after spec review 1 (human, `stack-decision.md`): the real local diarizer is part of this job, and voice profiles stay a separate follow-up.

## Scope
- in:
  - A `Diarizer` engine trait in `src-tauri/src/engines/` with a scripted fake (`ScriptedDiarizer`) for tests.
  - A real local diarizer, `SherpaDiarizer`: the sherpa-onnx speaker-embedding extractor turns each final transcript segment's audio into a voice embedding. Our own online clustering (cosine similarity to per-voice centroids, kept in memory) gives it a label `A`, `B`, …. The audio comes from the bounded in-memory buffer of job 003. No audio and no embedding is written.
  - Speaker-model detection on the device, done the same way as whisper models in job 003. The scan is read-only and checks each file's header and metadata. The folders are listed in the one location list in `src-tauri/src/engines/models.rs`. Nothing is downloaded. Without a model, the speakers view says so and lists the folders it searched.
  - The transcript pipeline tags each final segment with a voice (optional `voice` field in the existing sealed record). Records from job 003 load unchanged. The diarizer never delays the transcript line.
  - Speaker assignments are stored in the meeting file as optional fields. Voice → participant entries carry a source (`name_round` | `manual`) and a confirmed flag. Line → participant overrides, keyed by the segment's sequence number, cover lines that have no voice or the wrong one. Guests become participants with `guest: true`.
  - Name round: during the first 2 minutes of recorded audio, a voice that says an invited person's name gets that person as a suggestion.
  - Frame 06 "Speakers" as a view inside the live meeting (voice list, person picker per voice, "Who spoke when", "Invited" with voice chips, "How names are found", "Apply names to transcript", "Back to meeting"), plus the no-model and empty states.
  - Frame 02: transcript lines show the speaker. Each line's speaker area opens a non-modal picker for that line ("Who said this?"). The footer reads "Listening · N speakers" and opens the speakers view.
  - Built-app env flag `MEETING_COMPANION_DIARIZE=fake`. Mock backend support and e2e fixtures.
- out:
  - Voice profiles: remembering voices across meetings, the "Ask people to save their voice" toggle, the "Remembered voice" source, opt-in and deletion. These are biometric data (GDPR Art. 9) and get their own human-gated follow-up job after a legal check. The toggle is not shown.
  - Downloading, bundling or choosing speech or speaker models, and a model settings screen. These belong to the separate "Model setup" follow-up. The app uses the preferred model the scan finds.
  - sherpa-onnx's offline (whole-recording) diarization and the pyannote segmentation model (see Stack, rejected alternatives).
  - The play button on a voice row: it needs stored audio, and audio is never written. The row shows the first quote instead.
  - Names from Teams/Zoom and "In the room" / "Remote · Teams" labels (Teams job). Confidence percentages: cosine scores are not probabilities, so rows show the source only.
  - Splitting one voice into two. A wrong voice is fixed by assigning it, or line by line.
  - Smart board layout (frame 05) and the voice cue.

## Stack
Status: PROPOSED (an addition to the configured stack; Tauri, Rust, React and the test and lint commands are unchanged). A person confirms the new native component and the CI step before the build.
- Language/framework: unchanged (Rust core in Tauri 2, React 19 UI).
- New crate: `sherpa-onnx = "=2.0.1"`, the official k2-fsa bindings (Apache-2.0), with the default `static` feature. It wraps the sherpa-onnx C API with onnxruntime linked statically, and this job uses only `SpeakerEmbeddingExtractor`. Why: it is maintained by the sherpa-onnx authors, extracts the fbank features itself, accepts the 3D-Speaker, WeSpeaker and NeMo embedding models, and runs on CPU on all four targets.
- What CI needs:
  - Its build script (`sherpa-onnx-sys`) downloads `sherpa-onnx-v2.0.1-<os>-<arch>-static-lib.tar.bz2` from GitHub Releases at build time and does not verify a checksum. That is not acceptable. Instead, a CI step and `scripts/` fetch the archive once, check it against a SHA-256 committed in the repo (for example `src-tauri/native/sherpa-onnx.sha256`, one line per target), and set `SHERPA_ONNX_ARCHIVE_DIR`. A mismatch fails the build.
  - No new apt packages: the archive holds prebuilt static libs, and the C++ runtime is already present for whisper.cpp.
  - The Linux job caches the archive.
- Test command: unchanged (`npm test`). Hand-run real-model test: `cargo test --manifest-path src-tauri/Cargo.toml --release -- --ignored speaker`. It uses `MEETING_COMPANION_SPEAKER_MODEL`, or else the model the scan prefers.
- Lint command: unchanged (`npm run lint`).
- Layout:
  - `src-tauri/src/engines/diarize.rs`: `Diarizer` trait, `ScriptedDiarizer`, and `VoiceClusterer` (pure Rust, no sherpa types).
  - `src-tauri/src/engines/sherpa.rs`: `SherpaDiarizer`.
  - `src-tauri/src/engines/models.rs`: extended with a model kind (whisper | speaker) and the speaker-model check.
- Model formats accepted. Single-file ONNX speaker-embedding models in sherpa-onnx's format: an ONNX `ModelProto` whose `metadata_props` carry `framework` = `3d-speaker` | `wespeaker` | `nemo` and `sample_rate` = `16000`. Examples are `3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx`, `3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx`, `wespeaker_en_voxceleb_resnet34.onnx` and `nemo_en_titanet_small.onnx` (k2-fsa release "speaker-recongition-models"). The builder confirms the exact metadata keys against the sherpa-onnx v2.0.1 source.
  - Rejected: any other ONNX (VAD, ASR, TTS, source separation), PyTorch/`.ckpt`/`.nemo` checkpoints, pyannote `pytorch_model.bin`, and ggml/GGUF files.
  - Search folders: `<app_data>/models/` and the Hugging Face hub cache, from the same list as the whisper models.
  - Preference when several are found: smaller first (the board PC is slow). The `#[ignore]` test prints the time per segment for a person to judge.
- Found on this machine (2026-10-30): no speaker-embedding model.
  - Searched: `~/.cache/huggingface/hub` (only CTranslate2 faster-whisper models), `~/.local/share/voxtype/models` (ggml whisper `base`, `base.en`), `~/.buzz/models` (parakeet ASR and pocket-tts ONNX).
  - Stray ONNX files elsewhere: silero VAD v6 in a Python venv, a Piper voice `de_DE-thorsten-high.onnx`, UVR-MDX-NET, YuNet face detection. All of them must be rejected by the check and make good negative fixtures (header and metadata only; the files are not copied into the repo).
  - To try the real engine, a person places e.g. `3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx` (~27 MB) in `<app_data>/models/`.
- Rejected alternatives:
  - sherpa-onnx offline speaker diarization (pyannote segmentation + clustering): it needs the whole recording in memory or on disk. That breaks the 30 s bounded buffer and "audio is never written", and it is not live.
  - pyannote.audio via Python: needs a Python runtime and PyTorch on every device, and the model is gated behind a licence click on Hugging Face.
  - whisper.cpp tinydiarize: only the English `small.en-tdrz` model, and it marks turn changes without voice identities.
  - The `ort` crate with our own fbank front end: same onnxruntime, but more signal code to own.
  - Community `sherpa-rs` 0.6.x: older sherpa-onnx, not maintained by k2-fsa.

## Acceptance criteria
- [ ] AC1: Diarizer interface and pipeline (fakes only, no model, microphone or network). `Diarizer` is a Rust trait with a scripted fake. Rust tests:
  - Three scripted voices produce final segments tagged `A`, `B`, `C`.
  - A segment shorter than 1 s takes the voice of the previous segment if that one ended less than 1 s before; otherwise it has no voice.
  - Labels stay the same across Pause/Resume. After a restart of recording, new voices get labels after the highest stored one.
  - A fake diarizer that takes 2 s per call does not delay the transcript: the final segment still reaches the UI event within 3 s, and the voice follows in a separate update event.
  - Each record is written once the voice is known, or after 5 s without it, so job 003's "on disk within 10 s" still holds.
  - Job 003 records without `voice` load unchanged.
  - The UI and `src/lib/ipc.ts` see only voice labels, no engine types.

  (NFR Architecture, Performance, Reliability; profile: engines behind an interface with a fake)
- [ ] AC2: Real local diarizer and model detection. `SherpaDiarizer` implements `Diarizer` and compiles in CI. The archive check from ## Stack runs in CI, and a corrupted archive fails it. `VoiceClusterer` is tested with synthetic embeddings:
  - Vectors near three centroids form three voices.
  - A vector below the similarity threshold opens a new voice.
  - After 26 voices (`A`–`Z`), a new vector joins the nearest voice.

  The speaker-model scan is tested with temp folders:
  - A file with the ONNX header and speaker metadata is listed, with its id, name, size, source and folder.
  - ONNX files without that metadata (VAD-, TTS- and ASR-like fixtures), a ggml whisper file, a truncated file and a link pointing outside the folder are not listed.
  - The scan never writes, copies or moves anything.
  - The core accepts only model ids from its own scan.

  With no speaker model, recording and transcription run as in job 003. The speakers view shows "No speaker model found on this device" and the searched folders, and line-by-line assignment (AC5) still works. One `#[ignore]` test (`-- --ignored speaker`) runs a real model on two recorded voices and expects two labels.
- [ ] AC3: Speakers view (frame 06). The footer "Listening · N speakers" opens the view in the same window, not as a modal. "Back to meeting" returns to the live view and keeps the transcript scroll position. The REC chip and recording continue on both views (component test). The view shows:
  - "N voices detected · M matched", where M counts confirmed voices.
  - One row per voice: label, talk-time share in % (from final segment durations; the shares add up to 100 ± 1) and the first final line, shortened.
  - "Who spoke when", one bar track per voice.
  - "Invited", with each person's confirmed voice chip, an amber "Voice D?" for an unsure suggestion, or no chip.
  - "How names are found", lines 1, 2 and 4 of the frame.

  Component tests cover the filled, empty ("No voices detected yet") and no-model states.
- [ ] AC4: Name-round suggestions, never applied unasked. For each voice, the final segments in the first 2 minutes of recorded audio are matched against invited participants' full and first names. Matching is case-insensitive, on whole words, with umlauts and ß matched as written.
  - Exactly one match gives a suggestion with the source "Name round".
  - Two or more matches give an amber row and the picker text "Unsure: Yusuf or Jana?".
  - No match gives no suggestion.
  - If two voices name the same person, both become unsure.

  A suggestion changes nothing in the transcript until a person confirms it: a suggested voice still reads "Voice A". Transcript text is untrusted:
  - `<img src=x onerror=alert(1)> I'm Mara Klein` yields a suggestion only for the invited "Mara Klein" and renders literally.
  - A name not on the invite suggests nobody.

  Unit tests cover all cases. (NFR Security "text from transcripts is untrusted input"; profile: the assistant never decides)
- [ ] AC5: Manual assignment, applied backwards. Each voice row's picker lists the invited people, "Add guest…" and "Unassigned".
  - Picking a person confirms the voice.
  - "Add guest…" takes a name (1–80 characters, trimmed, rendered as text) and adds a participant with `guest: true`.
  - "Apply names to transcript" confirms all unique suggestions; unsure rows stay open.
  - In the live transcript, each line's speaker area opens a non-modal "Who said this?" picker with the same entries and "Use voice". A line choice overrides the voice for that line only.
  - Confirmed names show on every line of the voice, earlier and later, as the initials avatar and name in a stable per-person colour (WCAG AA). Unconfirmed voices show "Voice B" muted. Lines without voice or override show no speaker.
  - Every choice can be changed back (principle 4).
  - Assignments and overrides are stored in the meeting file and survive a reload (e2e with the mock backend). Meetings without them load unchanged.
  - A Rust test shows the `.transcript` file is byte-identical before and after assigning, overriding and unassigning.
  - Core commands reject unknown participant ids, malformed voice labels and unknown sequence numbers.
- [ ] AC6: Nothing new leaves the device or is kept. A Rust session with the fake audio, STT and diarizer ends with only `.meeting` and `.transcript` files in the app data folder. The fake's embedding marker appears in neither file after decryption. Embeddings and centroids are dropped when recording stops or the meeting ends. Names, guest names and transcript text never appear in logs or errors (log-capture test). No network access at runtime, listening port, HTTP client or Tauri plugin is added. `src/config.test.ts` passes, and the capability file grants only the new commands and events. sherpa-onnx is used only through `SpeakerEmbeddingExtractor`, and the build uses only the checksum-verified archive. (NFR Privacy "stored only on the device", "Voice profiles … only for people who opted in", "Nothing leaves the device"; NFR Security; profile reviewer-security)
- [ ] AC7: Accessibility, i18n and screenshots. All new strings come from `de.json`/`en.json` keys; the parity and no-literal tests pass. Playwright + axe report no WCAG 2.2 AA violations at 1280×800, and there is no horizontal scroll, in these fixtures:
  - `speakers`: 5 voices (2 confirmed, 1 suggested, 1 unsure, 1 unassigned)
  - `speakers-empty`
  - `speakers-no-model`
  - `live-speakers`: names and one line override

  The keyboard reaches "Back to meeting", every picker, the guest input, "Apply names to transcript" and each line's speaker picker in a logical order, with a visible focus ring. Pickers are labelled ("Person for Voice A", "Speaker of the line at 10:11"). Targets are at least 24×24 px. "Unsure" is not shown by colour alone. `npm run screenshot` adds the four fixtures. The smoke test runs with `MEETING_COMPANION_DIARIZE=fake`. (NFR Clients and usability, Internationalisation)

## Design
Source: figcraft design/meeting-companion.figcraft, frame "06 Speakers" (PNG `design/screens/s6_speakers.png`, generator `design/build/s6_speakers.py`); frame "02 Live meeting" for transcript rows and footer (`design/screens/s2_live.png`)
Status: EXISTS
- "06 Speakers" › top bar: title, REC chip (job 003), "Back to meeting". States: recording, paused.
- "06 Speakers" › header: "Speakers" / "5 voices detected · 3 matched". The subline is "Pick the person for each voice. Names apply to the whole transcript, also backwards." States: filled, empty, and no model (the message plus the searched folders in muted 12 px, in the style of job 003's no-model state).
- "06 Speakers" › voice rows: label, waveform glyph, "27% talk time" and the quote. There is no play button. Picker states:
  - confirmed: avatar, name, and the source "Name round" / "Picked by hand"
  - suggested: the same, with a "Suggested" marker
  - unsure: amber row with an accent border, "Yusuf Aydin?" / "Unsure: Yusuf or Jana?"
  - unassigned: "Add guest…" / "Not on the invite"
  - an inline guest name input
- "06 Speakers" › "Who spoke when": bars in the assigned person's colour, grey when unassigned; the right label reads "first 2 min · name round".
- "06 Speakers" › "Invited · N" with voice chips, without location sublines or the "Teams name" chip; "How names are found" with lines 1, 2 and 4; the "Apply names to transcript" primary button. The voice-profile card is omitted.
- "02 Live meeting" › transcript rows with avatar and coloured name as in the frame, and muted "Voice B" for unconfirmed voices. The avatar/name area is a button that opens the "Who said this?" popover. The popover is not in the frame: build it as a white card anchored to the row, in the style of frame 06's picker, non-modal and closed by Escape or an outside click. Footer: "Listening · 5 speakers" as a button.

## Surfaces
- User-facing UI: yes. New speakers view (frame 06) in the live meeting; speaker names and a per-line picker in the frame 02 transcript.
- Security-relevant: yes.
  - Voice embeddings are personal data (held in memory only).
  - Transcript text drives suggestions (untrusted).
  - A free-text guest name.
  - New IPC commands that validate labels, ids and sequence numbers.
  - The model scan reads files outside the app folder (read-only, links confined).
  - A new native dependency whose build script downloads binaries, which the checksum pin addresses.

  Rules touched: NFR Privacy (stored only on device, encrypted at rest, voice profiles only on opt-in, nothing leaves the device); NFR Security (no listening ports, transcript text untrusted); NFR Architecture (engines behind interfaces). No secure-coding guideline is configured.
- Human gate: yes. The app now computes voice embeddings and stores who said what (voice labels per transcript record; assignments, overrides and guest names in the meeting file). It also adds a native component with a supply-chain risk. The profile requires a gate for anything that touches voice data or stores transcripts.
- Audio/transcript data: yes.
  - Stored, encrypted: a voice label in each `.transcript` record; assignments, line overrides and guest names in the `.meeting` file. Both are kept until meeting deletion exists.
  - Memory only: voice embeddings and centroids, for the recording session. Audio stays in the 30 s buffer and is never written.
- Leaves the device: no at runtime. At build time only, the pinned, checksum-verified sherpa-onnx archive comes from GitHub Releases.
- Board (touch) layout: no. Laptop layout from 1280 px; standard controls, so touch works.
- AI speaks or contributes unasked: no. Suggestions appear only in the speakers view and change nothing until confirmed.

Size: normal

## Open questions
- Stack confirmation. `sherpa-onnx` 2.0.1 (static) with a checksum-pinned archive is proposed as a new native component. The human has asked for a real diarizer; what remains to confirm is the crate and the CI step.
  - Windows risk: the Windows archive is built with the static CRT (`MT`), and whisper-rs uses the CMake default (`MD`), which can break linking. Windows CI is deferred, so this surfaces later. The fallback is sherpa's `shared` feature with the DLL shipped next to the app.
  - The app binary grows by roughly 15–25 MB (onnxruntime).
- No speaker model is on this machine. Until the "Model setup" follow-up exists, a person places a model in `<app_data>/models/` by hand. Licences matter for bundling there: 3D-Speaker is Apache-2.0; the WeSpeaker VoxCeleb and NeMo TitaNet weights are CC-BY-4.0.
- Quality. Embedding per final segment (up to 3 s windows) with online clustering is coarser than pyannote: it gets overlapping speech and very short turns wrong. The threshold is a constant that the `#[ignore]` test helps tune. Line overrides and assigning two voices to one person are the manual fixes.
- "Manual assignment still works" without a model (review 1) is read as the per-line "Who said this?" picker. That picker was not in the first spec and is not in the frame.
- Restart: embeddings are kept in memory only, so after a restart earlier voices are not recognised and new labels appear. Two voices can be assigned to one person. Only voice profiles (separate follow-up) would remove this.
- Name-round window: assumed to be the first 2 minutes of recorded audio, as the frame's label says. Alternatives are the first agenda item, or a "Start name round" action.
- Voice profiles: a separate follow-up job with a human gate after a legal check (GDPR Art. 9), per review 1.
- If the job has to shrink, split it into (a) AC1, AC3–AC7 with the fake diarizer and (b) AC2 (sherpa, model scan, CI pin).
