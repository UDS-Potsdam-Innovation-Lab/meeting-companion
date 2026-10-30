"""02 add: start failed because the chosen microphone is missing (chosenMicrophoneMissing)."""
from kit import B, C, SHADOW
from s2_live import segmented
from s14_settings import Z, settings_button


def build(x=0, y=0):
    b = B("s14n_")
    z = Z("wide")
    s = b.col(None, "02 add · chosen microphone missing at start", w=1180, h=600, fill=C["bg"], x=x, y=y, clip=True,
              key="screen")
    t = b.topbar(s, "Product sync · Beta launch")
    b.chip(t, "Not recording", C["ink2"], C["sunken"], dot=C["muted"])
    b.chip(t, "On-device · DE/EN", C["ink2"], C["sunken"], style="Regular")
    settings_button(b, t, z, "rest")
    b.button(t, "End meeting", "dark", size=13, pad=(8, 14, 8, 14))
    body = b.col(s, "Body", pad=[20, 24, 20, 24], sizingH="fill", sizingV="fill")
    mid = b.card(body, "Transcript", pad=0, gap=0, sizingV="fill", effects=SHADOW)
    mh = b.row(mid, "Header", gap=12, pad=[14, 20, 14, 20], sizingH="fill", sides=[0, 0, 1, 0], stroke=C["line"])
    segmented(b, mh, ["Transcript", "Mind map", "Notes"], "Transcript")
    st = b.col(mid, "State: chosen microphone missing", gap=14, pad=40, sizingH="fill", sizingV="fill",
               main="center", cross="center")
    ic = b.row(st, "Icon", w=56, h=56, radius=28, fill=C["redSoft"], main="center", cross="center")
    b.txt(ic, "🎙", size=24)
    b.txt(st, "Jabra Speak 510 is not connected", size=22, style="Bold", align="center")
    b.txt(st, "The recording did not start. It does not switch to another microphone by itself.", size=15,
          color=C["ink2"], align="center", w=520)
    br = b.row(st, "Actions", gap=10)
    b.button(br, "Use system default", "primary", size=14, icon="●", key="use_default")
    b.button(br, "Settings", "ghost", size=14, icon="⚙")
    b.txt(st, "System default: Built-in Audio Analog Stereo. Recording starts right away.", size=12,
          color=C["muted"], align="center")
    return b
