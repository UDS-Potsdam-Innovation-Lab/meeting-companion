Local language model runtime (follow-up of 011): fill the `LocalLlmProvider` slot — whisper-rs and llama-cpp-2 each ship their own libggml under the same names, so one copy silently wins at link time; needs one shared ggml build, or llama-server on loopback (own security review, no vendored HTTP client)

Depends on: 011-language-model-engine
