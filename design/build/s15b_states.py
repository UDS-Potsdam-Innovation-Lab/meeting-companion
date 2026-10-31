"""02 add · Sound wave · footer states: every SoundWave state in the transcript footer, light and dark at the
1280 card width (512 px), the 375 px footer, the anatomy of the wave, and the REC chip decision."""
from kit import B, C, DARK, SHADOW, themed
import soundwave as W

STATES = [
    ("speech", "Listening · speech", "High, irregular bars. One bar per 100 ms, newest on the right."),
    ("silence", "Listening · silence", "Low ripple, still accent: the room is quiet, the mic is alive."),
    ("paused", "Paused", "One flat grey line, no bars. No rAF while paused."),
    ("nosignal", "No signal", "Dashed grey line after 500 ms without a level event."),
    ("lost", "Microphone lost", "Flat line; red only beside the text. Matches the card’s error notice."),
    ("rm_speech", "Reduced motion · speech", "Static level bar, at most 4 updates a second, no transition."),
    ("rm_paused", "Reduced motion · paused", "Empty track and “Paused”."),
]
CELL = 512


def cell(b, parent, state, title, sub, w, size="wide", caption=True):
    c = b.col(parent, f"State {title}", gap=10, w=w)
    if caption:
        b.txt(c, title, size=14, style="SemiBold", fillW=True)
        b.txt(c, sub, size=12, color=C["ink2"], fillW=True, lh="140%")
    card = b.card(c, "Transcript (bottom)", pad=0, gap=0, effects=SHADOW)
    W.snippet_body(b, card, state, w)
    W.footer(b, card, state, size)
    return c


def section(b, parent, title, sub, fill=None, pad=0):
    s = b.col(parent, title, gap=16, pad=pad, fill=fill, radius=20 if fill else 0)
    h = b.col(s, "Heading", gap=4)
    b.txt(h, title, size=18, style="Bold")
    if sub:
        b.txt(h, sub, size=13, color=C["ink2"])
    return s


def build(x=0, y=0):
    b = B("s15b_")
    s = b.col(None, "02 add · Sound wave · footer states", fill=C["bg"], x=x, y=y, pad=48, gap=40, key="screen")
    hd = b.col(s, "Title", gap=6)
    b.txt(hd, "Sound wave in the transcript footer", size=28, style="Bold", ls=-0.5)
    b.txt(hd, "The wave is aria-hidden. The status word in “Listening · 5 speakers” carries the meaning and is "
              "announced once per state change.", size=14, color=C["ink2"])

    sec = section(b, s, "Light · 1280×800 (transcript card 512 px)", None)
    r = b.row(sec, "Strip", gap=24, cross="min")
    for st, t, sub in STATES:
        cell(b, r, st, t, sub, CELL)

    with themed(DARK):
        sec = section(b, s, "Dark · same states", "Wave #8F88FF on the card #1B1D22: 5.7:1. Flat line 5.7:1.",
                      fill=C["bg"], pad=28)
        r = b.row(sec, "Strip", gap=24, cross="min")
        for st, t, sub in STATES:
            cell(b, r, st, t, sub, CELL)
    # the dark heading texts were drawn with dark tokens; fine on the dark panel.

    sec = section(b, s, "375 px · wave 12 bars (1.2 s), “Mark moment” as an icon button",
                  "The wave sits left of job 004’s speakers button and is not part of its target. "
                  "Microphone lost drops the flat line at 375 px so the button fits.")
    r = b.row(sec, "Strip", gap=24, cross="min")
    for st, t, sub in STATES:
        cell(b, r, st, t, sub, 343, size="phone")

    low = b.row(s, "Details", gap=48, cross="min")
    an = section(b, low, "Anatomy", "A scrolling level history of the last 2 s, mirrored around the centre line.")
    big = b.row(an, "Wave ×4", gap=40, pad=28, fill=C["surface"], radius=16, stroke=C["line"], cross="center")
    W.SIZES["x4"] = dict(n=20, bw=12, gap=8, h=80, fs=12, pad=None, bpad=None)
    W.bars(b, big, W.SPEECH, "x4", name="Sound wave ×4")
    notes = b.col(big, "Notes", gap=8, w=360)
    for k, v in (("Footer", "20 bars · 3 px wide, 2 px gap · 98×20 px (fits the 18–20 px row)"),
                 ("375 px", "12 bars · 58×20 px"),
                 ("Board 1920", "20 bars · 5 px, 3 px gap · 157×32 px"),
                 ("Settings", "30 bars · 4 px, 3 px gap · 207×32 px (3 s)"),
                 ("Height", "2 px + level × (h − 2); level = min(1, rms × 4)"),
                 ("Fade", "oldest 4 bars at 35 / 55 / 75 / 90 % opacity")):
        rr = b.row(notes, k, gap=10, sizingH="fill", cross="min")
        b.txt(rr, k, size=12, style="SemiBold", color=C["ink"], w=80)
        b.txt(rr, v, size=12, color=C["ink2"], fillW=True, lh="140%")

    rc = section(b, low, "REC chip · no wave", "The footer wave is the only placement in frame 02.")
    box = b.col(rc, "Chips", gap=14, pad=28, fill=C["surface"], radius=16, stroke=C["line"], w=520)
    cr = b.row(box, "Chip states", gap=10)
    b.chip(cr, "REC  00:23:41", C["red"], C["redSoft"], dot=C["red"], name="REC chip · recording")
    b.chip(cr, "Paused  00:23:41", C["ink2"], C["sunken"], name="REC chip · paused")
    with themed(DARK):
        dk = b.row(cr, "Dark", gap=10, pad=[6, 8, 6, 8], radius=999, fill=C["surface"])
        b.chip(dk, "REC  00:23:41", C["red"], C["redSoft"], dot=C["red"], name="REC chip · recording · dark")
    for t in ("The chip says “recording”, steady, on every view. A second moving thing in the top bar would "
              "pull the eye all meeting long.",
              "Red stays the colour of recording and errors; an indigo wave inside a red chip would mix both "
              "meanings.",
              "Where the footer is out of view: Settings · Audio shows the recording’s level with the same "
              "wave (frame 14)."):
        rr = b.row(box, "Reason", gap=8, sizingH="fill", cross="min")
        b.txt(rr, "–", size=13, color=C["muted"])
        b.txt(rr, t, size=13, color=C["ink2"], fillW=True, lh="145%")
    return b
