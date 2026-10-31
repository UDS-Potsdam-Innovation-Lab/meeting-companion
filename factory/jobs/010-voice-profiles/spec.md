# Voice profiles (opt-in, consent on the person's own phone)

## Problem
Job 004 matches voices to people only within one recording: every meeting starts with "Voice A, B, C" again, and the facilitator has to rely on the name round or assign everyone by hand. Regular teams want the app to recognise people who agreed to it. A voice profile is biometric data used to identify a person (GDPR Art. 9). So it may exist only after that person's explicit consent, given on their own phone and not by the facilitator. It must be encrypted per person, and the person must be able to delete it at any time. The assistant still only suggests a name; a person confirms it (profile: "The assistant never decides").

Revised after spec review 1 (human, `stack-decision.md`):
- The phone web view moved to job 012-phone-web-view; this job builds on it.
- The legal points are decided (see "Legal decisions").
- An admin setting is in scope.
- The consent and privacy texts also appear in the Help and legal notes area (job 014-help-legal).

### Legal decisions (spec review 1, human, 2026-10-31)
- Explicit consent (Art. 9(2)(a)) given on the person's own phone is sufficient.
- The organisation that operates the device is the controller.
- A profile is deleted 12 months after its last use.
- The consent text is the draft below, in de and en. It is shown on the phone, stored in the app, and its version is stored with each profile.
- Voice profiles are allowed on a device only through an admin setting, which is off by default.
- Plain HTTP on the local network is accepted, because no audio or voice data crosses it.
- Safeguard against someone claiming another person's voice: a notice everyone in the room can see, with Undo.
- Anyone at the device may delete any profile.

## Scope
- in:
  - **Device setting** "Allow voice profiles on this device" (`voiceProfilesAllowed`, default off) in Settings. It is a new field in the closed settings schema. While it is off:
    - frame 06 does not show the "Ask people to save their voice" card;
    - no profile is loaded, matched or written;
    - existing profiles stay listed in Settings, where they can be deleted.

    Turning it off again keeps existing profiles. Who counts as an admin is the person with access to Settings on that device; there are no app roles.
  - **The "Ask people to save their voice" card on frame 06.** It shows only when the setting is on, is off in every meeting, and is used only on the facilitator's device while the speakers view is open during a recording. Switching it on opens 012's phone web view and mounts this job's pages on it. The card then shows 012's QR code and short URL. Switching it off, stopping the recording or ending the meeting closes the view (012's lifecycle).
  - **The consent page on the phone, served through 012:**
    - The person picks their own name from the people with a **confirmed** voice in this meeting; the page shows only first name and initials.
    - The page then shows the consent text: what is stored (voice features, no audio), where (only this device), what for (suggesting their name in transcripts here), who is responsible (the organisation operating the device, using the controller field from 014), how long (until deleted; automatic deletion 12 months after last use), and how to withdraw.
    - Nothing is preselected. "Save my voice" is the only way to give consent; "No thanks" and closing the page store nothing.
    - "Saved" shows a deletion code once.
  - **The profile store.** One sealed file per profile, `<app_data>/voices/<profile-id>.voice`, holding the display name, the voice centroid, the consent time, the consent-text version and the last use.
    - Each profile has its **own** random key in the OS keychain (`KeyProvider`, one entry per profile).
    - Deleting a profile removes the key and the file (crypto-erasure).
    - A `VoiceProfileStore` trait has a file implementation and an in-memory one for tests.
  - **Recognition.** When recording starts, the app loads the profiles whose display name matches an invited participant (job 004's name rules).
    - A voice whose centroid is close to a loaded profile gets the suggestion source "Remembered voice". It stays a suggestion until a person confirms it.
    - Loading or matching a profile updates its last-use date.
  - **Deletion:**
    - "Delete my voice" on the phone, with the deletion code, while a phone web view is open.
    - Settings › "Voice profiles": the list, with "Delete" per profile, for anyone at the device.
    - Expiry 12 months after last use, checked at app start.
  - **Visible to the room.** Frame 06 shows a notice when someone saves or deletes a voice ("Mara Klein saved her voice"), with Undo on a save.
  - **Texts.** The consent and privacy texts are versioned i18n keys. Job 014 shows the same keys in Help and legal notes, and this job links to them from the phone page, the frame 06 card and Settings.
  - Mock backend support, a fake phone client against 012's test harness, and e2e fixtures.
- out:
  - The phone web view itself, which belongs to job 012:
    - the server, binding and token;
    - CSRF, DNS-rebinding and rate-limit protection, and the headers;
    - the QR code and the "closed" page.
  - The Help and legal notes area itself (job 014). This job delivers the texts and links to it.
  - Enrolment by reading a sentence aloud, or from audio recorded outside a meeting. The profile is built only from the voice already confirmed for that person in the running meeting.
  - Moving profiles between devices, export, backup or sync.
  - Remote (Teams) people, the team review (frame 08), and the smart board layout (frame 05).
  - Updating a profile from later meetings. Its centroid is fixed when the person consents.

## Stack
Status: EXISTING
Configured stack (Rust, Tauri 2, React 19 + Vite 6). The test command (`npm test`) and lint command (`npm run lint`) are unchanged. This job adds no crates and no server code.
- **Depends on 012-phone-web-view** for its HTTP server (axum 0.8), token check, protections, QR code (qrcodegen) and phone page entry. Job 012 must be merged first.
- This job only registers its own phone routes and pages through the API that job 012 exposes. Assumed: a route registration that receives the already-validated meeting token, plus open and close calls tied to the card.
- Layout:
  - `src-tauri/src/voices/`: store, matching and expiry.
  - `src/features/speakers/`: the card and the notice.
  - `src/features/settings/`: the setting and the profile list.
  - The voice pages under 012's phone entry, e.g. `src/phone/voices/`.

## Acceptance criteria
- [ ] AC1: Consent only from the person, only on the phone, only when allowed. All tests use the fake audio, STT and diarizer, the in-memory stores, `MemoryKeyProvider`, and a fake phone client on 012's loopback test harness.
  - With `voiceProfilesAllowed` off (the default), frame 06 has no card, the voice routes are not mounted, no profile is loaded or matched, and no `.voice` file is ever written.
  - With the setting on, the card is off in every new meeting. A profile is written only after the phone sends "Save my voice" with the person's id and the consent-text version that was shown.
  - The person must have a confirmed voice in this meeting. These are rejected, and nothing is written:
    - an unconfirmed, unsure or unknown person;
    - a guest without a confirmed voice;
    - an outdated consent version;
    - a malformed id, a name in place of an id, or an unknown field;
    - a second consent for an existing profile.
  - "No thanks", a closed page, and any desktop IPC call write nothing. No IPC command can create a profile (capability-file test).

  (NFR Privacy "Voice profiles are stored only for people who opted in"; profile: the assistant never decides)
- [ ] AC2: Per-person encryption and crypto-erasure. Each `.voice` file is sealed with XChaCha20-Poly1305 under its own random key. The key is a separate `KeyProvider` entry, and the AAD binds the purpose "voice" and the profile id. Rust tests:
  - Two profiles use different keys.
  - A file moved to another profile id, or tampered with, is reported as unreadable, never used, and does not crash the app.
  - After a deletion, the key entry and the file are gone, and a copy of the file taken before the deletion cannot be opened with any remaining key.
  - The fake embedding marker and the display name appear in no file in plain text, and in no log or error (log-capture test).
  - No audio is written: the app data folder holds only `.meeting`, `.transcript`, `settings` and `voices/*.voice`.

  (NFR Privacy "encrypted at rest", "Secrets … go into the OS keychain")
- [ ] AC3: Recognition suggests, never confirms.
  - Profiles are loaded only for invited participants whose name matches the profile's display name. Profiles of people not on the invite are never loaded or compared.
  - A scripted voice close to a loaded profile gets the suggestion source "Remembered voice". The transcript still shows "Voice A" until a person confirms it.
  - A voice close to two profiles becomes "Unsure". So does a voice whose name-round suggestion disagrees with its remembered-voice suggestion.
  - Loading or matching updates the last use. Recognition never changes a profile's centroid.

  Unit and component tests cover these cases. (profile: the assistant never decides; NFR Privacy)
- [ ] AC4: Deletion by the person, at any time.
  - On the phone, "Delete my voice" with the 8-character deletion code removes the profile. A wrong or malformed code is rejected without saying whether the profile exists, and counts towards 012's rate limit.
  - Settings › "Voice profiles" lists each profile's name, consent date, last use and consent version. "Delete" sits behind a confirmation, works by keyboard and touch, and needs no role. This also works while `voiceProfilesAllowed` is off.
  - A profile whose last use is more than 12 months ago is deleted at app start (test with an injected clock).
  - A deletion during a recording drops the profile's centroid in memory. Unconfirmed "Remembered voice" suggestions revert to "Voice X".
  - Deleting a profile leaves every `.meeting` and `.transcript` file byte-identical.

  (NFR Privacy "can be deleted by them"; GDPR Art. 7(3), Art. 17)
- [ ] AC5: Visible to everyone in the room.
  - While the card is on, frame 06 shows "Phones can save voices" with 012's QR code and short URL. Frame 02's footer shows a persistent marker next to REC.
  - Every save and delete shows a non-blocking notice on frames 06 and 02 for 8 s, e.g. "Mara Klein saved her voice" or "A voice profile was deleted". A save's notice has "Undo", which deletes that profile again.

  Component tests cover these. (NFR Privacy "a recording indicator is always visible"; profile reviewer-ux: nudges never block)
- [ ] AC6: Consent and privacy texts, versioned and linked to Help and legal notes (014).
  - The consent text (the draft in "Legal decisions", de and en) and the voice-profile privacy section are i18n keys with a version, e.g. `voices.consent.v1.*`.
  - Changing the text means a new version; a test fails if a versioned key's text changes in place.
  - The phone consent page, the frame 06 card and Settings › "Voice profiles" each link to the matching section of 014's Help and legal notes ("Privacy: voice profiles").
  - The controller line uses 014's organisation field, with a visible placeholder if it is empty.
  - A test checks that the version stored in a profile is the one shown on the phone.
- [ ] AC7: Accessibility, i18n and screenshots.
  - All new strings come from `de.json`/`en.json` keys; the parity and no-literal tests pass.
  - Playwright + axe report no WCAG 2.2 AA violations and no horizontal scroll in these fixtures:
    - at 1280×800: `speakers-profiles-off`, `speakers-profiles-on`, `settings-voices`, `settings-voices-empty`, `settings-voices-disallowed`;
    - at 375×667: `phone-voice-pick`, `phone-consent`, `phone-saved`, `phone-delete`.
  - Phone targets are at least 48×48 px.
  - The keyboard reaches the setting, the card toggle, every "Delete", the confirmation and the legal links, with a visible focus ring.
  - `npm run screenshot` adds the fixtures. The smoke test still passes and opens no port.

  (NFR Clients and usability, Internationalisation)

## Design
Source: figcraft design/meeting-companion.figcraft, frame "06 Speakers" (`design/screens/s6_speakers.png`, generator `design/build/s6_speakers.py`) for the toggle card only
Status: NEEDED
Frame 06 shows only the off toggle "Ask people to save their voice · Each person decides on their own device" and the "Remembered voice" source in a picker. Before the build, a FigCraft prototype (scripts in `design/build/`, exported to `design/screens/`) has to answer the following.
- **Frame 06, card on:** 012's QR code and short URL in the card, at 1280×800 next to "Invited" and "Apply names to transcript". The notice "Mara Klein saved her voice" with Undo. The footer marker on frame 02.
- **Phone voice pages at 375 px**, inside 012's phone page shell:
  - The page shows the name list: confirmed people only, first name and initials.
  - The person picks their name, then sees the consent text with "Save my voice" / "No thanks". Neither is preselected, and neither looks like the default.
  - "Saved" with the deletion code shown once.
  - "Delete my voice" with code entry.
  - The link to the privacy notes.
- **Settings:**
  - The "Allow voice profiles on this device" switch, with its explanation and a link to the privacy notes.
  - The "Voice profiles" list (name, consent date, last use, consent version) with "Delete" and its confirmation.
  - The empty state "No voices saved on this device", and the state where profiles exist but the setting is off.
- Style: warm neutral, white cards, indigo `#4338CA`, Inter.

## Surfaces
- User-facing UI: yes. A Settings switch and the "Voice profiles" list, the frame 06 card and notice, the frame 02 footer marker, and the phone voice pages (served by 012).
- Security-relevant: yes.
  - Biometric data at rest, with per-person keys in the OS keychain, and crypto-erasure.
  - Untrusted phone input (ids, consent version, deletion code) on routes mounted on 012's server; the server-level protections are 012's ACs.
  - A capability check that no IPC command can create a profile.
  - Rules touched: NFR Privacy (voice profiles only on opt-in and deletable by the person, encrypted at rest, secrets in the keychain, nothing leaves the device); NFR Security (the only listening port is 012's opt-in phone web view). No secure-coding guideline is configured.
- Human gate: yes. The job stores biometric data (GDPR Art. 9) across meetings and adds keychain entries per person. The legal check is decided (spec review 1); the merge still needs a human.
- Audio/transcript data: yes. Stored, encrypted with a per-person key: one `.voice` file per consenting person in `<app_data>/voices/`, holding the display name, voice centroid, consent time, consent-text version and last use. It is kept until deleted by anyone at the device or by the person on the phone, or until 12 months after its last use. No audio is stored, and transcripts are unchanged.
- Leaves the device: no for biometric data. Over 012's local-network web view (plain HTTP, accepted):
  - the phone receives the consent page, the first names and initials of confirmed people, and the deletion code;
  - the phone sends back the consent and the deletion requests.

  Nothing goes to the internet.
- Board (touch) layout: no. Laptop from 1280 px; phone at 375 px with targets ≥ 48 px.
- AI speaks or contributes unasked: no. "Remembered voice" is a suggestion in the speakers view and changes nothing until confirmed.

Size: normal

## Open questions
- **012's API.** Job 012 has no spec yet. This spec assumes 012 provides:
  - route and page registration on its server, behind its token check;
  - open and close calls the frame 06 card can drive;
  - its rate limiter, available to the voice routes;
  - a fake phone client on a loopback test harness.

  If 012's API ends up different, the builder adapts the wiring; the criteria stay.
- **014's API.** Assumed: 014 offers deep links to sections (e.g. "Privacy: voice profiles") and an organisation/controller field. If 014 merges after this job, the links point at the section ids that 014 agrees to, and the controller line shows the placeholder.
- **Order of jobs.** 012 must be merged before this job is built. 014 can follow, as long as the section ids and the controller field are agreed first.
- "Admin" means anyone with access to Settings on the device; the app has no roles. Locking Settings would be a separate job.
- Display names: two people with the same name on one device clash. The second consent is rejected (AC1) until the first profile is deleted.
- Centroid quality: one meeting's centroid, from 3 s windows, may recognise a person poorly in another room or with another microphone. Profiles are deliberately never updated by recognition.
