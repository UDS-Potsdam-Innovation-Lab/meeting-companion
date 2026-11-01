VERDICT: PASS

## Findings
- [note] src-tauri/src/organisation.rs:150-161 — the regular-file check (`fs::metadata`) and `File::open` are two steps, so a file swapped for a named pipe in between could block the read. Impact is low: the file sits in the user's own app-data folder, the command is `async` and is read only on demand, so it cannot stop the app from starting. A later hardening could open with `O_NONBLOCK` and check `file.metadata()` on the open handle. Not blocking.
- [note] scripts/licences-native.json — the build report says the licence IDs and copyright lines for the native libraries (ONNX Runtime, kaldi-*, OpenFst, SentencePiece, KISS FFT, PortAudio, utf8proc) were filled in from memory. This is a compliance accuracy issue, not a security one. A person should check them against upstream before release.
- [note] The privacy statements (src/i18n/en.json:431-446 and the de equivalents) match the code on main: XChaCha20-Poly1305 with the key in the keyring (src-tauri/src/crypto/mod.rs, Cargo.toml `keyring`), no HTTP client or listener in the core, and audio is not persisted. The spec's human gate (data-protection sign-off on the de/en wording) is still the approver's call. This review does not stand in for it.

## Checked
- `organisation.rs` and the `load_organisation` command: 16 KB bound (checked in metadata and enforced again with `take(MAX+1)` during the read), closed schema, string-only values of at most 1,000 chars, control characters rejected. Errors log only a fixed rejection kind (line 192), with no content and no key names. Rust negative tests cover each case.
- The UI side: `ipc.ts` drops `rejection` and passes only status, fields and path. `LegalContent.tsx` renders values as React text in `<dd>`. The help view and top bar have no `dangerouslySetInnerHTML`, no `href` and no `window.open`. A component test checks `<img onerror>` and `javascript:` as literal text.
- No new Tauri plugin, capability or CSP change, and no network code. `scripts/licences.mjs` uses `spawnSync` (cargo metadata) only at build time, with fixed arguments.
- Secret scan: `gitleaks.sh` on the worktree found no leaks (exit 0).

## Secure-coding checklist
| Rule | Result | Evidence |
|---|---|---|
| Input validation, injection (shell, SQL, path, HTML), unsafe deserialization | ok | organisation.rs:106-171 closed schema and bounded read; fixed path from `app_data_dir` (lib.rs:543); text-only rendering in LegalContent.tsx:101; `spawnSync` in the build script uses fixed args |
| Secrets in code, config, logs or fixtures; overly broad permissions | ok | gitleaks clean; no capability or permission changes; test fixtures use `.example` domains |
| AuthN/AuthZ, sessions, insecure defaults, rate/size limits | ok | no new exposure; size limits of 16 KB per file and 1,000 chars per field |
| Cryptography | n/a | no crypto change; the notice describes the existing XChaCha20-Poly1305 correctly |
| Errors and logs | ok | organisation.rs:192 logs only the rejection kind; the UI gets a generic "could not be read" notice |
| Personal data (minimisation, test data, deletion) | ok | the organisation file holds contact details deployed by IT and is shown read-only; fixtures are fictitious; retention text matches behaviour (no delete UI yet, stated) |
| New dependencies | ok | no new runtime crate or npm dependency; `licences.json` is generated data |
| Security negative tests | ok | organisation.rs tests (>16 KB, invalid JSON, non-object, unknown keys, non-string, null, >1,000 chars, control chars, folder, no content in log or answer); Help.test.tsx XSS-as-text test |
| Secret scan (`secret_scan: true`) | ok | `gitleaks.sh` found no leaks, exit 0 |
| NFR Architecture: local-first / offline | ok | all text, licences and the font are bundled; e2e blocks and records requests outside the app origin |
| NFR Privacy: statements match behaviour | ok | en.json:435-446 match crypto/mod.rs, keyring, and the absence of network code; wording sign-off goes to the human gate |
| NFR Security: no listening ports; untrusted input | ok | no listener added; organisation.json is treated as untrusted (see above) |
