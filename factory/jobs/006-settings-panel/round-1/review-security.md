VERDICT: PASS

## Findings
- [note] src-tauri/src/recording/mic_test.rs:85 — the microphone test opens the microphone outside the meeting consent gate (spec open question). The core limits the exposure: the sink holds at most 1 s (mic_test.rs:101), the test stops by itself after 10 s (TEST_LIMIT, :16, :180), it is refused while a meeting records or is paused (:88-93), and only a level leaves the thread. The approver still has to confirm the "no consent needed" assumption, as the profile requires (human gate).
- [note] src-tauri/src/recording/mod.rs:400-406, :619-631 — "Switch to the system default" lets recording carry on with a different microphone, which may be in a different room. It is opt-in (DeviceLost::Stop is the default, settings/mod.rs:35-37), happens once per session, never when the default itself is chosen, and sends a `microphone-switched` notice. This changes what is recorded, so the approver needs to sign it off (profile `## approver`).
- [note] src-tauri/src/settings/file.rs:96-100 — the settings file and its temp file are created with the process umask (no 0600). This is the same as the existing meeting and transcript files (store/file.rs:158), and the content is sealed, so it does not block this job. A project-wide hardening could set owner-only permissions on all sealed files.
- [note] The microphone stays open for up to 10 s if the UI fails to send `stop_mic_test` (for example after a renderer crash). The core-side TEST_LIMIT bounds this. Acceptable.

## Checked
- Core settings store (settings/mod.rs, settings/file.rs, store/file.rs): XChaCha20-Poly1305 with the keychain data key; AAD `MCSETT01|purpose=settings` binds the purpose; 64 KiB read cap; atomic temp+rename. The schema is closed (`deny_unknown_fields`, closed enums). Device names must be in the core's device list, ≤256 chars and free of control chars. Model ids must be in the core's own scan; the localStorage migration goes through the same `apply` path. Errors and logs carry the key or failure kind only. The locked keychain path writes nothing.
- IPC surface in lib.rs: `start_recording` no longer takes a model id from the UI. It takes the model from the store, and `stt.load` re-checks it against the scan. The new commands are load_settings, update_setting, list_input_devices, start_mic_test and stop_mic_test. The capability file is still only `core:default`, and no crate, plugin, network or listening port was added. The CSP is unchanged: `public/theme-boot.js` is a `'self'` script that only reads a whitelisted theme value.
- Recorder and microphone (recording/mod.rs, mic_test.rs, engines/devices.rs, cpal_source.rs): a missing chosen device is never silently replaced at start (`ChosenMicrophoneMissing`). `halt` closes a switched-to source. Starting a meeting stops a running test first, and both take the `inner` lock. No audio is written; the AudioError/Reason Display/Debug output holds no device name.
- Frontend: localStorage holds only locale and theme (the mock backend's localStorage use is limited to the `--mode e2e` build). No innerHTML or eval was added. Gitleaks (`scripts/gitleaks.sh`) scanned 72 commits and found no leaks.

## Secure-coding checklist
No `docs.secure_coding` is configured. The checklist follows the focus list.

| Rule | Result | Evidence |
|---|---|---|
| Input validation, injection, unsafe deserialization | ok | settings/mod.rs:136-218 closed serde schema, `deny_unknown_fields`, device and model ids checked against the core's own catalog, length and control-char limits; file.rs:84-86 size cap before decrypt; no shell, SQL or HTML sinks; theme-boot.js whitelists values |
| Secrets in code, config, logs, fixtures; broad permissions | ok | gitleaks clean (72 commits); capabilities/default.json still `core:default` only; data key from the keychain, reused via store/file.rs:81 |
| AuthN/AuthZ, sessions, insecure defaults, rate/size limits | ok | Safe defaults: DeviceLost::Stop, system default mic, auto language. The microphone test is capped at 10 s and a 1 s sink, and refused while recording (mic_test.rs:16, :88-101). No auth surface (local desktop app) |
| Cryptography | ok | XChaCha20-Poly1305 through the existing crate::crypto; purpose-bound AAD (file.rs:13); tamper and swap tests listed in build.md |
| Errors and logs | ok | SettingsError/StoreFailure carry the key or kind only (settings/mod.rs:155-170, :226-243); a log-capture test checks this; Fallback logs only AudioError Display (mod.rs:515-521) |
| Personal data | ok | Device names sealed at rest, never in localStorage (Settings.test.tsx AC1), never logged; the test audio is dropped after measurement; deleted together with the app data folder, as the spec says |
| New dependencies | n/a | No change to package.json or Cargo.toml |
| Security negative tests | ok | settings/tests.rs: corrupt, tampered, foreign and locked files; out-of-schema enums, >256 chars, model id not in the scan; device_tests.rs: a missing chosen device records from no other device; no test while recording or paused |
| Secret scan (secret_scan: true) | ok | `gitleaks.sh` found no leaks; no allow-list entries added |
| NFR Privacy / Security / Architecture | ok | Stored only on the device and encrypted; REC chip stays visible on the settings view; recording never starts while off or paused (fallback runs only inside an active worker); no listening port or network; AudioDevices trait with a fake (engines/devices.rs) |
