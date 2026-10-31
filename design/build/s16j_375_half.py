"""16 Agenda-free · 375×812 viewport: the half-time toast sticks to the bottom, full width."""
from s16_free import live


def build(x=0, y=0):
    return live("s16j_", "16 Agenda-free · 375 · half-time nudge", x, y, w=375, h=812, state="half", nudge=True)
