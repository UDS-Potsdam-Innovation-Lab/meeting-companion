# Language model engine: local model or Claude API behind one interface

## Problem
Several upcoming features need a language model: capture suggestions, topic detection in agenda-free mode, the summary, and later the AI participant. Today the app has no model engine. Facilitators in German organisations need two options. One is a local model that keeps everything on the device, which the NFR "Local-first" requires. The other is the Claude API, which gives better results on weak hardware, but only after a person has chosen it knowing where the text goes. This job adds the engine interface, both engines, a fake for tests, the setting that chooses between them, and a Claude API key that lives only in the OS keychain. No meeting feature uses the engine yet.

## Scope
- in:
  - Core trait `LanguageModel` in `src-tauri/src/engines/llm.rs`. A request has fixed task instructions (system) and untrusted content, kept apart, plus limits: max input characters and max output tokens. The response is text, or an error that carries no prompt or output text. `ScriptedLanguageModel` is the fake. It returns scripted replies and records every request it got.
  - Local engine: GGUF models found read-only by a new model kind `llm` in `engines/models.rs` (`<app_data>/models/` and the Hugging Face cache, the same rules as the existing scans; nothing is downloaded), run in-process by llama.cpp.
  - Claude engine `engines/claude.rs`: HTTPS to `https://api.anthropic.com/v1/messages` only, from the Rust core only. The HTTP transport sits behind a trait so tests use a fake transport.
  - `SecretStore` trait with `KeychainSecretStore` (entry service = app identifier, account `anthropic-api-key`) and `MemorySecretStore`. Commands to set, replace and delete the key. The UI only ever learns "key set: yes/no".
  - Settings: new key `languageModel` in the sealed settings file: `none` (default) | `{ local: <model id from the scan> }` | `claude`. The Claude model name comes from a closed list in the core.
  - Settings view: a new section **Language model** with the engine choice, the local model picker with "None found" / "Not found any more" states, the Claude key field, a notice naming the destination, and "Test". Mock backend fixtures, screenshots, de/en keys.
  - Deliberate update of `src/config.test.ts`: an HTTP client is allowed in `engines/claude.rs` only, and only to that one host. Every other no-network check stays.
- out:
  - Any feature that uses the engine (captures, topic detection, summary, AI participant). Each is its own job and adds its own prompts and the criteria for unasked contributions.
  - Other cloud providers, OAuth sign-in, proxies or custom endpoints.
  - Downloading or bundling local models (the "Model setup" follow-up).
  - Streaming responses and tool use.
  - Showing in the live view that text goes off the device. That belongs to the first feature that sends meeting text (see Open questions).

## Stack
Status: EXISTING

## Acceptance criteria
- [ ] AC1: One interface, swappable engines, nothing chosen by default. `LanguageModel` has three implementations: local, Claude and `ScriptedLanguageModel`. A factory builds the engine from the `languageModel` setting. Rust tests:
  - The default setting `none` builds no engine. A call returns `NotConfigured` without touching the network, the keychain or a model file.
  - A local id that is not in the core's current `llm` scan is rejected when set. A chosen model that has disappeared since gives `NoModel` and the settings view shows "Not found any more" (component test).
  - The core never falls back to another engine on its own: local → Claude or Claude → local only happens when a person changes the setting.
  - The env flag `MEETING_COMPANION_LLM=fake` selects the scripted engine for smoke runs and the e2e build.

  No engine-specific type reaches `src/` (the UI sees only the setting and status values). The real local model test is `#[ignore]` and uses `MEETING_COMPANION_LLM_MODEL`. (NFR Architecture: engines behind interfaces, local-first; profile: fake engine, testable without models or network)
- [ ] AC2: The API key lives only in the OS keychain. `SecretStore` tests with `MemorySecretStore`:
  - After `setApiKey`, a marker key is not found in the settings file, the app data folder, `localStorage`, any IPC response or event, any log line or any error string (marker and log-capture tests, Rust and component).
  - `getApiKeyStatus` returns only `{ set: boolean }`.
  - Deleting the key removes the keychain entry. After that a Claude call fails with `NoApiKey` before any request is built (the fake transport records no call).
  - Input is checked: trimmed, 1–512 printable ASCII characters, otherwise `InvalidKey` naming no value.
  - A locked or missing keychain gives `KeychainUnavailable`, and the app keeps running.

  The key field is `type="password"` with `autocomplete="off"` and is cleared after saving. The one real keychain test is `#[ignore]`. (NFR Privacy "Secrets go into the OS keychain, never into files or logs")
- [ ] AC3: Nothing leaves the device unless a person has chosen Claude, and then only to Anthropic. Choosing "Claude API (cloud)" first shows a non-modal confirmation in the section that names the destination: "Anthropic, api.anthropic.com, USA", and what will be sent: "text from your meetings, when a feature asks for it". The setting changes only after the person confirms; cancelling leaves it unchanged (component test). Rust tests with the fake transport:
  - Requests go only to `https://api.anthropic.com/v1/messages` over TLS. The key is sent only in the `x-api-key` header.
  - No request is made while the setting is `none` or local.
  - `config.test.ts` passes after the deliberate update: the one HTTP client crate (rustls, no native-tls, no proxy auto-detection) is referenced only from `engines/claude.rs` and only with that host constant. There is still no listening socket (`TcpListener`/`UdpSocket`), no Tauri HTTP/shell plugin, and the CSP `connect-src` is still IPC only.
  - Timeouts (connect 10 s, total 60 s), and offline, 401, 429 and 5xx responses map to `Offline`, `Unauthorized`, `RateLimited` and `Failed`. None of them retries in a loop or carries response body text.

  (NFR Privacy "Nothing leaves the device without a person sending it; every export names its destination"; Architecture "Cloud services are opt-in per setting"; AGENTS.md "No network access without a setting that names where data goes")
- [ ] AC4: Transcript text is treated as untrusted input. Both engines put caller content only into the content part of the request, never into the system/instruction part. The content is wrapped in a delimiter that is escaped if it occurs in the content. Rust tests with `ScriptedLanguageModel` and the fake transport:
  - A transcript line that contains "Ignore previous instructions…" and a fake closing delimiter appears only inside the escaped content block.
  - Input over the limit is cut at the limit and the result reports `truncated: true`.
  - Output over the limit is cut.
  - Output is returned as plain text, never interpreted. The test reply in the UI is rendered as text (`react/no-danger` holds; a component test with markup in the reply shows it literally).
  - Prompt and reply text never appear in logs or errors (log-capture test).

  (NFR Security "Text from transcripts … is untrusted input to the language model"; profile reviewer-security: prompt injection)
- [ ] AC5: Language model section in Settings. A new section **Language model** (de "Sprachmodell") has these parts:
  - The choice "Off" (default) / "On this device" / "Claude API (cloud)".
  - For "On this device": the found GGUF models with name, size and folder, or "No language model found on this device" with the folders searched.
  - For Claude: the key field with "Key saved" / "No key", "Remove key", and the destination line, which stays visible while Claude is chosen.
  - "Test", which sends a fixed sample text (no meeting data) through the chosen engine and shows the reply or the error reason in text, not colour alone.

  Every change goes through the settings store and `settings-changed`, with no "Save" button. Fixtures `settings-llm-off|settings-llm-local|settings-llm-none-found|settings-llm-claude|settings-llm-claude-nokey|settings-llm-error` exist in the mock backend. Playwright + axe report no WCAG 2.2 AA violations and no horizontal scroll at 1280×800, 1920×1080, 375 px and the sizes in `e2e/responsive.spec.ts`, in light and dark. Touch targets are ≥ 48 px on the board size. Keyboard-only operation works (e2e). All strings come from de/en keys, and the parity and no-literal tests pass. (NFR Clients and usability, Internationalisation)
- [ ] AC6: The engine does not block the app and is not used during this job's meetings. Calls run off the UI thread and can be cancelled. A test with a slow fake shows that the settings view and the recording state stay responsive, and that cancelling returns `Cancelled` within 1 s. No code path calls the engine during a meeting or recording in this job (Rust test: a recording with the scripted engine configured records zero requests). The AI does not speak or contribute. (NFR Performance; vision principle 2 "Quiet by default")

## Design
Source: figcraft design/meeting-companion.figcraft
Status: NEEDED
No frame covers a language model section. The settings frames (14, 14b–14p) show only Audio, On this device and General. Before building, a FigCraft frame set (built by `design/build/s17_llm.py`, exported to `design/screens/`) has to answer these questions:
- Where the section goes in the settings view (its own section between "On this device" and "General", or inside "On this device" for the local part), and how the three-way choice looks (segmented control or radio list).
- The cloud confirmation, inline and non-modal: wording, the destination line "Anthropic, api.anthropic.com, USA", and Confirm/Cancel.
- The Claude key field states: no key, entering, saved ("Key saved", never the key), remove, invalid, keychain unavailable.
- The local model list: found, none found (folders searched), not found any more.
- The Test result: running, reply shown as plain text, and the errors offline / unauthorized / rate-limited / failed / no model.
- Dark theme, 375 px, 768 px and the board size (1920×1080, 48 px targets).
- Whether a persistent "Cloud: Anthropic" marker next to the existing "On-device · DE/EN" chip is needed now, or only once a feature sends meeting text. Recommendation: draw it now and ship it with the first feature that sends meeting text.

## Surfaces
- User-facing UI: yes — new Language model section in the settings view (`src/features/settings/`)
- Security-relevant: yes — secret handling (API key in the OS keychain), the first outbound network connection in the app (HTTPS to api.anthropic.com), untrusted transcript text as model input (prompt injection), key input validation; rules touched: none (no `docs.secure_coding` configured); NFR Privacy (secrets, nothing leaves without a person), Security (untrusted input), Architecture (cloud opt-in)
- Human gate: yes — adds a secret to the keychain and a network path off the device; it deliberately loosens the existing no-network checks in `src/config.test.ts`
- Audio/transcript data: no in this job — no audio or transcript is stored or sent; the engine is only exercised with a fixed sample text. Once later features use it, transcript text is sent per request and not stored by the app
- Leaves the device: yes — only when a person chooses "Claude API (cloud)": the "Test" sample text and the API key go to api.anthropic.com (Anthropic, USA); never with "Off" or "On this device"
- Board (touch) layout: yes — the settings section at 1920×1080 with ≥ 48 px targets
- AI speaks or contributes unasked: no

Size: normal

## Open questions
- **Linking llama.cpp next to whisper.cpp.** Both `whisper-rs-sys` and `llama-cpp-sys-2` build their own copy of `ggml`. Linked statically into one binary, they are likely to clash on duplicate symbols (the same risk sherpa-onnx had, solved by renaming symbols). The builder should check this first. If it does not link cleanly, I would split the job:
  - (a) This job: the interface, the fake, the Claude engine, the keychain and the settings section, with "On this device" listed as "coming" or left out.
  - (b) A follow-up "Local language model": either a shared ggml (one `ggml` build used by both crates) or llama.cpp's `llama-server` as a separate process on loopback. The second needs its own security review, because it is a listening port, which the NFR allows only for the phone web view.
- **HTTP client crate.** I assumed `ureq` 3 with `rustls` (blocking, small, no tokio runtime of its own). `reqwest` with rustls would also do. The human gate should confirm the crate and the relaxed `config.test.ts` rule.
- **Claude model list.** I assumed a closed list in the core (for example the current Sonnet and Haiku ids), with the newest Sonnet as the default, and no free-text model field. Who updates it when models change: a code change per release?
- **Data protection.** Sending meeting transcripts to Anthropic (USA) needs a legal basis and probably a data processing agreement on the customer's side. Anthropic's API retention also matters (by default no training on API data; logs kept for a limited time). This job only enables the path and sends a fixed test text. The first feature that sends meeting text should have its own human gate and a visible "Cloud" marker in the live view. The profile's approver should also escalate it.
- **Enterprise deployment.** German public-sector and school customers may need to disable the cloud option centrally (a policy file or build flag). This is not in scope; it should be added to the backlog if needed.
