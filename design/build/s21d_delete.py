"""21 Captures · 018 · 1440: deleted. The card is gone at once; the notice keeps Undo for 8 s (at least 5 s, AC1),
the bar runs down. Undo puts it back in its place."""
import s21_captures as S


def build(x=0, y=0):
    spec = dict(
        tab="t", counts=(1, 2, 0),
        groups=[("Jetzt · Punkt 02 · Beta-Start", [S.NEW_TODO]),
                ("Punkt 01 · Check-in & Ziele", [S.CAPS["t"][1]])],
        notice=dict(text="Aufgabe gelöscht", sub="„Einladungen für die Donnerstags-…“", frac=0.45),
        composer=dict(state="rest", kind="t"),
    )
    return S.live("s21d_", "21 Captures · 018 · deleted, with Undo", x, y, spec, now_counts="1 Aufgabe")
