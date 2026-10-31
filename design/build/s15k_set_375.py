"""14 add · Sound wave: Settings · Audio at 375 px, microphone test running (14 bars, 1.4 s)."""
from soundwave import settings_screen


def build(x=0, y=0):
    return settings_screen("s15k_", "14 add · Sound wave · 375 · test running", x, y, w=375, h=1300,
                           section="Audio", state="test", size="phone", origin="setup")
