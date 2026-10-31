AMENDED
Stack: EXISTING (unchanged).

## Spec review 1 (orchestrator, applying the facilitator's 2026-10-31 decisions: "consider all legal stuff agreed", "build everything")
- Corpus: VoxPopuli (CC0), German and English — parliament speech is closer to meeting speech and needs no attribution. Fall back to Multilingual LibriSpeech / LibriSpeech (CC-BY-4.0, with attribution file) only for a gap VoxPopuli cannot fill; never Common Voice.
- All other open questions: take the spec's assumptions as decided (name round as reference text, 3 s segments, model-free default suite + #[ignore] real-model tests run in CI with the pinned CAM++ model, thresholds only for the pinned model).
- No split.
