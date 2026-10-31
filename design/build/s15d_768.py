"""02 add · Sound wave · 768×480: the short live window; footer keeps one row, wave beside the speakers button."""
from kit import B, C, SHADOW
from s2_live import LINES, segmented
import soundwave as W


def build(x=0, y=0):
    b = B("s15d_")
    s = b.col(None, "02 add · Sound wave · 768×480", w=768, h=480, fill=C["bg"], x=x, y=y, clip=True, key="screen")
    t = b.row(s, "Top bar", gap=12, pad=[10, 16, 10, 16], fill=C["surface"], sizingH="fill",
              sides=[0, 0, 1, 0], stroke=C["line"])
    mark = b.row(t, "Mark", w=28, h=28, radius=8, fill=C["accent"], main="center", cross="center")
    b.txt(mark, "◆", size=13, style="Bold", color="#FFFFFF")
    b.txt(t, "Product sync · Beta launch", size=15, style="SemiBold", color=C["ink2"])
    b.spacer(t)
    b.chip(t, "REC  00:23:41", C["red"], C["redSoft"], dot=C["red"])
    b.button(t, "Pause", "ghost", size=13, pad=(7, 12, 7, 12), icon="❚❚")
    b.button(t, "End meeting", "dark", size=13, pad=(7, 12, 7, 12))
    body = b.col(s, "Body", pad=[12, 16, 12, 16], sizingH="fill", sizingV="fill")
    mid = b.card(body, "Transcript", pad=0, gap=0, sizingV="fill", effects=SHADOW)
    mh = b.row(mid, "Header", gap=12, pad=[10, 16, 10, 16], sizingH="fill", sides=[0, 0, 1, 0], stroke=C["line"])
    segmented(b, mh, ["Transcript", "Mind map", "Notes"], "Transcript")
    b.spacer(mh)
    b.txt(mh, "⌕  Search", size=13, color=C["muted"])
    feed = b.col(mid, "Feed", gap=2, pad=[8, 12, 8, 12], sizingH="fill", sizingV="fill", clip=True, mainAlign="max")
    for who, ts, line in LINES[2:]:
        W.line(b, feed, who, ts, line, fs=14, avatar=28)
    W.line(b, feed, "JR", "", "And the release notes for the schools, should those go out in German only or",
           fs=14, avatar=28, live=True)
    W.footer(b, mid, "speech", "tablet")
    return b
