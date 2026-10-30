CONFIRMED

Confirmed by the human on 2026-10-30. Final stack = spec.md ## Stack as proposed:

Status: PROPOSED
- Language + version: Rust stable 1.85+ pinned in `rust-toolchain.toml` for the core, and TypeScript 5.x for the UI. Node 22 LTS, npm.
- Framework: Tauri 2.x (desktop shell, system web view; Android target available for the board PC if it turns out to run Android). React 19 + Vite 6 for the UI.
- Test runner: Vitest + @testing-library/react + jsdom for UI logic and components, with Tauri IPC mocked via `@tauri-apps/api/mocks`. `cargo test` for the Rust core (store, validation). Playwright (Chromium) + @axe-core/playwright for keyboard, accessibility and layout checks against the Vite build with the mocked IPC.
- Exact test command: `npm test` (runs `vitest run && cargo test --manifest-path src-tauri/Cargo.toml && playwright test`).
- Lint/format command: `npm run lint` (runs `eslint . && prettier --check . && cargo fmt --manifest-path src-tauri/Cargo.toml --check && cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`). Use `tsc --noEmit` as part of `npm run lint`.
- Build command: `npm run tauri build -- --no-bundle` in CI (a compile check; installers come later).
- Screenshot command: `npm run screenshot`. It runs Playwright against the Vite build with fixture data and writes `screenshots/<view>-<width>.png` at 375, 1280 and 1920 px wide.
- Layout:
  - `src/` — React UI: `src/i18n/de.json`, `src/i18n/en.json`, `src/features/agenda/`, `src/lib/ipc.ts`; the only place that calls Tauri.
  - `src-tauri/` — Rust core: `src/store/` with the `MeetingStore` trait, `FileMeetingStore` and `MemoryMeetingStore`; `src/model/` with the meeting and validation code; Tauri commands.
  - `e2e/` — Playwright specs.
  - `.github/workflows/ci.yml`.
  - Engines for later jobs go in `src-tauri/src/engines/` behind traits.
- Why: whisper.cpp/whisper-rs and diarization run natively in Rust (as in Meetily). A web UI can be reused for the phone web view and the Teams meeting app. Tauri's binaries are small enough for the board PC.
- Rejected:
  - Electron: about 150 MB runtime, native addons for whisper.cpp per OS, no Android path.
  - Flutter: good on desktop and Android, but the phone web view and Teams app would need a second UI, and whisper needs FFI.
  - Avalonia/.NET: no reuse for the web or Teams surfaces, and a smaller speech ecosystem.
  - Qt/C++: licensing and a slower UI iteration loop.
  - Svelte instead of React: lighter, but React has the larger pool of Teams/Fluent components for frames 10–12.

