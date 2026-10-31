"""16 Agenda-free · live at 50 %: frame 02's dark toast with "Half the time is gone"."""
from s16_free import live


def build(x=0, y=0):
    return live("s16d_", "16 Agenda-free · live · half-time nudge", x, y, w=1280, h=800, state="half", nudge=True)
