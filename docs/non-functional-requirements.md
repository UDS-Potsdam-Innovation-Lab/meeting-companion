# Non-functional requirements

## Architecture

- Local-first: the app works fully offline with local models. Cloud services are opt-in per setting.
- One codebase for macOS, Windows, Linux and the smart board's embedded PC.
- Speech-to-text, diarization and the language model sit behind interfaces so engines can be swapped.

## Privacy

- Audio, transcripts and notes are stored only on the device, encrypted at rest where the OS allows.
- Recording starts only after the facilitator confirms that everyone was informed; a recording indicator
  is always visible.
- Voice profiles are stored only for people who opted in, and can be deleted by them.
- Audio is deleted after a configurable period (default 30 days); transcripts and notes stay until deleted.
- Nothing leaves the device without a person sending it; every export names its destination.
- Secrets (API keys, OAuth tokens) go into the OS keychain, never into files or logs.

- When the AI participant mode is on, everyone in the meeting can see it (board, side panel, Teams
  participant list); it never speaks or contributes while the mode is off.
- Sources the AI participant draws on (earlier meetings, documents) are listed in the setting that
  enables them, and each contribution shows its source.

## Security

- No listening network ports except the opt-in local web view for phones, bound to the local network,
  protected by a per-meeting token in the QR code, and closed when the meeting ends.
- Text from transcripts and slides is untrusted input to the language model and to exports.

## Performance

- Transcript lines appear within 3 s of speech on a 2022 laptop CPU; the UI stays responsive meanwhile.
- A 2-hour meeting does not exhaust memory; the transcript is written to disk continuously.

## Reliability

- A crash or power loss loses at most the last 10 s of audio and nothing that was confirmed.

## Clients and usability

- Laptop layouts work from 1280×800; smart board layouts at 1920×1080 with touch targets ≥ 48 px.
- Everything works by touch and by keyboard; visible focus; WCAG 2.2 AA contrast.

## Internationalisation

- UI in German and English, by key; transcription in German and English, mixed within one meeting.

## Maintainability

- Tests for every acceptance criterion; CI builds and tests on macOS, Windows and Linux.
