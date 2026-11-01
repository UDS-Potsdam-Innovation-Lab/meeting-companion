CI: failure

https://github.com/UDS-Potsdam-Innovation-Lab/meeting-companion/actions/runs/41334135604

## Failed: ubuntu-latest / Compile the desktop app

```
      1           rust-lld: error: too many errors emitted, stopping now (use --error-limit=0 to see all errors)
      1           rust-lld: error: duplicate symbol: ggml_backend_buft_is_host
      1           rust-lld: error: duplicate symbol: ggml_backend_buft_get_max_size
      1           rust-lld: error: duplicate symbol: ggml_backend_buft_get_device
      1           rust-lld: error: duplicate symbol: ggml_backend_buft_get_alignment
      1           rust-lld: error: duplicate symbol: ggml_backend_buft_alloc_buffer
      1           rust-lld: error: duplicate symbol: ggml_backend_buffer_reset
      1           rust-lld: error: duplicate symbol: ggml_backend_buffer_name
      1           rust-lld: error: duplicate symbol: ggml_backend_buffer_is_host
      1           rust-lld: error: duplicate symbol: ggml_backend_buffer_init_tensor
      1           rust-lld: error: duplicate symbol: ggml_backend_buffer_init
      1           rust-lld: error: duplicate symbol: ggml_backend_buffer_get_usage
      1           rust-lld: error: duplicate symbol: ggml_backend_buffer_get_type
      1           rust-lld: error: duplicate symbol: ggml_backend_buffer_get_size
      1           rust-lld: error: duplicate symbol: ggml_backend_buffer_get_max_size

          >>> defined at ggml-backend.cpp
          >>>            ggml-backend.cpp.o:(ggml_backend_buffer_is_host) in archive /home/runner/work/meeting-companion/meeting-companion/src-tauri/target/release/deps/libwhisper_rs_sys-54e61e0791c2d4cc.rlib
          >>> defined at ggml-backend.cpp
          >>>            ggml-backend.cpp.o:(.text+0xa90) in archive /home/runner/work/meeting-companion/meeting-companion/src-tauri/target/release/deps/libllama_cpp_sys_2-bd140cc7f5dda819.rlib
          
          rust-lld: error: duplicate symbol: ggml_backend_buffer_reset
          >>> defined at ggml-backend.cpp
          >>>            ggml-backend.cpp.o:(ggml_backend_buffer_reset) in archive /home/runner/work/meeting-companion/meeting-companion/src-tauri/target/release/deps/libwhisper_rs_sys-54e61e0791c2d4cc.rlib
          >>> defined at ggml-backend.cpp
          >>>            ggml-backend.cpp.o:(.text+0xb40) in archive /home/runner/work/meeting-companion/meeting-companion/src-tauri/target/release/deps/libllama_cpp_sys_2-bd140cc7f5dda819.rlib
          
          rust-lld: error: duplicate symbol: ggml_backend_buffer_copy_tensor
          >>> defined at ggml-backend.cpp
          >>>            ggml-backend.cpp.o:(ggml_backend_buffer_copy_tensor) in archive /home/runner/work/meeting-companion/meeting-companion/src-tauri/target/release/deps/libwhisper_rs_sys-54e61e0791c2d4cc.rlib
          >>> defined at ggml-backend.cpp
          >>>            ggml-backend.cpp.o:(.text+0xb80) in archive /home/runner/work/meeting-companion/meeting-companion/src-tauri/target/release/deps/libllama_cpp_sys_2-bd140cc7f5dda819.rlib
          
          rust-lld: error: too many errors emitted, stopping now (use --error-limit=0 to see all errors)
          collect2: error: ld returned 1 exit status
          

error: could not compile `meeting-companion` (lib) due to 1 previous error
failed to build app: failed to build app
       Error failed to build app: failed to build app
##[error]Process completed with exit code 1.
```
