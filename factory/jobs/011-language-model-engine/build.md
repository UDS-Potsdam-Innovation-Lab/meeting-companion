# Build: 011-language-model-engine

## Decision for the human gate: the local runtime is not linked (spec's own fallback, split option a)

The spec asked to check llama.cpp next to whisper.cpp first. I built a probe binary with `whisper-rs 0.16` and
`llama-cpp-2 0.1.160`. It **links without an error, but wrongly**: both `whisper-rs-sys` and `llama-cpp-sys-2`
emit `libggml.a`, `libggml-base.a` and `libggml-cpu.a` under the same names. The linker takes one copy for both
libraries. In the probe binary only llama.cpp's ggml was linked: whisper's own `gguf_init_from_file_impl` was
missing. That means whisper.cpp (built against ggml 0.9.5 headers) would silently run on llama.cpp's newer ggml.
That is an ABI mismatch that no test would catch. `llama-cpp-sys-2` also links a vendored `cpp-httplib` (an HTTP
client in C++), which this app's no-network posture would have to review separately.

So this job ships the spec's split option (a):
- Done in full: the interface, the scripted fake, the Claude engine, the keychain key, the settings, and the whole
  section with every designed state (frame 17).
- Done as the slot for the runtime: the GGUF scan (`ModelKind::Llm`, read-only, App folder and Hugging Face cache)
  and the local engine slot (`LocalLlmProvider`). The app ships `NoLocalRuntime`: `list_llm_models` returns
  `available: false`, the core refuses `{ local: … }`, and "On this device" is a disabled radio with
  "Not available in this version yet."
- With `MEETING_COMPANION_LLM=fake` (smoke run, tests) and in the e2e build, local models from the scan run on the
  scripted engine, so all local UI states are built and tested.
- Not done: a real llama.cpp engine and its `#[ignore]` test with `MEETING_COMPANION_LLM_MODEL`. Follow-up
  "Local language model": one shared ggml for both crates (or `llama-server` on loopback, which needs its own
  security review). AC1 therefore has two real implementations (Claude, scripted) plus the empty local slot, not three.

Other decisions the gate should confirm:
- HTTP client: `ureq = { version = "3.5", default-features = false, features = ["rustls"] }` (rustls + ring +
  webpki-roots; no native-tls, no gzip, no proxy features). `src/config.test.ts` is deliberately loosened, and
  only for this (see AC3).
- Claude models: a closed list in the core, `sonnet` (default) / `haiku` / `opus`. The API ids are `claude-sonnet-5-5`,
  `claude-haiku-5-5` and `claude-opus-5-5`, after the design's "Sonnet 5.5 / Haiku 5.5 / Opus 5.5". **Check them
  against Anthropic's model list before release.** Updating them is a code change (`ClaudeModel::api_id`).
- The Claude model is its own setting key, `claudeModel`. The design added a model select, so `languageModel`
  stays exactly as the spec says: `"none" | { local } | "claude"`.
- Spec review 1 (Help & legal privacy paragraph): job 014 is not on `main`, so there is no view or section list to
  add it to. The de/en text is added as `legal.privacy.languageModel.title/.body`, following 014's key structure.
  The `privacy-language-model` section entry has to be added when 014 is merged (whichever job merges second).
  This criterion is **partly done**.

## Summary
- Core: `engines/llm.rs` holds the `LanguageModel` trait, `Prompt::build` and `ScriptedLanguageModel`.
  `Prompt::build` takes fixed `&'static str` instructions and keeps the content apart: it cuts the content at
  its limit, escapes `& < >` and wraps it in `<untrusted_content>`. `run_cancellable` runs the call off the
  calling thread and returns `Cancelled` within 50 ms.
- `engines/claude.rs`: the Claude engine and the `Transport` trait. `UreqTransport` is HTTPS-only, posts only
  to `https://api.anthropic.com/v1/messages`, uses no proxy, follows no redirect, has a 10 s connect and 60 s
  total timeout and never retries. Answers map to error kinds only.
- `secrets.rs`: `SecretStore` with `KeychainSecretStore` (service = app id, account `anthropic-api-key`) and
  `MemorySecretStore`. `language_model.rs` holds the factory (no fallback ever) and the cancellable Test service.
  New settings `languageModel` and `claudeModel`.
- New commands: `list_llm_models`, `get_api_key_status`, `set_api_key`, `delete_api_key`, `run_llm_test`,
  `cancel_llm_test`. No new event. No meeting or recording code path can reach the engine.
- UI: a "Language model" section between "On this device" and "General" (frame 17). It has the engine radios,
  the inline non-modal "Send text to Anthropic?" confirmation, the local list (found / none found / not found any
  more), the Claude card with destination line, model select and key states (no key, entering, saved,
  replace, remove confirm, invalid, keychain unavailable), and the Test with waiting, cancel, plain-text reply
  and worded errors.
- The shared settings building blocks moved to `src/features/settings/parts.tsx`. Added mock fixtures
  `settings-llm-*` (plus `&theme=dark`), screenshots, de/en keys, and AGENTS.md.

## Acceptance criteria
| AC | Test | Result |
|----|------|--------|
| AC1 default `none` builds nothing, touches no network/keychain/model file | src-tauri/src/language_model/tests.rs::the_default_setting_builds_no_engine_and_touches_no_network_keychain_or_model_file | PASS |
| AC1 unknown local id refused; vanished model → `NoModel` | language_model/tests.rs::a_local_id_outside_the_scan_is_refused_and_a_model_that_disappeared_gives_no_model; settings/tests.rs::the_language_model_setting_is_none_local_from_the_scan_or_claude_and_nothing_else | PASS |
| AC1 "Not found any more" in the view | src/features/settings/LanguageModel.test.tsx::AC1 a chosen model that disappeared shows Not found any more and nothing switches | PASS |
| AC1 no automatic fallback | language_model/tests.rs::the_core_never_falls_back_to_another_engine | PASS |
| AC1 `MEETING_COMPANION_LLM=fake` | language_model/tests.rs::the_fake_flag_selects_the_scripted_engine_and_nothing_is_sent; smoke run | PASS |
| AC1 no engine type in `src/` | src/config.test.ts::the UI never sees an engine type: the IPC module names no engine, host or key | PASS |
| AC1 GGUF scan (read-only, App + HF cache, no projectors/split parts) | engines/models.rs::tests::gguf_language_models_are_listed_…, projectors_encoders_split_parts_…, the_llm_scan_changes_nothing_…, a_gguf_linked_from_outside_… | PASS |
| AC1 local runtime absent in this build | language_model/tests.rs::this_build_has_no_local_runtime_so_on_this_device_cannot_be_chosen; LanguageModel.test.tsx::while this version has no local runtime… | PASS (deviation, see top) |
| AC1 real local model test `#[ignore]` | — | NOT BUILT (no runtime) |
| AC2 marker key in no file, IPC answer, log line or error (Rust) | language_model/tests.rs::the_key_is_in_no_file_ipc_answer_log_line_or_error | PASS |
| AC2 marker in no localStorage, IPC response, event, page or console (component) | LanguageModel.test.tsx::the field is a password field without autocomplete, cleared after saving; the key is nowhere else; e2e/language-model.spec.ts::choose Claude, confirm, save a key and test, without a mouse | PASS |
| AC2 status is `{ set }` only; delete removes entry; then `NoApiKey` before any request | secrets.rs::tests::the_status_is_set_yes_or_no_only; engines/claude.rs::tests::without_a_key_the_call_fails_before_any_request_is_built | PASS |
| AC2 input check, `InvalidKey` names no value | secrets.rs::tests::input_is_trimmed_and_must_be_1_to_512_printable_ascii_characters, an_invalid_key_names_no_value_in_the_error_or_the_log; LanguageModel.test.tsx::an invalid key names no value… | PASS |
| AC2 locked keychain → `KeychainUnavailable`, app keeps running | secrets.rs::tests::a_locked_keychain_gives_keychain_unavailable; language_model/tests.rs::a_locked_keychain_gives_keychain_unavailable_and_the_app_keeps_running; LanguageModel.test.tsx::a locked keychain is explained… | PASS |
| AC2 real keychain test | secrets.rs::tests::keychain_api_key_round_trip (`#[ignore]`, `-- --ignored keychain`) | not run (by hand) |
| AC3 confirmation names destination and what is sent; cancel keeps setting | LanguageModel.test.tsx::shows an inline confirmation naming Anthropic…, Use Claude API changes the setting…; e2e::Cancel in the confirmation keeps the setting… | PASS |
| AC3 only `https://api.anthropic.com/v1/messages`, key only in `x-api-key` | engines/claude.rs::tests::requests_go_only_to_the_messages_url_over_https_with_the_key_only_in_x_api_key, the_real_transport_refuses_any_other_url_before_connecting | PASS |
| AC3 no request while `none` or local | language_model/tests.rs::no_request_is_made_while_the_setting_is_off_or_local | PASS |
| AC3 deliberate `config.test.ts` update | src/config.test.ts::AC3 (job 011) … (5 tests) + updated job 003/004 checks | PASS |
| AC3 timeouts, offline/401/429/5xx → kinds, no retry, no body text | engines/claude.rs::tests::offline_timeouts_401_429_and_5xx_map_to_kinds_once_without_retry_or_body_text | PASS |
| AC4 injection line + fake delimiter only inside escaped block | engines/llm.rs::tests::content_goes_only_into_the_escaped_block_and_never_into_the_system_part; engines/claude.rs::tests::content_is_only_in_the_user_message_and_instructions_only_in_system | PASS |
| AC4 input cut + `truncated: true`; output cut | engines/llm.rs::tests::input_over_the_limit_is_cut_and_reported, output_over_the_limit_is_cut_and_returned_as_plain_text | PASS |
| AC4 reply rendered as text | LanguageModel.test.tsx::markup in the reply is shown literally (ESLint `react/no-danger` unchanged) | PASS |
| AC4 prompt/reply never in logs or errors | engines/claude.rs::tests::prompt_and_reply_text_never_reach_the_log_or_an_error; language_model/tests.rs::the_test_sends_only_the_fixed_sample_in_the_content_block_and_logs_no_text | PASS |
| AC5 section, choices, local list/none found, key, destination line, Test | LanguageModel.test.tsx::AC5 … (6 tests) and AC4/AC5 error kinds (5) | PASS |
| AC5 fixtures, axe WCAG 2.2 AA, no horizontal scroll, 24 px / 48 px on board, light + dark, 7 sizes | e2e/language-model.spec.ts::AC5 accessible and responsive in light and dark (84 tests) | PASS |
| AC5 keyboard only | e2e/language-model.spec.ts::AC5 keyboard only (2) | PASS |
| AC5 strings from keys, parity, no literals | src/i18n/i18n.test.tsx::AC5 (job 011) …, AC6 catalogues; the sample shown = the sample the core sends | PASS |
| AC6 off the UI thread, cancellable, `Cancelled` < 1 s, settings + recording state responsive | engines/llm.rs::tests::cancelling_a_slow_call_returns_cancelled_within_a_second, a_cancel_returns_within_a_second_even_when_the_engine_does_not_look_at_the_token; language_model/tests.rs::a_slow_engine_blocks_nothing_and_cancel_returns_cancelled_within_a_second; LanguageModel.test.tsx::while the Test waits…; e2e::Cancel test answers within a second… | PASS |
| AC6 recording with scripted engine configured records zero requests | language_model/tests.rs::a_recording_with_the_scripted_engine_configured_sends_it_nothing | PASS |
| Spec review 1: privacy paragraph in Help & legal | de/en keys `legal.privacy.languageModel.*` | PARTIAL (014 not merged; section entry pending) |

## Secure coding
No `docs.secure_coding` is configured. The NFR rules this change touches:
- Secrets only in the OS keychain: the key goes through `set_api_key` straight into `SecretStore`. It is held as
  `Zeroizing`, its Debug output is redacted, and it is never in the settings file, localStorage, React state (the
  input element only), an answer, an event, a log line or an error. Tests check all of these with a marker key.
- Nothing leaves the device without a person: "Off" is the default. Claude needs an explicit inline confirmation
  that names "Anthropic, api.anthropic.com, USA". "Off" and local never touch the transport (tested). The only
  traffic in this job is the fixed sample text, and only when someone presses Test.
- Cloud opt-in, one destination: one HTTP client, referenced only in `engines/claude.rs`, and one URL constant.
  The transport refuses any other URL. HTTPS only, no proxy (not even from the environment), no redirects,
  timeouts of 10 s and 60 s, no retry. CSP `connect-src` is unchanged (IPC only), there is no Tauri HTTP or shell
  plugin, and no listening socket. `src/config.test.ts` pins all of this.
- Untrusted transcript text and prompt injection: the instructions are `&'static str`. The content is only in the
  user message, escaped and delimited, with a fixed rule in the system part. Input and output are cut at their
  limits, and the reply is plain text rendered as text.
- No content in logs: errors are kinds. Logs carry the kind or HTTP status only, never a body, prompt, reply or key.
  No `log` crate backend is installed, so ureq's internal `log` calls go nowhere.
- Input validation: the key must be 1–512 printable ASCII characters without spaces (`InvalidKey` names no value).
  A local id is accepted only from the core's own scan. `claudeModel` comes from a closed enum. Unknown stored
  values fall back to `none`.

## Test run
`npm test` (vitest && cargo test && playwright test) → vitest 258 passed / 20 files; cargo 249 passed, 0 failed,
6 ignored (real keychain / model tests); Playwright 236 passed.
Also: `npm run lint` exit 0; `npm run tauri build -- --no-bundle` then `node scripts/smoke.mjs` → `SMOKE OK`;
`gitleaks.sh` exit 0 (143 commits, no leaks).
```
 Test Files  20 passed (20)
      Tests  258 passed (258)
test result: ok. 249 passed; 0 failed; 6 ignored; 0 measured; 0 filtered out; finished in 32.02s
  ✓  233 [chromium] › e2e/transcript.spec.ts:168:3 › AC1–AC5 recording with the mock core › the stored transcript is shown with times; markup stays text (445ms)
  ✓  234 [chromium] › e2e/transcript.spec.ts:176:3 › AC1–AC5 recording with the mock core › a microphone error shows the reason and Resume recording, without a REC chip (524ms)
  ✓  235 [chromium] › e2e/transcript.spec.ts:184:3 › AC1–AC5 recording with the mock core › End meeting stops recording first (567ms)
  ✓  236 [chromium] › e2e/transcript.spec.ts:192:3 › AC1–AC5 recording with the mock core › recording makes no network request beyond the app's own assets (1.4s)

  236 passed (1.7m)
SMOKE OK: agenda-setup rendered
smoke: passed
```
A note on an existing flaky test: `src/i18n/i18n.test.tsx` › "AC7 (job 004) … speakers view" sometimes fails at
`speakers.footer.listening`, on `main` as well (1 of 4 runs without this branch's changes). Not touched here.

## Commits
```
b5f0ce2 test(smoke): run the smoke test with the fake language model
2ce3aac feat(settings): language model section (frame 17)
a4a1969 feat(llm): language model engine with Claude API, keychain key and fake
```
