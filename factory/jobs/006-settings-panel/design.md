SOURCE: figcraft
APPROVED 2026-10-30 (human, layout approved in FigCraft)

File: design/meeting-companion.figcraft — frame "14 Settings" and its state/size frames, built by design/build/s14_settings.py; PNG exports in design/screens/s14_*.png. Frame-02 additions as "02 add · …" frames.

## Build order (human, 2026-10-30)

The human asked to start the build now, before 004 and 005 are merged. Build the parts that do not depend on them first (AC1, AC2, AC4, AC6, AC7, and the speech-model picker of AC5). For AC3 (device-lost handling) and the speaker-model row of AC5: merge `main` in once 005 / 004 have merged (the orchestrator will tell you), then finish them. If 004 has not merged by the end of the build, the speaker-model row moves to a follow-up, as the spec says.
