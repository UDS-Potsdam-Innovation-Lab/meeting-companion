"""21 Captures · #19 · 1440: a pending suggestion. The "detected" chip on the source line was tapped: the line is
marked and focus is on the card. Claude is chosen, so the status line and the bar say the text goes to Anthropic."""
import s21_captures as S


def build(x=0, y=0):
    spec = dict(
        tab="d", counts=(1, 2, 0), pending=("d", "t"),
        suggestions=[dict(S.SUG_DEC, focus=True)],
        groups=[("Punkt 01 · Check-in & Ziele", S.CAPS["d"])],
        composer=dict(state="rest", kind="d"),
        status="cloud",
    )
    return S.live("s21g_", "21 Captures · #19 · suggestion, from the detected chip · cloud", x, y, spec,
                  lines=S.lines_detected(focus_dec=True), cloud=True, now_counts=None)
