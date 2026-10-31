"""16 Agenda-free · live at the start: no topics yet, so no topic is current."""
from s16_free import live


def build(x=0, y=0):
    return live("s16c_", "16 Agenda-free · live · start, no topics", x, y, w=1280, h=800, state="empty")
