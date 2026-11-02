"""21 Captures · 018 · 1280: a question typed with /q. The command picks the kind (and the tab) and is removed
from the text."""
import s21_captures as S


def build(x=0, y=0):
    spec = dict(
        tab="q", counts=(1, 2, 0),
        empty=("Noch keine Fragen", "Offene Fragen aus diesem Meeting erscheinen hier."),
        composer=dict(state="typing", kind="q", text="Gehen die Release Notes nur auf Deutsch raus?",
                      attach="Punkt 02 · Beta-Start"),
    )
    return S.live("s21i_", "21 Captures · 018 · 1280 · question via /q", x, y, spec, w=1280, h=800, now_counts=None)
