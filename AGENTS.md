# Meeting Companion

A local AI meeting companion. It structures a meeting (agenda, timekeeping), transcribes it on the device,
captures decisions, to-dos and questions, draws a live mind map of the topics, lets the team review the
notes and next steps, and hands the results to other apps (Jira, Planner, Teams, Confluence, email).

It runs as a **local desktop app** on macOS, Windows and Linux, and on the embedded PC of a Huawei
touch smart board. There is no server we operate: audio, transcripts and notes stay on the device unless
a person sends them somewhere. Releases are installers on GitHub Releases.

Product brief: [docs/vision.md](docs/vision.md). Non-functional requirements:
[docs/non-functional-requirements.md](docs/non-functional-requirements.md).

## Layout

- `design/meeting-companion.figcraft` — the approved prototype (FigCraft), 13 frames, 3 click-through flows.
- `design/screens/` — PNG exports of every frame, named after the frame (`s2_live.png` = "02 Live meeting").
- `design/build/` — the Python generator that builds the frames through FigCraft's control port
  (`figcraft --control 7979`, then `python3 run.py s2_live:1540:0`). Rebuilding a frame replaces hand edits.
- `factory/` — the software factory: `profile.md`, `backlog.md`, `jobs/`.

## Conventions

- UI strings in German and English, referenced by key; German is the default.
- Everything the assistant produces is a suggestion until a person confirms it.
- No network access without a setting that names where data goes.

## Application stack

STATUS: NOT CONFIGURED

Constraints for the proposal:
- One codebase for macOS, Windows and Linux desktops; the smart board's embedded PC (OS to be confirmed,
  likely Windows or Android) must run it, at worst as a full-screen touch UI.
- On-device speech-to-text and speaker diarization (Whisper-class models), German and English.
- Pluggable language model: local model or a cloud API (Claude), chosen in settings.
- A local web view for phones in the room (QR code, same network) and later a Microsoft Teams meeting app.
- Reference: Meetily (Tauri + Rust + whisper.cpp) solves the same local-transcription problem.
