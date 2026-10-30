# App skeleton and agenda setup

## Problem
A facilitator preparing a meeting needs to set up the meeting itself, with title, time slot, participants and an agenda where each item has a lead, a goal and a time budget, before any live feature (timekeeping, transcription, captures) can exist. The product has no code yet. This job lays the foundation: a desktop app that starts on macOS, Windows and Linux, the manual part of frame 01 "Agenda setup", local storage of the meeting, and CI that builds and tests on all three operating systems. Later jobs build on its stack, layout, i18n and test setup.

## Scope
- in: the application skeleton (stack below), the top bar of frame 01 with a "New meeting" action, and the manual agenda builder of frame 01: the meeting card (title, date, start and end time, participants), and the agenda list (number, topic, optional outcome line, lead, goal Inform/Discuss/Decide, minutes). Add, edit, reorder and remove items. The "N of M min planned · B min buffer" line. Storage on the device, behind a `MeetingStore` interface with a file implementation and an in-memory fake. On start, the most recently edited meeting is reopened. de/en UI by key, de default, with a language switch. GitHub Actions CI on ubuntu, macos and windows. An `npm run screenshot` command for the UI reviewer.
- out (later jobs; leave these elements of the frame out entirely rather than showing dead controls):
  - the assistant prompt and "Draft agenda"
  - the "Also from" sources (calendar invite, last meeting's open items, paste document)
  - the assistant hint ("ran over before")
  - the "With agenda / Agenda-free" switch (frame 13)
  - the "Assistant settings" toggles
  - "Send results to"
  - "Start meeting" (frame 02)
  - room / smart board chip, remote flag for participants
  - the "On-device transcription" chip
  - a list or archive of past meetings, deleting meetings
  - encryption at rest (agenda data is not audio, transcript or notes; it comes with job 3)
  - installers and signing
  - smart board layout (frame 05)
  - any network access

## Stack
Status: PROPOSED
- Language + version: Rust stable 1.85+ pinned in `rust-toolchain.toml` for the core, and TypeScript 5.x for the UI. Node 22 LTS, npm.
- Framework: Tauri 2.x (desktop shell, system web view; Android target available for the board PC if it turns out to run Android). React 19 + Vite 6 for the UI.
- Test runner: Vitest + @testing-library/react + jsdom for UI logic and components, with Tauri IPC mocked via `@tauri-apps/api/mocks`. `cargo test` for the Rust core (store, validation). Playwright (Chromium) + @axe-core/playwright for keyboard, accessibility and layout checks against the Vite build with the mocked IPC.
- Exact test command: `npm test` (runs `vitest run && cargo test --manifest-path src-tauri/Cargo.toml && playwright test`).
- Lint/format command: `npm run lint` (runs `eslint . && prettier --check . && cargo fmt --manifest-path src-tauri/Cargo.toml --check && cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`). Use `tsc --noEmit` as part of `npm run lint`.
- Build command: `npm run tauri build -- --no-bundle` in CI (a compile check; installers come later).
- Screenshot command: `npm run screenshot`. It runs Playwright against the Vite build with fixture data and writes `screenshots/<view>-<width>.png` at 375, 1280 and 1920 px wide.
- Layout:
  - `src/` — React UI: `src/i18n/de.json`, `src/i18n/en.json`, `src/features/agenda/`, `src/lib/ipc.ts`; the only place that calls Tauri.
  - `src-tauri/` — Rust core: `src/store/` with the `MeetingStore` trait, `FileMeetingStore` and `MemoryMeetingStore`; `src/model/` with the meeting and validation code; Tauri commands.
  - `e2e/` — Playwright specs.
  - `.github/workflows/ci.yml`.
  - Engines for later jobs go in `src-tauri/src/engines/` behind traits.
- Why: whisper.cpp/whisper-rs and diarization run natively in Rust (as in Meetily). A web UI can be reused for the phone web view and the Teams meeting app. Tauri's binaries are small enough for the board PC.
- Rejected:
  - Electron: about 150 MB runtime, native addons for whisper.cpp per OS, no Android path.
  - Flutter: good on desktop and Android, but the phone web view and Teams app would need a second UI, and whisper needs FFI.
  - Avalonia/.NET: no reuse for the web or Teams surfaces, and a smaller speech ecosystem.
  - Qt/C++: licensing and a slower UI iteration loop.
  - Svelte instead of React: lighter, but React has the larger pool of Teams/Fluent components for frames 10–12.

## Acceptance criteria
- [ ] AC1: `.github/workflows/ci.yml` runs `npm ci`, `npm run lint`, `npm test` and the Tauri compile build on `ubuntu-latest`, `macos-latest` and `windows-latest` for every push and pull request. All jobs pass, and a failing test fails the workflow. A smoke test starts the built app with the in-memory store and checks that the agenda setup view renders. (NFR Maintainability, Architecture "one codebase")
- [ ] AC2: In the meeting card, the facilitator can enter a title, a date, a start and an end time, and can add and remove participants by name; initials avatars are derived from the name. Validation rejects these cases, each with a message shown next to the field:
  - an empty title, or one longer than 200 characters
  - an end time that is not after the start time
  - an empty or duplicate participant name

  Invalid input is never saved. Tests cover each rejection. (NFR Security: input is untrusted. Names and titles render as text, never as HTML; a test enters `<img src=x onerror=…>` and asserts it appears literally.)
- [ ] AC3: In the agenda list, the facilitator can add a topic and give each item a title, an optional outcome line, a lead, a goal (Inform, Discuss or Decide) and a time budget in whole minutes (1–240). Items can be edited, removed, and moved up or down. The lead can only be chosen from the meeting's participants, and removing a participant clears them as lead on their items. Items are numbered 01, 02, … in list order.
- [ ] AC4: Below the list, the line "N of M min planned · B min buffer" shows the sum of item minutes (N) against the time slot (M = end − start). When N exceeds M, the line says how many minutes over and uses the overrun colour; the text is not colour-only. Unit tests cover under, exact and over.
- [ ] AC5: Every change that passes validation is saved through `MeetingStore`. `FileMeetingStore` writes one JSON file per meeting in the OS app-data directory, as a temp file that is then renamed, so a crash never leaves a half-written file. After an app restart, the most recently edited meeting is reopened with all fields intact. A corrupt or unreadable file leads to an error message and an empty new meeting, not a crash, and the file is left untouched. The app opens no listening port and makes no network request; a test asserts that the Tauri config enables no HTTP plugin and that the CSP blocks external connect-src. (NFR Reliability, Privacy "stored only on the device", Security "no listening ports")
- [ ] AC6: All UI strings come from keys in `src/i18n/de.json` and `src/i18n/en.json`. German is the default on first start, and a language switch in the top bar changes all visible text without a reload and is remembered. A test fails if a key exists in only one locale, or if a component renders a literal user-facing string. (NFR Internationalisation)
- [ ] AC7: Every control can be reached and operated with the keyboard in a logical order, with a visible focus indicator. Moving items up and down works by keyboard; drag-and-drop, if built, is optional. Playwright + axe report no WCAG 2.2 AA violations at 1280×800, and at 1280×800 the view has no horizontal scroll. Interactive targets are at least 24×24 px (48 px is for the board layout, which comes later). (NFR Clients and usability)

## Design
Source: figcraft design/meeting-companion.figcraft, frame "01 Agenda setup" (PNG export `design/screens/s1_setup.png`, generator `design/build/s1_setup.py`)
Status: EXISTS
- "01 Agenda setup": the top bar ("Companion" brand, "New meeting" title, plus the language switch added by this job), the heading block (step label, "What's on the agenda?", subtitle that drops the assistant wording), the "Agenda list" card (header row #/Topic/Lead/Goal/Time, item rows with lead avatar, goal chip coloured Inform teal / Discuss amber / Decide indigo, time box, "+ Add topic", the planned/buffer line), and the right-hand "Meeting" card (title, time slot, participant avatars and count).

States to show:
- empty new meeting: no items, only "+ Add topic", and a 0-of-M line
- filled list, as in the frame
- a selected or edited item, highlighted like item 02 in the frame
- validation errors on title, time slot and participant
- over budget: the line in the overrun colour with text
- the store error message for a corrupt file

The out-of-scope elements listed under Scope are omitted, and the right column then holds only the Meeting card. Style per the profile: warm neutral background, white cards, accent `#4338CA`, Inter.

## Surfaces
- User-facing UI: yes. The agenda setup view (frame 01) of the desktop app.
- Security-relevant: yes. The feature handles untrusted text input (title, names, topics) that is stored locally and rendered. It must not open network ports or make network requests. Rules touched: NFR Security "no listening network ports", NFR Privacy "stored only on the device", "nothing leaves the device". No secure-coding guideline is configured.
- Human gate: no. There is no auth, no secrets, no permissions, and no deletion or migration of existing data. The PROPOSED stack still needs human confirmation before the build starts.
- Audio/transcript data: no. Meeting metadata only (title, time slot, participant names, agenda), stored as JSON in the OS app-data directory until a later job adds deletion.
- Leaves the device: no.
- Board (touch) layout: no. The laptop layout only; board mode is frame 05. Touch still works because all controls are standard buttons and inputs.
- AI speaks or contributes unasked: no.

Size: normal

## Open questions
- Stack: this proposes Tauri 2 + Rust + React/TypeScript, which needs human confirmation. The OS of the board PC is still unknown. If it is Android, Tauri 2's Android target covers it, but this job does not test that target.
- Participant names are personal data stored unencrypted in app data. I assumed encryption at rest starts with audio, transcripts and notes (job 3). Confirm whether agenda files need it too.
- I assumed autosave on every valid change instead of an explicit Save button, because the frame has none, and the "Start meeting" button stays out until frame 02 exists.
- I assumed participants are entered as free-text names. Picking from a calendar or directory, and the remote flag, are left to later jobs.
- After this job, update `factory/profile.md`:
  - set `ci_workflow: ci.yml`
  - narrow `ui_paths` to `src/**`
  - set the reviewer-ui screenshot command to `npm run screenshot`
- This feature has 7 criteria. If it has to shrink, split it into (a) skeleton, CI, i18n and screenshot tooling (AC1, AC6, AC7 on a placeholder view) and (b) the meeting and agenda editor with storage (AC2–AC5).
