"""16 Agenda-free · live · dark: the half-time state on the dark tokens."""
from s16_free import live, darken


def build(x=0, y=0):
    return darken(lambda: live("s16f_", "16 Agenda-free · live · dark", x, y, w=1280, h=800, state="half",
                               nudge=True))
