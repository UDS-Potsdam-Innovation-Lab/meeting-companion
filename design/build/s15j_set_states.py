"""14 add · Sound wave · meter states: the Settings · Audio meter row in every SoundWave state, light and dark,
including the reduced-motion bar. Same component as the footer, at the settings size (30 bars, 32 px)."""
from kit import B, C, DARK, themed
import soundwave as W

ROWS = [
    ("speech", "Test · speaking", "Jabra Speak 510", "0:07 left"),
    ("silence", "Test · quiet room", "Jabra Speak 510", "0:04 left"),
    ("speech", "Recording’s level", "Recording · Jabra Speak 510", None),
    ("paused", "Recording paused", "Recording paused · Jabra Speak 510", None),
    ("nosignal", "No signal (500 ms)", "No signal · Jabra Speak 510", None),
    ("lost", "Microphone lost", "Microphone lost · Jabra Speak 510", None),
    ("paused", "Idle", "No test running", None),
    ("rm_speech", "Reduced motion · test", "Jabra Speak 510", "0:07 left"),
    ("rm_paused", "Reduced motion · paused", "Recording paused · Jabra Speak 510", None),
]
W_ROW = 560


def meter_row(b, parent, state, label, right):
    mr = b.row(parent, f"Meter row · {label}", gap=14, pad=[10, 14, 10, 14], radius=10, fill=C["sunken"], w=W_ROW)
    W.sound_wave(b, mr, state, "settings")
    if state in ("nosignal", "lost"):
        W.badge(b, mr, "!", C["amber"] if state == "nosignal" else C["red"], C["sunken"], 16)
        head, _, rest = label.partition(" · ")
        t = b.row(mr, "Text", gap=6, sizingH="fill")
        b.txt(t, head, size=13, style="SemiBold", color=C["red"] if state == "lost" else C["ink"])
        b.txt(t, "· " + rest, size=13, color=C["ink2"])
    else:
        b.txt(mr, label, size=13, color=C["muted"] if label == "No test running" else C["ink2"], fillW=True)
    if right:
        b.txt(mr, right, size=14, style="SemiBold", color=C["accentInk"], features={"tnum": True})
    return mr


def column(b, parent, title):
    col = b.col(parent, title, gap=12, pad=28, radius=20, fill=C["surface"], stroke=C["line"])
    b.txt(col, title, size=16, style="Bold")
    for state, cap, label, right in ROWS:
        r = b.row(col, cap, gap=20)
        b.txt(r, cap, size=13, style="SemiBold", color=C["ink2"], w=170)
        meter_row(b, r, state, label, right)
    return col


def build(x=0, y=0):
    b = B("s15j_")
    s = b.col(None, "14 add · Sound wave · meter states", fill=C["bg"], x=x, y=y, pad=48, gap=28, key="screen")
    hd = b.col(s, "Title", gap=6)
    b.txt(hd, "Settings · Audio · level meter", size=28, style="Bold", ls=-0.5)
    b.txt(hd, "The test and the running recording use the same SoundWave and the same capture-side level.",
          size=14, color=C["ink2"])
    r = b.row(s, "Themes", gap=32, cross="min")
    column(b, r, "Light")
    with themed(DARK):
        column(b, r, "Dark")
    return b
