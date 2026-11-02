"""21 Captures · dark · 1280: a pending suggestion, a confirmed capture, the composer and the cloud status line."""
import s21_captures as S


def build(x=0, y=0):
    spec = dict(
        tab="d", counts=(1, 2, 0), pending=("d", "t"),
        suggestions=[S.SUG_DEC],
        groups=[("Punkt 01 · Check-in & Ziele", S.CAPS["d"])],
        notice=dict(text="Beschluss gespeichert · Punkt 01", sub=None, frac=0.5),
        composer=dict(state="rest", kind="d"),
        status="cloud",
    )
    return S.run_dark(lambda: S.live("s21n_", "21 Captures · dark · 1280", x, y, spec, w=1280, h=800,
                                     lines=S.lines_detected(), cloud=True, now_counts=None))
