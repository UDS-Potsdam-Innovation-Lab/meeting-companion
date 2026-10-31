"""Settings view with more sections (jobs 010, 011, 014): a generic `screen()` on top of s14_settings.

s14_settings.screen() knows three sections. This one takes the section list and a content callback, so the
Language model (011) and Voice profiles (010) sections and the Help & legal link (014) reuse the same nav,
tabs, cards and top bars. At 375 px the tabs wrap into a 2-column grid (four or five sections no longer fit
in one row); at 768 they stay one row.
"""
from kit import B, C, SHADOW, DARK, themed
import s14_settings as S
from s14_settings import Z, card_head, setting_row, info, select, radio_option, radio_dot, disabled_button, folders

SEC_AUDIO = ("Audio", "🎙", "Microphone, test, when it disappears")
SEC_DEVICE = ("On this device", "🖥", "Models, meeting language, storage")
SEC_LLM = ("Language model", "✦", "Engine, Claude API key, test")
SEC_VOICES = ("Voice profiles", "◉", "Remembered voices, who agreed")
SEC_GENERAL = ("General", "⚙", "App language, theme")

SECTIONS_011 = [SEC_AUDIO, SEC_DEVICE, SEC_LLM, SEC_GENERAL]
SECTIONS_ALL = [SEC_AUDIO, SEC_DEVICE, SEC_LLM, SEC_VOICES, SEC_GENERAL]


# --- small parts ------------------------------------------------------------------------------------------

def toggle(b, parent, on, z, name=None, focus=False):
    w, h, d = z.f(44), z.f(26), z.f(20)
    t = b.row(parent, name or ("Switch on" if on else "Switch off"), w=w, h=h, radius=h / 2, pad=3,
              fill=C["accent"] if on else C["muted"], main="max" if on else "min",
              effects=[{"type": "dropShadow", "color": C["surface"], "offset": [0, 0], "radius": 0, "spread": 2},
                       {"type": "dropShadow", "color": C["accent"], "offset": [0, 0], "radius": 0, "spread": 4}]
              if focus else None)
    b.dot(t, d, C["surface"] if C["bg"] == DARK["bg"] and on else "#FFFFFF", name="Knob")
    return t


def link(b, parent, text, z, size=None):
    return b.txt(parent, text, size=size or z.f(13), style="SemiBold", color=C["accentInk"] if C["bg"] == DARK["bg"]
                 else C["accent"], textDecoration="underline", name=f"Link {text[:24]}")


def field(b, parent, z, text, state="empty", name="Field"):
    """A text/password input. state: empty | typing | filled | invalid | disabled."""
    stroke = {"empty": C["line"], "typing": C["accent"], "filled": C["line"], "invalid": C["red"],
              "disabled": C["line"]}[state]
    fx = None
    if state == "typing":
        fx = [{"type": "dropShadow", "color": C["accent"] + "33", "offset": [0, 0], "radius": 0, "spread": 3}]
    f = b.row(parent, name, gap=8, pad=[z.f(11), z.f(12), z.f(11), z.f(12)], radius=10, sizingH="fill",
              fill=C["sunken"] if state == "disabled" else C["surface"], stroke=stroke, effects=fx)
    if state == "invalid":
        b.cmds[-1]["params"]["props"]["strokeWeight"] = 2
    col = C["muted"] if state in ("empty", "disabled") else C["ink"]
    b.txt(f, text, size=z.f(14), color=col, fillW=True, ls=1 if text.startswith("•") else None)
    if state == "typing":
        b.rect(f, 2, z.f(18), C["accent"], name="Caret")
    return f


def status(b, parent, glyph, text, fg, bg, z, name=None):
    """A status chip whose glyph + word carry the meaning (not the colour alone)."""
    c = b.row(parent, name or f"Status {text}", gap=6, pad=[z.f(4), z.f(10), z.f(4), z.f(8)], radius=999, fill=bg)
    b.txt(c, glyph, size=z.f(12), style="Bold", color=fg)
    b.txt(c, text, size=z.f(12), style="SemiBold", color=fg)
    return c


def btn(b, parent, label, kind, z, icon=None, name=None, fillW=False):
    fs, pad = z.btn
    return b.button(parent, label, kind, size=fs, pad=pad, icon=icon, name=name, fillW=fillW)


def actions(b, parent, z, name="Actions"):
    if z.size == "phone":
        return b.col(parent, name, gap=8, sizingH="fill")
    return b.row(parent, name, gap=z.f(8), wrap=z.narrow, crossGap=8, sizingH="fill" if z.narrow else None)


# --- nav / tabs -----------------------------------------------------------------------------------------------

def nav(b, parent, sections, active, z, help_link=False):
    n = b.col(parent, "Section list", gap=4, w=z.f(264))
    b.txt(n, "Settings", size=z.f(28), style="Bold", ls=-0.5)
    b.txt(n, "Changes apply at once and stay on this device.", size=z.f(13), color=C["ink2"], fillW=True, lh="145%")
    b.node("frame", n, name="Gap", w=10, h=z.f(12), fill="none")
    for label, icon, sub in sections:
        on = label == active
        r = b.row(n, f"Section {label}", gap=12, pad=[z.f(11), 12, z.f(11), 12], radius=12, sizingH="fill",
                  fill=C["surface"] if on else "none", stroke=C["line"] if on else None,
                  effects=SHADOW if on else None)
        b.rect(r, 3, z.f(30), C["accent"] if on else "#00000000", radius=2, name="Active marker")
        ic = b.row(r, "Icon", w=z.f(34), h=z.f(34), radius=9, main="center", cross="center",
                   fill=C["accentSoft"] if on else C["sunken"])
        b.txt(ic, icon, size=z.f(15), color=C["accentInk"] if on else C["ink2"])
        c = b.col(r, "Text", gap=1, sizingH="fill")
        b.txt(c, label, size=z.f(15), style="SemiBold", color=C["ink"] if on else C["ink2"], fillW=True)
        b.txt(c, sub, size=z.f(12), color=C["muted"], fillW=True)
    if help_link:
        help_entry(b, n, z)
    return n


def help_entry(b, parent, z, compact=False):
    """Job 014: the link from Settings to Help & legal, under the section list (not a section of its own)."""
    sep = b.col(parent, "Help & legal link", gap=6, pad=[z.f(14), 0, 0, 0], sizingH="fill",
                sides=[1, 0, 0, 0], stroke=C["line"])
    if compact:
        sep = b.col(parent, "Help & legal link", gap=6, sizingH="fill")
    r = b.row(sep, "Link Help & legal", gap=12, pad=[z.f(11), 12, z.f(11), 15], radius=12, sizingH="fill",
              h=z.f(48) if z.size == "board" else None)
    ic = b.row(r, "Icon", w=z.f(34), h=z.f(34), radius=9, main="center", cross="center", fill=C["sunken"])
    b.txt(ic, "?", size=z.f(15), style="Bold", color=C["ink2"])
    c = b.col(r, "Text", gap=1, sizingH="fill")
    b.txt(c, "Help & legal", size=z.f(15), style="SemiBold", color=C["ink2"], fillW=True)
    b.txt(c, "How it works, shortcuts, privacy", size=z.f(12), color=C["muted"], fillW=True)
    b.txt(r, "›", size=z.f(18), style="SemiBold", color=C["muted"])
    return sep


def tabs(b, parent, sections, active, z):
    phone = z.size == "phone"
    sg = b.row(parent, "Section tabs", gap=2, pad=3, fill=C["sunken"], radius=12, sizingH="fill",
               wrap=phone, crossGap=2, cross="min")
    tw = (375 - 32 - 6 - 2) // 2
    for label, icon, _ in sections:
        on = label == active
        t = b.row(sg, f"Tab {label}", gap=6, pad=[13 if phone else 10, 8, 13 if phone else 10, 8], radius=9,
                  sizingH=None if phone else "fill", w=tw if phone else None, main="center",
                  fill=C["surface"] if on else "none",
                  effects=[{"type": "dropShadow", "color": "#00000014", "offset": [0, 1], "radius": 2}] if on else None)
        b.txt(t, label, size=13, style="SemiBold", color=C["ink"] if on else C["ink2"])
    return sg


# --- screen -----------------------------------------------------------------------------------------------------

def bar_phone(b, s, z, origin, title="Settings", rec="REC  23:41", help_btn=False):
    t = b.col(s, "Top bar", gap=10, pad=[12, 16, 12, 16], fill=C["surface"], sizingH="fill",
              sides=[0, 0, 1, 0], stroke=C["line"])
    r1 = b.row(t, "Row 1", gap=10, sizingH="fill")
    mark = b.row(r1, "Mark", w=28, h=28, radius=8, fill=C["accent"], main="center", cross="center")
    b.txt(mark, "◆", size=13, style="Bold", color=C.get("onAccent", "#FFFFFF"))
    b.txt(r1, title, size=16, style="Bold")
    b.spacer(r1)
    if origin == "live":
        b.chip(r1, rec, C["red"], C["redSoft"], dot=C["red"])
    r2 = b.row(t, "Row 2", gap=8, sizingH="fill")
    b.button(r2, "Back to meeting" if origin == "live" else "Back to setup", "dark", size=13, pad=(8, 12, 8, 12),
             icon="‹", key="back")
    b.spacer(r2)
    S.lang_switch(b, r2, z)
    if help_btn:
        help_icon_button(b, r2, z)
    return t


def help_icon_button(b, parent, z, state="rest", d=None):
    d = d or (48 if z.size == "board" else 36)
    on = state == "active"
    h = b.row(parent, "Button Help & legal (icon)", w=d, h=d, radius=10, main="center", cross="center",
              fill=C["accentSoft"] if on else C["surface"], stroke=None if on else C["line"])
    b.txt(h, "?", size=round(d * 0.42), style="Bold", color=C["accentInk"] if on else C["ink"])
    return h


def screen(prefix, name, x, y, content, w=1440, h=900, size="wide", origin="setup", theme=None,
           sections=SECTIONS_011, active="Language model", help_link=False, topbar=None, title=None):
    """content(b, parent, z) draws the section body. topbar(b, s, z) replaces the default bar when given."""
    b = B(prefix)
    z = Z(size)

    def draw():
        s = b.col(None, name, w=w, h=h, fill=C["bg"], x=x, y=y, clip=True, key="screen")
        if topbar:
            topbar(b, s, z)
        elif size == "phone":
            bar_phone(b, s, z, origin)
        elif origin == "live":
            S.bar_live(b, s, z, title or ("Product sync · Beta launch" if not z.narrow else "Product sync"))
        else:
            S.bar_setup(b, s, z, title or "New meeting")
        if z.narrow:
            pad = [16, 16, 24, 16] if size == "phone" else [24, 28, 28, 28]
            body = b.col(s, "Body", gap=14, pad=pad, sizingH="fill", sizingV="fill")
            hd = b.col(body, "Heading", gap=4, sizingH="fill")
            if size != "phone":
                b.txt(hd, "Settings", size=26, style="Bold", ls=-0.5)
            b.txt(hd, "Changes apply at once and stay on this device.", size=13, color=C["ink2"], fillW=True)
            tabs(b, body, sections, active, z)
            sec = b.col(body, active, gap=14, sizingH="fill")
            content(b, sec, z)
            if help_link:
                help_entry(b, body, z, compact=True)
        else:
            body = b.row(s, "Body", gap=z.f(32), pad=[z.f(28), z.f(32), z.f(28), z.f(32)], sizingH="fill",
                         sizingV="fill", cross="min")
            nav(b, body, sections, active, z, help_link=help_link)
            sec = b.col(body, active, gap=z.f(16), sizingH="fill")
            content(b, sec, z)
        return s

    if theme:
        with themed(theme):
            draw()
    else:
        draw()
    return b


def card(b, parent, name, z, gap=4):
    return b.card(parent, name, gap=gap, pad=[z.f(20), z.f(22), z.f(18), z.f(22)], effects=SHADOW)


# --- state boards ---------------------------------------------------------------------------------------------------

def board(prefix, name, x, y, title, sub):
    b = B(prefix)
    s = b.col(None, name, fill=C["bg"], x=x, y=y, pad=48, gap=36, key="screen")
    hd = b.col(s, "Title", gap=6)
    b.txt(hd, title, size=28, style="Bold", ls=-0.5)
    if sub:
        b.txt(hd, sub, size=14, color=C["ink2"], w=1400, lh="145%")
    return b, s


def section(b, parent, title, sub=None, w=None):
    s = b.col(parent, title, gap=16, w=w)
    h = b.col(s, "Heading", gap=4, sizingH="fill" if w else None)
    b.txt(h, title, size=18, style="Bold")
    if sub:
        b.txt(h, sub, size=13, color=C["ink2"], fillW=bool(w), lh="145%")
    return s


def cell(b, parent, title, sub, w=420):
    c = b.col(parent, f"State {title}", gap=10, w=w)
    b.txt(c, title, size=14, style="SemiBold", fillW=True)
    if sub:
        b.txt(c, sub, size=12, color=C["ink2"], fillW=True, lh="140%")
    return c
