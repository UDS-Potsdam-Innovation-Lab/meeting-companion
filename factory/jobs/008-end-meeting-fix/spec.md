# Ending a meeting does nothing after confirming

## Problem
The facilitator clicks "End meeting", then "Click again to end", and nothing happens while recording
runs. `LiveView.onEnd` waits for `stop_recording` before it ends the run. In the core, `Recorder::stop`
→ `halt` holds the recorder lock while it joins the transcript worker. That worker may first transcribe
the queued audio, wait up to `VOICE_WAIT` (5 s) for voices, and join the diarizer thread. It never
returns if an engine hangs. The armed button disarms itself after `CONFIRM_MS` (6 s), so a slow stop
looks like a lost click. Also, `save_meeting` is a sync command, so it runs on the main thread, and it
calls `stop_meeting` on an ended run. Once the UI stops waiting, that call would freeze the window on
the same lock. Ending a meeting must work at once and must never hang, and the transcript so far must
be kept.

## Scope
- in: `LiveView.onEnd` / `EndMeeting` (end without waiting for capture to stop, no double end);
  `Recorder::stop`/`halt` and `Delivery::finish`/`close` in `src-tauri/src/recording/mod.rs` (bounded
  stop that never waits on a stuck worker); `save_meeting` / `stop_meeting` in `src-tauri/src/lib.rs`
  (no unbounded wait for a recorder stop on the main thread); test fakes for an engine that blocks or
  panics; regression tests.
- out: wrap-up screen (frame 04); changes to what is recorded or stored; speeding up whisper or
  the diarizer; pause behaviour (it may reuse the bounded halt but is not changed on purpose).

## Stack
Status: EXISTING

## Acceptance criteria
- [ ] AC1: In the live view with recording running, the second click on "Click again to end" saves the
  run with `endedAt` and opens agenda setup with a new meeting, without waiting for `stop_recording`.
  Vitest: the mocked `stop_recording` never resolves; the ended meeting and the new meeting are both
  saved, and setup is shown.
- [ ] AC2: Ending happens exactly once. After the confirm click, the end button cannot trigger a second
  end, and the 6 s auto-disarm does not bring back "End meeting" in the live view. If `stop_recording`
  rejects or resolves late, the user sees no error and gets no unhandled promise rejection, and the new
  meeting shows recording as off. Vitest with fake timers: confirm, advance 10 s, then resolve or
  reject the stop. `core.saved` has exactly 2 entries, and the UI stays in setup.
- [ ] AC3: `Recorder::stop` returns within 2 s and leaves the state `off` in each of these cases: the
  speech-to-text engine blocks forever on queued audio, the diarizer blocks forever in `voice_for`,
  and the transcript worker panicked. The audio source is closed before `stop` returns (NFR Privacy:
  the recording indicator matches reality). Cargo tests with blocking and panicking fakes behind
  `SpeechToText` / `Diarizer`. No models, microphone or network.
- [ ] AC4: Everything already recorded is kept. Every final segment sent to the UI before `stop` (with
  `seq`) is in the meeting's encrypted `.transcript` once `stop` returns, in order. A segment whose
  voice is not known yet is stored without one. Once `stop` has returned, a worker still stuck in an
  engine appends nothing more to that meeting's transcript and sends no more segment or voice events
  for it. Cargo test with the in-memory transcript store and a blocking diarizer.
- [ ] AC5: A stuck stop blocks nothing else. While a previous meeting's worker hangs, `save_meeting`
  for the ended run returns within 2 s, and `recording_status` answers. Recording can then start for
  the new meeting with a fresh engine. Cargo tests at the `Recorder` level and on the command functions
  (no Tauri runtime).
- [ ] AC6: Regression for the reported case (NFR Maintainability, Reliability). A Playwright e2e on the
  `live-transcript` fixture: with the mock backend's `stop_recording` delayed past `CONFIRM_MS`, End
  meeting + confirm shows agenda setup within 1 s. The existing AC6 test in `LiveView.test.tsx` still
  passes.

## Design
Source: figcraft design/meeting-companion.figcraft (frame 02 "Live meeting", `design/screens/s2_live.png`)
Status: NOT NEEDED
No new screens or states. The existing inline confirm on frame 02 stays as it is, and the result is the
existing switch to agenda setup (wrap-up frame 04 does not exist yet). No new user-facing strings.

## Surfaces
- User-facing UI: yes. Live view footer, "End meeting" (`src/features/live/EndMeeting.tsx`,
  `LiveView.tsx`). Behaviour only, no layout change.
- Security-relevant: no new input, auth, secrets or network. Rules touched: none (there is no
  `docs.secure_coding`). NFR Privacy: the microphone must be closed when the meeting ends.
- Human gate: yes. Nothing new is recorded, stored or sent, but this changes when the recorder stops,
  when the microphone closes, and which transcript segments are stored at the end of a meeting. The
  profile's rule for features that store transcripts and the approver's escalation rule both apply.
- Audio/transcript data: yes. No change to what is stored or where. Final transcript segments stay in
  the encrypted `<app_data>/meetings/<id>.transcript` until deleted. Audio is still never written, and
  clips held by a stuck worker are dropped and never stored. A segment the stuck engine never finishes
  is lost (it was never final).
- Leaves the device: no.
- Board (touch) layout: no. No layout change; the confirm button keeps its touch target.
- AI speaks or contributes unasked: no.

Size: normal

## Open questions
- Assumed the core does not wait longer than 2 s at stop. Final segments still waiting for a voice are
  stored without one at that point; they do not get the full `VOICE_WAIT`. Speaker labels for the last
  few seconds of a meeting may therefore be missing. If keeping them matters more, the builder can
  finish the voices in the background, but only if AC4 (no writes after `stop` returns) is changed to
  allow it.
- Assumed a stuck worker thread may be detached and leaked rather than joined. Its engine is then not
  reused, and the next recording loads a fresh one (AC5). Killing a thread stuck in native code
  (whisper.cpp, sherpa-onnx) is not possible safely.
- To check for the builder: `save_meeting` is a sync command, so it runs on the main thread, and it
  calls `stop_meeting`. With AC1 in place it can run while `stop_recording` still holds the recorder
  lock. Either make the command async or make sure `stop_meeting` cannot wait on that lock without a
  limit (AC5).
