CI: failure
https://github.com/UDS-Potsdam-Innovation-Lab/meeting-companion/actions/runs/41186499306
All build/test steps passed (lint, test, compile, smoke). Only "Post Run Swatinem/rust-cache@v2" failed: "No space left on device" while saving the cargo cache (infrastructure: runner disk full after the whisper + sherpa-onnx builds).

Also: main moved — 006-settings-panel is merged and conflicts with this branch (both edit src-tauri/src/recording/mod.rs and related files).
