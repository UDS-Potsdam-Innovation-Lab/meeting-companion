"""16 Agenda-free · 375: the whole page (it scrolls), timer, topics, transcript card."""
from s16_free import live


def build(x=0, y=0):
    return live("s16i_", "16 Agenda-free · 375 · full page", x, y, w=375, h=None, state="now")
