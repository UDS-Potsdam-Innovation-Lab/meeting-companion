# Rework after round 1 (human, 2026-10-30)

1. Platforms: Linux only for now. macOS and Windows builds come later, once the feature set is final.
   - Reduce the CI matrix in .github/workflows/ci.yml to ubuntu-latest. Keep the workflow easy to extend
     (a matrix with a comment naming macos-latest / windows-latest for later), don't delete OS-specific code that already works.
   - AC1 is amended accordingly: CI builds, tests and smoke-tests on Linux; macOS/Windows are deferred.
   - Still fix the keyboard e2e test from round-1/ci.md (use "ControlOrMeta+A" instead of "Control+A"); it is a real cross-platform bug in the test.
   - Update AGENTS.md ## Application stack to say Linux is the only CI-tested target for now.
2. Encrypt meeting data at rest now, in this job (the approver's escalation, decided by the human):
   - Meeting files written by FileMeetingStore are encrypted with an authenticated cipher (e.g. XChaCha20-Poly1305 or AES-256-GCM, a vetted crate, no hand-rolled crypto).
   - The data key is generated on first start and stored in the OS keychain (Linux: Secret Service via the `keyring` crate); it is never written to disk in plain text or logged.
   - If the keychain is unavailable or the key is missing while encrypted files exist, the app does not crash and does not overwrite data: it shows a clear error (DE/EN by key) and keeps the files untouched.
   - Atomic write (temp + rename), the corrupt-file handling and the 4 MB limit stay as they are; a tampered file counts as unreadable, not as a crash.
   - Tests: round-trip, tampered ciphertext rejected, no plaintext participant name or title on disk, missing key handled. Use an in-memory key provider in tests; the real keychain only in the app.
   - Add a short note to build.md on the scheme (cipher, nonce handling, key storage).
