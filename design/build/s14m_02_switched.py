"""02 add: the non-blocking notice after the device was lost and the app switched to the system default."""
from kit import B, C, SHADOW, PEOPLE
from s2_live import segmented
from s14_settings import Z, lang_switch, settings_button

LINES = [("YA", "10:13", "Fine with me, as long as we tell the third school early."),
         ("MK", "10:14", "Okay. Yusuf, can you write to them this week?")]


def build(x=0, y=0):
    b = B("s14m_")
    z = Z("wide")
    s = b.col(None, "02 add · switched to the system microphone", w=1180, h=600, fill=C["bg"], x=x, y=y, clip=True,
              key="screen")
    t = b.topbar(s, "Product sync · Beta launch")
    b.chip(t, "REC  00:24:05", C["red"], C["redSoft"], dot=C["red"])
    b.chip(t, "On-device · DE/EN", C["ink2"], C["sunken"], style="Regular")
    settings_button(b, t, z, "rest")
    b.button(t, "Pause", "ghost", size=13, pad=(8, 14, 8, 14), icon="❚❚")
    b.button(t, "End meeting", "dark", size=13, pad=(8, 14, 8, 14))
    body = b.col(s, "Body", pad=[20, 24, 20, 24], sizingH="fill", sizingV="fill")
    mid = b.card(body, "Transcript", pad=0, gap=0, sizingV="fill", effects=SHADOW)
    mh = b.row(mid, "Header", gap=12, pad=[14, 20, 14, 20], sizingH="fill", sides=[0, 0, 1, 0], stroke=C["line"])
    segmented(b, mh, ["Transcript", "Mind map", "Notes"], "Transcript")
    b.spacer(mh)
    b.txt(mh, "⌕  Search", size=13, color=C["muted"])
    feed = b.col(mid, "Feed", gap=4, pad=[16, 20, 16, 20], sizingH="fill", sizingV="fill")

    n = b.row(feed, "Notice: switched microphone", gap=14, pad=[12, 14, 12, 16], radius=12, fill=C["accentSoft"],
              stroke=C["accent"], sizingH="fill")
    ic = b.row(n, "Icon", w=34, h=34, radius=17, fill=C["surface"], main="center", cross="center")
    b.txt(ic, "🎙", size=15)
    c = b.col(n, "Text", gap=2, sizingH="fill")
    b.txt(c, "Switched to the system microphone", size=14, style="SemiBold", color=C["accentInk"], fillW=True)
    b.txt(c, "Jabra Speak 510 stopped at 10:14. Recording carries on with Built-in Audio Analog Stereo.",
          size=13, color=C["ink2"], fillW=True)
    b.button(n, "Settings", "ghost", size=12, pad=(7, 12, 7, 12))
    b.button(n, "Dismiss", "ghost", size=12, pad=(7, 12, 7, 12))

    for who, ts, line in LINES:
        name, colr = PEOPLE[who]
        r = b.row(feed, f"Line {who}", gap=12, pad=[10, 12, 10, 12], sizingH="fill", cross="min")
        b.avatar(r, who, 30)
        cc = b.col(r, "Text", gap=4, sizingH="fill")
        nr = b.row(cc, "Meta", gap=8)
        b.txt(nr, name, size=13, style="SemiBold", color=colr)
        b.txt(nr, ts, size=12, color=C["muted"])
        b.txt(cc, line, size=15, fillW=True, lh="150%")
    mk = b.row(feed, "Marker", gap=10, pad=[6, 12, 6, 12], sizingH="fill")
    b.rect(mk, 40, 1, C["line"], name="Rule")
    b.txt(mk, "10:14 · microphone switched to Built-in Audio Analog Stereo", size=12, color=C["muted"])
    b.node("frame", mk, name="Rule", w=10, h=1, fill=C["line"], sizingH="fill")
    foot = b.row(mid, "Listening", gap=10, pad=[12, 20, 12, 20], sizingH="fill", sides=[1, 0, 0, 0], stroke=C["line"])
    wave = b.row(foot, "Level", gap=3)
    for hgt in (6, 12, 18, 10, 22, 14, 8, 16, 20, 9, 5, 12):
        b.rect(wave, 3, hgt, C["accent"], radius=2, name="Bar")
    b.txt(foot, "Listening · Built-in Audio Analog Stereo", size=12, color=C["muted"])
    return b
