"""14 Settings (job 006): the app settings view and its states.

`build` draws the main frame (Audio, opened from the live meeting while it records). The sibling modules
s14b_… to s14p_… call `screen()` / the helpers below with another section, state, size or theme.
"""
from kit import B, C, SHADOW, DARK, themed
from s2_live import segmented

APP_DATA = "~/.local/share/de.udspotsdam.meetingcompanion"
DEVICES = [
    ("System default", "Built-in Audio Analog Stereo"),
    ("Jabra Speak 510", "USB"),
    ("Built-in Audio Analog Stereo", "Laptop"),
    ("Logitech BRIO", "USB · camera"),
]
SECTIONS = [
    ("Audio", "🎙", "Microphone, test, when it disappears"),
    ("On this device", "🖥", "Models, meeting language, storage"),
    ("General", "⚙", "App language, theme"),
]
METER = (6, 10, 16, 22, 14, 26, 18, 12, 20, 9, 14, 7)


class Z:
    """Sizes per window class: wide (1280–1440), board (1920×1080, 48 px targets), tablet (768), phone (375)."""

    def __init__(self, size):
        self.size = size
        self.narrow = size in ("tablet", "phone")
        self.k = 1.2 if size == "board" else 1.0

    def f(self, n):
        return round(n * self.k)

    @property
    def btn(self):  # (font size, padding) of buttons
        return (16, (15, 22, 15, 22)) if self.size == "board" else (13, (9, 14, 9, 14))


# --- small controls ------------------------------------------------------------------------------

def radio_dot(b, parent, on, z):
    d = z.f(18)
    r = b.row(parent, "Radio", w=d, h=d, radius=d / 2, main="center", cross="center", fill=C["surface"],
              stroke=C["accent"] if on else C["muted"], strokeWeight=2 if on else 1.5)
    if on:
        b.dot(r, z.f(9), C["accent"], name="Checked")
    return r


def radio_option(b, parent, label, hint, on, z, fillW=True, extra=None, name=None, stretch=False):
    o = b.row(parent, name or f"Option {label}", gap=12, pad=[z.f(12), z.f(14), z.f(12), z.f(14)], radius=12,
              fill=C["accentSoft"] if on else C["surface"], stroke=C["accent"] if on else C["line"],
              cross="min", sizingH="fill" if fillW else None, sizingV="fill" if stretch else None)
    radio_dot(b, o, on, z)
    c = b.col(o, "Label", gap=2, sizingH="fill")
    b.txt(c, label, size=z.f(14), style="SemiBold", fillW=True)
    if hint:
        b.txt(c, hint, size=z.f(12), color=C["ink2"] if on else C["muted"], fillW=True, lh="140%")
    if extra:
        extra(c)
    return o


def select(b, parent, icon, title, sub, z, state="ok", name="Select", w=None):
    stroke = {"ok": C["line"], "open": C["accent"], "missing": C["red"], "gone": C["amber"]}[state]
    s = b.row(parent, name, gap=12, pad=[z.f(10), z.f(14), z.f(10), z.f(12)], radius=10, fill=C["surface"],
              stroke=stroke, sizingH=None if w else "fill", w=w,
              effects=[{"type": "dropShadow", "color": C["accent"] + "33", "offset": [0, 0], "radius": 0, "spread": 3}]
              if state == "open" else None)
    if icon:
        ic = b.row(s, "Icon", w=z.f(32), h=z.f(32), radius=8, main="center", cross="center",
                   fill=C["redSoft"] if state == "missing" else C["sunken"])
        b.txt(ic, icon, size=z.f(15), color=C["ink2"])
    c = b.col(s, "Value", gap=1, sizingH="fill")
    b.txt(c, title, size=z.f(14), style="SemiBold", fillW=True)
    if sub:
        col = {"missing": C["red"], "gone": C["amber"]}.get(state, C["muted"])
        b.txt(c, sub, size=z.f(12), color=col, fillW=True, style="SemiBold" if state in ("missing", "gone") else "Regular")
    b.txt(s, "▴" if state == "open" else "▾", size=z.f(13), color=C["muted"])
    return s


def meter(b, parent, z, active=True, scale=1.0, name="Level meter"):
    m = b.row(parent, name, gap=z.f(3), h=z.f(30), cross="center")
    for i, hgt in enumerate(METER):
        h = max(4, round(hgt * scale * z.k)) if active else 4
        b.rect(m, z.f(4), h, C["accent"] if active else C["line"], radius=2, name=f"Bar {i + 1}")
    return m


def disabled_button(b, parent, label, z, icon=None):
    fs, pad = z.btn
    d = b.row(parent, f"Button {label} (disabled)", gap=8, pad=list(pad), fill=C["sunken"], radius=10,
              main="center", stroke=C["line"])
    if icon:
        b.txt(d, icon, size=fs, style="SemiBold", color=C["muted"])
    b.txt(d, label, size=fs, style="SemiBold", color=C["muted"])
    return d


def info(b, parent, icon, text, z, tone="neutral", sub=None, name="Notice"):
    fg, bg = {"neutral": (C["ink2"], C["sunken"]), "accent": (C["accentInk"], C["accentSoft"]),
              "red": (C["red"], C["redSoft"]), "amber": (C["amber"], C["amberSoft"])}[tone]
    n = b.row(parent, name, gap=10, pad=[z.f(10), z.f(12), z.f(10), z.f(12)], radius=10, fill=bg, sizingH="fill",
              cross="min")
    ic = b.row(n, "Icon", w=z.f(18), h=z.f(18), radius=z.f(9), main="center", cross="center",
               fill=fg if tone != "neutral" else C["ink2"])
    b.txt(ic, icon, size=z.f(11), style="Bold", color=bg)
    c = b.col(n, "Text", gap=2, sizingH="fill")
    b.txt(c, text, size=z.f(13), style="Regular" if tone == "neutral" else "SemiBold",
          color=fg if tone != "neutral" else C["ink"], fillW=True, lh="140%")
    if sub:
        b.txt(c, sub, size=z.f(12), color=C["ink2"], fillW=True, lh="140%")
    return n


def card_head(b, card, title, hint, z, right=None):
    stack = right is not None and z.size == "phone"  # 375 px: the chip goes under the text, not beside it
    h = (b.col(card, "Head", gap=8, sizingH="fill") if stack
         else b.row(card, "Head", gap=12, sizingH="fill", cross="min"))
    c = b.col(h, "Title", gap=3, sizingH="fill")
    b.txt(c, title, size=z.f(16), style="SemiBold", fillW=True)
    if hint:
        b.txt(c, hint, size=z.f(13), color=C["ink2"], fillW=True, lh="145%")
    if right:
        right(h)
    return h


def setting_row(b, card, label, hint, z, first=True):
    """Label left, control right (wide); stacked (narrow). Returns the control column."""
    side = {} if first else {"sides": [1, 0, 0, 0], "stroke": C["line"]}
    if z.narrow:
        r = b.col(card, label, gap=10, pad=[z.f(14), 0, z.f(4), 0], sizingH="fill", **side)
    else:
        r = b.row(card, label, gap=24, pad=[z.f(16), 0, z.f(4), 0], sizingH="fill", cross="min", **side)
    lc = b.col(r, "Label", gap=3, sizingH="fill" if z.narrow else None, w=None if z.narrow else z.f(250))
    b.txt(lc, label, size=z.f(14), style="SemiBold", fillW=True)
    if hint:
        b.txt(lc, hint, size=z.f(12), color=C["muted"], fillW=True, lh="140%")
    return b.col(r, "Control", gap=10, sizingH="fill")


# --- top bars --------------------------------------------------------------------------------------

def lang_switch(b, parent, z):
    return segmented(b, parent, ["DE", "EN"], "EN")


def settings_button(b, parent, z, state="rest", key=None):
    fs, pad = z.btn
    if state == "active":
        return b.button(parent, "Settings", "soft", size=fs, pad=pad, icon="⚙", key=key, name="Button Settings (open)")
    btn = b.button(parent, "Settings", "ghost", size=fs, pad=pad, icon="⚙", key=key)
    if state == "focus":
        b.cmds[-1 - 2]["params"]["props"]["effects"] = [
            {"type": "dropShadow", "color": C["surface"], "offset": [0, 0], "radius": 0, "spread": 2},
            {"type": "dropShadow", "color": C["accent"], "offset": [0, 0], "radius": 0, "spread": 4}]
        b.cmds[-1 - 2]["params"]["props"]["stroke"] = C["accent"]
        b.cmds[-1 - 2]["params"]["name"] = "Button Settings (keyboard focus)"
    return btn


def bar_live(b, s, z, title, settings="active", back=True, elapsed="00:23:41"):
    fs, pad = z.btn
    t = b.topbar(s, title)
    b.chip(t, f"REC  {elapsed}", C["red"], C["redSoft"], dot=C["red"], size=z.f(12))
    if not z.narrow:
        b.chip(t, "On-device · DE/EN", C["ink2"], C["sunken"], style="Regular", size=z.f(12))
    lang_switch(b, t, z)
    settings_button(b, t, z, settings)
    if back:
        b.button(t, "Back to meeting", "dark", size=fs, pad=pad, icon="‹", key="back")
    return t


def bar_setup(b, s, z, title, settings="active", back=True):
    fs, pad = z.btn
    t = b.topbar(s, title)
    if not z.narrow:
        b.chip(t, "On-device · DE/EN", C["ink2"], C["sunken"], style="Regular", size=z.f(12))
    lang_switch(b, t, z)
    settings_button(b, t, z, settings)
    if back:
        b.button(t, "Back to setup", "dark", size=fs, pad=pad, icon="‹", key="back")
    else:
        b.avatar(t, "MK", 30)
    return t


def bar_phone(b, s, z, origin):
    t = b.col(s, "Top bar", gap=10, pad=[12, 16, 12, 16], fill=C["surface"], sizingH="fill",
              sides=[0, 0, 1, 0], stroke=C["line"])
    r1 = b.row(t, "Row 1", gap=10, sizingH="fill")
    mark = b.row(r1, "Mark", w=28, h=28, radius=8, fill=C["accent"], main="center", cross="center")
    b.txt(mark, "◆", size=13, style="Bold", color=C.get("onAccent", "#FFFFFF"))
    b.txt(r1, "Settings", size=16, style="Bold")
    b.spacer(r1)
    if origin == "live":
        b.chip(r1, "REC  23:41", C["red"], C["redSoft"], dot=C["red"])
    r2 = b.row(t, "Row 2", gap=8, sizingH="fill")
    b.button(r2, "Back to meeting" if origin == "live" else "Back to setup", "dark", size=13, pad=(8, 12, 8, 12),
             icon="‹", key="back")
    b.spacer(r2)
    lang_switch(b, r2, z)
    return t


# --- section bodies ---------------------------------------------------------------------------------

def audio(b, body, z, state):
    """state: recording | test | idle | missing | open (device list open)."""
    dev, kind = ("Jabra Speak 510", "USB")
    c1 = b.card(body, "Microphone", gap=4, pad=[z.f(20), z.f(22), z.f(14), z.f(22)], effects=SHADOW)
    card_head(b, c1, "Microphone", "The meeting records from this device. The list shows what is connected now.", z)
    ctl = setting_row(b, c1, "Input device", "“System default” follows the system’s choice.", z)
    if state == "missing":
        select(b, ctl, "🎙", dev, "Not connected", z, state="missing")
        info(b, ctl, "!", "Jabra Speak 510 is not connected",
             z, tone="red", sub="Meetings will not start on another microphone by themselves. Connect it again, "
                                 "or use the system default (Built-in Audio Analog Stereo).")
        ar = b.row(ctl, "Actions", gap=8)
        fs, pad = z.btn
        b.button(ar, "Use system default", "primary", size=fs, pad=pad)
    elif state == "open":
        select(b, ctl, "🎙", dev, f"{kind} · chosen", z, state="open")
        lst = b.col(ctl, "Device list", gap=2, pad=6, radius=12, fill=C["surface"], stroke=C["line"],
                    sizingH="fill", effects=SHADOW)
        for i, (n, sub) in enumerate(DEVICES):
            on = n == dev
            r = b.row(lst, f"Device {n}", gap=12, pad=[z.f(10), 12, z.f(10), 12], radius=8, sizingH="fill",
                      fill=C["accentSoft"] if on else "none", h=56 if z.size == "board" else None)
            b.txt(r, "✓" if on else "", size=z.f(14), style="Bold", color=C["accent"], w=z.f(14))
            cc = b.col(r, "Text", gap=1, sizingH="fill")
            b.txt(cc, n, size=z.f(14), style="SemiBold", color=C["accentInk"] if on else C["ink"], fillW=True)
            b.txt(cc, sub, size=z.f(12), color=C["ink2"] if on else C["muted"], fillW=True)
            if i == 0:
                b.chip(r, "first", C["ink2"], C["sunken"], size=z.f(11), style="Regular")
    else:
        sub = f"{kind} · in use by this recording" if state == "recording" else f"{kind} · connected"
        select(b, ctl, "🎙", dev, sub, z)
        if state == "recording":
            info(b, ctl, "i", "A different device applies at the next Start or Resume.", z, tone="neutral")

    # level + test
    c2 = b.card(body, "Level and test", gap=4, pad=[z.f(20), z.f(22), z.f(16), z.f(22)], effects=SHADOW)
    if state == "test":
        def right(h):
            b.chip(h, "Microphone test running", C["accentInk"], C["accentSoft"], dot=C["accent"], size=z.f(12))
        card_head(b, c2, "Level and test", "Opens the microphone for up to 10 seconds. Nothing is recorded, "
                                           "transcribed or kept.", z, right=right)
    else:
        card_head(b, c2, "Level and test", "Opens the microphone for up to 10 seconds. Nothing is recorded, "
                                           "transcribed or kept.", z)
    ctl = setting_row(b, c2, "Level", {
        "recording": "Shows the running recording.",
        "test": "Speak at your normal volume.",
    }.get(state, "Moves while a test runs."), z)
    mr = b.row(ctl, "Meter row", gap=14, pad=[z.f(10), 14, z.f(10), 14], radius=10, fill=C["sunken"], sizingH="fill")
    active = state in ("recording", "test")
    meter(b, mr, z, active=active, scale=0.9 if state == "recording" else 1.0)
    if state == "recording":
        b.txt(mr, "Recording · Jabra Speak 510", size=z.f(13), color=C["ink2"], fillW=True)
    elif state == "test":
        b.txt(mr, "Jabra Speak 510", size=z.f(13), color=C["ink2"], fillW=True)
        b.txt(mr, "0:07 left", size=z.f(14), style="SemiBold", color=C["accentInk"], features={"tnum": True})
    else:
        b.txt(mr, "No test running", size=z.f(13), color=C["muted"], fillW=True)
    if state == "test":
        b.progress(ctl, 420, 0.3, C["accent"], h=4, name="Countdown")
        b.cmds[-2]["params"]["props"]["sizingH"] = "fill"
    ar = b.row(ctl, "Test", gap=12, sizingH="fill", wrap=z.narrow, crossGap=8)
    fs, pad = z.btn
    if state == "recording":
        disabled_button(b, ar, "Test microphone", z, icon="▶")
        b.txt(ar, "Not available while the meeting records or is paused.", size=z.f(12), color=C["ink2"],
              fillW=True)
    elif state == "missing":
        disabled_button(b, ar, "Test microphone", z, icon="▶")
        b.txt(ar, "Connect Jabra Speak 510 or choose another device to test.", size=z.f(12), color=C["ink2"],
              fillW=True)
    elif state == "test":
        b.button(ar, "Stop test", "ghost", size=fs, pad=pad, icon="■")
        b.txt(ar, "Stops by itself after 10 s or when you leave this view.", size=z.f(12), color=C["muted"],
              fillW=True)
    else:
        b.button(ar, "Test microphone", "ghost", size=fs, pad=pad, icon="▶")

    # device lost
    c3 = b.card(body, "When the microphone disappears", gap=12, pad=[z.f(20), z.f(22), z.f(20), z.f(22)],
                effects=SHADOW)
    card_head(b, c3, "When the microphone disappears", None, z)
    grp = b.box(c3, "Radio group", dir="vertical" if z.narrow else "horizontal", gap=12, sizingH="fill", cross="min")
    radio_option(b, grp, "Stop recording and tell me", "The meeting shows what happened and how to go on.", True, z)
    radio_option(b, grp, "Switch to the system default",
                 "Recording carries on with a notice. It may hear a different room.", False, z)


SPEECH = [
    ("ggml-base.bin", "148 MB", "German and English", "Voxtype", "~/.local/share/voxtype/models", False),
    ("ggml-base.en.bin", "148 MB", "English only", "Voxtype", "~/.local/share/voxtype/models", True),
    ("ggml-large-v3-turbo-q5_0.bin", "574 MB", "German and English", "whisper.cpp", "/usr/share/whisper.cpp/models", False),
]
SEARCHED = [
    (f"{APP_DATA}/models", "Meeting Companion"),
    ("~/.local/share/voxtype/models", "Voxtype"),
    ("~/whisper.cpp/models", "whisper.cpp"),
    ("/usr/share/whisper.cpp/models", "whisper.cpp"),
    ("/usr/local/share/whisper.cpp/models", "whisper.cpp"),
    ("~/.local/share/pywhispercpp/models", "pywhispercpp"),
    ("~/.cache/Buzz/models", "Buzz"),
    ("~/.cache/huggingface/hub", "Hugging Face"),
]


def folders(b, parent, rows, z):
    fl = b.col(parent, "Searched folders", gap=4, sizingH="fill")
    for path, src in rows:
        r = b.row(fl, path, gap=8, sizingH="fill")
        b.txt(r, path, size=12, color=C["muted"], fillW=True)
        b.txt(r, src, size=12, color=C["muted"])
    return fl


def device(b, body, z, state):
    """state: found | none."""
    c1 = b.card(body, "Speech model", gap=4, pad=[z.f(20), z.f(22), z.f(18), z.f(22)], effects=SHADOW)
    card_head(b, c1, "Speech model", "whisper.cpp models already on this device. Nothing is downloaded.", z)
    ctl = setting_row(b, c1, "Transcribe with", "Used from the next Start or Resume.", z)
    if state == "found":
        for name, size, lang, src, folder, en in SPEECH:
            on = name == "ggml-base.bin"

            def extra(c, en=en, folder=folder):
                b.txt(c, f"Found in {folder}", size=12, color=C["muted"], fillW=True)
                if en:
                    rr = b.row(c, "English-only hint", gap=6, pad=[4, 8, 4, 8], radius=6, fill=C["amberSoft"])
                    b.txt(rr, "EN only", size=11, style="Bold", color=C["amber"])
                    b.txt(rr, "This model only understands English. Choose a multilingual model for German.",
                          size=12, color=C["ink"])
            radio_option(b, ctl, name, f"{size} · {lang} · {src}", on, z, extra=extra)
    else:
        e = b.col(ctl, "No model", gap=8, pad=[14, 16, 14, 16], radius=12, fill=C["sunken"], sizingH="fill")
        b.txt(e, "No speech model installed", size=z.f(14), style="SemiBold", fillW=True)
        b.txt(e, "The app looks for whisper.cpp models (ggml-….bin) in these folders:", size=z.f(13),
              color=C["ink2"], fillW=True)
        folders(b, e, SEARCHED, z)

    c2 = b.card(body, "Speaker model", gap=4, pad=[z.f(20), z.f(22), z.f(18), z.f(22)], effects=SHADOW)
    card_head(b, c2, "Speaker model", "Tells voices apart so names can be matched. Optional.", z)
    ctl = setting_row(b, c2, "Tell voices apart with", "Used from the next Start or Resume.", z)
    if state == "found":
        select(b, ctl, "◎", "wespeaker_en_voxceleb_resnet34.onnx", "Not found any more", z, state="gone")
        info(b, ctl, "!", "The chosen model was moved or deleted.", z, tone="amber",
             sub="Until you choose again, the app uses 3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx "
                 "(27 MB · Meeting Companion).")
    else:
        e = b.col(ctl, "No model", gap=8, pad=[14, 16, 14, 16], radius=12, fill=C["sunken"], sizingH="fill")
        b.txt(e, "No speaker model found on this device", size=z.f(14), style="SemiBold", fillW=True)
        b.txt(e, "Lines can still be given names one by one. The app looked in:", size=z.f(13), color=C["ink2"],
              fillW=True)
        folders(b, e, [(f"{APP_DATA}/models", "Meeting Companion"), ("~/.cache/huggingface/hub", "Hugging Face")], z)

    c3 = b.card(body, "Default meeting language", gap=12, pad=[z.f(20), z.f(22), z.f(20), z.f(22)], effects=SHADOW)

    def chip(h):
        b.chip(h, "On-device · DE/EN", C["ink2"], C["sunken"], style="Regular", size=z.f(12))
    card_head(b, c3, "Default meeting language", "The language hint for new recordings. Mixed meetings keep "
                                                 "“German + English”.", z, right=chip)
    grp = b.box(c3, "Radio group", dir="vertical" if z.narrow else "horizontal", gap=12, sizingH="fill", cross="min")
    radio_option(b, grp, "German + English", "Detect per line", True, z)
    radio_option(b, grp, "German", "Every line as German", False, z)
    radio_option(b, grp, "English", "Every line as English", False, z)

    c4 = b.card(body, "Storage", gap=4, pad=[z.f(20), z.f(22), z.f(18), z.f(22)], effects=SHADOW)
    card_head(b, c4, "Storage", None, z)
    ctl = setting_row(b, c4, "Meetings and transcripts", "Encrypted on this device. Audio is never written.", z)
    p = b.row(ctl, "Path (read-only, selectable)", pad=[z.f(10), 12, z.f(10), 12], radius=10, fill=C["sunken"],
              sizingH="fill")
    b.txt(p, f"{APP_DATA}/meetings", size=z.f(13), color=C["ink"], fillW=True)


def theme_tile(b, parent, label, sub, mode, on, z):
    t = b.col(parent, f"Theme {label}", gap=10, pad=12, radius=12, sizingH="fill",
              fill=C["accentSoft"] if on else C["surface"], stroke=C["accent"] if on else C["line"])
    pv = b.row(t, "Preview", h=z.f(64), radius=8, sizingH="fill", clip=True, stroke=C["line"], gap=0)
    halves = {"light": ["light"], "dark": ["dark"], "system": ["light", "dark"]}[mode]
    for half in halves:
        bgc, card, ink = ("#F5F4F0", "#FFFFFF", "#17181C") if half == "light" else (DARK["bg"], DARK["surface"], DARK["ink"])
        h = b.col(pv, f"Preview {half}", gap=5, pad=8, fill=bgc, sizingH="fill", sizingV="fill")
        b.rect(h, 34, 5, ink, radius=3, name="Line")
        cd = b.col(h, "Card", gap=4, pad=6, radius=5, fill=card, sizingH="fill")
        b.rect(cd, 28, 4, "#8F88FF" if half == "dark" else "#4338CA", radius=2, name="Accent")
        b.rect(cd, 40, 4, "#9396A0" if half == "dark" else "#8A8D96", radius=2, name="Muted")
    lr = b.row(t, "Label", gap=10, sizingH="fill")
    radio_dot(b, lr, on, z)
    lc = b.col(lr, "Text", gap=1, sizingH="fill")
    b.txt(lc, label, size=z.f(14), style="SemiBold", fillW=True)
    b.txt(lc, sub, size=z.f(12), color=C["ink2"] if on else C["muted"], fillW=True)
    return t


def general(b, body, z, theme="system"):
    c1 = b.card(body, "App language", gap=12, pad=[z.f(20), z.f(22), z.f(20), z.f(22)], effects=SHADOW)
    card_head(b, c1, "App language", "The same switch as DE / EN in the top bar.", z)
    grp = b.box(c1, "Radio group", dir="vertical" if z.narrow else "horizontal", gap=12, sizingH="fill", cross="min")
    radio_option(b, grp, "Deutsch", "Menüs und Hinweise auf Deutsch", False, z)
    radio_option(b, grp, "English", "Menus and hints in English", True, z)

    c2 = b.card(body, "Theme", gap=12, pad=[z.f(20), z.f(22), z.f(20), z.f(22)], effects=SHADOW)
    card_head(b, c2, "Theme", None, z)
    grp = b.box(c2, "Radio group", dir="vertical" if z.size == "phone" else "horizontal", gap=12, sizingH="fill",
                cross="min")
    now = "dark" if theme == "dark" else "light"
    theme_tile(b, grp, "Light", "Warm paper", "light", theme == "light", z)
    theme_tile(b, grp, "Dark", "For dim rooms and evenings", "dark", theme == "dark", z)
    theme_tile(b, grp, "System", f"Follows the system · now {now}", "system", theme == "system", z)


# --- screen ------------------------------------------------------------------------------------------

def nav(b, parent, active, z):
    n = b.col(parent, "Section list", gap=4, w=z.f(264))
    b.txt(n, "Settings", size=z.f(28), style="Bold", ls=-0.5)
    b.txt(n, "Changes apply at once and stay on this device.", size=z.f(13), color=C["ink2"], fillW=True, lh="145%")
    sp = b.node("frame", n, name="Gap", w=10, h=z.f(12), fill="none")
    for label, icon, sub in SECTIONS:
        on = label == active
        r = b.row(n, f"Section {label}", gap=12, pad=[z.f(11), 12, z.f(11), 12], radius=12, sizingH="fill",
                  fill=C["surface"] if on else "none", stroke=C["line"] if on else None,
                  effects=SHADOW if on else None)
        bar = b.rect(r, 3, z.f(30), C["accent"] if on else "#00000000", radius=2, name="Active marker")
        ic = b.row(r, "Icon", w=z.f(34), h=z.f(34), radius=9, main="center", cross="center",
                   fill=C["accentSoft"] if on else C["sunken"])
        b.txt(ic, icon, size=z.f(15), color=C["accentInk"] if on else C["ink2"])
        c = b.col(r, "Text", gap=1, sizingH="fill")
        b.txt(c, label, size=z.f(15), style="SemiBold", color=C["ink"] if on else C["ink2"], fillW=True)
        b.txt(c, sub, size=z.f(12), color=C["muted"], fillW=True)
    return n


def tabs(b, parent, active, z):
    sg = b.row(parent, "Section tabs", gap=2, pad=3, fill=C["sunken"], radius=12, sizingH="fill")
    for label, icon, _ in SECTIONS:
        on = label == active
        t = b.row(sg, f"Tab {label}", gap=6, pad=[10, 8, 10, 8], radius=9, sizingH="fill", main="center",
                  fill=C["surface"] if on else "none",
                  effects=[{"type": "dropShadow", "color": "#00000014", "offset": [0, 1], "radius": 2}] if on else None)
        b.txt(t, label, size=13, style="SemiBold", color=C["ink"] if on else C["ink2"])
    return sg


def screen(prefix, name, x, y, w=1440, h=900, section="Audio", state="recording", size="wide", origin="live",
           theme=None, gtheme="system"):
    b = B(prefix)
    z = Z(size)

    def draw():
        s = b.col(None, name, w=w, h=h, fill=C["bg"], x=x, y=y, clip=True, key="screen")
        if size == "phone":
            bar_phone(b, s, z, origin)
        elif origin == "live":
            bar_live(b, s, z, "Product sync · Beta launch" if not z.narrow else "Product sync")
        else:
            bar_setup(b, s, z, "New meeting")
        if z.narrow:
            pad = [16, 16, 24, 16] if size == "phone" else [24, 28, 28, 28]
            body = b.col(s, "Body", gap=14, pad=pad, sizingH="fill", sizingV="fill")
            hd = b.col(body, "Heading", gap=4, sizingH="fill")
            if size != "phone":
                b.txt(hd, "Settings", size=26, style="Bold", ls=-0.5)
            b.txt(hd, "Changes apply at once and stay on this device.", size=13, color=C["ink2"], fillW=True)
            tabs(b, body, section, z)
            content = b.col(body, section, gap=14, sizingH="fill")
        else:
            gap = z.f(32)
            body = b.row(s, "Body", gap=gap, pad=[z.f(28), z.f(32), z.f(28), z.f(32)], sizingH="fill",
                         sizingV="fill", cross="min")
            nav(b, body, section, z)
            content = b.col(body, section, gap=z.f(16), sizingH="fill")
        sec = {"Audio": lambda: audio(b, content, z, state),
               "On this device": lambda: device(b, content, z, state),
               "General": lambda: general(b, content, z, gtheme)}
        sec[section]()
        return s

    if theme:
        with themed(theme):
            draw()
    else:
        draw()
    return b


def build(x=0, y=0):
    return screen("s14_", "14 Settings · Audio · while recording", x, y, section="Audio", state="recording",
                  origin="live")
