# ggml-check fixtures

`nm --no-demangle` listings for `scripts/ggml-check.mjs --symbols`, tested in `src/config.test.ts`.

- `clean.txt`: recorded from the job 016 release build on Linux (`src-tauri/target/release/meeting-companion`),
  kept to the `ggml_`, `gguf_`, `llama_` and `whisper_` symbols and a few of the Claude client's `ureq` symbols.
- `two-ggml.txt`: `clean.txt` plus a second `ggml_init`, as a second ggml copy would add.
- `no-whisper.txt`, `no-llama.txt`: `clean.txt` without whisper.cpp's or llama.cpp's model loader.
- `httplib.txt`, `curl.txt`, `llama-server.txt`: `clean.txt` plus one cpp-httplib, curl or llama-server symbol.
- `stripped.txt`: no symbols, as from a stripped binary.

`macos/` (job 017): `nm` listings of the Mach-O release app, read with `--format macho` (one leading underscore
is stripped from every name).

- `macos/clean.txt`: recorded on `macos-latest` (arm64) from the release build of CI run 41424742138
  (`nm src-tauri/target/release/meeting-companion`), kept to the `_ggml_`, `_gguf_`, `_llama_` and `_whisper_`
  symbols (incl. `_ggml_backend_blas_reg` of the Accelerate backend) and five of the Claude client's `ureq` symbols.
- `macos/two-ggml.txt`: `macos/clean.txt` plus a second `_ggml_init`.
- `macos/no-llama.txt`: `macos/clean.txt` without `_llama_model_load_from_file`.
- `macos/curl.txt`: `macos/clean.txt` plus an undefined `_curl_easy_init`.
