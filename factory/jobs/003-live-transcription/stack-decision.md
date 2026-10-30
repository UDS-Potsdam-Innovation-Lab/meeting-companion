AMENDED

Stack as in spec.md (EXISTING; adds cpal and whisper-rs).

## Spec review 1 (human, 2026-10-30)

Detect speech models that are already on the device instead of only looking in `<app_data>/models/`.

- Scan known locations of whisper.cpp (ggml) models read-only: the app's own `<app_data>/models/`, Voxtype (`~/.local/share/voxtype/models/`), whisper.cpp / pywhispercpp default model folders, the Hugging Face cache (`~/.cache/huggingface/hub`, ggml files only), plus the per-OS equivalents on macOS and Windows. Keep the list of locations in one place in the Rust core.
- A file counts as a model only if its header is a valid ggml/gguf whisper model; ignore anything else. Never copy, move or modify found files; reference them by path. Don't follow symlinks out of the scanned folder.
- Show the found models in the live view's engine area (name, size, where it was found, language: multilingual or English-only). Prefer a multilingual model by default, since meetings are German or English; the facilitator can pick another. Remember the choice locally.
- No model found → keep the "No speech model installed" state, and say where the app looks.
- Tests: scanning works on temp folders with fake model headers; no real model needed in CI.
