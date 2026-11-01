# Runs inside whisper.cpp's CMake project (whisper-rs-sys) through CMAKE_PROJECT_whisper.cpp_INCLUDE,
# set in .cargo/config.toml.
#
# whisper.cpp compiles against the shared ggml (WHISPER_USE_SYSTEM_GGML=ON finds it through
# CMAKE_PREFIX_PATH) and builds no ggml of its own. whisper-rs-sys's build script still asks rustc for
# `static=ggml`, `static=ggml-base` and `static=ggml-cpu`, and only searches its own build folder. This
# copies the shared archives, unchanged, into that folder, so rustc finds the very same files that
# llama-cpp-sys-2 links, and stamps the build folder with the prefix's SOURCE, so
# `node scripts/ggml.mjs build` can find and clean an output built against another ggml.
# `node scripts/ggml-check.mjs` checks the result in the built app.
set(_mc_ggml "$ENV{MEETING_COMPANION_GGML_DIR}")
if(NOT _mc_ggml OR NOT EXISTS "${_mc_ggml}/SOURCE")
  message(FATAL_ERROR
    "The shared ggml is missing (${_mc_ggml}): run `node scripts/ggml.mjs build` once per checkout")
endif()
if(WIN32)
  set(_mc_names ggml.lib ggml-base.lib ggml-cpu.lib)
else()
  set(_mc_names libggml.a libggml-base.a libggml-cpu.a)
endif()
set(_mc_files "")
foreach(_mc_name IN LISTS _mc_names)
  if(NOT EXISTS "${_mc_ggml}/lib/${_mc_name}")
    message(FATAL_ERROR "${_mc_ggml}/lib/${_mc_name} is missing: run `node scripts/ggml.mjs build`")
  endif()
  list(APPEND _mc_files "${_mc_ggml}/lib/${_mc_name}")
endforeach()
file(COPY ${_mc_files} DESTINATION "${CMAKE_BINARY_DIR}/shared-ggml")
configure_file("${_mc_ggml}/SOURCE" "${CMAKE_BINARY_DIR}/meeting-companion-ggml.SOURCE" COPYONLY)
