"""02 add · Sound wave · dark: frame 02 at 1280×800 on the dark tokens, wave while people speak."""
from kit import DARK
from soundwave import live_screen


def build(x=0, y=0):
    return live_screen("s15f_", "02 add · Sound wave · dark", x, y, w=1280, h=800, theme=DARK, state="speech")
