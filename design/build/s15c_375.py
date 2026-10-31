"""02 add · Sound wave · 375: the live transcript on a phone-width window, wave beside the speakers button."""
from kit import B, C, SHADOW
from s2_live import LINES, segmented
import soundwave as W


def build(x=0, y=0, prefix="s15c_", name="02 add · Sound wave · 375", state="speech", theme=None):
    b = B(prefix)
    s = b.col(None, name, w=375, h=760, fill=C["bg"], x=x, y=y, clip=True, key="screen")
    t = b.col(s, "Top bar", gap=10, pad=[12, 16, 12, 16], fill=C["surface"], sizingH="fill",
              sides=[0, 0, 1, 0], stroke=C["line"])
    r1 = b.row(t, "Row 1", gap=10, sizingH="fill")
    mark = b.row(r1, "Mark", w=28, h=28, radius=8, fill=C["accent"], main="center", cross="center")
    b.txt(mark, "◆", size=13, style="Bold", color=C.get("onAccent", "#FFFFFF"))
    b.txt(r1, "Product sync", size=16, style="Bold")
    b.spacer(r1)
    b.chip(r1, "REC  23:41", C["red"], C["redSoft"], dot=C["red"])
    r2 = b.row(t, "Row 2", gap=8, sizingH="fill")
    b.button(r2, "Pause", "ghost", size=13, pad=(8, 12, 8, 12), icon="❚❚")
    b.spacer(r2)
    b.button(r2, "End meeting", "dark", size=13, pad=(8, 12, 8, 12))
    body = b.col(s, "Body", pad=[12, 12, 16, 12], sizingH="fill", sizingV="fill")
    mid = b.card(body, "Transcript", pad=0, gap=0, sizingV="fill", effects=SHADOW)
    mh = b.row(mid, "Header", gap=8, pad=[10, 12, 10, 12], sizingH="fill", sides=[0, 0, 1, 0], stroke=C["line"])
    segmented(b, mh, ["Transcript", "Mind map", "Notes"], "Transcript")
    feed = b.col(mid, "Feed", gap=2, pad=[8, 4, 8, 4], sizingH="fill", sizingV="fill", clip=True, mainAlign="max")
    for who, ts, line in LINES[2:]:
        W.line(b, feed, who, ts, line, fs=14, avatar=26)
    W.line(b, feed, "JR", "", "And the release notes for the schools, should those go out in German only or",
           fs=14, avatar=26, live=True)
    W.footer(b, mid, state, "phone")
    return b
