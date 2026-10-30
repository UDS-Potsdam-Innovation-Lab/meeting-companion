VERDICT: PASS

## Findings
- [note] src-tauri/Cargo.toml:26: `keyring` 3.6 (async-secret-service) brings in the zbus 4 stack. `cargo deny check advisories` flags `zvariant` (RUSTSEC-2026-0370), `zbus_names` (RUSTSEC-2026-0371) and `zvariant_derive` (RUSTSEC-2026-0372) as **unmaintained**. These are not vulnerabilities, and the advisories list no safe upgrade. `proc-macro-error` (RUSTSEC-2024-0370) comes from tauri/gtk and was already there in round 1. No crate has a vulnerability advisory. Move to a keyring release on zbus 5+ when there is one, and add `cargo deny`/`cargo audit` to CI (repeated from round 1).
- [note] build.md "Encryption scheme": plaintext `<id>.json` files from round 1 are ignored but left on disk. This only affects dev machines (nothing was released), so it doesn't block. Developers should delete `<app_data>/meetings/*.json` by hand.
- [note] On Linux the Secret Service has no per-application ACL. Any process running as the same user can read the `de.udspotsdam.meetingcompanion` / `meeting-data-key` entry. This is a platform limit and fits NFR Privacy "encrypted at rest where the OS allows". Mention it in the threat model when one is written.
- [note] Still open from round 1, not caused by this job: GitHub Actions are pinned by tag, not by SHA (.github/workflows/ci.yml). The risk is low: `contents: read` and no secrets.

## Checked
- Round-1 notes: the open privacy question (unencrypted participant names) is now resolved by encryption at rest, as rework-1 asked. The other round-1 notes are non-blocking and still apply.
- Crypto, src-tauri/src/crypto/mod.rs:
  - XChaCha20-Poly1305 from RustCrypto `chacha20poly1305` 0.10.1. Its cipher zeroizes its key copy on drop (crate lib.rs:292). Nothing is hand-rolled.
  - The 256-bit key and each fresh 192-bit nonce come from `OsRng` (:31-35, :66).
  - The AAD is `MAGIC || id`, which binds each file to its name (:58-62).
  - `open` checks the length and magic header first, then authenticates. It returns `None` on failure and never panics (:87-103).
  - The key is held as `Zeroizing`, and its `Debug` output is redacted (:52-56).
  - `KeyError` carries only the keyring error text, never key material.
  - keyring uses `crypto-rust`, so the secret travels DH-encrypted over the local D-Bus session.
- Key lifecycle and the store, src-tauri/src/store/file.rs:37-70, store/locked.rs and lib.rs:133-145:
  - A new key is created only when there is no key and no `.meeting` file. It is then read back and compared before use, so two instances starting at once end with one of them locked rather than with mixed keys.
  - If the keychain is unavailable, or files exist without a key, the app uses `LockedMeetingStore`. That store refuses every read and write, so nothing is ever written in plaintext.
  - A tampered file, a wrong key, or a file swapped in from another meeting all end up `Corrupt`, and the file is left untouched.
  - The 4 MB cap, the `is_valid_id` path guard, validation in the core, and the temp-file-plus-rename write are all unchanged.
  - Logs carry only the error kind.
  - The UI shows a banner that cannot be dismissed (AgendaSetup.tsx, useMeeting.ts). Its DE/EN text does not leak internals.
- Attack surface: tauri.conf.json, capabilities and the CSP did not change in this round. The new crates add no HTTP, socket or listening code; D-Bus is a local socket. The mock backend's `locked` fixture is compiled only into the e2e build.
- Scans:
  - `gitleaks.sh`: exit 0 over 16 commits plus the staged files, no leaks, no allow-list entries.
  - `npm audit`: 0 vulnerabilities.
  - `cargo deny check advisories`: unmaintained warnings only, listed in the first note.
  - Tests cover the negative cases: tampered, wrong key, swapped file, missing or unavailable key, and nothing readable on disk.

## Secure-coding checklist
No `docs.secure_coding` is set in the profile, so this checklist uses the focus list plus the profile's NFR sections.

| Rule | Result | Evidence |
|---|---|---|
| Input validation, injection (shell, SQL, path, HTML), unsafe deserialization | ok | file.rs:99-103: decrypt, then typed serde, then id check and `validate`. `is_valid_id` guards file names (file.rs:125,168). The 4 MB cap is kept (file.rs:94). No HTML sinks were added in the UI. |
| Secrets in code, config, logs or test fixtures; overly broad permissions | ok | The data key exists only in the keychain and in memory (crypto/mod.rs:141-160). Debug output is redacted. Logs print only `KeyError` and the error kind (file.rs:41,48,59). Tests use `MemoryKeyProvider`, and the ignored real-keychain test uses a separate `.test` service. Capabilities did not change. |
| AuthN/AuthZ, sessions, insecure defaults, rate/size limits | ok | No auth surface. The default fails closed: without a key it uses `LockedMeetingStore` (lib.rs:139-144, locked.rs:9-21). No replacement key is created while files exist (file.rs:47-52). |
| Cryptography: established algorithms and libraries only | ok | XChaCha20-Poly1305 AEAD from RustCrypto, a 256-bit key and random 192-bit nonces from OsRng (crypto/mod.rs:14-15,31,66). No MD5, SHA-1, DES or RC4. Covered by tests for tampering, wrong key and wrong id. |
| Errors and logs: no internals to users, security events logged, no sensitive data in logs | ok | The UI gets only `keyUnavailable`, `corrupt`, `unreadable` or `locked` (lib.rs:67-71,83). The failure to get the key is logged without content (file.rs:41,48,59). |
| Personal data: minimisation, no real data in tests, access, deletion | ok | Participant names are now encrypted at rest. The `nothing_readable_is_on_disk` test checks this. Fixtures use fictional names. Deletion is still out of scope per the spec. Old round-1 dev JSON is covered in a note. |
| New dependencies: necessary, maintained, licensed, pinned, audited | ok | `chacha20poly1305`, `zeroize` and `keyring` (MIT/Apache) are needed for the rework, and Cargo.lock is committed. `npm audit` reports 0. `cargo deny` reports only unmaintained warnings for the zbus 4 stack (see note). |
| Security negative tests for what the change exposes | ok | crypto::tests: tampered, wrong key or id, Debug redaction. store::file::tests: tampered, copied-over, wrong key, missing or unavailable key touches nothing, nothing readable on disk. App.test.tsx covers the locked state. |
| Secret scan (`secret_scan: true`) | ok | `gitleaks.sh` exit 0 over 16 commits plus the staged files, no allow-list entries |
| NFR Architecture (local-first, one codebase, engines behind interfaces) | ok | No network. The `KeyProvider` trait has a fake. The OS-specific keyring features for macOS and Windows stay in Cargo.toml:26. |
| NFR Privacy (stored only on device, encrypted at rest, secrets in keychain) | ok | Encrypted `.meeting` files in app_data. The key is in the OS keychain only. Nothing leaves the device. |
| NFR Security (no listening ports; untrusted text) | ok | No server or socket code. Secret Service is a local D-Bus client connection. Text is still validated and rendered only as text. |
| Profile watch: audio or transcript leaving the device, secrets outside the keychain, phone web view token, prompt injection | ok / n/a | The only secret, the data key, is in the keychain. There is no audio, transcript, web view or LLM in this change. |
