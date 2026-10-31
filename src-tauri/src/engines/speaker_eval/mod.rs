//! Speaker-recognition accuracy tests. Test-only (`#[cfg(test)]`): nothing here, and nothing of the
//! corpus under `src-tauri/testdata/speakers/`, is part of the app.
//!
//! - [`corpus`]: the licence-clean single-speaker clips and their manifest, verified.
//! - [`scene`]: test meetings mixed from the clips in memory, deterministically, with reference turns.
//! - [`measures`]: DER (missed speech, false alarm, speaker confusion), optimal voice mapping and line
//!   accuracy.
//! - [`run`]: a scene through the transcript windowing, a diarizer and the real `VoiceTracker`; the
//!   oracle and degraded fakes; the regression thresholds.
//! - [`real`]: the `#[ignore]` run with a real model (`--ignored speaker_accuracy`).
//!
//! Audio stays in memory; the workflow scenario writes its sealed meeting and transcript files to a
//! temp folder that is removed. Nothing is downloaded.

mod corpus;
mod measures;
mod scene;
mod sha256;
mod wav;
