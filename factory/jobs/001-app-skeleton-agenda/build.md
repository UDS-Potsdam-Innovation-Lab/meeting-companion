# Build: 001-app-skeleton-agenda

## Summary
Set up the confirmed stack: Tauri 2 + Rust core, React 19 + Vite 6 + TypeScript UI, Vitest, cargo test, Playwright + axe, ESLint/Prettier/clippy. `AGENTS.md` now says `STATUS: CONFIGURED`.
Built the frame 01 agenda setup view: a top bar with "New meeting" and a Deutsch/English switch, the heading block, the agenda list (add, edit inline, move up/down, remove, numbered 01…, the planned/buffer line) and the Meeting card (title, date, start/end, participants with initials avatars). Assistant parts of the frame are left out, as the spec says.
Every valid change autosaves through the `MeetingStore` trait (Rust). `FileMeetingStore` keeps one `<id>.json` per meeting in `<app_data>/meetings`, written to a temp file and then renamed. `MemoryMeetingStore` is the fake. On start, the newest file (by mtime) is reopened. A corrupt or unreadable file shows an error banner and opens an empty meeting; the file itself is never changed.
CI (`.github/workflows/ci.yml`) runs `npm ci`, lint, `npm test`, `tauri build --no-bundle` and a smoke run of the built binary (`scripts/smoke.mjs`, in-memory store) on ubuntu, macos and windows. `npm run screenshot` writes 7 states × 375/1280/1920 px to `screenshots/`.

## Acceptance criteria
| AC | Test | Result |
|----|------|--------|
| AC1 | `src/config.test.ts` › "AC1 CI workflow" (push + pull_request, 3-OS matrix, npm ci / lint / test / tauri build / smoke, no `continue-on-error` or `\|\| true`); `scripts/smoke.mjs` run against the locally built release binary | PASS locally (`SMOKE OK: agenda-setup rendered`). CI itself has not run: the branch is not pushed yet |
| AC2 | `src/features/agenda/MeetingCard.test.tsx` (empty title, title > 200, end not after start, empty participant, duplicate participant: each shows a message next to the field and is not saved; `<img src=x onerror=…>` renders literally); `model.test.ts` › "AC2 meeting validation"; Rust `model::tests::*` (rejects_empty_title, rejects_title_over_200_chars, rejects_end_not_after_start, rejects_empty_participant_name, rejects_duplicate_…, markup_in_text_is_kept_verbatim) | PASS |
| AC3 | `src/features/agenda/AgendaList.test.tsx` (add with all fields, edit, move, remove, keyboard move, lead options = participants only, removing a participant clears the lead, 01/02 numbering, minutes 1–240); `model.test.ts` › "AC3 agenda items"; Rust `lead_must_be_a_participant`, `minutes_must_be_1_to_240` | PASS |
| AC4 | `model.test.ts` › "AC4 planned and buffer" (under/exact/over/empty); `AgendaList.test.tsx` › "AC4 budget line" (text "N of M min planned · B min buffer", "… · X min over" plus the overrun class) | PASS |
| AC5 | Rust `store::file::tests::*` (one file per meeting, no temp file left, reopen returns the latest with all fields, a corrupt file is reported and left byte-identical, a leftover temp file is ignored, a failed write keeps the previous version, invalid input is never written); `tests::load_latest_reports_corrupt_file_and_returns_no_meeting`; `App.test.tsx` › "AC5 start-up and storage"; `e2e/agenda-setup.spec.ts` › "AC5 restart" and "no network request"; `src/config.test.ts` › "AC5 no network" (no HTTP/websocket/localhost/shell plugin, only `core:` permissions, CSP `connect-src` = `ipc: http://ipc.localhost`, no sockets in the Rust source) | PASS |
| AC6 | `src/i18n/i18n.test.tsx` (key parity, matching placeholders, and a key-mode render that fails on any literal text or aria-label/title/placeholder; checked that it fails when a literal is injected); ESLint `react/jsx-no-literals`; `App.test.tsx` › "AC6 language" (German by default, switching without reload keeps typed input, choice remembered) | PASS |
| AC7 | `e2e/agenda-setup.spec.ts` › "AC7 accessibility at 1280×800" (axe WCAG 2.0/2.1/2.2 A+AA with no violations on the filled view, the open editor with errors, over budget and the store error in German; no horizontal scroll; all targets ≥ 24×24; Tab order and a visible 2 px focus ring on every stop; move up/down and full item editing by keyboard) | PASS |

## Secure coding
No secure-coding guideline is configured (`docs.secure_coding` is not set). The NFR rules this change touches:
- Untrusted input: titles, names, topics and outcomes render only as React text (ESLint `react/no-danger`). An XSS string test (UI and Rust round trip) checks this. Lengths are bounded (200/100/200 characters, 100 participants, 100 items, minutes 1–240), and stored files over 4 MB are not read.
- Path traversal: ids become file names, so `is_valid_id` allows only `[A-Za-z0-9-]{1,64}`. `load` ignores any other id, and files with a different id inside count as corrupt (tests: `ids_cannot_escape_the_store_directory`, `unknown_ids_and_foreign_files_are_ignored`).
- Validation in the core: the store validates every save itself; the UI check is not trusted. Files that fail validation on load count as corrupt and are not overwritten.
- No listening ports and no network: no Tauri HTTP/websocket/localhost/shell plugin; the capability grants only `core:default`. CSP: `default-src 'self'`, `connect-src ipc: http://ipc.localhost`, `object-src`/`frame-src`/`base-uri`/`form-action` set to `'none'`, plus `freezePrototype`. Inter is bundled through `@fontsource-variable/inter`, so no font CDN. Covered by `src/config.test.ts` and the e2e request check.
- Stored only on the device: meeting JSON goes to the OS app-data directory. Logs record only the kind of error, never meeting content.
- Test hooks: `MEETING_COMPANION_STORE=memory` and `MEETING_COMPANION_SMOKE=1` only switch to the in-memory store or exit after the first render, and they do not loosen anything. The mock IPC backend is compiled only in `--mode e2e` (checked: it is not in `dist/`).
- Secrets: none. gitleaks over the branch history exits 0.
- Supply chain: vitest is upgraded to 5.x because `npm audit` flagged tinypool/@vitest/mocker in 3.x. `npm audit` now reports 0 vulnerabilities.

## Notes for the reviewers and the human
- Deviation from the spec's test-runner versions: Vitest 5 (not 3) for the audit fix above. `@vitejs/plugin-react` is pinned to 5 because 6 needs Vite 8. The Rust toolchain is pinned to 1.99.1, which meets "1.85+"; Tauri 2.12 needs at least 1.90.
- Choices the frame leaves open:
  - Items are edited inline: clicking the topic opens an editor under the row, and that row is highlighted like item 02 in the frame.
  - A new topic joins the meeting once its title is valid. A new topic still empty when closed is discarded and never saved.
  - A new meeting starts with the title "Neues Meeting"/"New meeting" in the current language, so it is valid and autosaves from the first edit.
  - "New meeting" saves the new, empty meeting at once, so a restart reopens it.
  - The language buttons show "Deutsch"/"English" (endonyms) rather than DE/EN, which avoids an axe label-in-name violation.
- Contrast: the frame's muted grey (#8A8D96), teal and amber chip text fail AA at small sizes, so they are darkened (#676A73, #0B6266, #8A5300).
- Smoke run: verified locally on Linux/Wayland. CI uses `xvfb-run` on Linux and the native session on macOS and Windows; the first CI run will confirm those.
- Follow-up from the spec, for the orchestrator (I may not edit `factory/`): set `ci_workflow: ci.yml`, narrow `ui_paths` to `src/**`, and set the reviewer-ui screenshot command to `npm run screenshot`.

## Test run
`npm test` → Vitest 53 passed / 0 failed (6 files); cargo test 27 passed / 0 failed; Playwright 8 passed / 0 failed. Exit 0.
`npm run lint` → exit 0. `npm run tauri build -- --no-bundle` → built. `node scripts/smoke.mjs` → `SMOKE OK: agenda-setup rendered`, exit 0. `npm run screenshot` → 21 passed.
```
  ✓  2 [chromium] › e2e/agenda-setup.spec.ts:111:3 › AC7 accessibility at 1280×800 › items move up and down by keyboard (791ms)
  ✓  6 [chromium] › e2e/agenda-setup.spec.ts:123:3 › AC7 accessibility at 1280×800 › an item can be edited entirely by keyboard (1.1s)
  ✓  3 [chromium] › e2e/agenda-setup.spec.ts:65:3 › AC7 accessibility at 1280×800 › every control is reachable by Tab in a logical order, with a visible focus indicator (2.0s)
  ✓  8 [chromium] › e2e/agenda-setup.spec.ts:164:1 › the page makes no network request beyond its own assets (503ms)
  ✓  5 [chromium] › e2e/agenda-setup.spec.ts:36:3 › AC7 accessibility at 1280×800 › filled agenda: no axe violations, no horizontal scroll, targets ≥ 24 px (2.6s)
  ✓  1 [chromium] › e2e/agenda-setup.spec.ts:43:3 › AC7 accessibility at 1280×800 › open editor and validation errors: no axe violations (2.8s)
  ✓  7 [chromium] › e2e/agenda-setup.spec.ts:146:3 › AC5 restart › after a reload the last meeting is back with all fields (932ms)
  ✓  4 [chromium] › e2e/agenda-setup.spec.ts:55:3 › AC7 accessibility at 1280×800 › over budget and store error, in German: no axe violations (3.4s)

  8 passed (7.7s)
```

## Commits
```
954a8c5 chore: check out text files with LF on every OS so prettier --check passes on Windows
3e54c95 ci: lint, test, compile and smoke-test on ubuntu, macos and windows
f951b12 test(e2e): axe, keyboard, layout and restart checks; npm run screenshot
547fd63 feat(agenda): agenda setup view with meeting card, agenda list and de/en UI
da757ad feat(core): meeting model, validation and MeetingStore with file and memory stores
6453bbc chore(stack): establish Tauri 2 + Rust + React 19/Vite 6 + TypeScript
```

## Rework

From `rework-1.md` (human, 2026-10-30) and `round-1/ci.md`. The branch was already pushed, so I merged `main` in (b26d9ed); nothing was rebased or force-pushed.

### Requested changes and what I did
1. **CI on Linux only.** The matrix in `.github/workflows/ci.yml` is now `[ubuntu-latest]`, with a comment that names macos-latest and windows-latest for later. The steps for macOS and Windows (smoke run without xvfb) stay as they were, and so does the OS-specific Rust code (rename, `sync_dir`, keyring features for Keychain and Credential Manager). `src/config.test.ts` now checks for ubuntu-latest plus the lint/test/build/smoke steps. The `## Application stack` section of `AGENTS.md` says Linux is the only CI-tested target for now. AC1 is amended to match: CI builds, tests and smoke-tests on Linux. (6361bfa)
2. **Keyboard e2e test on macOS.** The test now uses `ControlOrMeta+A` instead of `Control+A` (`e2e/agenda-setup.spec.ts` "an item can be edited entirely by keyboard"). (6361bfa)
3. **Encryption at rest.** (2027554)
   - `FileMeetingStore` now writes `<id>.meeting` files that hold the meeting JSON, encrypted.
   - The data key is generated on first start and put into the OS keychain through `KeyProvider`. The app uses `KeychainKeyProvider` (`keyring` 3.6, Secret Service over pure-Rust zbus on Linux). Tests use `MemoryKeyProvider`.
   - If the keychain is unavailable, or it has no key while meeting files exist, the app does not crash. It uses `LockedMeetingStore`, which refuses every read and write. It does not create a replacement key and does not change or write any file. The UI shows a DE/EN message that cannot be dismissed (`store.keyUnavailable.*`), and the generic save-error banner is hidden so the message is not shown twice.
   - Unchanged: atomic temp file + rename, the corrupt-file handling (file left untouched) and the 4 MB limit.
   - A tampered file, a file encrypted with another key, or a file copied over another meeting's file fails authentication. It is reported like a corrupt file ("could not be read", load error `corrupt`), never as a crash.
4. **Found while doing this (not requested, fixed):** the `.gitignore` pattern `screenshots/` also matched `e2e/screenshots/`. That means `e2e/screenshots/screenshots.spec.ts` was never committed in round 1, so `npm run screenshot` could not work from a fresh checkout. The pattern is now `/screenshots/` and the spec is tracked. (b1a9f0e)

### Encryption scheme
- Cipher: XChaCha20-Poly1305 (RustCrypto `chacha20poly1305` 0.10, an AEAD). No hand-rolled crypto.
- Key: 256 bits from the OS random generator. It is held in memory as `Zeroizing`, so it is wiped on drop, and its `Debug` output is redacted.
- Key storage: only in the OS keychain, under service = app identifier `de.udspotsdam.meetingcompanion` and account `meeting-data-key`. The key is never written to disk or logged; log lines name only the kind of error.
- Nonce: a fresh random 192-bit nonce per write. With XChaCha's nonce size, random nonces are safe and never need a counter.
- File layout: `"MCMEET01" (8 bytes) || nonce (24) || ciphertext || Poly1305 tag (16)`.
- Associated data: `"MCMEET01" || meeting id`. A file only opens under its own name.
- First start: the app generates the key, stores it, and reads it back to check. The store is used only if the keychain returns the same key.
- Old plaintext `<id>.json` files from round 1 (only on dev machines) are ignored and left as they are; there is no migration.
- D-Bus to the Secret Service is a local Unix socket. It is not a network connection and opens no listening port.

### Tests added
- Rust `crypto::tests`:
  - round_trip
  - same_plaintext_gives_different_ciphertext
  - tampered_ciphertext_nonce_or_header_is_rejected
  - wrong_key_or_other_meeting_id_is_rejected
  - debug_output_never_shows_the_key
  - keychain_round_trip: `#[ignore]`, uses the real Secret Service; run by hand here with `-- --ignored keychain` → PASS, and the test entry was deleted afterwards
- Rust `store::file::tests`:
  - nothing_readable_is_on_disk (no title, participant names, topic or "title" bytes on disk)
  - tampered_file_is_rejected_and_left_untouched
  - a_file_copied_over_another_meeting_is_rejected
  - valid_ciphertext_of_an_invalid_meeting_counts_as_corrupt
  - first_start_generates_a_key_and_puts_it_in_the_keychain
  - missing_key_with_existing_files_refuses_to_open_and_touches_nothing
  - unavailable_keychain_refuses_to_open_and_writes_nothing
  - another_key_cannot_read_the_files
  - all earlier store tests, ported to encrypted files
- Rust `tests::missing_key_is_reported_and_nothing_is_saved`.
- `src/app/App.test.tsx`: "a missing keychain key shows a lasting error and nothing claims to be saved".
- e2e: axe has no violations on the key-unavailable state, in German.
- New screenshot state: `agenda-key-unavailable-<width>.png`.

### Secure coding (additions)
- Encryption at rest: AEAD with a vetted crate, a key that exists only in the keychain and in memory, and a redacted `Debug` output for the key.
- No silent data loss: without a key nothing is written, and no new key is ever created while encrypted files exist.
- `npm audit` reports 0 vulnerabilities, and gitleaks finds no leaks across the 15 commits in the branch history (exit 0).

### Test run
`npm test` → Vitest 54 passed / 0 failed; cargo test 40 passed / 0 failed / 1 ignored (the real keychain test); Playwright 8 passed / 0 failed. Exit 0.
`npm run lint` → exit 0. `npm run tauri build -- --no-bundle` → built. `node scripts/smoke.mjs` → `SMOKE OK: agenda-setup rendered`. `npm run screenshot` → 24 passed.
```
  ✓  7 [chromium] › e2e/agenda-setup.spec.ts:146:3 › AC5 restart › after a reload the last meeting is back with all fields
  ✓  4 [chromium] › e2e/agenda-setup.spec.ts:55:3 › AC7 accessibility at 1280×800 › over budget and store error, in German: no axe violations
  8 passed (9.1s)
```

### Commits (main..HEAD)
```
b1a9f0e fix: track e2e/screenshots; ignore only the top-level screenshots output
2027554 feat(store): encrypt meeting files at rest with a keychain-held data key
6361bfa ci: test on Linux only for now; fix select-all in the keyboard e2e test on macOS
b26d9ed Merge main into factory/001-app-skeleton-agenda
954a8c5 chore: check out text files with LF on every OS so prettier --check passes on Windows
3e54c95 ci: lint, test, compile and smoke-test on ubuntu, macos and windows
f951b12 test(e2e): axe, keyboard, layout and restart checks; npm run screenshot
547fd63 feat(agenda): agenda setup view with meeting card, agenda list and de/en UI
da757ad feat(core): meeting model, validation and MeetingStore with file and memory stores
6453bbc chore(stack): establish Tauri 2 + Rust + React 19/Vite 6 + TypeScript
```
