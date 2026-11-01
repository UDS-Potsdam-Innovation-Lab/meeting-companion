CI: failure

https://github.com/UDS-Potsdam-Innovation-Lab/meeting-companion/actions/runs/41337761300

## Steps
- Set up job: success
- Free disk space (Linux): success
- Run actions/checkout@v4: success
- Run actions/setup-node@v4: success
- Install Rust (version from rust-toolchain.toml): success
- Run Swatinem/rust-cache@v2: success
- Install Linux system libraries: success
- Install npm dependencies: success
- Cache the sherpa-onnx archive: success
- Fetch and verify the sherpa-onnx libraries (pinned SHA-256): success
- Cache the shared ggml: success
- Build the shared ggml (whisper.cpp and llama.cpp link this one copy): success
- A corrupted sherpa-onnx archive fails the check: success
- Cache the speaker model: success
- Fetch and verify the speaker model (pinned SHA-256): success
- A corrupted speaker model fails the check: success
- Install Playwright Chromium: success
- Lint: success
- Test: failure
- Speaker accuracy (real model, regression thresholds): skipped
- The corpus marker check finds the marker in the test build: skipped
- Compile the desktop app: skipped
- One ggml, both engines and no HTTP client in the release app: skipped
- The release app holds no speaker corpus: skipped
- Smoke test the built app (Linux, virtual display): skipped
- Smoke test the built app: skipped
- Free disk space before the cache is saved: success
- Post Cache the speaker model: skipped
- Post Cache the shared ggml: skipped
- Post Cache the sherpa-onnx archive: skipped
- Post Run Swatinem/rust-cache@v2: skipped
- Post Run actions/setup-node@v4: skipped
- Post Run actions/checkout@v4: success
- Complete job: success

## Failed: Test (vitest, src/config.test.ts:588 and :600, the three new round-2 tests)
```
ubuntu-latest	Test	
ubuntu-latest	Test	+ ggml: /home/runner/work/meeting-companion/meeting-companion/src-tauri/native/ggml/prefix does not hold ggml 0.26.0 from llama-cpp-sys-2 0.1.160: run node scripts/ggml.mjs build
ubuntu-latest	Test	+
ubuntu-latest	Test	
ubuntu-latest	Test	 ❯ src/config.test.ts:588:22
ubuntu-latest	Test	
ubuntu-latest	Test	
##[error]AssertionError: expected 'ggml: /home/runner/work/meeting-compa…' to match /not built against .*prefix/
ubuntu-latest	Test	
ubuntu-latest	Test	- Expected:
ubuntu-latest	Test	/not built against .*prefix/
ubuntu-latest	Test	
ubuntu-latest	Test	+ Received:
ubuntu-latest	Test	"ggml: /home/runner/work/meeting-companion/meeting-companion/src-tauri/native/ggml/prefix does not hold ggml 0.26.0 from llama-cpp-sys-2 0.1.160: run node scripts/ggml.mjs build
ubuntu-latest	Test	"
ubuntu-latest	Test	
ubuntu-latest	Test	 ❯ src/config.test.ts:600:22
ubuntu-latest	Test	
ubuntu-latest	Test	
##[error]AssertionError: expected 'ggml: /home/runner/work/meeting-compa…' to match /not built against .*prefix/
ubuntu-latest	Test	
ubuntu-latest	Test	- Expected:
ubuntu-latest	Test	/not built against .*prefix/
ubuntu-latest	Test	
ubuntu-latest	Test	+ Received:
ubuntu-latest	Test	"ggml: /home/runner/work/meeting-companion/meeting-companion/src-tauri/native/ggml/prefix does not hold ggml 0.26.0 from llama-cpp-sys-2 0.1.160: run node scripts/ggml.mjs build
ubuntu-latest	Test	"
ubuntu-latest	Test	
ubuntu-latest	Test	 ❯ src/config.test.ts:600:22
ubuntu-latest	Test	
ubuntu-latest	Test	
##[error]Process completed with exit code 1.
```
