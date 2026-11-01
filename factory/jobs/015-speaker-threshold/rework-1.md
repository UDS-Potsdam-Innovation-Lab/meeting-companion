# Human decision on AC3 (2026-11-01)

Accept 7 voices for 6 speakers in de-name-round at SAME_VOICE 0.55. Relax AC3's voice-count check to "at most one extra voice" for this scene (record 7/6 as the baseline); everything else in AC3 stays strict (DER ≤ 5 %, other scenes no worse than 0.5). Re-baseline thresholds.json at 0.55 from the run's `measured:` line, set nameRoundMinSuggested to 6, finish the build: full lint + test suite, commit, update build.md. Do not commit the src-tauri/native/lib symlink.
