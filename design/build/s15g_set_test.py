"""14 add · Sound wave: Settings · Audio, microphone test running, the test meter is SoundWave (3 s history)."""
from soundwave import settings_screen


def build(x=0, y=0):
    return settings_screen("s15g_", "14 add · Sound wave · Audio · test running", x, y, section="Audio",
                           state="test", origin="setup")
