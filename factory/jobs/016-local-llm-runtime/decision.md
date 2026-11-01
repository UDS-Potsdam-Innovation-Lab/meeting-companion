APPROVE
llama.cpp fills the local language model slot on one shared ggml with no port or HTTP client; CI is green on HEAD 3f73115, every AC has a test, and the scope is clean.

## Checks
- Tests: CI run 41341421155 (round-3/ci.md) → `CI: success` for 3f73115a23098a74e0a0deac9a545b83a8970796, which equals `git rev-parse HEAD` in the worktree. All steps are green, including the release compile, the "One ggml" ggml-check step, speaker accuracy and the Linux smoke test (port scan). I did not re-run the suites.
- Acceptance criteria:
  - AC1 ✓ CI step `node scripts/ggml-check.mjs` after the release build. The negative tests on recorded symbol lists in `src/config.test.ts` cover two-ggml, no-whisper, no-llama, httplib, curl, llama-server, a stripped binary and the clean list. The Cargo pin/feature checks and the socket/Command/HTTP-client bans are in `config.test.ts`. One documented deviation: the check requires `whisper_init_from_file_with_params_no_state`, because the linker drops the unused `_with_params` wrapper, and `gguf_init_from_file_impl` is static in ggml 0.26.0. The intent of the AC holds and code review accepted it.
  - AC2 ✓ The default cargo suite is green in CI. The real whisper test went from 2.66 s to 2.68 s per 3 s window, still under 3 s. Speaker accuracy is green in CI.
  - AC3 ✓ I confirmed that each named test exists: `with_the_llama_runtime_the_scan_is_listed_as_available…`, `choosing_hands_out_an_engine_but_loads_nothing…`, `the_model_loads_on_the_first_call_and_off_the_calling_thread`, `switching_to_off_claude_or_another_model_releases…`, `a_model_file_that_disappeared_gives_no_model…`, `broken_files_fail_without_panic…`, `model_files_are_only_read…`, `generation_uses_at_most_half_the_logical_cores` and `llama_cpp_and_ggml_logs_are_dropped…`.
  - AC4 ✓ Tests: chatml and llama3 turn separation with escaping, `only_template_text_is_tokenized_with_special_tokens`, `generation_stops_at_end_of_turn_or_at_the_token_limit`, `a_cancel_stops_generation_at_the_next_token`, `a_prompt_that_does_not_fit_the_context_is_cut_further`, `the_reply_goes_through_from_output`. The `#[ignore]` test `llama_runs_a_real_model_offline` was run by hand, and build.md records it.
  - AC5 ✓ `LanguageModel.test.tsx` (job 016 cases) and `e2e/language-model.spec.ts`. The `settings-llm-local-failed` fixture is in the mock backend and the axe/size/theme matrix. The i18n parity and no-literal tests pass.
  - AC6 ✓ The smoke test is green in CI with the real runtime linked. `a_garbage_local_model_fails_without_calling_claude_or_falling_back` covers the no-fallback case.
- Scope / factory files untouched: ✓ Nothing under `.claude/` or `factory/` changed. The new crates `llama-cpp-2` and `llama-cpp-sys-2` (`=0.1.160`) are named in the spec. `find_cuda_helper` and `valuable` come in only as their transitive build or tracing dependencies. `whisper-rs` is only tightened to `=0.16.0`, the same version. Nothing changes what is recorded, stored or sent off the device. No auth, secrets, permissions or data migration are involved.
- Non-blocking notes for later jobs:
  - A crafted GGUF can still abort the process inside C++, because `catch_unwind` only catches Rust panics. This is a local DoS with the user's own file.
  - The cached ggml prefix is identified by a stamp, not by archive hashes. Add hashes before release installers are built from a cached prefix.
  - There is no RAM check before a model loads. This is deferred to "Model setup".
  - `ggml.mjs build --prefix` will delete whatever folder it is given.

## For the human (ESCALATE only)
n/a
