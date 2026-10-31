"""02 add · Sound wave (job 007): frame 02 at 1280×800 with the SoundWave in the transcript footer.

Siblings: s15b_states (footer state strip, light/dark/375, anatomy, REC chip), s15c_375, s15d_768, s15e_board,
s15f_dark (frame 02), s15g…s15k (frame 14 Audio with the wave). Shared parts live in soundwave.py.
"""
from soundwave import live_screen


def build(x=0, y=0):
    return live_screen("s15_", "02 add · Sound wave", x, y, w=1280, h=800, state="speech")
