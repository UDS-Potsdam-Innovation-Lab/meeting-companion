"""21 Captures · 018 · 375: a to-do being typed. Owner and date chips wrap; the sticky composer grows upwards."""
import s21_captures as S


def build(x=0, y=0):
    spec = dict(
        tab="t", counts=(1, 2, 0),
        groups=[("Punkt 01 · Check-in & Ziele", S.CAPS["t"])],
        composer=dict(state="typing", kind="t", text="Dritter Pilotschule schreiben", owner="YA",
                      due="Fr 6. Nov.", attach="Punkt 02"),
    )
    return S.narrow("s21k_", "21 Captures · 018 · 375 · to-do", x, y, spec, w=375)
