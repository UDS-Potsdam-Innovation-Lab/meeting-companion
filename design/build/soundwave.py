"""Job 007: the SoundWave component and the frame 02 transcript footer that carries it.

Shape: a scrolling level history drawn as mirrored bars (one bar per 100 ms, newest on the right, the
oldest four fade out). Flat states draw a 2 px line instead of bars, so "paused" never looks like a quiet
room. Colours: accent for the live wave, `--muted` for flat lines, red only next to the "Microphone lost" text.
"""
from kit import B, C, DARK, PEOPLE

# Level history, oldest -> newest, 0..1 (scaled RMS, min(1, rms * 4)).
SPEECH = (0.10, 0.32, 0.58, 0.41, 0.83, 0.52, 0.22, 0.47, 0.92, 0.68, 0.36, 0.63, 1.00, 0.74, 0.28, 0.55,
          0.88, 0.59, 0.33, 0.71, 0.45, 0.80, 0.50, 0.26, 0.66, 0.95, 0.60, 0.38, 0.77, 0.54)
SILENCE = (0.06, 0.10, 0.04, 0.13, 0.07, 0.03, 0.09, 0.15, 0.05, 0.04, 0.11, 0.07, 0.03, 0.10, 0.06, 0.14,
           0.04, 0.08, 0.12, 0.05, 0.09, 0.04, 0.13, 0.06, 0.03, 0.10, 0.07, 0.12, 0.05, 0.08)
FADE = ("59", "8C", "BF", "E6")  # alpha of the oldest four bars

# Geometry per size: bars, bar width, gap, height, footer font, footer padding.
SIZES = {
    "wide": dict(n=20, bw=3, gap=2, h=20, fs=12, pad=[12, 20, 12, 20], bpad=(5, 10, 5, 10)),
    "tablet": dict(n=20, bw=3, gap=2, h=20, fs=12, pad=[10, 16, 10, 16], bpad=(5, 10, 5, 10)),
    "phone": dict(n=12, bw=3, gap=2, h=20, fs=12, pad=[10, 12, 10, 12], bpad=(5, 8, 5, 8)),
    "board": dict(n=20, bw=5, gap=3, h=32, fs=16, pad=[16, 28, 16, 28], bpad=(9, 16, 9, 16)),
    "settings": dict(n=30, bw=4, gap=3, h=32, fs=13, pad=None, bpad=None),
}


def dark():
    return C["bg"] == DARK["bg"]


def flat_color():
    """`--muted`: 5.4:1 on the light card, 4.6:1 on sunken; dark muted 5.7:1 / 5.1:1."""
    return DARK["muted"] if dark() else "#676A73"


def width(size):
    g = SIZES[size]
    return g["n"] * g["bw"] + (g["n"] - 1) * g["gap"]


def bars(b, parent, levels, size, name="Sound wave"):
    g = SIZES[size]
    r = b.row(parent, name, gap=g["gap"], w=width(size), h=g["h"], cross="center")
    lv = levels[-g["n"]:]
    for i, l in enumerate(lv):
        hgt = max(2, round(2 + l * (g["h"] - 2)))
        col = C["accent"] + (FADE[i] if i < len(FADE) else "")
        b.rect(r, g["bw"], hgt, col, radius=g["bw"] / 2, name=f"Bar {i + 1}")
    return r


def flat(b, parent, size, dashed=False, name="Sound wave (flat)"):
    g = SIZES[size]
    w = width(size)
    r = b.row(parent, name, gap=g["gap"], w=w, h=g["h"], cross="center")
    if dashed:
        for i in range(g["n"]):
            b.rect(r, g["bw"], 2, flat_color(), radius=1, name=f"Dash {i + 1}")
    else:
        b.rect(r, w, 2, flat_color(), radius=1, name="Line")
    return r


def level_bar(b, parent, level, size, name="Level bar (reduced motion)"):
    """Static horizontal bar: track + value, updated at most 4x a second, no transition."""
    g = SIZES[size]
    w = width(size)
    th = 8 if size in ("board", "settings") else 6
    r = b.row(parent, name, w=w, h=g["h"], cross="center")
    # the settings meter row is already `sunken`, so its track sits on `surface` there
    tf = C["surface"] if size.startswith("settings") else C["sunken"]
    t = b.node("frame", r, name="Track", w=w, h=th, fill=tf, cornerRadius=th / 2, clip=True,
               stroke=C["line"], strokeWeight=1, strokeAlign="inside")
    if level > 0:
        b.rect(t, max(th, round(w * level)), th, C["accent"], radius=th / 2, name="Value")
    return r


def sound_wave(b, parent, state, size):
    """state: speech | silence | paused | nosignal | lost | off | rm_speech | rm_silence | rm_paused | rm_nosignal | rm_lost."""
    if state == "speech":
        return bars(b, parent, SPEECH, size)
    if state == "silence":
        return bars(b, parent, SILENCE, size)
    if state == "nosignal":
        return flat(b, parent, size, dashed=True)
    if state in ("paused", "lost"):
        return flat(b, parent, size)
    if state.startswith("rm_"):
        lv = {"rm_speech": 0.62, "rm_silence": 0.04}.get(state, 0)
        return level_bar(b, parent, lv, size)
    return None


STATUS = {  # state -> (status text, tone)
    "speech": ("Listening", "ok"), "silence": ("Listening", "ok"), "rm_speech": ("Listening", "ok"),
    "rm_silence": ("Listening", "ok"),
    "paused": ("Paused", "paused"), "rm_paused": ("Paused", "paused"),
    "nosignal": ("No signal", "warn"), "rm_nosignal": ("No signal", "warn"),
    "lost": ("Microphone lost", "error"), "rm_lost": ("Microphone lost", "error"),
}


def badge(b, parent, glyph, bg, fg, d, name="Icon"):
    i = b.row(parent, name, w=d, h=d, radius=d / 2, fill=bg, main="center", cross="center")
    b.txt(i, glyph, size=round(d * 0.66), style="Bold", color=fg)
    return i


def status_button(b, parent, state, size, speakers=5):
    """Job 004's "Listening · N speakers" button: the status word comes first, so it changes with the state."""
    g = SIZES[size]
    text, tone = STATUS[state]
    btn = b.row(parent, f"Button {text} · {speakers} speakers", gap=6, pad=list(g["bpad"]), radius=8,
                fill=C["surface"], stroke=C["line"])
    d = g["fs"] + 2
    if tone == "warn":
        badge(b, btn, "!", C["amber"], C["surface"], d)
    elif tone == "error":
        badge(b, btn, "!", C["red"], C["surface"], d)
    col = {"ok": C["ink"], "paused": C["ink2"], "warn": C["ink"], "error": C["red"]}[tone]
    b.txt(btn, text, size=g["fs"], style="SemiBold", color=col, name="Status")
    b.txt(btn, f"· {speakers} speakers", size=g["fs"], color=C["ink2"], name="Speakers")
    b.txt(btn, "›", size=g["fs"] + 2, style="SemiBold", color=C["muted"])
    return btn


def footer(b, parent, state, size="wide"):
    g = SIZES[size]
    f = b.row(parent, "Listening", gap=12 if size == "board" else 10, pad=g["pad"], sizingH="fill",
              sides=[1, 0, 0, 0], stroke=C["line"])
    if not (size == "phone" and state in ("lost", "rm_lost")):
        # 375 px: "Microphone lost · 5 speakers" needs the room; the flat line would add nothing to the red text
        sound_wave(b, f, state, size)
    status_button(b, f, state, size)
    b.spacer(f)
    if size == "phone":
        m = b.row(f, "Button Mark moment (icon)", w=32, h=32, radius=8, fill=C["surface"], stroke=C["line"],
                  main="center", cross="center")
        b.txt(m, "⚑", size=14, style="SemiBold", color=C["ink"])
    elif size == "board":
        b.button(f, "Mark moment", "ghost", size=16, pad=(12, 18, 12, 18), icon="⚑")
    else:
        b.button(f, "Mark moment", "ghost", size=12, pad=(6, 12, 6, 12), icon="⚑")
    return f


# --- transcript card pieces -------------------------------------------------------------------------

def line(b, parent, who, ts, text, fs=15, avatar=30, live=False):
    name, colr = PEOPLE[who]
    r = b.row(parent, f"Line {who}", gap=12, pad=[10, 12, 10, 12], sizingH="fill", cross="min")
    b.avatar(r, who, avatar)
    c = b.col(r, "Text", gap=4, sizingH="fill")
    nr = b.row(c, "Meta", gap=8)
    b.txt(nr, name, size=13, style="SemiBold", color=colr)
    b.txt(nr, "speaking…" if live else ts, size=12, color=C["muted"])
    b.txt(c, text, size=fs, color=C["muted"] if live else C["ink"], fillW=True, lh="150%")
    return r


def error_notice(b, parent, fs=1.0):
    """The existing rec-notice--error of the centre card (TranscriptPanel ErrorNotice)."""
    n = b.col(parent, "Notice: microphone lost", gap=14, pad=[18, 20, 18, 20], radius=12, fill=C["surface"],
              stroke=C["red"], sizingH="fill")
    a = b.col(n, "Alert", gap=4, sizingH="fill")
    b.txt(a, "The microphone stopped working.", size=round(16 * fs), style="SemiBold", fillW=True)
    b.txt(a, "Recording is off.", size=round(13 * fs), color=C["ink2"], fillW=True)
    b.button(n, "Resume recording", "primary", size=round(14 * fs), icon="🎙")
    return n


def snippet_body(b, parent, state, w):
    body = b.col(parent, "Feed (end)", gap=4, pad=[12, 16, 12, 16], sizingH="fill")
    if state in ("lost", "rm_lost"):
        error_notice(b, body)
    elif state in ("speech", "rm_speech"):
        line(b, body, "JR", "", "And the release notes for the schools, should those go out in German only or",
             live=True)
    else:
        line(b, body, "YA", "10:11", "Fine with me, as long as we tell the third school early.")
    return body


# --- frame 02 with the new footer ------------------------------------------------------------------------

def _descendants(cmds, root):
    refs = {root}
    for c in cmds:
        p = c["params"].get("parent")
        if p and p["$ref"] in refs and "as" in c:
            refs.add(c["as"])
    return refs


def live_screen(prefix, name, x, y, w=1280, h=800, theme=None, state="speech", size="wide", toast=False):
    """Frame 02 (s2_live) at another window size, with the SoundWave footer in place of the 12-bar meter."""
    import s2_live
    from kit import themed

    def make():
        b = s2_live.build(x, y)
        fb = B(prefix + "f")
        mid = next(c["as"] for c in b.cmds if c["params"].get("name") == "Transcript" and c["params"].get("parent")
                   and c["params"]["props"].get("layout") == "vertical")
        foot = next(c["as"] for c in b.cmds if c["params"].get("name") == "Listening")
        footer(fb, mid, state, size)
        return b, fb, mid, foot

    if theme:
        with themed(theme):
            b, fb, mid, foot = make()
    else:
        b, fb, mid, foot = make()
    drop = _descendants(b.cmds, foot)
    i = next(k for k, c in enumerate(b.cmds) if c.get("as") == foot)
    cmds = [c for c in b.cmds if c.get("as") not in drop]
    cmds[i:i] = fb.cmds
    if not toast:
        t = next(c["as"] for c in cmds if c["params"].get("name") == "Time nudge")
        gone = _descendants(cmds, t)
        cmds = [c for c in cmds if c.get("as") not in gone]
    for c in cmds:
        p = c["params"]
        if p.get("name") == "Feed":  # keep the newest lines on screen, as the app scrolls
            p["props"].update(clip=True, mainAlign="max")
        if theme:
            pr = p.get("props", {})
            if pr.get("stroke") == "#FFFFFF":
                pr["stroke"] = DARK["surface"]
            if pr.get("fill") == "#F3F2FE":
                pr["fill"] = DARK["accentSoft"]
            if p.get("type") == "text" and pr.get("fill") == PEOPLE["MK"][1]:  # indigo name, 2:1 on dark
                pr["fill"] = DARK["accent"]
    # rename refs so ids.json and the batch stay unique per module
    out = B(prefix)
    for c in cmds:
        if "as" in c:
            c["as"] = c["as"].replace("s2_", prefix, 1) if c["as"].startswith("s2_") else c["as"]
        par = c["params"].get("parent")
        if par and par["$ref"].startswith("s2_"):
            par["$ref"] = par["$ref"].replace("s2_", prefix, 1)
    cmds[0]["params"]["name"] = name
    cmds[0]["params"]["width"] = w
    cmds[0]["params"]["height"] = h
    out.cmds = cmds
    out.named = {"screen": cmds[0]["as"]}
    return out


# --- frame 14 Settings · Audio with the wave ----------------------------------------------------------------

SIZES["settings_phone"] = dict(n=14, bw=3, gap=2, h=32, fs=13, pad=None, bpad=None)


def settings_screen(prefix, name, x, y, reduced=False, **kw):
    """s14_settings.screen() with SoundWave in place of the 12-bar meter (the module is patched only here)."""
    import s14_settings as S
    phone = kw.get("size") == "phone"
    size = "settings_phone" if phone else "settings"

    def meter(b, parent, z, active=True, scale=1.0, name="Level meter"):
        st = ("speech" if scale == 1.0 else "speech") if active else "paused"
        if reduced:
            st = "rm_speech" if active else "rm_paused"
        r = sound_wave(b, parent, st, size)
        b.cmds[_index_of(b, r)]["params"]["name"] = "SoundWave (aria-hidden)"
        return r

    saved = S.meter
    S.meter = meter
    try:
        return S.screen(prefix, name, x, y, **kw)
    finally:
        S.meter = saved


def _index_of(b, ref):
    return next(i for i, c in enumerate(b.cmds) if c.get("as") == ref)
