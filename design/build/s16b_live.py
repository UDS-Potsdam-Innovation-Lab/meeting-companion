"""16 Agenda-free · live 1280×800: whole-meeting timer, topics with one "talking now", transcript centre."""
from s16_free import live


def build(x=0, y=0):
    return live("s16b_", "16 Agenda-free · live · talking now", x, y, w=1280, h=800, state="now")
