"""20 Voice profiles · Settings › Voice profiles · dark."""
from kit import DARK
from s20_voices import settings


def build(x=0, y=0):
    return settings("s20l_", "20 Voice profiles · Settings · dark", x, y, w=1280, h=800, on=True, state="list",
                    theme=DARK)
