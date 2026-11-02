AMENDED

## Spec review 1 (human, 2026-11-02)

The repo is public now (AGPL-3.0-only), so CI minutes are free on macOS too. Replace AC5's separate `ci-macos.yml` with limited triggers: add `macos-latest` (arm64) to the matrix of the existing `.github/workflows/ci.yml`, running on every push and PR like Linux, so the factory's CI gate (`ci_workflow: ci.yml`) waits for macOS as well. Update the "Linux only for now" comment in ci.yml. The speaker-accuracy step may stay Linux-only if it is too slow on macOS; say so in the spec. Jan's request of 2026-11-02 supersedes the "Linux only until the feature set is final" decision of 2026-10-30; the orchestrator updates the comment in factory/profile.md.
