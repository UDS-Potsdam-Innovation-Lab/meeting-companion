AMENDED

Stack: as PROPOSED in spec.md ## Stack, confirmed by the human (see Stack decision below).

## Spec review 1 (human, 2026-10-30)

1. Include real speaker detection in this job instead of the follow-up (a). Implement the `Diarizer` trait with a real local engine (sherpa-onnx speaker segmentation + speaker embedding, or a better-fitting local option the spec-writer finds), keep the scripted fake for tests, and keep one `#[ignore]` test with a real model.
   - Models are found on the device like the whisper models in job 003 (read-only scan, header/format check, locations listed in one place, no download in this job). If none is found, the speakers view says so and lists where it looked; the manual assignment still works.
   - Voice features stay in memory only (no change to the privacy rules).
   - Speech-model download/setup stays a separate follow-up.
2. Voice profiles stay a separate, human-gated follow-up job (GDPR Art. 9, legal check first). Not in this job.

## Stack decision (human, 2026-10-30)

CONFIRMED as proposed in spec.md: official `sherpa-onnx = "=2.0.1"` crate (speaker-embedding extractor only) with our own in-memory `VoiceClusterer`; CI fetches the prebuilt archive once, checks it against a SHA-256 committed in the repo, and builds via `SHERPA_ONNX_ARCHIVE_DIR`; a mismatch fails the build.

## Spec review 2 (human, 2026-10-30)

- Include the per-line "Who said this?" picker on transcript lines (works without a model; also fixes wrong labels). Stored as line overrides in the meeting file, as the spec proposes.
- The orchestrator will place a speaker model on the dev machine after the merge; the job itself does not download models.
