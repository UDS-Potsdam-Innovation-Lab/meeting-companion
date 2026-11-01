VERDICT: PASS

## Findings
- [note] src-tauri/src/engines/llm.rs:2 — the module doc links `super::llama::LlamaLanguageModel`, which does not exist in this build, and says "three implementations". Reword it to name the empty local slot (see language_model.rs:9) so the doc does not mislead.
- [note] The local llama.cpp engine and its `#[ignore]` test are not delivered. This is the spec's own split option (a), the ggml clash is documented in build.md and AGENTS.md, and the gate must accept that AC1 is met only in part. The `{ local }` setting is rejected by the core while there is no runtime (language_model.rs `build_engine`, lib.rs `llm_models`), so there is no dead path that appears to work.
- [note] engines/claude.rs: `TransportError::Timeout` maps to `Failed`. The spec lists no separate kind, so this is fine.

## Checked
- Read claude.rs, llm.rs, secrets.rs, language_model.rs and the lib.rs wiring. The prompt is built in one place, with content escaped and wrapped. The key sits in the `x-api-key` header only, in `Zeroizing` memory, with a redacted `Debug`. Errors are kinds only. There is no fallback between engines. `none` returns `NotConfigured` before any keychain or network access. The Claude and keychain code paths match their ACs. Cancel is polled every 50 ms.
- Ran `cargo test --lib language_model` (14 passed). It covers the key-in-no-file, log and error test, the slow-engine cancel within 1 s, and the recording-sends-zero-requests test.
- Conventions: no edits to `.claude/` or `factory/` on the branch, and the AGENTS.md stack and network sections are updated. UI, e2e and the `config.test.ts` loosening were only skimmed; the UI and a11y lenses belong to other reviewers.
