"""21 Captures · #19 · 375: a pending suggestion on the phone layout; the dot on "Festgehalten" marks it from the
transcript tab."""
import s21_captures as S


def build(x=0, y=0):
    spec = dict(
        tab="d", counts=(1, 2, 0), pending=("d",),
        suggestions=[S.SUG_DEC],
        groups=[("Punkt 01 · Check-in & Ziele", S.CAPS["d"])],
        composer=dict(state="rest", kind="d"),
        status="local",
    )
    return S.narrow("s21l_", "21 Captures · #19 · 375 · suggestion", x, y, spec, w=375)
