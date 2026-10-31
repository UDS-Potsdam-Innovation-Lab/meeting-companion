# Build: 012-phone-web-view

## Summary
- New core module `src-tauri/src/phone_view/`. `PhoneViewServer` runs axum 0.8 with hyper HTTP/1 on Tauri's tokio runtime, using an accept loop of its own. That loop gives a 32-connection cap, a request deadline counted from the first byte, and on close drops the listener and every open keep-alive connection. The module also has `PhoneViewToken`, `NetInterfaces` (`SystemNetInterfaces`, `FakeNetInterfaces`), the per-address `RateLimiter` on an injectable `Clock`, the request checks and security headers (`http.rs`), the QR SVG from `qrcodegen` (`qr.rs`), the embedded phone assets (`build.rs` → `assets.rs`) and the consumer API (`ConsumerRoutes`, `PhoneJson`, `PhonePath`, `PhoneId`, `PhoneSession`).
- Lifecycle in `lib.rs`. `phone_view_open(meetingId)` returns `{ url, qrSvg }` or `{ key }`, and `phone_view_close()` closes the view. The `phone-view-state` event reports each change. The view closes on request, when recording stops or fails or moves to another meeting (through `ClosesPhoneView`, which wraps the recorder's event sink), when the meeting ends (`save_from_ui`, before the recorder stops) and on `RunEvent::Exit` or drop.
- Phone page: second Vite entry `phone.html` + `src/phone/`. It is built on its own by `vite.phone.config.ts` into `dist/phone/`, so the bundle holds only the phone page and no IPC. It has the states "Connected" (waiting card in the consumer slot) and "This page is closed", in de and en, light and dark as in frames s18*. It is part of `npm run build` and `build:e2e`.
- IPC wrappers in `ipc.ts`. The mock core in `mockBackend.ts` returns `MOCK_PHONE_VIEW`; its SVG is the core's own rendering of the mock URL, and a Rust test keeps the two in step. Added the e2e fixtures `phone-open` and `phone-closed` and the `phone-*-375.png` screenshots. The smoke script now fails if the running app has any listening TCP or bound UDP socket.
- New crates: `axum`, `hyper`, `hyper-util` and `tokio` (all already in the lock file through Tauri; now direct, server and HTTP/1 only), `qrcodegen` and `subtle` (already in the tree). **`if-addrs` 0.15 is new**: it lists interfaces with their up state. `rqrr` is a dev-dependency only.

## Acceptance criteria
| AC | Test | Result |
|----|------|--------|
| AC1 no port before open / port scan (loopback + chosen address, via /proc of the process) | src-tauri/src/phone_view/tests.rs::ac1_no_port_before_opening_one_while_open_none_after_closing | PASS |
| AC1 smoke run opens no port | scripts/smoke.mjs (Linux /proc scan; also checked against a fake app that listens → fails) | PASS |
| AC1 notRecording | phone_view/tests.rs::ac1_not_recording_fails_with_its_key_and_opens_nothing; lib.rs::tests::phone_view_opens_only_while_the_meeting_records | PASS |
| AC1 binding rules (RFC 1918, up, not loopback, default route preferred, never 0.0.0.0/::/public) | phone_view/net.rs::tests (4 tests incl. /proc/net/route parsing); tests.rs::ac1_it_binds_exactly_the_chosen_address_never_a_wildcard; ac1_the_port_is_random_per_opening | PASS |
| AC1 noLocalNetwork | tests.rs::ac1_without_a_local_network_it_fails_with_its_key | PASS |
| AC1 close ≤ 1 s, keep-alive dropped, event + reason, per trigger | tests.rs::ac1_closes_on_request, ac1_closes_when_recording_stops_fails_or_moves_to_another_meeting, ac1_closes_when_the_meeting_ends, ac1_closes_when_the_app_exits; lib.rs::tests::phone_view_closes_when_the_recorder_stops, phone_view_closes_when_the_meeting_ends_from_the_ui | PASS |
| AC2 token ≥128 bit, OS RNG, base64url, new per opening, constant time | phone_view/token.rs::tests (4); tests.rs::ac2_the_url_carries_a_fresh_token_only_in_its_fragment | PASS |
| AC2 missing/malformed/wrong/old/foreign → identical 403 | tests.rs::ac2_missing_malformed_wrong_old_and_foreign_tokens_get_the_same_403 | PASS |
| AC2 token never in a log line | tests.rs::ac2_the_token_never_reaches_the_log | PASS |
| AC3 Host → 421 | tests.rs::ac3_a_foreign_host_header_gets_421 | PASS |
| AC3 Origin → 403, POST needs Origin | tests.rs::ac3_a_foreign_origin_gets_403_and_a_post_needs_its_origin | PASS |
| AC3 POST + JSON + bearer only, else 405/415/403 | tests.rs::ac3_state_changing_routes_take_only_post_with_json | PASS |
| AC3 body > 4 KB → 413 | tests.rs::ac3_bodies_over_4_kb_get_413 | PASS |
| AC3 malformed JSON / unknown fields / bad ids → 400 (consumer route) | tests.rs::ac3_malformed_json_unknown_fields_and_bad_ids_get_400 | PASS |
| AC3 traversal / unknown assets → 404 | tests.rs::ac3_asset_paths_outside_the_embedded_files_get_404; assets.rs::tests::lookups_are_by_exact_name_only | PASS |
| AC3 slowloris | tests.rs::ac3_a_request_not_complete_within_the_deadline_is_dropped | PASS |
| AC3 ≤ 32 connections | tests.rs::ac3_at_most_32_connections_at_a_time | PASS |
| AC4 10 failed → 429 + Retry-After, valid token too, window by injected clock | tests.rs::ac4_eleven_wrong_tokens_lock_out_the_address_until_the_window_ends; rate.rs::tests (4) | PASS |
| AC4 > 120/min → 429 | tests.rs::ac4_more_than_120_requests_a_minute_get_429 | PASS |
| AC4 other addresses unaffected | tests.rs::ac4_other_addresses_are_not_affected (client from 127.0.0.2) | PASS |
| AC5 headers on page, asset, API, 400/403/404/405/408/413/421/429 | tests.rs::ac5_every_response_carries_the_security_headers, ac5_413_and_408_carry_the_headers_too | PASS |
| AC5 no inline script/style | e2e/phone.spec.ts::"runs under the server's CSP with no inline script or style"; assets.rs::tests::the_embedded_page_has_no_inline_script_or_style; src/phone/PhoneApp.test.tsx::"has no inline style attribute" | PASS |
| AC5 route table, no meeting data | tests.rs::ac5_the_route_table_lists_every_route_and_nothing_else_answers, ac5_a_consumer_name_is_registered_once_and_must_be_plain | PASS |
| AC6 url + qrSvg, decodes to url (rqrr), quiet zone, nothing active | qr.rs::tests (3); tests.rs::ac6_open_returns_the_url_and_a_qr_code_that_decodes_to_it | PASS |
| AC6 mock backend fixed URL + SVG | tests.rs::ac6_the_mock_backend_svg_is_the_core_rendering_of_the_mock_url; src/lib/phoneView.test.ts (5) | PASS |
| AC7 token from fragment, replaceState, GET /api/session with bearer | src/phone/PhoneApp.test.tsx (token, session tests); e2e/phone.spec.ts "phone-open …" | PASS |
| AC7 Connected / Closed / network error / later failed check | PhoneApp.test.tsx; e2e/phone.spec.ts (network error, visibility re-check, no token) | PASS |
| AC7 de/en by navigator.language, de default; parity + no literals | PhoneApp.test.tsx ("speaks German", "renders every string from a key"); src/i18n/i18n.test.tsx (catalogue parity); e2e "other languages get German" | PASS |
| AC7 axe WCAG 2.2 AA, no horizontal scroll at 375×667, targets ≥ 48 px, dark | e2e/phone.spec.ts (de-DE and en-US × open and closed; dark) | PASS |
| AC7 screenshots | `npm run screenshot` → screenshots/phone-{open,closed}[-de\|-dark]-375.png | PASS |

## Secure coding
No secure-coding guideline is configured. These are the NFR rules this change touches:
- **NFR Security: the only listening port is the opt-in view.** The view opens only through `phone_view_open` while the meeting records, re-checked under the view's lock. It binds one RFC 1918 address of an up, non-loopback interface; `TcpListener::bind` exists only in `phone_view/mod.rs`, and `src/config.test.ts` enforces that. It closes on the four triggers within `CLOSE_WAIT` (1 s), with listener and connections dropped. The smoke run and the `/proc` port scan test show no port otherwise.
- **NFR Security: per-meeting token in the QR code.** The token is 256 bits from `OsRng`, new for every opening, and lives in memory only (`Zeroizing`). `Debug` is redacted, the token is compared in constant time (`subtle`), and it travels only in the fragment and the bearer header. The page drops it from the address bar before rendering and sets `Referrer-Policy: no-referrer`. A log-capture test runs over the whole lifecycle.
- **Untrusted LAN input.** `Host` must match exactly (421), `Origin` must match and a POST must carry one (403), bodies are at most 4 KB (413) and must arrive within the 10 s deadline (408 and connection closed), heads are at most 16 KB, connections at most 32. Assets are served from an embedded table by exact name only and the file system is never read. JSON is strict (415/400), ids go through `PhoneId`, error bodies are fixed, and the server logs nothing per request.
- **NFR Privacy: nothing leaves the device beyond the local network.** No route returns meeting data (route-table test). The phone page stores nothing and uses no cookies (`credentials: "omit"`). Responses carry `Cache-Control: no-store`. The server has no HTTP client and no outgoing connection. The default route is read from `/proc/net/route` instead of a UDP socket.
- **Desktop CSP and capabilities.** Unchanged. The capability description lists the new event, and the config tests were adjusted (see notes).

## Test run
`npm test` → vitest 249 passed; `cargo test` 266 passed, 5 ignored (the existing manual model/keychain tests); Playwright 159 passed. `npm run lint` → clean. `npm run tauri build -- --no-bundle` then `node scripts/smoke.mjs` → passed, no listening port in 34 scans. Secret scan: `gitleaks.sh` → no leaks, exit 0.

While I tested, the machine carried a load average above 20 from other builders. Under that load the combined `npm test` failed once on existing timing-sensitive vitest tests: i18n speakers view, Settings, SoundWave, Speakers. None of them touch this change. `main` fails the same way under the same load (4 failed files). Run one file at a time (`npx vitest run --no-file-parallelism`), all 249 pass, and cargo test and Playwright were then run separately.
```
 Test Files  21 passed (21)
      Tests  249 passed (249)
test result: ok. 266 passed; 0 failed; 5 ignored; 0 measured; 0 filtered out; finished in 69.50s
  ✓  155 [chromium] › e2e/transcript.spec.ts:131:3 › AC1–AC5 recording with the mock core › consent, start, German and English lines, pause, resume and restart (5.6s)
  159 passed (2.5m)
SMOKE OK: agenda-setup rendered
smoke: no listening port (34 scans)
smoke: passed
```

## Notes for review
- **Pause keeps the view open.** It opens only while the meeting is `recording`. A pause keeps it open (recording is not stopped), but it cannot be newly opened while paused. Stop, error or another meeting closes it.
- **`src/config.test.ts` changed beyond the two commands.** The spec said it stays unchanged, but its "the core opens no socket" and "no `hyper` in Cargo.toml" checks cannot hold with a server. They now say: no socket outside `phone_view/`; inside it exactly one `TcpListener::bind(SocketAddrV4::new(ip, 0))`, and no UDP, client connect, wildcard or IPv6; the HTTP crates are pinned to the three server-only lines. The events list gained `phone-view-state`. Desktop CSP and the capability permissions are unchanged.
- **The token is not in the path or query.** The page itself (`/`, `/assets/*`) is served without a token. The token only arrives in the fragment, which the browser never sends. Everything under `/api/` needs the bearer header.
- **Default route on macOS and Windows.** It is read from `/proc/net/route` on Linux only, to avoid even a transient UDP socket. On macOS and Windows the first suitable interface in OS order is taken until those targets are back in CI.
- **Request deadline.** The 10 s count starts at the first byte of the request (a per-connection marker). hyper's header timeout (10 s) also closes idle keep-alive connections.
- **Dev builds.** `build.rs` embeds `dist/phone/` and a release build fails without it. In `tauri dev` the page is only served after one `npm run build`. Otherwise it answers 404.
- **Live check.** I checked the real built page served by the real server (embedded assets, real CSP) once by hand in Chromium: 200, Connected, Inter loaded, no console or CSP errors, token gone from the URL.

## Commits
```
732b0ff fix(phone-view): look up embedded asset names in their original case
5e67bbe docs: describe the phone web view in AGENTS.md
6d866b2 test(smoke): fail when the running app listens on a port
004758b feat(phone-view): IPC, mock core, e2e fixtures and screenshots
101426a feat(phone-view): phone page with Connected and Closed states
7357797 feat(phone-view): opt-in local phone web view server in the core
```
