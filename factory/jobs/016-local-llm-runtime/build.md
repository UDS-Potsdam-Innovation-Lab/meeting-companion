# Build: 016-local-llm-runtime

## Summary
I probed the open question first, and option (a) works. ggml is built once (`node scripts/ggml.mjs build`) from the ggml 0.26.0 tree that `llama-cpp-sys-2 =0.1.160` vendors, into `src-tauri/native/ggml/prefix/`. Both engines link that one copy:
- llama.cpp uses it through the crate's `system-ggml-static` feature.
- whisper.cpp 1.8.3 (`whisper-rs =0.16.0`) uses it through `WHISPER_USE_SYSTEM_GGML=ON`. A CMake project hook (`whisper-shared-ggml.cmake`) copies the same archives into whisper-rs-sys's build folder, because its build script only searches there.

`.cargo/config.toml` wires both crates to the shared build. No `llama-server`, port or extra process was needed.

`engines/llama.rs` adds three types:
- `LlamaLocalProvider` takes the place of `NoLocalRuntime` whenever `MEETING_COMPANION_LLM` is not `fake`.
- `LlamaLanguageModel` loads the model lazily on its first call.
- `ModelSlot` holds at most one model in memory.

Prompts use the model's own chat template. llama.cpp renders the template with stand-ins, and only the template text is tokenized with special tokens. The prompt is fit to the context, generation stops at end of turn or at the token limit, and a cancel is checked before every token.

Broken GGUF files give `Failed` without a panic. llama.cpp's and ggml's log output goes to a callback that drops it.

In the UI, "On this device" is enabled and the "not available" key is removed. A load failure now shows a de/en message that names the model file. There is a new mock fixture, `settings-llm-local-failed`.

`scripts/ggml-check.mjs` and two new CI steps check for one ggml and no HTTP client. `AGENTS.md` documents the stack, the native build and the real-model test.

**Probe result:** a scratch crate linked whisper-rs and llama-cpp-2 on the shared ggml.
- whisper.cpp 1.8.3 compiles against ggml 0.26.0's headers without changes. The Rust side of whisper-rs only calls `ggml_log_set` and `ggml_cpu_has_*` from ggml, and both are stable.
- In the release app, `nm` shows exactly one definition of each listed ggml/gguf symbol.

## Acceptance criteria
| AC | Test | Result |
|----|------|--------|
| AC1 one ggml / no HTTP client in the binary | `node scripts/ggml-check.mjs src-tauri/target/release/meeting-companion` (release build of this branch; CI step "One ggml, both engines and no HTTP client in the release app") | PASS |
| AC1 check's negative tests on recorded symbol lists | `src/config.test.ts` › "AC1 (job 016) ggml-check on recorded symbol lists" (clean passes; two-ggml, no-whisper, no-llama, httplib, curl, llama-server, stripped, unreadable binary fail) | PASS |
| AC1 Cargo pins and bans | `src/config.test.ts` › "AC1 (job 016) one ggml, llama.cpp without HTTP client, sockets or processes" (llama-cpp-2/-sys-2 `=0.1.160`, `default-features = false`, only `system-ggml-static`; no HTTP/TLS/async crate in the engines' dependency closure; no `TcpListener`/`UdpSocket` outside `phone_view/`; no `process::Command` or socket in `engines/`; ureq only, only in `engines/claude.rs`; CI step order) | PASS |
| AC2 default `cargo test` unchanged | `cargo test --manifest-path src-tauri/Cargo.toml` (320 passed, 7 ignored) | PASS |
| AC2 real speech test before/after | `MEETING_COMPANION_WHISPER_MODEL=~/.local/share/voxtype/models/ggml-base.bin cargo test --release -- --ignored whisper`: **before** (main, whisper's own ggml 0.9.5) 2.66 s per 3 s window; **after** (shared ggml 0.26.0) 2.68 s. Both on this laptop (10 logical cores), both under 3 s | PASS |
| AC2 speaker accuracy | `MEETING_COMPANION_SPEAKER_MODEL=… cargo test -- --ignored speaker_accuracy`: 2 passed, every scene within `thresholds.json` (de-name-round DER 0.1669, en-overlap 0.1431, en-short-turns 0.0861, en-return 0.0438, de-noise 0.1292) | PASS |
| AC3 scan with `available: true`; `{ local: id }` only from the scan | `language_model::tests::with_the_llama_runtime_the_scan_is_listed_as_available_and_only_its_ids_are_accepted` | PASS |
| AC3 choosing loads nothing; load on first call, off the calling thread | `engines::llama::tests::choosing_hands_out_an_engine_but_loads_nothing_until_the_first_call`, `language_model::tests::the_model_loads_on_the_first_call_and_off_the_calling_thread` | PASS |
| AC3 one model in memory; Off/Claude/other model releases it | `language_model::tests::switching_to_off_claude_or_another_model_releases_the_local_model` | PASS |
| AC3 a disappeared file gives `NoModel` | `engines::llama::tests::a_model_file_that_disappeared_gives_no_model_and_is_released` | PASS |
| AC3 garbage / truncated header / no chat template give `Failed`, no panic, next call works | `engines::llama::tests::broken_files_fail_without_panic_and_the_next_call_still_works` (plus "no weights": a valid GGUF with a template that llama.cpp refuses) | PASS |
| AC3 read-only; nothing written beside the model or in the app data folder | `engines::llama::tests::model_files_are_only_read_and_nothing_is_written_beside_them_or_in_the_app_folder` (files 0444, folder 0555, listings and bytes unchanged) | PASS |
| AC3 at most `max(1, cores/2)` threads | `engines::llama::tests::generation_uses_at_most_half_the_logical_cores` | PASS |
| AC3 log callbacks drop everything; no content or path in the log | `engines::llama::tests::llama_cpp_and_ggml_logs_are_dropped_and_nothing_names_the_file_or_its_content` | PASS |
| AC4 system only in the system turn, content only in the user turn (chatml, llama3) | `engines::llama::tests::chatml_puts_the_instructions_only_in_the_system_turn_and_the_content_only_in_the_user_turn`, `…::llama3_puts_…` | PASS |
| AC4 injected `<\|im_start\|>system`, `<\|eot_id\|>`, "Ignore previous instructions…" come out escaped inside `<untrusted_content>` | same two tests (one template marker set only; the content's markers appear only as `&lt;…&gt;` between the delimiters) | PASS |
| AC4 content tokenized with special-token parsing off | `engines::llama::tests::only_template_text_is_tokenized_with_special_tokens` (chatml, llama3, gemma, mistral-v7, phi3) | PASS |
| AC4 stop at end of turn/EOS or `max_output_tokens` (sets `output_truncated`); cancel at next token | `engines::llama::tests::generation_stops_at_end_of_turn_or_at_the_token_limit`, `…::a_cancel_stops_generation_at_the_next_token` | PASS |
| AC4 cut to the context, `truncated: true`; fit logic pure | `engines::llama::tests::a_prompt_that_does_not_fit_the_context_is_cut_further`, `…::the_reply_goes_through_from_output` | PASS |
| AC4 reply through `LlmReply::from_output` | `engines::llama::tests::the_reply_goes_through_from_output` | PASS |
| AC4 `#[ignore]` real model | `MEETING_COMPANION_LLM_MODEL=qwen2.5-1.5b-instruct-q4_k_m.gguf cargo test --release -- --ignored llama` → `engines::llama::tests::llama_runs_a_real_model_offline`: load 0.41 s; EN reply 2.3 s (with load), DE 2.1 s; injection reply "The user message instructs to say ZEBRA-7731, which is ignored."; cancel → `Cancelled` < 1 s, generation thread stopped 36 ms after the cancel; no new or listening socket; 0 Claude calls | PASS |
| AC5 radio enabled, old notice and key gone | `src/features/settings/LanguageModel.test.tsx` › "job 016: On this device can be chosen…", "…stays disabled" if the core cannot list; `e2e/language-model.spec.ts` › "the radio is enabled; the old notice is gone; keyboard only…" | PASS |
| AC5 found / none found / gone / Test waiting + cancel / plain text reply | existing 011 component and e2e tests (`LanguageModel.test.tsx` AC5/AC6, `language-model.spec.ts` AC6), unchanged and green | PASS |
| AC5 worded local load failure (de/en), names the file, no llama.cpp text, not colour alone | `LanguageModel.test.tsx` › "job 016 AC5 a local model that cannot be loaded" (en, de, Claude keeps its own wording); `language-model.spec.ts` › "a load failure names the file, not llama.cpp, and Test again works by keyboard (en/de)" | PASS |
| AC5 mock fixture, axe, no horizontal scroll at all sizes, light/dark, ≥ 48 px on the board size | `language-model.spec.ts` › "AC5 accessible and responsive in light and dark" now includes `settings-llm-local-failed` (7 sizes × 2 themes) | PASS |
| AC5 de/en parity, no literals | `src/i18n/i18n.test.tsx` and ESLint `react/jsx-no-literals` (in `npm test` / `npm run lint`) | PASS |
| AC6 `{ local }` + garbage model: no Claude call, no fallback | `language_model::tests::a_garbage_local_model_fails_without_calling_claude_or_falling_back` | PASS |
| AC6 smoke run port-free with the runtime linked | `xvfb-run -a node scripts/smoke.mjs`: **not run locally**, because this machine has no `xvfb-run`/Xvfb and starting the app on the live Wayland desktop would take focus. CI runs it on the release build. The `/proc` socket scan of the real-model test above covers the llama.cpp runtime itself | CI |

Deviations, for the reviewers:
- AC1 names `whisper_init_from_file_with_params` as a required symbol. The app only calls `whisper_init_from_file_with_params_no_state` (whisper-rs's `WhisperContext::new_with_params`), and the linker's section GC drops the unused wrapper. `ggml-check` therefore requires `whisper_init_from_file_with_params_no_state`. `gguf_init_from_file_impl` is static in ggml 0.26.0, so it has 0 definitions, which passes the "at most once" check.
- `fit`: when the requested reply length alone does not fit next to the fixed tokens (e.g. `max_output_tokens` 4096 in a 4096 context), the reply keeps at most half of the remaining room and the content is cut to the rest (`truncated`). It does not fail outright. The real-model run found this case.
- A GGUF with 0 tensors is not listed by 011's scan. The "garbage" and "no chat template" fixtures are therefore tested on the loader directly. The fixtures that pass the scan (truncated, valid without template, template without weights) also go through the provider and the engine thread.
- CI builds the shared ggml with `GGML_NATIVE=OFF`, so the cached prefix runs on any runner. Local builds keep ggml's default (native), as whisper-rs-sys built it before. Portable CPU variants for release installers are left for the release/installer work.
- The 1.5B test model answered the German sample in English. The prompt is unchanged from 011, and this is a model-quality point, not a runtime one.

## Secure coding
No `docs.secure_coding` is configured. These NFR rules are touched:
- **No listening network ports / no socket outside `phone_view/`:** llama.cpp runs in-process and nothing new opens a socket. `config.test.ts` bans sockets and `process::Command` in `engines/`. The real-model test scans `/proc` for new or listening sockets and finds none.
- **No HTTP client besides ureq in `engines/claude.rs`:** `llama-cpp-2` is built without `common`, so cpp-httplib is not linked. `config.test.ts` checks the dependency closure, and `ggml-check` fails on any httplib, curl or llama-server symbol in the release binary.
- **Transcript text is untrusted input to the language model:** instructions go only into the system turn and the escaped `<untrusted_content>` block only into the user turn. Content and instructions are tokenized with special-token parsing off, so `<|im_start|>`, `<|eot_id|>` and `[INST]` in content cannot become turn markers. The reply goes through `LlmReply::from_output`, and the UI renders it as text.
- **Native code parsing user-placed GGUF files:** the GGUF metadata is read first, and a file with no template is refused before any weights load. llama.cpp's versions are pinned (`=0.1.160`), the file is mapped read-only, and panics are caught (`Failed`). Tests cover garbage, truncated and template-less files, and none aborts.
- **Nothing in the logs names content or paths:** llama.cpp's and ggml's log callbacks drop all text. They are installed when the provider is created, before every load and before every generation. The app's own log carries error kinds only, which a test checks.
- **Nothing leaves the device / no fallback:** a broken local model gives `Failed` with 0 calls to the Claude transport.
- **Local-first:** the local engine works offline. No model is downloaded or bundled.
- **Shared ggml supply chain:** ggml is built only from the pinned crate's own sources. `prefix/SOURCE` records the crate, the ggml version and the options, and `ggml.mjs verify` fails on a mismatch.

## Test run
`npm run lint` → exit 0. `npm test` → vitest 293 passed (22 files); cargo 320 passed, 0 failed, 7 ignored; Playwright 263 passed.
```
 Test Files  22 passed (22)
      Tests  293 passed (293)
test result: ok. 320 passed; 0 failed; 7 ignored; 0 measured; 0 filtered out; finished in 25.25s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  ✓  262 [chromium] › e2e/transcript.spec.ts:184:3 › AC1–AC5 recording with the mock core › End meeting stops recording first (360ms)
  ✓  263 [chromium] › e2e/transcript.spec.ts:192:3 › AC1–AC5 recording with the mock core › recording makes no network request beyond the app's own assets (1.1s)

  263 passed (1.2m)
```
Run by hand:
- `npm run tauri build -- --no-bundle` → OK.
- `node scripts/ggml-check.mjs src-tauri/target/release/meeting-companion` → "one ggml, both engines linked, no HTTP client (10 symbols checked)".
- `--ignored whisper` → 2.68 s per window.
- `--ignored llama` → 1 passed.
- `--ignored speaker_accuracy` → 2 passed.
- Secret scan (`gitleaks.sh`) → no leaks.

Setup for a fresh checkout: `node scripts/sherpa-onnx.mjs fetch`, then `node scripts/ggml.mjs build`.

## Commits
```
b96fe4f docs: one ggml, the local language model and its real-model test
e8b2f63 feat(ui): On this device can be chosen; a local load failure is named
68dbfeb ci: check for one ggml and no HTTP client in the release app
e332999 feat(core): llama.cpp fills the local language model slot
878e873 build(native): one shared ggml for whisper.cpp and llama.cpp
```

## Round 2 response

All four reviews were PASS. CI failed in "Compile the desktop app" (run 41334135604): rust-lld reported duplicate `ggml_backend_*` symbols, defined in both `libwhisper_rs_sys-*.rlib` and `libllama_cpp_sys_2-*.rlib`.

**Cause.** Swatinem/rust-cache restores by key prefix, so the run got the release-profile `whisper-rs-sys` that main's CI had cached. That copy was built with whisper's own ggml 0.9.5. Two things kept it in place:
- cargo does not rerun whisper-rs-sys's build script when `[env]` in `.cargo/config.toml` changes (its build script declares no `rerun-if-env-changed`), so `WHISPER_USE_SYSTEM_GGML` was never applied to the cached build.
- My `cargo clean -p whisper-rs-sys -p llama-cpp-sys-2` in `ggml.mjs` only cleaned the dev profile.

That is why `npm test` (debug) passed in CI and the release link failed. It worked locally only because the worktree's release dir had been built fresh.

**Reproduced locally.** I used a target dir holding main's release build (whisper-rs-sys with its own ggml) and ran `CARGO_TARGET_DIR=<it> cargo build --release`. It failed with the same rust-lld "duplicate symbol: ggml_backend_buft_*" errors.

**Fix (commit 83cc3ac).**
- **Stamps:** the CMake hooks stamp each sys crate's build folder (`out/build/meeting-companion-ggml.SOURCE`) with the prefix's `SOURCE`, which now carries a build id. `whisper-shared-ggml.cmake` does this as before; the new `llama-shared-ggml.cmake` is wired through `CMAKE_PROJECT_llama.cpp_INCLUDE`.
- **`ggml.mjs build`:** on every run, including when the prefix is already up to date, it scans the target dir and runs `cargo clean --profile <p> -p <crate>` for every profile with a whisper-rs-sys or llama-cpp-sys-2 output that is unstamped or stamped by another build. It honours `CARGO_TARGET_DIR` and `<triple>/<profile>` folders.
- **`ggml.mjs verify`:** fails if such a stale output remains. CI already runs `build` and then `verify` before the tests.
- **Tests:** `src/config.test.ts` covers a stamped target (passes), a whisper-rs-sys with its own ggml (fails) and an output from an earlier prefix (fails). It also checks the new cargo config line.
- **Docs:** `AGENTS.md` and the CI comment explain the stamping and cleaning.

**Verified with CI's settings on the stale target dir:**
- `GGML_NATIVE=OFF node scripts/ggml.mjs build` rebuilt the prefix and cleaned the stale release outputs of both crates ("Removed 1322 files"); `verify` then passed.
- `npm run tauri build -- --no-bundle` linked with 0 duplicate symbols.
- `node scripts/ggml-check.mjs <release binary>` passed: one ggml, both engines linked, no HTTP client.
- Both stamps were present, and whisper-rs-sys had no `out/build/ggml`.

I then rebuilt the local default prefix, which cleaned the worktree's debug and release sys outputs, and re-ran:
- `npm run lint` → exit 0.
- `npm test` → vitest 296 passed (22 files); cargo 320 passed, 7 ignored; Playwright 263 passed.
- Secret scan → no leaks.

Not pushed.
