VERDICT: PASS

## Findings
- [note] src-tauri/src/settings/mod.rs:277-289 / src-tauri/src/lib.rs:465-473 — the "Send text to Anthropic?" confirmation lives only in the UI; the core's `update_setting` accepts `languageModel: "claude"` directly. That is acceptable today (IPC is reachable only from the app's own webview, CSP connect-src is IPC only, capabilities `core:default`), and nothing is sent until a person presses Test. Before the first feature sends meeting text (its own human gate), consider recording the consent in the core (e.g. a `confirmedAt` alongside the setting) so the opt-in cannot be set without the confirmation path.
- [note] src-tauri/src/engines/llm.rs (`run_cancellable`) + src-tauri/src/language_model.rs (`run_test`) — Cancel returns at once and clears `running`, but an in-flight Claude request keeps going on its thread until it answers or hits the 60 s timeout. Repeated Test → Cancel can therefore start several parallel requests (each bounded by the 60 s timeout, fixed sample text, no meeting data). Not a vulnerability; worth keeping `Busy` until the engine thread really ends once real meeting text flows through this path.
- [note] Dependency audit: `cargo deny check advisories` (no deny.toml) reports only "unmaintained" advisories for `proc-macro-error`, `zbus_names`, `zvariant`, `zvariant_derive` via `keyring` 3.6.3, which is already on `main`. The new crates (`ureq` 3.5.0, `ureq-proto` 0.6.5, `utf8-zero` 0.8.1, `webpki-roots` 1.x, `base64` 0.23) carry no advisory. Not caused by this job.
- [note] Claude model ids in `ClaudeModel::api_id` (src-tauri/src/engines/claude.rs:41-49) are unverified, as the build says. That is a functional issue, not a security one.

## Checked
- Core: `engines/claude.rs` (transport: https_only, `proxy(None)`, `max_redirects(0)`, 10 s/60 s timeouts, URL check before connecting, 1 MiB body cap, `http_status_as_error(false)`, status-to-kind mapping, logs name the status/kind only, the key held as `Zeroizing` and redacted in `HttpRequest`'s Debug), `engines/llm.rs` (`&'static str` system part, content cut, escaped `& < >`, delimited, CONTENT_RULE in system; control characters stripped from the output, which is cut), `secrets.rs` (keychain service = app id, account `anthropic-api-key`, parse 1–512 `is_ascii_graphic`, errors carry kinds only, the keyring error is logged as a kind only), `language_model.rs` (no fallback, `none` touches nothing), the `lib.rs` commands and wiring, the settings validation (local id must be in the core's scan, closed `ClaudeModel` enum).
- UI: `LanguageModelSection.tsx`: the key read from an uncontrolled `type="password"` `autocomplete="off"` input via ref and never in React state, the field cleared after saving, the reply rendered as a text node; `ipc.ts` returns `{ set }` only.
- `src/config.test.ts` loosening: only ureq 3 with rustls/webpki-roots; native-tls/openssl/socks/platform-verifier/tokio/hyper banned; only `engines/claude.rs` uses ureq; the only URL constant is the Messages API; still no TcpListener/UdpSocket; CSP and capabilities unchanged. ureq's internal `log` calls go nowhere (no log backend in Cargo.lock).
- `gitleaks.sh` on the worktree: no leaks found. The test key `FAKE-TOKEN-for-tests-only-9931` is an obvious fake.

## Secure-coding checklist
No `docs.secure_coding` in the profile; one row per focus bullet. NFR sections: Architecture, Privacy, Security.

| Rule | Result | Evidence |
|---|---|---|
| Input validation, injection (shell, SQL, path, HTML), unsafe deserialization | ok | secrets.rs `ApiKey::parse`; settings/mod.rs local id checked against the core scan + `valid_text`; closed enum `claudeModel`; Messages answer parsed into a typed struct for 200 only; prompt injection: llm.rs `Prompt::build` escapes and delimits, system is `&'static str` (NFR Security "untrusted input") |
| Secrets in code, config, logs, fixtures; broad permissions | ok | key only in `KeychainSecretStore`; `Zeroizing`, redacted Debug; errors and logs carry kinds only; capabilities still `core:default`; gitleaks clean (NFR Privacy "Secrets go into the OS keychain") |
| AuthN/AuthZ, sessions/cookies, insecure defaults, rate/size limits | ok | default `languageModel: none`; one Test at a time (`Busy`); input ≤ 200k chars, output ≤ 4096 tokens, body ≤ 1 MiB; consent enforced in the UI only (see note) |
| Cryptography: established algorithms/libraries only | ok | rustls (ring) + webpki-roots via ureq; no native-tls/openssl; https_only |
| Errors and logs: no internals to users, no sensitive data in logs | ok | `LlmError`/`SecretError` are kinds; claude.rs logs the status/kind only, never the body; log.rs to stderr only |
| Personal data: minimisation, no real data in tests, deletion | ok | the Test sends a fixed sample only; no meeting path reaches the engine (language_model/tests AC6); `delete_api_key` removes the keychain entry |
| New dependencies: necessary, maintained, licensed, pinned | ok | `ureq` 3.5 (MIT/Apache, maintained), default features off, Cargo.lock pinned with checksums; no advisories on the new crates |
| Security negative tests | ok | wrong URL refused, no key → `NoApiKey` with no request, locked keychain, invalid key names no value, injection line + fake delimiter, marker key absent from files/IPC/logs, 401/429/5xx/offline mapping |
| Secret scan (`secret_scan: true`) | ok | `gitleaks.sh` on the worktree: "no leaks found" |
| NFR Architecture: local-first, cloud opt-in per setting, engines behind interfaces | ok | `LanguageModel`/`Transport`/`SecretStore` traits; default `none`; no automatic fallback (language_model.rs `build_engine`) |
| NFR Privacy: nothing leaves without a person, destination named | ok | inline confirmation names "Anthropic, api.anthropic.com, USA"; requests only on Test; none/local make no request (tested) |
| NFR Security: no listening ports | ok | config.test.ts still bans TcpListener/UdpSocket; no llama-server/loopback added |
