SOURCE: figcraft
APPROVED 2026-11-02 (Jan)

File: design/meeting-companion.figcraft (builders design/build/s21*.py, ids in design/build/ids.json)
Frames ("21 Captures"), PNGs in design/screens/:
- s21b_saved.png
- s21_captures.png
- s21c_edit.png
- s21d_delete.png
- s21e_empty.png
- s21f_many.png
- s21g_suggest.png
- s21h_suggest_edit.png
- s21i_1280.png
- s21j_768.png
- s21k_375.png
- s21l_375_suggest.png
- s21m_board.png
- s21n_dark.png
- s21o_free.png
- s21s_states.png

018 builds the quick-capture frames (s21_captures, s21b_saved, s21c_edit, s21d_delete, s21e_empty, s21f_many without the suggestion, s21i_1280, s21j_768, s21k_375, s21m_board, s21n_dark without the suggestion, s21o_free, and the composer/card/notice parts of s21s_states). The suggestion parts (s21g_suggest, s21h_suggest_edit, s21l_375_suggest, pinned suggestion in s21f, status line and transcript chips in s21s_states, top-bar cloud chip) belong to #19.

Decisions (human, 2026-11-02):
- Choosing a kind switches the list to that kind's tab (as drawn), so a saved capture is visible at once.
- German copy uses "du" (as the live view); the whole app moves to "du" later (backlog).
- Kind buttons Beschluss / Aufgabe / Frage above the field, plus /d /t /q; owner and due date as chip rows inside the composer (no popovers); Enter saves; "gerade gespeichert" only after the core wrote the file; Undo notice 8 s (≥ 5 s per spec) for save and delete; delete only inside the inline editor; list grouped by agenda item (running first), newest first; tabs and composer pinned; below 800 px captures become a second tab "Festgehalten n" in the centre card, composer sticks to the bottom; agenda-free: captures go to the running topic, else "Ohne Thema".
- Not drawn, builder decides within the design language: 1024 px (uses the narrow tab pattern), a "Weitere …" overflow when the "Wer" row has more than ~6 people.
