AMENDED

Stack: EXISTING, plus a real local diarizer (see below).

## Spec review 1 (human, 2026-10-30)

1. Include real speaker detection in this job instead of the follow-up (a). Implement the `Diarizer` trait with a real local engine (sherpa-onnx speaker segmentation + speaker embedding, or a better-fitting local option the spec-writer finds), keep the scripted fake for tests, and keep one `#[ignore]` test with a real model.
   - Models are found on the device like the whisper models in job 003 (read-only scan, header/format check, locations listed in one place, no download in this job). If none is found, the speakers view says so and lists where it looked; the manual assignment still works.
   - Voice features stay in memory only (no change to the privacy rules).
   - Speech-model download/setup stays a separate follow-up.
2. Voice profiles stay a separate, human-gated follow-up job (GDPR Art. 9, legal check first). Not in this job.
