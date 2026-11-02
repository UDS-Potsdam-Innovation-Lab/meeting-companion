VERDICT: PASS
## Findings
- [note] scripts/sockets.mjs scanLsof treats any lsof non-zero exit as a failed scan (fails closed, so it is safe; CI shows 22 good scans on macOS).
- [note] Level-rate tests skip on coarse-timer Macs (level_tests.rs); documented in build.md, acceptable.

## Checked
- ggml.mjs/cmake hook archive lists, Metal off, deployment target; ggml-check Mach-O; sockets/smoke; plist embed and check.
- ci.yml matrix and macOS steps without Linux-only guards; config.test.ts coverage per AC1-AC6; build.md reports both runners green.
