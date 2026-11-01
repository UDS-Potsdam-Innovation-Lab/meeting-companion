# Runs inside llama.cpp's CMake project (llama-cpp-sys-2) through CMAKE_PROJECT_llama.cpp_INCLUDE, set in
# .cargo/config.toml. llama.cpp finds the shared ggml itself (feature `system-ggml-static`, CMAKE_PREFIX_PATH);
# this only stamps the build folder with the prefix's SOURCE, so `node scripts/ggml.mjs build` can find and
# clean an output built against another ggml.
set(_mc_ggml "$ENV{MEETING_COMPANION_GGML_DIR}")
if(NOT _mc_ggml OR NOT EXISTS "${_mc_ggml}/SOURCE")
  message(FATAL_ERROR
    "The shared ggml is missing (${_mc_ggml}): run `node scripts/ggml.mjs build` once per checkout")
endif()
configure_file("${_mc_ggml}/SOURCE" "${CMAKE_BINARY_DIR}/meeting-companion-ggml.SOURCE" COPYONLY)
