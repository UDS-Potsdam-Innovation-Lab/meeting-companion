Bug: ending a meeting does not work. Clicking "End meeting" arms it ("Click again to end"), but clicking the confirm button does nothing visible — the meeting does not end and the button gives no response.

Reported by the facilitator on main after 004 (speaker detection) merged, with recording running.

Observations from the code (for the builder to verify, not a fix):
- `LiveView.onEnd` (src/features/live/LiveView.tsx) awaits `recording.stop()` and only then ends the run; if the promise is slow or rejects, nothing happens and the UI gives no feedback.
- The core `Recorder::stop` → `halt` (src-tauri/src/recording/mod.rs) joins the transcript worker, which may first finish whisper and the diarizer on queued audio, or hang if the engine panicked (known non-blocking note from 005/004).
- The armed state also disarms itself after 6 s, so a slow stop can look like the click was lost.

Expected: the second click ends the meeting at once from the user's point of view (immediate feedback, meeting ends even if stopping capture is slow or fails); the transcript recorded so far is kept; no hang if the engine or diarizer is stuck. Add a regression test.
