# Local phone web view (QR code, token, closed page)

## Problem
People in the room should be able to act from their own phones: give consent for a voice profile (job 010) now, and review notes and to-dos (frame 08) later. For that, the desktop app needs to serve a small web view to phones on the same local network, reached by scanning a QR code. This is the app's first listening network port, so it must be opt-in and locked down. Only someone holding the current meeting's token can reach it, and it must close the moment it is no longer needed (NFR Security). This job builds only the shared server, the token, the QR code and the phone shell with its "open" and "closed" states. Consumers such as 010 and the team review add their own routes and pages on top.

## Scope
- in:
  - A core module `src-tauri/src/phone_view/` containing:
    - `PhoneViewServer`, an axum 0.8 server on Tauri's tokio runtime.
    - `PhoneViewToken`.
    - A `NetInterfaces` trait that lists local IPv4 addresses, with a system implementation and `FakeNetInterfaces` for tests.
    - Per-address rate limiting.
    - Request hardening.
    - Embedded static assets for the phone page.
    - A route-registration API so consumers can add authenticated `/api/<consumer>/…` routes that all pass through the same middleware.
  - The rules for opening and closing:
    - It opens only on request, and only while the meeting is recording.
    - It closes on request, when recording stops, when the meeting ends, and when the app exits.
  - Two IPC commands for consumers' toggles, plus an event:
    - `phone_view_open(meetingId)` returns `{ url, qrSvg }` or an error key.
    - `phone_view_close()`.
    - The event `phone-view-state` reports `open`/`closed` and the reason.
  - A QR code rendered as an SVG in the core with `qrcodegen`, encoding the phone URL.
  - The phone page: a second Vite entry `phone.html` with `src/phone/`. It has two states, all strings from `de.json`/`en.json`:
    - "Connected", a shell with an empty slot for consumer views.
    - "This page is closed".
  - Mock-backend support for the two commands and the event, e2e fixtures for the phone page, and screenshots.
- out:
  - The voice-profile toggle, the QR card on frame 06, the footer marker and the consent pages. These belong to job 010, which calls this job's API.
  - Team review pages (frame 08).
  - TLS. Plain HTTP on the local network was accepted by the human on 2026-10-31 (`010-voice-profiles/stack-decision.md`).
  - IPv6, and more than one interface at a time.
  - Showing any meeting data on the phone. In this job, no route returns meeting content.

## Stack
Status: EXISTING
The configured stack is Rust/Tauri 2 + React 19/Vite 6, with the existing `npm test` and `npm run lint`. The human confirmed two additions on 2026-10-31 (`factory/jobs/010-voice-profiles/stack-decision.md`):
- `axum = "0.8"` on the tokio runtime that Tauri already brings.
- `qrcodegen` for the SVG QR code.

No other runtime dependency should be needed. Tokens use the OS RNG through the existing crypto dependencies. If listing interfaces needs a crate (for example `if-addrs`), say so in the PR. A QR decoder (for example `rqrr`) is allowed as a dev-dependency only. Desktop CSP, `src/config.test.ts` and the capability rules stay unchanged apart from the two new commands. No Tauri HTTP/shell plugin is added.

## Acceptance criteria
- [ ] AC1: The view opens only on request and closes reliably. Rust tests use `FakeNetInterfaces` and bind to an injected `127.0.0.1` address. Tests never use the network beyond loopback.
  - Before `phone_view_open` is called, no port is open. The smoke test (`node scripts/smoke.mjs`) also opens no port. A port-scan test covers loopback and the chosen address.
  - `phone_view_open` fails with the error key `phoneView.error.notRecording` unless the meeting is recording, and opens nothing.
  - When it opens, it binds one IPv4 address on a random port:
    - The address is a private (RFC 1918) address on an interface that is up and not loopback.
    - If there are several, it prefers the interface with the default route.
    - It never binds `0.0.0.0`, `::` or a public address.
    - With no suitable interface, it fails with `phoneView.error.noLocalNetwork`.
  - Within 1 s of any of these, new connections are refused and open keep-alive connections are dropped. A test covers each trigger:
    - `phone_view_close`
    - recording stops
    - the meeting ends
    - app shutdown
  - Each close sends `phone-view-state` with `closed` and the reason.

  (NFR Security "No listening network ports except the opt-in local web view …, closed when the meeting ends")
- [ ] AC2: The token is per meeting and per opening, and is checked strictly.
  - The token has at least 128 bits from the OS RNG, is base64url-encoded, is new for every opening and is compared in constant time.
  - The token travels only in the URL fragment (`http://<ip>:<port>/#t=<token>`) and in an `Authorization: Bearer` header on API calls. It is never placed in a path or query, so it does not reach logs or a `Referer`. A log-capture test shows that the token appears in no log line or error.
  - Security negative tests:
    - A missing, malformed or wrong token gets 403.
    - The token from an earlier opening of the same meeting (after close and reopen) gets 403.
    - A valid-format token that belongs to another meeting gets 403.
    - All 403 bodies are identical and do not reveal whether a meeting exists or is recording.

  (NFR Security "protected by a per-meeting token in the QR code"; profile reviewer-security "phone web view reachable without the meeting token")
- [ ] AC3: Requests are hardened against misuse and bad input. Each case has a negative test, and these rules also apply to a test route registered through the consumer API.
  - DNS rebinding: a `Host` header other than `<bound-ip>:<port>` gets 421 or 403.
  - CSRF:
    - Any `Origin` other than `http://<bound-ip>:<port>` gets 403.
    - State-changing routes accept only `POST` with `Content-Type: application/json` and the bearer header. Other methods get 405.
  - Bodies:
    - A body over 4 KB gets 413.
    - Malformed JSON, unknown fields, and ids that do not match the route's schema get 400.
  - Static asset paths with `..`, encoded traversal or unknown files get 404 and never read outside the embedded assets.
  - A request whose headers and body are not complete within 10 s is dropped (slowloris test).
  - At most 32 concurrent connections are accepted; further connections are refused.
- [ ] AC4: Rate limit.
  - From one address, more than 10 requests per minute with a missing or wrong token get 429 with `Retry-After`. After that, a valid token from that address also gets 429 until the window ends.
  - From one address, more than 120 requests per minute in total also get 429.
  - Other addresses are not affected.
  - The window can be tested with an injected clock.
- [ ] AC5: Response headers and data exposure.
  - Every response carries these headers (header test on the page, an asset, an API route, and the 403/404/429 answers):
    - `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`
    - `X-Content-Type-Options: nosniff`
    - `Referrer-Policy: no-referrer`
    - `Cache-Control: no-store`
    - `X-Frame-Options: DENY`
  - The phone bundle has no inline script and no inline style.
  - A route-table test lists every route. In this job those are:
    - the phone page and its assets
    - `GET /api/session`, which answers 204 for a valid token
    - the consumer routes registered through the API

    No route returns meeting title, participants, transcript, audio, embeddings or settings.
- [ ] AC6: The QR code and URL.
  - `phone_view_open` returns `url` and `qrSvg`.
  - The SVG comes from `qrcodegen` in the core.
  - The SVG has a quiet zone, contains no `<script>`, no `<foreignObject>`, no external references and no event attributes, and decodes back to exactly `url` (test with a dev-dependency decoder on the module matrix).
  - The mock backend returns a fixed URL and SVG, so 010's fixtures can use them.
- [ ] AC7: The phone page in de and en.
  - The page reads the token from the fragment, removes it from the address bar with `history.replaceState`, and calls `GET /api/session`.
  - On 204 it shows "Connected" with the app name and an empty consumer slot. On 403, on a network error, or on a later failed check (when the page becomes visible again), it shows "This page is closed" with the hint to scan the code again.
  - Language follows the phone (`navigator.language`, `de` or `en`), with `de` as the default. All strings come from keys, and the parity and no-literal tests pass.
  - Playwright + axe report no WCAG 2.2 AA violations and no horizontal scroll for the fixtures `phone-open` and `phone-closed` at 375×667.
  - Targets are at least 48×48 px, and focus is visible.
  - `npm run screenshot` adds both fixtures.

  (NFR Clients and usability, Internationalisation)

## Design
Source: figcraft design/meeting-companion.figcraft (no frame covers the phone page yet)
Status: NEEDED
Following the profile, the prototype is a FigCraft frame built by a script in `design/build/` (for example `s17_phone.py`) and exported to `design/screens/`. It uses the existing style: warm neutral, white cards, indigo `#4338CA`, Inter. The phone frames at 375×667 should answer these questions:
- "Connected": what the header shows (app name, no meeting data), where consumer views (010 consent, 08 review) go, and how a waiting state looks when no consumer view is active.
- "This page is closed": the wording in de and en, the hint to scan the QR code on the screen again, and no action that implies the phone can reopen it.
- Whether a light/dark variant is needed, or whether the phone always uses light.

The desktop QR card is not part of this design. It is 010's frame 06 card.

## Surfaces
- User-facing UI: yes. New phone pages (`phone.html`, states "Connected" and "This page is closed") are served over the local network. Desktop UI is unchanged apart from the IPC/mock-backend plumbing.
- Security-relevant: yes.
  - It adds the app's first listening network port.
  - It handles untrusted HTTP input from any device on the LAN.
  - Token auth.
  - CSRF and DNS rebinding.
  - Rate limiting.
  - Plain HTTP on the local network.

  Rules touched: NFR Security (the only listening port is the opt-in local web view, bound to the local network, behind a per-meeting token in the QR code, closed at meeting end) and NFR Privacy (nothing leaves the device). No secure-coding guideline is configured.
- Human gate: yes. It opens the app's first network listener and adds token-based access control. 010's split notes already require this gate.
- Audio/transcript data: no. Nothing is stored. The token exists in memory only and is dropped on close.
- Leaves the device: yes, to the local network only. Phones that hold the token receive the static phone page and a 204 session answer. No meeting data crosses the network in this job, and nothing goes to the internet.
- Board (touch) layout: no. The phone at 375 px has targets of at least 48 px. The board shows the QR code in consumer jobs.
- AI speaks or contributes unasked: no.

Size: normal

## Open questions
- **Opening a dead link.** After the view closes, a phone that reloads or rescans gets a browser connection error, not the "closed" page, because nothing listens any more. The "closed" page appears only in a tab that is already loaded. This is assumed acceptable, since the alternative is keeping a port open.
- **Rate limit values.** 010 asked for "more than 10 requests per minute → 429". Page load and assets alone use several requests, so I assumed:
  - 10 per minute for failed token checks.
  - 120 per minute in total per address.

  010 or the team review can tighten limits per route.
- **Several meetings.** At most one view is open at a time (only one meeting records at a time). A second `phone_view_open` for the same meeting while it is open returns the current URL. It does not rotate the token.
- **Interface choice.** The interface with the default route is assumed. A picker for several networks (for example Wi-Fi and Ethernet on a board PC) is left out. If a board sits on a guest or isolated Wi-Fi, phones may not reach it. Consumers show the `noLocalNetwork` error only when no interface exists at all.
- **No maximum lifetime.** The view stays open as long as the consumer and the recording keep it open. An extra idle timeout could be added later.
- The comment at the top of `src-tauri/src/lib.rs` and the AGENTS.md layout should be updated to say that the app now serves a port when opted in.
