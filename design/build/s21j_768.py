"""21 Captures · 018 · 768: one column. "Festgehalten" is the centre card's second tab; the composer sticks to the
bottom of the window."""
import s21_captures as S


def build(x=0, y=0):
    spec = dict(
        tab="t", counts=(1, 3, 0),
        groups=[("Jetzt · Punkt 02 · Beta-Start", [dict(S.NEW_TODO, new=True)]),
                ("Punkt 01 · Check-in & Ziele", S.CAPS["t"])],
        notice=dict(text="Aufgabe gespeichert · Punkt 02", sub="Yusuf Aydin · bis Fr 6. Nov.", frac=0.7),
        composer=dict(state="typing", kind="t", text="", attach="Punkt 02"),
    )
    return S.narrow("s21j_", "21 Captures · 018 · 768 · Festgehalten tab", x, y, spec, w=768)
