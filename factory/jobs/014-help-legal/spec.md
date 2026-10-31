# Help and legal notes

## Problem
Facilitators are not technical, and the board is used by whoever stands in front of it. They need to look up
how a meeting works, which keys do what and what to do when the microphone or a model is missing, without
leaving the app or going online. Organisations that roll the app out also have to tell participants what is
recorded and where it goes (GDPR Art. 13), name a controller, and show the licences of bundled components.
Right now the app has none of this.

## Scope
- in:
  - A "Help & legal" view in the same window (not modal), opened from a top-bar button and from a link in
    Settings. It works from setup, from Settings and during a live meeting. "Back" returns to where it was
    opened and puts focus back on the button that opened it. A running recording keeps running.
  - Help: how a meeting works (agenda vs. agenda-free mode, recording and consent, speakers, the sound wave,
    ending a meeting), keyboard shortcuts, troubleshooting (microphone lost, no speech model, no speaker model),
    each troubleshooting entry with a button that opens the matching Settings section.
  - Legal notes: a privacy notice that describes what the app does today (what is recorded, where it is stored,
    encryption at rest, that audio is never written, that nothing leaves the device), the consent texts the app
    shows, an imprint/controller block that an organisation fills in, and open-source licences of the bundled
    components with their full licence texts.
  - The organisation's details come from an optional plain JSON file `<app_data>/organisation.json` that IT
    deploys (closed schema: `name`, `address`, `controller`, `dpoContact`, `contact`, `imprintUrl`, all optional
    strings). The core reads it through one Tauri command and shows it read-only. If the file is missing, the view
    shows a placeholder that says the organisation has not added its details yet.
  - All text in de and en by key, bundled with the app.
- out:
  - Privacy paragraphs for features that are not built yet: voice profiles across meetings (job 010) and the
    Claude language-model engine (job 011). Those jobs add their paragraphs to this view (see Open questions).
    Paragraphs for exports, the phone web view and the AI participant are also out until those features exist.
  - Editing organisation details in the app, and any setting for audio retention (audio is never written today).
  - Search inside help, context-sensitive help on single controls, and online documentation or links that open
    a browser.
  - Model download or model setup.

## Stack
Status: EXISTING

## Acceptance criteria
- [ ] AC1: The top bar has a "Help & legal" button on the setup, live (agenda and agenda-free) and settings
  views, and Settings has a link to the same view. Opening it shows the view in the same window with the tabs
  "Help" and "Legal notes". "Back" or Escape returns to the view it was opened from and focuses the button that
  opened it. On the `live-transcript` fixture, recording state and timer keep running while the view is open
  and after returning. (Component + Playwright test.)
- [ ] AC2: Help shows the sections "How a meeting works" (agenda mode, agenda-free mode, recording and consent,
  speakers, sound wave, ending a meeting), "Keyboard shortcuts" and "Troubleshooting" (microphone lost, no speech
  model, no speaker model). Each troubleshooting entry has a button that opens Settings at the right section
  (microphone lost → audio, no speech model and no speaker model → the section that holds the model pickers). The
  shortcut list is generated from the same shortcut registry module that `App.tsx` and the views use to bind
  keys, so a test fails if a bound shortcut is missing from the list or a listed one is not bound. (Unit +
  component test.)
- [ ] AC3: Legal notes shows the privacy notice and states, by key, at least: meetings and transcripts are stored
  only in `<app_data>/meetings/` on this device and encrypted (XChaCha20-Poly1305, key in the OS keychain);
  audio is never written to disk; the input level is never stored; nothing is sent off the device; recording
  starts only after the facilitator confirms that everyone was informed, and an indicator is visible while it
  runs; transcripts and meetings stay until a person deletes them. (NFR Privacy: on-device storage, encryption
  at rest, consent before recording, recording indicator, nothing leaves the device.) The "Consent texts"
  section renders the same i18n keys that the consent dialog uses (`consent.title`, `consent.check`,
  `consent.local`); a test changes the value of one key and sees it change in both places.
- [ ] AC4: Organisation details. With a valid `organisation.json`, the imprint block shows its fields. With no
  file, the placeholder is shown. Security negative tests in Rust: a file larger than 16 KB, invalid JSON,
  unknown keys, non-string values, or a field over 1,000 characters are rejected; the view then shows the
  placeholder plus a notice that the file could not be read, and the app still starts. The command never returns
  or logs the raw file content on error. The UI renders all fields as text only (no HTML, no clickable links,
  `react/no-danger` holds); a component test with `<img src=x onerror=…>` and `javascript:` values shows them as
  literal text. (NFR Security: untrusted input.)
- [ ] AC5: Licences lists every bundled component with name, version, licence identifier and full licence text,
  stored in the app bundle: at least whisper.cpp (via `whisper-rs`), sherpa-onnx, Tauri, React, and the Inter
  font. Speech and speaker models are listed as "not bundled; the licence of the model you placed applies",
  naming the known licences of the supported model families (whisper ggml: MIT; 3D-Speaker: Apache-2.0;
  WeSpeaker VoxCeleb and NeMo TitaNet: CC-BY-4.0). A test checks that the versions listed for `whisper-rs` and
  `sherpa-onnx` match `src-tauri/Cargo.lock`, and that no entry has an empty licence text.
- [ ] AC6: Offline and in two languages. In Playwright, with all non-local requests blocked, every tab and section
  of the view renders completely and the test sees no request outside the app origin. Every string comes from
  `de.json`/`en.json` (the key-mode test covers the new view, `react/jsx-no-literals` holds), de is the default,
  and switching the language in the top bar switches the view at once. (NFR Architecture: works offline;
  NFR Internationalisation.)
- [ ] AC7: Accessible on laptop, phone width and board. Axe reports no violations in light and dark at 1280×800,
  375 px and 1920×1080. Headings form one outline (one `h1`, sections as `h2`); tabs follow the existing settings
  tab pattern (arrow keys, Home/End); every control can be reached and used by keyboard with visible focus;
  touch targets are at least 48 px at 1920×1080; long legal text reflows without horizontal scrolling at
  375 px. `npm run screenshot` writes `help` and `legal` views at all three widths. (NFR Clients and usability.)

## Design
Source: figcraft design/meeting-companion.figcraft
Status: NEEDED
No frame covers help or legal notes. The design gate builds new FigCraft frames (script
`design/build/s17_help.py` and siblings, exported to `design/screens/`) in the existing style. They have to answer:
- Entry: where the "Help & legal" button sits in the top bar next to the language switch and the Settings button
  on setup, live and settings views (laptop, 768, 375 and board), including how it collapses to an icon when narrow;
  where the link sits inside Settings.
- Layout of the view: tabs "Help" / "Legal notes" and the section navigation inside each (left list like Settings,
  or one long page with anchors); how it looks when opened during a live meeting (is the recording indicator still
  visible in the top bar).
- Help states: "How a meeting works" as text with small illustrations or plain text; the shortcut table; the
  troubleshooting entries with their "Open settings" buttons.
- Legal states: privacy notice (long text, reading width); consent texts block; imprint block filled vs. placeholder
  vs. "file could not be read"; licence list with a collapsed and an expanded licence text.
- Variants: light and dark, 1280×800, 375 px, 1920×1080 board.

## Surfaces
- User-facing UI: yes — new help/legal view, a top-bar button, a link in Settings
- Security-relevant: yes — reads an IT-deployed file from `<app_data>` (untrusted input, size limit, closed schema,
  text-only rendering, no content in logs); no network, no new Tauri plugins; rules touched: NFR Security
  ("untrusted input"), NFR Privacy (statements must match behaviour)
- Human gate: yes — the privacy notice and consent texts are legal statements to users (GDPR Art. 13); a person
  responsible for data protection signs off the wording in de and en before merge
- Audio/transcript data: no — the feature reads no audio or transcripts; it only describes how they are stored
- Leaves the device: no
- Board (touch) layout: yes — the view must work at 1920×1080 by touch with ≥ 48 px targets
- AI speaks or contributes unasked: no

Size: normal

## Open questions
- Assumed: the privacy notice only describes features that exist on main. Jobs 010 (voice profiles) and 011
  (language model engine, Claude) are still at the spec stage; each of them should add a criterion "add the
  privacy paragraph to Legal notes" (what is stored, where, how to delete a voice profile; that transcript text
  goes to Anthropic when the Claude engine is chosen). The orchestrator should add this to both specs.
- Assumed: organisation details come from an IT-deployed `organisation.json` instead of a field in Settings,
  because rollouts are done by IT and the settings file is sealed. If organisations should type them in the app
  instead, that is a settings schema change and a separate small job.
- Assumed: no retention text for audio, because audio is never written (NFR "audio deleted after 30 days" does
  not apply yet). Transcripts and meetings stay until deleted; there is no delete-meeting UI yet, so the text
  says how to delete them once that exists — the wording needs the sign-off named under Human gate.
- Licence texts: the builder should generate the list from `Cargo.lock` and `package-lock.json` for runtime
  dependencies (e.g. with `cargo about`/`license-checker` run by a script, output committed) rather than by hand;
  AC5 only pins the components the request names.
- Split, if wanted: 014a "Help" (AC1, AC2, AC6, AC7 for help) and 014b "Legal notes" (AC3–AC5, AC6, AC7 for
  legal, human gate). 014a has no legal sign-off and could merge first.
