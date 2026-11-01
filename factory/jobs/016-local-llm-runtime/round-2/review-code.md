VERDICT: PASS

## Findings
- [note] scripts/ggml.mjs:128-141 — `staleOutputs` skips a build folder with no `out` dir, so a failed earlier build script is not cleaned. Harmless: cargo reruns it anyway.
- [note] CI gate: the fix is only proven by the CI release build ("Compile the desktop app", then "One ggml, both engines…"). The orchestrator should gate on that run. The local reproduction on a stale target dir in build.md is convincing.

## Checked
- Commit 83cc3ac against the CI failure (cached release whisper-rs-sys built with its own ggml): the stamps from both CMake hooks (whisper-shared-ggml.cmake, llama-shared-ggml.cmake, wired in .cargo/config.toml), and `ggml.mjs` `build` and `verify`. `build` cleans per profile and triple, including when the prefix is up to date, and `verify` fails on a missing or differing stamp. The CI order (build, verify, tests, release build, ggml-check) is right and the cache key covers the new cmake file.
- The config.test.ts cases (stamped passes, own-ggml fails, earlier prefix fails) and the AGENTS.md and CI comments. I did not re-run the suites.
