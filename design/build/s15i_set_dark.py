"""14 add · Sound wave: Settings · Audio while recording, dark tokens (as s14j_dark)."""
from kit import DARK
from soundwave import settings_screen


def build(x=0, y=0):
    return settings_screen("s15i_", "14 add · Sound wave · dark · Audio while recording", x, y, section="Audio",
                           state="recording", origin="live", theme=DARK)
