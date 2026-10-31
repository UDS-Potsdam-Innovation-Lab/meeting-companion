# Voice profiles (opt-in, consent on the person's own phone)

## Problem
Job 004 matches voices to people only within one recording: every meeting starts with "Voice A, B, C" again, and the facilitator has to rely on the name round or assign everyone by hand. Regular teams want the app to recognise people who agreed to it. A voice profile is biometric data used to identify a person (GDPR Art. 9). So it may exist only after that person's explicit consent, given on their own device and not by the facilitator. It must be encrypted per person, and the person must be able to delete it at any time. The assistant still only suggests a name; a person confirms it (profile: "The assistant never decides").

**Legal check required before building (GDPR Art. 9, likely a DPIA under Art. 35).** This spec is input to that check. The build waits for a human.

## Scope
- in:
  - The "Ask people to save their voice" card on frame 06. It is off by default and set per meeting. Only the facilitator's device can switch it on, and only while the speakers view is open during a recording.
  - Switching it on opens the local phone web view. It is opt-in, bound to the local network interface only, protected by a random per-meeting token carried in the QR code, and closed when the toggle goes off, the recording stops or the meeting ends (NFR Security). The QR code and short URL are shown on the card. This is the first listening port in the app.
  - The consent page on the phone. The person picks their own name from the people with a **confirmed** voice in this meeting. The page shows the consent text: what is stored (voice features, no audio), where (only this device), what for (suggesting their name in transcripts here), how long (until deleted; automatic deletion after 12 months without use), and how to withdraw. Nothing is preselected. "Save my voice" is the only way to give consent; "No thanks" and closing the page store nothing.
  - The profile store. One sealed file per profile, `<app_data>/voices/<profile-id>.voice`, holding the display name, the voice centroid, the consent time, the consent text version and the last use. Each profile has its **own** random key in the OS keychain (`KeyProvider`, one entry per profile). Deleting a profile removes both the key and the file (crypto-erasure).
  - Recognition. When recording starts, profiles whose display name matches an invited participant (same rules as job 004's name round) are loaded. A voice whose centroid is close to a loaded profile gets the suggestion source "Remembered voice". It stays a suggestion until a person confirms it, exactly like a name-round suggestion. Loading or matching a profile updates its last-use date.
  - Deletion by the person:
    - On the phone, during any meeting with the web view open: "Delete my voice" with the deletion code shown once at consent.
    - On the device, under Settings › "Voice profiles": a list of names with consent date and last use, and "Delete" per profile. Deleting needs no special role, so asking anyone at the device is enough.
    - A profile not used for 12 months is deleted when the app starts.
  - A board-visible notice on frame 06 when someone saves or deletes a voice ("Mara Klein saved her voice"), so a wrong claim is noticed and undone.
  - Mock backend support, a fake phone client for tests, and e2e fixtures.
- out:
  - Enrolment by reading a sentence aloud, or from audio recorded outside a meeting. The profile is built only from the voice already confirmed for that person in the running meeting.
  - Moving profiles between devices, export, backup or sync. A profile belongs to the one device that holds it.
  - Remote (Teams) people. Their names come from Teams (Teams job).
  - The team review on phones (frame 08). That job reuses this job's web view.
  - TLS on the local web view (see Open questions).
  - Smart board layout (frame 05).

## Stack
Status: PROPOSED (an addition to the configured stack. Tauri, Rust, React, and the test and lint commands are unchanged. A person confirms the new component before the build.)
- Language/framework: unchanged (Rust core in Tauri 2, React 19 + Vite 6 UI).
- New crate: `axum = "0.8"` (MIT), the phone web view server. It runs on the tokio runtime Tauri already brings, binds to one chosen LAN interface and a random port, and is never bound to `0.0.0.0`. No new Tauri plugin; the desktop CSP and `src/config.test.ts` stay as they are.
- New crate: `qrcodegen` (MIT, no dependencies). It renders the QR code as an SVG path in the core, so no image file and no network are involved.
- Phone page: a second Vite entry `phone.html` with `src/phone/`, using the same i18n keys. The core serves it from embedded assets with its own strict CSP (`default-src 'self'`, no inline script, `connect-src 'self'`).
- Test command: unchanged (`npm test`). Server tests bind to `127.0.0.1` with an injected address; tests never use the network beyond loopback.
- Lint command: unchanged (`npm run lint`).
- Layout:
  - `src-tauri/src/voices/`: `VoiceProfileStore` trait with `FileVoiceProfileStore` and `MemoryVoiceProfileStore`, matching, expiry.
  - `src-tauri/src/webview_lan/`: server, token, routes, rate limit.
  - `src/features/speakers/` (card and notice), `src/features/settings/` (profile list), `src/phone/` (consent and delete pages).
- Rejected:
  - `tiny_http`: thinly maintained, and a thread per request.
  - `actix-web`: a second async runtime next to tokio.
  - `tauri-plugin-localhost`: loopback only, so phones cannot reach it.
  - Consent on the facilitator's device: the request requires the person's own device.

## Acceptance criteria
- [ ] AC1: Off by default, consent only from the person, only on the phone. All tests use the fake audio, STT and diarizer, the in-memory store, the `MemoryKeyProvider` and a fake phone client on loopback.
  - The toggle is off in every new meeting, and no port is open (port-scan test on loopback and the chosen interface).
  - With the toggle off, no `.voice` file is ever written, even if a person is confirmed by hand.
  - With the toggle on, a profile is written only after a `POST` of "Save my voice" carrying the valid meeting token, the person's id and the shown consent-text version.
  - The person must have a confirmed voice in this meeting. An unconfirmed, unsure or unknown person, a guest without a confirmed voice, and a second consent for an existing profile are rejected, and nothing is written.
  - "No thanks", a closed page, and a facilitator-side IPC call all write nothing. No desktop IPC command can create a profile (the capability-file test lists the commands).

  (NFR Privacy "Voice profiles are stored only for people who opted in"; profile: the assistant never decides)
- [ ] AC2: The local web view is locked down. It listens only while the toggle is on during a recording, on one LAN interface plus a random port, never on `0.0.0.0`. It closes within 1 s when the toggle goes off, the recording stops, or the meeting ends (test: the connection is refused afterwards). The token is ≥ 128 bit from the OS RNG, new for each opening, and compared in constant time. Security negative tests:
  - A missing, wrong or old token gets 403 with a body that does not reveal whether a meeting exists.
  - A token that is valid but belongs to another meeting is rejected.
  - Requests with a foreign `Origin` or `Host` header are rejected (CSRF and DNS rebinding).
  - Bodies over 4 KB, unknown fields, malformed ids, and names in place of ids are rejected.
  - After more than 10 requests per minute from one address, the server answers 429.
  - The pages send CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.
  - The phone page shows only first name and initials of confirmed people. It never shows the transcript, embeddings, or other meeting data, and no route returns them.

  (NFR Security "No listening network ports except the opt-in local web view …"; profile reviewer-security)
- [ ] AC3: Per-person encryption and crypto-erasure. Each `.voice` file is sealed with XChaCha20-Poly1305 under its own random key. The key is stored as its own `KeyProvider` entry. The AAD binds the purpose "voice" and the profile id. Rust tests:
  - Two profiles use different keys.
  - A file swapped to another profile id, or tampered with, fails to open and is reported as unreadable. It is never used and never crashes the app.
  - After a deletion, both the key entry and the file are gone, and a copy of the file taken before the deletion cannot be opened with any remaining key.
  - The fake embedding marker and the display name appear in no file in plain text, and in no log or error (log-capture test).
  - No audio is written (the app data folder holds only `.meeting`, `.transcript`, `settings` and `voices/*.voice`).

  (NFR Privacy "encrypted at rest", "Secrets … go into the OS keychain")
- [ ] AC4: Recognition suggests, never confirms. Profiles are loaded only for invited participants whose name matches the profile's display name (job 004 name rules). Profiles of people not on the invite are never loaded or compared. In a new meeting, a scripted voice close to a loaded profile gets a suggestion with the source "Remembered voice". The transcript still shows "Voice A" until a person confirms it. A voice close to two profiles becomes "Unsure", as in job 004. When both a name-round and a remembered-voice suggestion exist and they disagree, the voice is "Unsure". Loading or matching updates the last use. Profiles never change from recognition: the centroid is fixed at consent. Unit and component tests cover these cases. (profile: the assistant never decides; NFR Privacy)
- [ ] AC5: Deletion by the person, at any time.
  - On the phone, "Delete my voice" with the 8-character deletion code from the consent page removes the profile. A wrong code is rejected and counts towards the rate limit.
  - Under Settings › "Voice profiles", each profile shows its name, consent date and last use, with "Delete" behind a confirmation. Deleting works by keyboard and by touch, with no special role.
  - A profile whose last use is more than 12 months ago is deleted at app start (test with an injected clock).
  - Each deletion also drops the profile's in-memory centroid in a running recording. Suggestions already made revert to "Voice X" unless a person has confirmed them.
  - Deleting a profile does not change any `.meeting` or `.transcript` file (byte-identical test).

  (NFR Privacy "can be deleted by them"; GDPR Art. 7(3), Art. 17)
- [ ] AC6: Visible to everyone in the room.
  - While the web view is open, frame 06's card shows "Phones can save voices" with the QR code and short URL, and frame 02's footer shows a persistent marker next to REC.
  - Every save and delete shows a non-blocking notice on frame 06 and 02 ("Mara Klein saved her voice", "A voice profile was deleted") for 8 s, with "Undo" on a save that deletes the profile again.
  - The consent and delete texts are versioned keys in `de.json` and `en.json`, and the stored consent version is shown in Settings.

  Component tests cover these. (NFR Privacy "a recording indicator is always visible"; profile reviewer-ux: nudges never block)
- [ ] AC7: Accessibility, i18n and screenshots.
  - All new strings come from `de.json`/`en.json` keys, on the desktop and the phone page; the parity and no-literal tests pass.
  - Playwright + axe report no WCAG 2.2 AA violations and no horizontal scroll in these fixtures: `speakers-profiles-off` and `speakers-profiles-on` at 1280×800, `settings-voices` and `settings-voices-empty` at 1280×800, and `phone-consent`, `phone-saved`, `phone-delete` and `phone-closed` at 375×667.
  - Phone targets are at least 48×48 px. The keyboard reaches the toggle, the QR card, every "Delete", and the confirmation, with a visible focus ring.
  - `npm run screenshot` adds the fixtures. The smoke test still passes and opens no port.

  (NFR Clients and usability, Internationalisation)

## Design
Source: figcraft design/meeting-companion.figcraft, frame "06 Speakers" (`design/screens/s6_speakers.png`, generator `design/build/s6_speakers.py`) for the toggle card only
Status: NEEDED
Frame 06 shows only the off toggle "Ask people to save their voice · Each person decides on their own device" and the "Remembered voice" source in a picker. Nothing else exists. Before the build, a FigCraft prototype (scripts in `design/build/`, exported to `design/screens/`) has to answer the following.
- Frame 06, toggle on: the card with the QR code and short URL, and how it fits beside "Invited" and "Apply names to transcript" at 1280×800. The notice "Mara Klein saved her voice" with Undo. The footer marker on frame 02.
- The phone flow at 375 px, in the existing style (warm neutral, white cards, indigo `#4338CA`, Inter):
  - The page shows the name list: confirmed people only, with first name and initials.
  - The person picks their name, then sees the consent text (what, where, what for, how long, withdrawal) with "Save my voice" / "No thanks". Neither is preselected, and neither looks like the default.
  - "Saved" with the deletion code shown once and "Write this down".
  - "Delete my voice" with code entry.
  - "This page is closed" for an expired token.
- Settings: a "Voice profiles" section with a list (name, consent date, last use, consent version), "Delete" with a confirmation, and the empty state "No voices saved on this device".
- Wording of the consent text in de and en. The final text comes from the legal check.

## Surfaces
- User-facing UI: yes. The frame 06 card and notice, the frame 02 footer marker, the Settings "Voice profiles" list, and new phone pages served over the local network.
- Security-relevant: yes.
  - The first listening network port (LAN, token-protected).
  - Untrusted input from phones (ids, codes).
  - CSRF and DNS rebinding.
  - Biometric data at rest, with per-person keys in the OS keychain.
  - Crypto-erasure.
  - Rules touched: NFR Security (only listening port is the opt-in phone web view, per-meeting token, closed at meeting end; transcript text untrusted); NFR Privacy (voice profiles only on opt-in and deletable by the person, encrypted at rest, secrets in the keychain, nothing leaves the device); NFR Architecture (engines behind interfaces). No secure-coding guideline is configured.
- Human gate: yes. The job stores biometric data (GDPR Art. 9) across meetings, adds keychain entries per person and opens the app's first network listener. It needs a legal check before the build.
- Audio/transcript data: yes. Stored, encrypted with a per-person key: one `.voice` file per consenting person in `<app_data>/voices/`, holding display name, voice centroid (embedding), consent time, consent-text version and last use. It is kept until the person deletes it, or for 12 months after its last use. No audio is stored, and transcripts are unchanged.
- Leaves the device: no for biometric data. On the local network only, the phone receives the consent page, first names and initials of confirmed people, and the deletion code, and sends back the consent and deletion requests. Nothing goes to the internet.
- Board (touch) layout: no. Laptop from 1280 px and phone at 375 px. The phone targets are ≥ 48 px.
- AI speaks or contributes unasked: no. "Remembered voice" is a suggestion in the speakers view and changes nothing until confirmed.

Size: normal

## Open questions
- **Legal check (blocking).** These need a decision before the build:
  - Is explicit consent under Art. 9(2)(a) given on the person's own phone enough? Is a DPIA (Art. 35) needed? (Likely.)
  - Who is the controller: the organisation running the device, or the facilitator?
  - The final consent text in de and en.
  - Retention: 12 months without use is assumed.
  - **Minors.** Schools are a target group: may pupils consent at all, and from what age? Assumed: a setting "Voice profiles allowed on this device", off by default, that an administrator turns on. This is not in the ACs yet.
  - Does the profile need to record who facilitated the consent?
- No TLS on the LAN web view. Only the token, ids, the choice and the deletion code cross the LAN; no audio or embeddings do. Self-signed TLS would show certificate warnings on every phone. A person decides whether plain HTTP on the local network is acceptable, or whether this waits for a TLS solution.
- **Identity.** The person picks their own name from the confirmed people; nothing stronger proves who they are.
  - Mitigations: the board-visible notice with Undo, and a profile built only from a voice a person has already confirmed in the meeting.
  - Risk: someone could claim another person's confirmed voice. A stronger option would be a one-time code read aloud and detected in the transcript. That is more work and less reliable.
- **Deletion route.** Assumed: anyone at the device may delete any profile in Settings, because deletion only ever reduces data, and the phone path needs the deletion code. If the code is lost, the person asks someone at the device. The alternative is to require the facilitator's confirmation.
- Profiles are matched to invited participants by display name. Two people with the same name on one device clash; the second consent is rejected (AC1) until the first is deleted.
- Centroid quality: a single meeting's centroid, from 3 s windows, may recognise people poorly in another room or with another microphone. Profiles are deliberately never updated from recognition (AC4), because that would mean processing biometric data without fresh consent.
- **Split (recommended).** This job spans a new network service, a phone UI and desktop UI, so I would split it into two jobs:
  - (a) "Local phone web view": the server, token, QR code, lockdown and closing rules (AC2, and AC7 for the `phone-closed` page), plus the stack addition. The team review (frame 08) reuses it.
  - (b) "Voice profiles" on top of it: AC1, AC3–AC7.

  Job (a) has no biometric data and could be built while the legal check for (b) runs. It still needs the human gate for the first listening port.
