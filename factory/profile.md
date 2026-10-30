---
# Factory profile. The core reads the frontmatter; each agent reads
# `## All agents` plus its own section below.
factory_version: 0.2.1
flavour: local
main: main
ci_workflow: ci.yml             # Linux only until the feature set is final (decision 2026-10-30)
lenses: [security, ux, ui, code]
ui_paths:
  - "src/**"
secret_scan: true
docs:
  agents: AGENTS.md
  nfr: docs/non-functional-requirements.md
design:
  source: figcraft
  file: design/meeting-companion.figcraft
  prototypes: design/screens
---

# Factory profile: Meeting Companion

## All agents

- Product: a local desktop app (macOS, Windows, Linux, Huawei smart board PC). No server we run; no
  deployment step. Releases are installers on GitHub Releases. Brief: `docs/vision.md`.
- Users: teams in German organisations (schools, public sector, companies). One facilitator per meeting,
  3–12 participants, some in the room, some remote. Not technical; the board is used by whoever stands
  in front of it.
- Languages: every user-facing string in de and en, by key; de is the default.
- Design: frames in `design/meeting-companion.figcraft`, PNG exports in `design/screens/<frame>.png`.
  New screens are designed as FigCraft frames first (no HTML prototypes).
  The frame number in `docs/vision.md` names the screen a feature belongs to.
- The assistant never decides: anything it produces is a suggestion until a person confirms it.

## spec-writer

- Extra `## Surfaces` lines: "Audio/transcript data: yes/no — what is stored, where, how long";
  "Leaves the device: yes/no — destination"; "Board (touch) layout: yes/no";
  "AI speaks or contributes unasked: yes/no".
- A feature where the AI speaks or contributes unasked gets criteria that it is visible to everyone,
  off by default, rate-limited by the facilitator, and silent the moment a person speaks.
- A feature that records, stores or sends audio, transcripts or voice profiles gets criteria from the
  NFR sections Privacy and Security, and `Human gate: yes`.
- Engines (speech-to-text, diarization, language model, export targets) go behind an interface with a
  fake implementation for tests; criteria are testable without models, network or a microphone.

## builder

- Tests never download models or call the network; use the fake engines and recorded fixtures.
- Keep every engine swappable; no engine-specific types in UI code.

## prototyper

- Not used in this project: every prototype is a FigCraft frame in `design/meeting-companion.figcraft`,
  built by a script in `design/build/` (`s<n>_<name>.py`, run via `run.py`) and exported to
  `design/screens/`. The orchestrator takes the design gate's FigCraft route, never the HTML prototyper.
- Reuse the FigCraft frames' style: warm neutral background, white cards, indigo accent `#4338CA`,
  Inter; decisions green, to-dos amber, questions indigo, overrun red.

## reviewer-security

- NFR sections: Architecture, Privacy, Security.
- Watch for: audio or transcript leaving the device unannounced, secrets outside the OS keychain,
  the local phone web view reachable without the meeting token, prompt injection from transcript text.

## reviewer-ux

- NFR sections: Clients and usability, Internationalisation.
- The facilitator runs a meeting while talking: one tap for the frequent actions, nothing modal during
  the meeting, nudges never block. The board is read from 3 m away.

## reviewer-ui

- NFR sections: Clients and usability, Internationalisation.
- Compare against the matching frame in `design/screens/`. Board screens at 1920×1080 in addition to
  375 and 1280 px.
- Screenshot command: `npm run screenshot` (writes screenshots/ at 375, 1280, 1920 px).

## reviewer-code

- NFR sections: Architecture, Reliability, Performance, Maintainability.

## approver

- Escalate anything that changes what is recorded, stored, or sent off the device.
