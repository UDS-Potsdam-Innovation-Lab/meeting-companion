"""02 add · Sound wave · board 1920×1080: frame 02 on the board PC, wave 32 px high (legible from 3 m)."""
from soundwave import live_screen


def build(x=0, y=0):
    return live_screen("s15e_", "02 add · Sound wave · board 1920", x, y, w=1920, h=1080, state="speech",
                       size="board")
