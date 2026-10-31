"""14 add · Sound wave: Settings · Audio while recording, the meter shows the recording's level stream."""
from soundwave import settings_screen


def build(x=0, y=0):
    return settings_screen("s15h_", "14 add · Sound wave · Audio · while recording", x, y, section="Audio",
                           state="recording", origin="live")
