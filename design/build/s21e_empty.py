"""21 Captures · 018 · 1280: nothing captured yet. Counts at 0, one quiet hint, the composer ready."""
import s21_captures as S


def build(x=0, y=0):
    spec = dict(
        tab="d", counts=(0, 0, 0),
        empty=("Noch nichts festgehalten",
               "Halte Beschlüsse, Aufgaben und Fragen unten fest. Sie landen beim laufenden Punkt. "
               "Im Feld gehen auch /d, /t und /q."),
        composer=dict(state="rest", kind="d"),
    )
    lines = [l + ({},) for l in S.LINES[:3]]
    return S.live("s21e_", "21 Captures · 018 · empty column · 1280", x, y, spec, w=1280, h=800, lines=lines,
                  now_counts=None)
