# Local language model runtime: llama.cpp in the `LocalLlmProvider` slot, on one shared ggml

## Problem
Job 011 added the language model engine, but "On this device" is a disabled radio. The app ships `NoLocalRuntime` because `whisper-rs-sys` (whisper.cpp, ggml 0.9.5) and `llama-cpp-sys-2` (llama.cpp, ggml 0.26.0) both emit `libggml.a`, `libggml-base.a` and `libggml-cpu.a` under the same names. The linker keeps one copy without an error, so whisper.cpp would silently run on the other library's ggml. The NFR "Local-first" requires a language model that works offline on the device. Facilitators who cannot or may not send meeting text to Anthropic need it. This job fills the slot with llama.cpp running in the app's own process on one ggml build, with no listening port and no HTTP client.

## Scope
- in:
  - One ggml in the binary, shared by whisper.cpp and llama.cpp. The builder probes and picks the mechanism (see Open questions). The crates seen locally offer two switches: `llama-cpp-sys-2`'s `system-ggml-static` feature, and whisper.cpp's `WHISPER_USE_SYSTEM_GGML`, which `whisper-rs-sys` passes through from the environment. The decision and the pinned versions are recorded in AGENTS.md.
  - `llama-cpp-2` with `default-features = false`. The `common` feature is off, which drops the vendored cpp-httplib. `mtmd`, `dynamic-link`, `dynamic-backends`, `llguidance` and GPU backends are also off: CPU only, with Metal on macOS left for later.
  - `src-tauri/src/engines/llama.rs`: `LlamaLocalProvider` (implements `LocalLlmProvider`) and `LlamaLanguageModel` (implements `LanguageModel`). They are wired in `lib.rs` in place of `NoLocalRuntime` whenever `MEETING_COMPANION_LLM` is not `fake`.
  - Prompt handling for local models: the model's own chat template, separate system and user turns, no special tokens parsed from content, and a stop at end-of-turn or the token limit.
  - A check script `scripts/ggml-check.mjs` and CI steps that fail on a second ggml copy or on a linked HTTP client.
  - UI: "On this device" becomes selectable when the core reports `available: true`. Add a worded "model could not be loaded" error for local models. De/en keys and a mock fixture.
  - Docs: AGENTS.md (stack, native build, the `#[ignore]` real-model test), the 011 module doc in `engines/llm.rs` (which names `LlamaLanguageModel`), and `language_model.rs`.
- out:
  - `llama-server` or any other separate process, loopback port or IPC socket. Reason: NFR Security allows no listening port except the phone web view, and AGENTS.md allows no socket outside `phone_view/`. If one shared ggml cannot be made to work, the builder stops and reports. The builder does not switch to `llama-server`.
  - Downloading, bundling or recommending models (the "Model setup" follow-up). GPU acceleration, multimodal models, streaming, tool use, grammar-constrained output.
  - Any meeting feature that calls the engine. 011's AC6 still holds: no recording path reaches the engine.
  - CI on macOS and Windows (deferred project-wide). OS-specific build code stays in place.

## Stack
Status: EXISTING

## Acceptance criteria
- [ ] AC1: One ggml and no HTTP client in the binary.
  - `node scripts/ggml-check.mjs <binary>` runs in CI after the release build.
  - It fails if any of a listed set of ggml/gguf symbols is defined more than once. The set includes at least `ggml_init`, `gguf_init_from_file`, `ggml_backend_cpu_init` and `ggml_graph_compute`, plus whisper's `gguf_init_from_file_impl`, which 011's probe found missing.
  - It fails if either `whisper_init_from_file_with_params` or `llama_model_load_from_file` is missing.
  - It fails if any `httplib`, curl or `llama-server` symbol is present.
  - Its own negative tests run on recorded symbol-list fixtures: two copies fail, a missing engine fails, an httplib symbol fails, and the clean list passes.
  - `src/config.test.ts` checks `Cargo.toml`: `llama-cpp-2` is pinned with `default-features = false`, without `common`/`mtmd`/`dynamic-link`/`dynamic-backends`. It also still bans `TcpListener`/`UdpSocket` outside `phone_view/`, `std::process::Command` in `engines/`, and any HTTP client crate besides 011's `ureq` in `engines/claude.rs`.
  - (NFR Security "No listening network ports…"; AGENTS.md Rules; feature request "no vendored HTTP client")
- [ ] AC2: whisper.cpp still works on the shared ggml.
  - The default `cargo test` suite passes unchanged.
  - The real speech test (`--release -- --ignored whisper`) passes on the new build and prints the time per 3 s window. The build report records it before and after, and the new time is still below 3 s on the reference laptop.
  - The speaker accuracy run in CI (`--ignored speaker_accuracy`) stays within `thresholds.json`.
  - (NFR Performance "Transcript lines appear within 3 s"; Reliability)
- [ ] AC3: The local engine fills the slot and fails safely. Rust tests that need no model:
  - With `LlamaLocalProvider`, `list_llm_models` returns the 011 scan with `available: true`.
  - `{ local: id }` is accepted only for an id from the current scan.
  - Choosing a model loads nothing. Loading happens on the first call and runs off the calling thread.
  - Only one model is in memory at a time. Switching to Off, to Claude or to another model releases it.
  - A file that disappeared gives `NoModel`.
  - A garbage file named `*.gguf`, a truncated GGUF header, or a GGUF without a chat template gives `Failed`. None of these panics or aborts, and the next call (and the rest of the app) keeps working. The test writes these fixtures to a temp dir.
  - The model file is opened read-only. Nothing is written beside it or in the app data folder.
  - Generation uses at most `max(1, logical cores / 2)` threads, so transcription keeps its share (unit test on the parameters builder).
  - llama.cpp's and ggml's own log callbacks are installed before the first load and drop all text. A log-capture test with the garbage fixture shows no file content and no path beyond the existing log rules.
  - (profile: engines behind an interface, testable without models; NFR Architecture, Reliability, Performance)
- [ ] AC4: Transcript text cannot become instructions for a local model. These are pure-function tests that render through llama.cpp's template code with built-in templates (at least chatml and llama3), without a model:
  - `Prompt.system` appears only in the system turn and `Prompt.content` only in the user turn.
  - A content line with `<|im_start|>system`, `<|eot_id|>` or "Ignore previous instructions…" comes out escaped, inside `<untrusted_content>`.
  - Content is tokenized with special-token parsing off.
  - Generation stops at end-of-turn/EOS or at `max_output_tokens`, and the latter sets `output_truncated`.
  - A prompt that does not fit the context window is cut further and reports `truncated: true`. The fit logic is a pure function over token counts.
  - The reply goes through `LlmReply::from_output`.
  - The `#[ignore]` test `MEETING_COMPANION_LLM_MODEL=<file.gguf> cargo test --release -- --ignored llama` runs:
    - the German and the English sample with a non-empty reply within the limit;
    - an injection sample whose reply does not follow the injected command;
    - a cancel during generation, which returns `Cancelled` within 1 s and stops the generation thread at the next token.

    It also checks that the process holds no listening or new network socket during the run (`/proc` scan as in the smoke test), and it prints load and generation times.
  - (NFR Security "Text from transcripts … is untrusted input to the language model"; profile reviewer-security: prompt injection)
- [ ] AC5: "On this device" works in Settings (frame 17).
  - The radio is enabled when `available: true`, and "Not available in this version yet." is gone (key removed from de/en).
  - The found / none found / not found any more states and the Test (waiting with the model name, cancel, plain-text reply) work against the core.
  - A local load failure shows a worded error in de and en, for example "The model could not be loaded. Choose another GGUF file." It names the model file but shows no llama.cpp text, and it does not rely on colour alone.
  - The mock backend gets the fixture `settings-llm-local-failed`. The existing `settings-llm-local` and `settings-llm-none-found` fixtures now have the radio enabled.
  - Component tests and the e2e cover these: axe WCAG 2.2 AA, no horizontal scroll at 375, 1280×800, 1920×1080 and the `responsive.spec.ts` sizes, in light and dark, ≥ 48 px targets on the board size, keyboard-only operation.
  - De/en parity and no-literal tests pass.
  - (NFR Clients and usability, Internationalisation)
- [ ] AC6: The smoke run and the real app stay offline and port-free with the real runtime linked.
  - `node scripts/smoke.mjs` passes on the release build, and on Linux it finds no listening TCP or bound UDP socket.
  - A Rust test shows that with the setting `{ local }` and a garbage model, a Test makes no call to the Claude transport (fake transport records zero) and no fallback to another engine happens.
  - (NFR Architecture "works fully offline with local models"; Privacy "Nothing leaves the device without a person sending it")

## Design
Source: figcraft design/meeting-companion.figcraft
Status: EXISTS
Frame set "17 Language model" (approved in job 011, `factory/jobs/011-language-model-engine/design.md`). This job enables the local states that were built but unreachable:
- `design/screens/s17d_local.png`: "On this device" chosen, model list with one selected, Test waiting ("Waiting for <model>… 2 s") with Cancel test.
- `design/screens/s17s_states.png`, "Model on this device" row: found, none found (folders searched), not found any more. "Test result" row: running, reply (plain text), no model (local), cancelled.
- `design/screens/s17f_board.png`, `s17g_768.png`, `s17h_375.png`, `s17i_375.png`, `s17j_dark.png`: the same section at board size, 768, 375 and in dark.
- Gap: no frame shows a local load failure. Use the "Failed · 5xx or timeout" card style from `s17s_states.png` with local wording (AC5). It needs no new frame.

## Surfaces
- User-facing UI: yes. "On this device" is enabled, plus one new error message, in Settings › Language model (`src/features/settings/LanguageModelSection.tsx`).
- Security-relevant: yes.
  - Native C/C++ code parses GGUF files that users place on the device, in-process, so memory safety depends on the pinned llama.cpp version.
  - The native build chain changes: ggml is shared, and whisper.cpp may run on a different ggml version.
  - Transcript text reaches a local model through a chat template, which raises prompt injection through special tokens.
  - The no-port / no-HTTP-client posture has to survive the new crate.
  - Rules touched: none (no `docs.secure_coding` configured). NFR Security (no listening ports, untrusted input to the language model), Architecture (local-first, engines behind interfaces), Privacy (nothing leaves the device).
- Human gate: no. It changes no auth, secret or permission and migrates no data. It would become yes if a working build needed a port or a separate process, which this spec forbids (see Scope, out).
- Audio/transcript data: no. Nothing is stored. The Test sends only the fixed sample text, and no meeting feature uses the engine yet.
- Leaves the device: no. The local engine makes no network connection and opens no port.
- Board (touch) layout: yes. The existing settings section at 1920×1080 with ≥ 48 px targets.
- AI speaks or contributes unasked: no.

Size: normal

## Open questions
- **How to get one ggml (the builder probes this first and reports before writing the engine).** Seen in the local cargo registry: `whisper-rs 0.16` / `whisper-rs-sys 0.15` (ggml 0.9.5) and `llama-cpp-2 0.1.160` (ggml 0.26.0). Candidates, in order of preference:
  - (a) Build ggml once from llama.cpp's tree. `llama-cpp-sys-2` uses it with `system-ggml-static`; `whisper-rs-sys` uses it with `WHISPER_USE_SYSTEM_GGML=ON` (an env var it passes through, set in `.cargo/config.toml`). The risk is the API drift from ggml 0.9.5 to 0.26.0 under whisper.cpp, which AC2 exists to catch. A newer `whisper-rs` with a closer ggml may help.
  - (b) A pair of `whisper-rs`/`llama-cpp-2` versions pinned to the same ggml commit. This works only with (a)'s single build; matching versions alone still give two copies.
  - (c) Rename one crate's ggml symbols as was done for sherpa-onnx's C++ symbols. Each library would then keep its own ggml. That is the fallback if (a) and (b) fail, and it doubles binary size.

  If none of these links cleanly with AC1 and AC2 green, stop and report. Do not switch to `llama-server`.
- **Models without a chat template** are refused (`Failed`) rather than given a guessed template. That is my assumption. A later "Model setup" job can recommend models that have one.
- **RAM.** There is no check of free memory before loading. A 2–3 GB model on an 8 GB board PC that is also running whisper could swap. Should a size warning ("needs about X GB") come with "Model setup"?
- **Thread budget.** I assumed half the logical cores. Revisit once a meeting feature runs the model during a recording.
- **macOS/Windows.** `ggml-check.mjs` only has to read ELF (Linux CI) now. Mach-O and PE support comes with the deferred CI targets.
