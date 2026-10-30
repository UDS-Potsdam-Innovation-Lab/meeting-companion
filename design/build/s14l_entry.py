"""14 Settings · entry points: the Settings button in the top bars of 01 and 02, its states, and the revised
Assistant settings card of frame 01 (per-meeting switches only; transcription defaults live in Settings)."""
from kit import B, C, SHADOW
from s14_settings import Z, lang_switch, settings_button


def label(b, parent, s):
    b.txt(parent, s.upper(), size=11, style="SemiBold", color=C["muted"], ls=0.8)


def framed(b, parent, name):
    return b.col(parent, name, radius=12, stroke=C["line"], clip=True, sizingH="fill", effects=SHADOW)


def build(x=0, y=0):
    b = B("s14l_")
    z = Z("wide")
    s = b.col(None, "14 Settings · entry points + frame 01 card", w=1440, h=780, fill=C["bg"], x=x, y=y, clip=True,
              gap=14, pad=32, key="screen")

    label(b, s, "Frame 01 · top bar")
    f1 = framed(b, s, "Setup bar")
    t = b.topbar(f1, "New meeting")
    b.chip(t, "On-device transcription", C["green"], C["greenSoft"], dot=C["green"])
    lang_switch(b, t, z)
    settings_button(b, t, z, "rest", key="settings_setup")
    b.avatar(t, "MK", 30)

    label(b, s, "Frame 02 · top bar")
    f2 = framed(b, s, "Live bar")
    t = b.topbar(f2, "Product sync · Beta launch")
    b.chip(t, "REC  00:23:41", C["red"], C["redSoft"], dot=C["red"])
    b.chip(t, "On-device · DE/EN", C["ink2"], C["sunken"], style="Regular")
    lang_switch(b, t, z)
    settings_button(b, t, z, "rest", key="settings_live")
    b.button(t, "Pause", "ghost", size=13, pad=(8, 14, 8, 14), icon="❚❚")
    b.button(t, "End meeting", "dark", size=13, pad=(8, 14, 8, 14))

    row = b.row(s, "Lower", gap=24, sizingH="fill", cross="min", pad=[10, 0, 0, 0])
    left = b.col(row, "Button states", gap=14, sizingH="fill")
    label(b, left, "Settings button · states")
    st = b.card(left, "States", gap=18, pad=24, effects=SHADOW)
    sr = b.row(st, "Row", gap=28, cross="max")
    for name, state in (("Rest", "rest"), ("Keyboard focus", "focus"), ("Open (settings view)", "active")):
        c = b.col(sr, name, gap=10)
        settings_button(b, c, z, state)
        b.txt(c, name, size=12, color=C["muted"])
    kr = b.row(st, "Shortcut", gap=8)
    for k in ("Ctrl", "+", ","):
        if k == "+":
            b.txt(kr, "+", size=13, color=C["muted"])
            continue
        kb = b.row(kr, f"Key {k}", pad=[3, 8, 3, 8], radius=6, fill=C["sunken"], stroke=C["line"])
        b.txt(kb, k, size=12, style="SemiBold", color=C["ink2"])
    b.txt(kr, "opens settings  ·  ⌘ ,  on macOS  ·  Esc or Back returns, recording carries on", size=13,
          color=C["ink2"])

    right = b.col(row, "Frame 01 card", gap=14, w=400)
    label(b, right, "Frame 01 · Assistant settings (revised)")
    card = b.card(right, "Assistant settings", gap=0, pad=[6, 20, 6, 20], effects=SHADOW)
    tr = b.row(card, "Transcription", gap=12, pad=[14, 0, 14, 0], sizingH="fill")
    tc = b.col(tr, "Label", gap=2, sizingH="fill")
    b.txt(tc, "Transcription", size=14, style="SemiBold", fillW=True)
    b.txt(tc, "On this device · German + English · ggml-base.bin", size=12, color=C["muted"], fillW=True)
    b.txt(tr, "Settings ›", size=13, style="SemiBold", color=C["accent"])
    for h, sub, on in (("Timekeeping", "Nudge at 80% · ask before overrunning", True),
                       ("Capture decisions & to-dos", "Suggest, a person confirms", True),
                       ("Live mind map", "Group by agenda item", True),
                       ("Speaker names", "Match voices to participants", False)):
        o = b.row(card, h, gap=12, pad=[14, 0, 14, 0], sizingH="fill", sides=[1, 0, 0, 0], stroke=C["line"])
        oc = b.col(o, "Label", gap=2, sizingH="fill")
        b.txt(oc, h, size=14, style="SemiBold", fillW=True)
        b.txt(oc, sub, size=12, color=C["muted"], fillW=True)
        tg = b.row(o, "Toggle", w=40, h=24, radius=12, pad=3, fill=C["accent"] if on else C["line"],
                   main="max" if on else "min")
        b.dot(tg, 18, "#FFFFFF", name="Knob")
    b.txt(right, "Per meeting: the switches. Per device (Settings): microphone, models, meeting language. "
                 "The transcription row only shows the device defaults and links to them.",
          size=12, color=C["ink2"], fillW=True, lh="145%")
    return b
