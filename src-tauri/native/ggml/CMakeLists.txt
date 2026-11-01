# The one ggml of the app (job 016): built once by `node scripts/ggml.mjs build` from the ggml tree that
# llama-cpp-sys-2 vendors (GGML_SOURCE_DIR), and used by both llama.cpp (llama-cpp-sys-2, feature
# `system-ggml-static`) and whisper.cpp (whisper-rs-sys, WHISPER_USE_SYSTEM_GGML). See AGENTS.md.
#
# ggml is added as a subproject, so its install rules run without the standalone-only pkg-config
# template (the crate does not ship ggml.pc.in).
cmake_minimum_required(VERSION 3.14)
project(meeting_companion_ggml C CXX ASM)

if(NOT GGML_SOURCE_DIR)
  message(FATAL_ERROR "GGML_SOURCE_DIR is not set: run node scripts/ggml.mjs build")
endif()

add_subdirectory(${GGML_SOURCE_DIR} ggml)
