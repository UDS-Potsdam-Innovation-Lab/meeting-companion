VERDICT: PASS

## Findings
- [note] src-tauri/src/theme/omarchy.rs:134 — `light.mode` is checked with `fs::metadata` (follows symlinks, stat only, nothing is read), and `colors.toml`/`theme.name` symlinks are followed by `open`. This is harmless: the open uses `O_NONBLOCK`, the regular-file and 16 KB checks run on the open handle, and only hex values of known keys and a slug get through, so a symlink to another file in the user's home leaks nothing beyond hex colours. No change requested.
- [note] public/theme-boot.js:50 and src/features/theme/omarchy.ts:88 — both accept `#rrggbbaa` from the cache, but the mapping only ever writes `#rrggbb`. That is still a pure hex colour and cannot inject CSS. Non-blocking; tightening it to 6 digits would keep the allow-list identical to what is produced.
- [note] The project has no general "untrusted local files" rule in the NFR Security section (it covers only transcripts and slides). This job applies the same principle to theme files. That is good practice and not a gap this job caused.

## Checked
- Core reader and poller: src-tauri/src/theme/{mod,omarchy,watch}.rs. Files are opened non-blocking and checked on the handle (regular file, ≤16 KB through `take(limit+1)`, UTF-8). Keys are allow-listed, values are hex-only and normalised, and the slug is `[a-z0-9-]{1,64}`. The only log line is fixed (watch.rs:94). There is no process, socket or write. The new `omarchy_theme` command returns read-only state.
- UI path: apply.ts `setOmarchyTokens` sets only `TOKEN_NAMES` with values that pass `TOKEN_VALUE`. `readOmarchyCache` and theme-boot.js filter per entry using `hasOwnProperty` (so there is no prototype-key abuse). `themeDisplayName` re-validates the slug and is rendered as text through i18n. The mock backend and `window.__mockOmarchy` sit only behind `VITE_MOCK_IPC` (src/main.tsx:11).
- Config: capabilities stay `core:default` (only the description changed). CSP is unchanged. The new dependency `libc 0.2` is Linux-only, already in Cargo.lock, maintained, and MIT/Apache.
- Secret scan: `gitleaks.sh` on the worktree reported no leaks. The fixtures hold only colours and slugs; `FAKE-TOKEN-for-tests-only` is pre-existing and not part of this change.

## Secure-coding checklist
No `docs.secure_coding` is configured; the rows below are the focus list.

| Rule | Result | Evidence |
|---|---|---|
| Input validation / injection (shell, SQL, path, HTML), unsafe deserialization | ok | omarchy.rs:156-183 (`read_small`), :199-222 (`normalise_hex`), :186 (`valid_slug`). Paths are fixed below `$HOME` with no user-supplied path segment. The UI re-checks values at apply.ts:35-41; the cache JSON is filtered per entry (apply.ts:44-62, theme-boot.js:56-81) |
| Secrets in code, config, logs or fixtures; broad permissions | ok | gitleaks clean. Fixtures hold colours only. capabilities/default.json keeps `core:default` |
| AuthN/AuthZ, sessions, insecure defaults, rate/size limits | ok | No auth surface. Size limit of 16 KB / 256 B (omarchy.rs:21,23). Polling is 1/s with a cheap stamp, and nothing is read while nothing changes (watch.rs:79) |
| Cryptography | n/a | No crypto touched |
| Errors and logs: no internals, no sensitive data | ok | One fixed line "omarchy theme: unreadable" (watch.rs:94), tested in watch.rs:384-420 |
| Personal data: minimisation, no real data in tests | ok | localStorage holds only `{mode, tokens}` hex (apply.ts:64-75). No audio or transcript involved |
| New dependencies: necessary, maintained, licensed, pinned | ok | `libc = "0.2"`, Linux-only target dep (Cargo.toml:57), already locked transitively; needed for `O_NONBLOCK` |
| Security negative tests | ok | FIFO, device, folder, >16 KB, non-UTF-8, CSS-injection values, bad slug (omarchy.rs tests); UI junk palette and junk cache (Omarchy.test.tsx, omarchy.test.ts, e2e AC6) |
| Secret scan (`secret_scan: true`) | ok | `gitleaks.sh` found no leaks |
| Profile watch items (audio/transcript off-device, keychain secrets, phone view token, prompt injection) | n/a | None of these areas are touched. Leaves the device: no; no network or listener added |
