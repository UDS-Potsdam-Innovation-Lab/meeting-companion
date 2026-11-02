"""21 Captures · 018 · 1440: just saved. The new card leads the running item's group, the field is empty with focus
still in it, and the notice above the composer offers Undo for 8 s."""
import s21_captures as S


def build(x=0, y=0):
    spec = dict(
        tab="t", counts=(1, 3, 0),
        groups=[("Jetzt · Punkt 02 · Beta-Start", [dict(S.NEW_TODO, new=True)]),
                ("Punkt 01 · Check-in & Ziele", S.CAPS["t"])],
        notice=dict(text="Aufgabe gespeichert · Punkt 02", sub="Yusuf Aydin · bis Fr 6. Nov.", frac=0.7),
        composer=dict(state="typing", kind="t", text="", attach="Punkt 02 · Beta-Start"),
    )
    return S.live("s21b_", "21 Captures · 018 · saved, with Undo", x, y, spec, now_counts="1 Aufgabe")
