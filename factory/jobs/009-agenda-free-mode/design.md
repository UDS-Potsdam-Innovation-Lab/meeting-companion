SOURCE: figcraft
APPROVED 2026-10-31 (facilitator: "everything approved, build everything")

File: design/meeting-companion.figcraft (builders design/build/s16*.py, ids in design/build/ids.json)
Frames ("16 Agenda-free"), PNGs in design/screens/:
- 11941 01 setup, Agenda-free selected — s16a_setup.png (1440×900)
- 10864 live · talking now — s16b_live.png (1280×800)
- 10291 live · start, no topics — s16c_empty.png
- 10394 live · half-time nudge — s16d_half.png
- 10557 live · overrun — s16e_over.png
- 11019 live · dark (half-time) — s16f_dark.png
- 11788 1024×768 · adding a topic — s16g_1024.png
- 11343 768×1024 — s16h_768.png
- 11496 375 · full page — s16i_375.png
- 11638 375 · half-time nudge — s16j_375_half.png
- 12418 states board (timer 0/49/50 %, late start, overrun, started after end; 7 topic-card states; nudge light/dark/375) — s16k_states.png

Decisions: half-time nudge = frame 02 dark toast pattern (existing `.nudge`), one "Dismiss";
two columns (timer card + "Topics so far" left, transcript card with the 007 sound-wave footer right), no right column;
"Add topic" pinned at the bottom of the topics card, inline field; current topic tinted AND labelled "● talking now";
slot label always shows the scheduled length; overrun as text "N min over · slot ended HH:MM".

Orchestrator note: the frames draw "End meeting" in the top bar. Keep the app's current placement instead
(End meeting is the last control of the live view, decided in job 002 rework). Do not move it.
