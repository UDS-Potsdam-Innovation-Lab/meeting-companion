# Meeting Companion

A local AI meeting companion for laptops and touch smart boards: agenda and timekeeping, on-device
transcription, decisions and to-dos, a live mind map, a team review of the notes, and export to the
apps the team already uses.

- What it does: [docs/vision.md](docs/vision.md)
- Prototype: `design/meeting-companion.figcraft` (open in FigCraft), screens in `design/screens/`
- How it is built: the [software factory](https://github.com/janrenz/factory), see `factory/`

## Set up on macOS

Apple Silicon (arm64) with macOS 13.3 or newer, the platform CI builds on (`macos-latest`). Intel Macs have a mapping for the
sherpa-onnx `osx-x64` archive but are not built or tested. Run from the repository root:

1. Xcode command line tools (C/C++ compiler, `nm`): `xcode-select --install`
2. CMake from Homebrew (builds whisper.cpp, llama.cpp and ggml): `brew install cmake`
3. Rust through rustup (<https://rustup.rs>); the version comes from `rust-toolchain.toml` and is
   installed on the first `cargo` call.
4. Node 22, the version in `.nvmrc` (e.g. `nvm install` or `brew install node@22`).
5. `npm ci`
6. `node scripts/sherpa-onnx.mjs fetch` (the pinned, checksum-verified speaker-detection libraries)
7. `node scripts/ggml.mjs build` (the one ggml of whisper.cpp and llama.cpp, CPU with Accelerate, no
   Metal; again after a change of the llama-cpp-sys-2 version)
8. `npx playwright install chromium` (for the browser tests)
9. `npm run tauri dev` starts the app.
10. `npm test` runs the unit, Rust and browser tests; `npm run lint` the linters.
11. `npm run tauri build -- --no-bundle` builds `src-tauri/target/release/meeting-companion` (no `.app`;
    signing and installers are not set up yet).

The microphone: in `npm run tauri dev` the app runs as a child of your terminal, so macOS asks for the
microphone on behalf of the terminal app (Terminal, iTerm, …) and lists it there under System Settings →
Privacy & Security → Microphone. Grant it there. To be asked again, reset it with
`tccutil reset Microphone <bundle id of the terminal>` (e.g. `com.apple.Terminal`, `com.googlecode.iterm2`).
The prompt text is the German `NSMicrophoneUsageDescription` of `src-tauri/Info.plist`, embedded in the binary.

## Licence

AGPL-3.0-only, see [LICENSE](LICENSE).
