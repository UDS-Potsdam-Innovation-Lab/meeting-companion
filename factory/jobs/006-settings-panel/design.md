SOURCE: figcraft
APPROVED 2026-10-30 (human, layout approved in FigCraft)

File: design/meeting-companion.figcraft — frame "14 Settings" and its state/size frames, built by design/build/s14_settings.py; PNG exports in design/screens/s14_*.png. Frame-02 additions as "02 add · …" frames.

## Build order (human, 2026-10-30)

The human asked to start the build now, before 004 and 005 are merged. Build the parts that do not depend on them first (AC1, AC2, AC4, AC6, AC7, and the speech-model picker of AC5). For AC3 (device-lost handling) and the speaker-model row of AC5: merge `main` in once 005 / 004 have merged (the orchestrator will tell you), then finish them. If 004 has not merged by the end of the build, the speaker-model row moves to a follow-up, as the spec says.

## Frames (final)

16 frames on page 1 from y=3400, PNGs in design/screens/s14*.png: s14_settings (Audio while recording, main), s14b_test, s14c_missing, s14d_device, s14e_nomodel, s14f_general, s14g_board (1920), s14h_768, s14i_375, s14j_dark, s14k_dark_general, s14l_entry (entry points + revised frame 01 card), s14m_02_switched, s14n_02_startfail, s14o_dark01, s14p_dark02.

Assistant settings (frame 01): the card keeps only per-meeting switches (timekeeping, capture, mind map, speaker names); its Transcription row shows the device defaults read-only with a "Settings ›" link. Microphone, models and meeting language are set only in Settings.

Known rough spots in the frames (not to copy): dark 01 goal chips stay light; speaker-name colours too dark on dark cards; light `muted` #8A8D96 is 3.3:1 on white (fails AA) — use an AA-passing muted colour in the app.
