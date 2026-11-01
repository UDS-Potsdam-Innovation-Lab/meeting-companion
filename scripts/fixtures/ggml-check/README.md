# ggml-check fixtures

`nm --no-demangle` listings for `scripts/ggml-check.mjs --symbols`, tested in `src/config.test.ts`.

- `clean.txt`: recorded from the job 016 release build on Linux (`src-tauri/target/release/meeting-companion`),
  kept to the `ggml_`, `gguf_`, `llama_` and `whisper_` symbols and a few of the Claude client's `ureq` symbols.
- `two-ggml.txt`: `clean.txt` plus a second `ggml_init`, as a second ggml copy would add.
- `no-whisper.txt`, `no-llama.txt`: `clean.txt` without whisper.cpp's or llama.cpp's model loader.
- `httplib.txt`, `curl.txt`, `llama-server.txt`: `clean.txt` plus one cpp-httplib, curl or llama-server symbol.
- `stripped.txt`: no symbols, as from a stripped binary.
