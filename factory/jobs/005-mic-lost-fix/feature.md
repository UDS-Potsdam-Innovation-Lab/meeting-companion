Bug: recording stops with "MicrophoneLost" a few seconds after it starts, while the microphone works.

Cause (from src-tauri/src/recording/mod.rs, the capture loop around line 416): the same loop takes audio from the sink and runs transcriber.push() (whisper) synchronously. last_audio is set before push(), so the time whisper spends on a window (about 2.5 s for a 3 s window in release, much longer in a debug build) counts toward STALL (1.5 s). After the first window the loop reports MicrophoneLost although audio is waiting in the sink. Seen on Linux in tauri dev: four "recording stopped: MicrophoneLost" lines.

Fix:
- The stall check must only measure time without audio arriving from the device, never time spent transcribing (e.g. run speech-to-text off the capture loop, or measure arrival in the sink). A slow engine must make transcription lag (bounded buffer, oldest dropped, as specified in 003), never stop recording.
- Add a regression test: a fake speech engine that takes longer than STALL per window with a live fake microphone must keep recording.
- Make whisper.cpp usable in dev builds: optimise the whisper-rs-sys / native build in the dev profile (e.g. [profile.dev.package."*"] opt-level), so tauri dev transcribes near real time.
