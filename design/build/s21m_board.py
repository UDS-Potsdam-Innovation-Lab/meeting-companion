"""21 Captures · board 1920×1080 touch: every target at least 48 px (kind buttons, chips, tabs, card actions)."""
import s21_captures as S


def build(x=0, y=0):
    spec = dict(
        tab="t", counts=(1, 2, 0), pending=("d",),
        groups=[("Punkt 01 · Check-in & Ziele", S.CAPS["t"])],
        composer=dict(state="typing", kind="t", text="Dritter Pilotschule schreiben, dass der Offline-Modus "
                                                     "später kommt", owner="YA", due="Fr 6. Nov.",
                      attach="Punkt 02 · Beta-Start"),
        status="local",
    )
    return S.live("s21m_", "21 Captures · board 1920 · touch", x, y, spec, w=1920, h=1080, size="board",
                  lines=S.lines_detected(todo=None), now_counts=None)
