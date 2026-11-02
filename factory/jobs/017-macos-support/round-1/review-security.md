VERDICT: PASS

## Findings
- [note] scripts/sockets.mjs:553 — the lsof scan (`-a -p <pid>`) covers only the app's own process, not the WebKit helper processes (e.g. `com.apple.WebKit.Networking`). This matches the Linux `/proc/<pid>/fd` scan, and the phone web view's server runs in the Rust process, which the scan covers. So the change adds no gap, but "no listening port" is not proven for the webview's helper processes on either OS.
- [note] scripts/sockets.mjs:579 and scripts/smoke.mjs:531 — the scan fails closed. A listing without the `p<pid>` line returns null, an lsof error returns null, and zero successful scans fail the smoke run. A connected UDP socket (`a:1->b:2`) also counts as open. That is stricter than the NFR asks, which is acceptable.
- [note] scripts/ggml-check.mjs:128-142 — if the format is misdetected (for example a read error falls back to "elf"), the Mach-O names keep their leading underscore. The REQUIRED loader check then fails, so the forbidden-HTTP-client check cannot pass silently.
- [note] scripts/fixtures/sockets/*.txt and scripts/fixtures/ggml-check/macos/*.txt hold only symbol names, CI runner paths (`/Users/runner/...`), a private VM address (192.168.64.5) and one public GitHub/Azure endpoint (172.182.252.133:443). They contain no personal data and no secrets. The socket fixtures come from a small Node process, not from the app, so the outbound connection in `outbound.txt` does not mean the app sends anything off the device.

## Checked
- The full diff main...HEAD: ci.yml (matrix, `permissions: contents: read` unchanged, no new third-party actions, the temporary fixture-recorder and timer steps removed again by 23303d6 and 6f6efc2), ggml.mjs/ggml-check.mjs/sockets.mjs/smoke.mjs/plist-check.mjs, main.rs `embed_info_plist!`, tauri.conf.json, .cargo/config.toml.
- NFR Security (no listening ports, no HTTP client or llama-server): the socket check and ggml-check now also run on macOS, with no Linux-only `if` on them. Their parsers are tested against recorded fixtures that cover the failure cases. CI run 41435606381 is green on both OSes (`ci.md`).
- NFR Privacy (secrets in keychain), Architecture (one codebase): nothing in this change stores secrets, and tests do not touch the macOS Keychain. AGENTS.md/README.md describe only how to set up and reset TCC.
- Secret scan: `bash FACTORY_HOME/scripts/gitleaks.sh <worktree>` scanned 195 commits and found no leaks (exit 0). Nothing is allow-listed.

## Secure-coding checklist
The profile names no `docs.secure_coding`, so the checklist has one row per focus bullet.

| Rule | Result | Evidence |
|---|---|---|
| Input validation, injection, unsafe deserialization | ok | `execFile`/`execFileSync` with argument arrays and no shell (sockets.mjs:594, ggml-check.mjs:164). plist-check.mjs reads the Mach-O with bounds-checked Buffer reads and builds its regex from a constant key (`KEY`). These are dev/CI scripts only. |
| Secrets in code, config, logs, fixtures; broad permissions | ok | gitleaks is clean. ci.yml keeps `permissions: contents: read`, and the change adds no secrets or tokens. |
| AuthN/AuthZ, sessions, insecure defaults, rate/size limits | n/a | No auth, session or exposed-endpoint code is touched. The phone view token logic is unchanged. |
| Cryptography | n/a | No crypto code. Keychain access (`keyring` apple-native) is unchanged and not exercised by tests. |
| Errors and logs | ok | The new script messages name only binary paths and socket addresses. They contain no user data. |
| Personal data | ok | The fixtures hold no real personal data, only CI runner paths and IP addresses (see the note above). |
| New dependencies | ok | The change adds no npm or cargo dependency. `tauri::embed_plist` is re-exported by the existing tauri crate. On macOS, Accelerate is a system framework. |
| Security negative tests | ok | src/config.test.ts AC2 (two-ggml, no-llama, curl fail) and AC3 (tcp-listen, udp-bound, empty listing / wrong pid fail). |
| Secret scan (`secret_scan: true`) | ok | gitleaks.sh exit 0, no leaks, no allow-list entries. |
