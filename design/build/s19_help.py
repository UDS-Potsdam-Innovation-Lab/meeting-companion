"""19 Help & legal (job 014): the help and legal notes view, its entry in the top bars and in Settings.

Decisions drawn here:
- Entry: a "Help & legal" button ("?" + label) between the language switch and Settings in the setup, live
  and settings bars. Below 1280 px (768, 375) and in the busy live bar it collapses to a 36 px "?" icon button
  (48 px on the board) with the accessible name "Help & legal". Settings has a "Help & legal" link under its
  section list (wide) or under the section content (narrow).
- The view replaces the content area like Settings does: same top bar (REC chip and "Back to meeting" stay
  when opened from a live meeting, the Help button shows "open"), a left column with the heading, the tabs
  "Help" / "Legal notes" and the section list of the active tab (anchors on one long page, the current one
  marked). At 768/375 the tabs sit on top and an "On this page" select replaces the list.
- Reading width: text cards are capped at 760 px so long legal text stays readable on wide windows.
- "How a meeting works" is plain text with small glyph tiles, no illustrations (they would need DE/EN
  variants and age with the UI).
- Licence texts are collapsed; one opens inline under its row.
"""
from kit import B, C, DARK, SHADOW, themed, PEOPLE
import s14_settings as S
from s14_settings import Z, card_head, info
import setx as X

APP_DATA = "~/.local/share/de.udspotsdam.meetingcompanion"
READ_W = 760

HELP_SECTIONS = ["How a meeting works", "Keyboard shortcuts", "Troubleshooting"]
LEGAL_SECTIONS = ["Privacy notice", "Consent texts", "Organisation", "Open-source licences"]

HOW = [
    ("☰", "Agenda mode", "Give each item a time. The left column shows the current item and the time left; a "
                         "quiet nudge comes when 80 % of an item is used."),
    ("◷", "Agenda-free mode", "Start without an agenda. The timer counts down the meeting slot, you add topics as "
                              "they come up, and a note appears at half time."),
    ("●", "Recording and consent", "Recording starts only after you confirm that everyone was informed. While it "
                                   "runs, the red REC chip shows the time on every view."),
    ("◉", "Speakers", "The app tells voices apart and suggests names from the name round. Nobody is named until a "
                      "person confirms it under Speakers."),
    ("≋", "Sound wave", "The wave under the transcript shows that the microphone hears the room. A flat line means "
                        "paused; a dashed line means no signal."),
    ("■", "Ending a meeting", "“End meeting” asks once more, then stops the recording. The transcript and notes "
                              "stay on this device."),
]
KEYS = [
    (["Ctrl", ","], "Open Settings", "Everywhere · ⌘ , on macOS"),
    (["F1"], "Open Help & legal", "Everywhere"),
    (["Esc"], "Back from Settings or Help & legal; cancel an edit", "Settings, Help, agenda, speakers"),
    (["←", "→", "Home", "End"], "Move between tabs and sections", "Settings, Help & legal"),
    (["Tab"], "Next control, with a visible focus ring", "Everywhere"),
    (["Enter"], "Confirm the focused button or suggestion", "Everywhere"),
]
TROUBLE = [
    ("Microphone lost", "The recording stops and the transcript shows why. Connect the microphone again, or choose "
                        "another one, then press Resume.", "Open Audio settings", "red"),
    ("No speech model", "Transcription needs a whisper.cpp model (ggml-….bin) on this device. The app never "
                        "downloads one; place it in one of the folders listed in Settings.",
     "Open On this device", "amber"),
    ("No speaker model", "Without it, lines can still be named one by one. Speaker models (….onnx) are found in "
                         "the app’s models folder or the Hugging Face cache.", "Open On this device", "amber"),
]
LICENCES = [
    ("whisper-rs", "0.16.0", "Unlicense", "Rust bindings for whisper.cpp"),
    ("whisper.cpp", "via whisper-rs 0.16.0", "MIT", "Speech recognition"),
    ("sherpa-onnx", "2.0.1", "Apache-2.0", "Speaker embeddings"),
    ("Tauri", "2.12.5", "MIT OR Apache-2.0", "Desktop shell"),
    ("React", "19.3.1", "MIT", "User interface"),
    ("Inter", "5.3.0", "OFL-1.1", "Typeface"),
]
MODELS = [("whisper ggml models", "MIT"), ("3D-Speaker models", "Apache-2.0"),
          ("WeSpeaker VoxCeleb models", "CC-BY-4.0"), ("NeMo TitaNet models", "CC-BY-4.0")]
MIT = ("MIT License\n\nCopyright (c) 2023-2026 The ggml authors\n\nPermission is hereby granted, free of charge, to "
       "any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in "
       "the Software without restriction, including without limitation the rights to use, copy, modify, merge, "
       "publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the "
       "Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this "
       "permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS "
       "PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED …")


# --- top bars ----------------------------------------------------------------------------------------------------

def help_button(b, parent, z, state="rest", icon_only=False):
    fs, pad = z.btn
    if icon_only:
        return X.help_icon_button(b, parent, z, state)
    if state == "active":
        return b.button(parent, "Help & legal", "soft", size=fs, pad=pad, icon="?", name="Button Help & legal (open)")
    return b.button(parent, "Help & legal", "ghost", size=fs, pad=pad, icon="?")


def bar(b, s, z, origin="setup", title=None, help_state="rest", settings_state="rest", back=None, icon_only=None,
        rec="00:23:41", live_controls=False):
    """Top bar with the Help & legal entry. back: None | 'meeting' | 'setup'."""
    fs, pad = z.btn
    if icon_only is None:
        icon_only = z.narrow
    t = b.topbar(s, title or ("Product sync · Beta launch" if origin == "live" else "New meeting"))
    if origin == "live":
        b.chip(t, f"REC  {rec}", C["red"], C["redSoft"], dot=C["red"], size=z.f(12))
    if not z.narrow:
        b.chip(t, "On-device · DE/EN", C["ink2"], C["sunken"], style="Regular", size=z.f(12))
    S.lang_switch(b, t, z)
    help_button(b, t, z, help_state, icon_only)
    S.settings_button(b, t, z, settings_state)
    if live_controls:
        b.button(t, "Pause", "ghost", size=fs, pad=pad, icon="❚❚")
        b.button(t, "End meeting", "dark", size=fs, pad=pad)
    elif back:
        b.button(t, {"meeting": "Back to meeting", "settings": "Back to settings"}.get(back, "Back to setup"), "dark",
                 size=fs, pad=pad, icon="‹", key="back")
    else:
        b.avatar(t, "MK", 30)
    return t


def bar_phone(b, s, z, origin):
    t = b.col(s, "Top bar", gap=10, pad=[12, 16, 12, 16], fill=C["surface"], sizingH="fill",
              sides=[0, 0, 1, 0], stroke=C["line"])
    r1 = b.row(t, "Row 1", gap=10, sizingH="fill")
    mark = b.row(r1, "Mark", w=28, h=28, radius=8, fill=C["accent"], main="center", cross="center")
    b.txt(mark, "◆", size=13, style="Bold", color=C.get("onAccent", "#FFFFFF"))
    b.txt(r1, "Help & legal", size=16, style="Bold")
    b.spacer(r1)
    if origin == "live":
        b.chip(r1, "REC  23:41", C["red"], C["redSoft"], dot=C["red"])
    r2 = b.row(t, "Row 2", gap=8, sizingH="fill")
    b.button(r2, "Back to meeting" if origin == "live" else "Back to setup", "dark", size=13, pad=(8, 12, 8, 12),
             icon="‹", key="back")
    b.spacer(r2)
    S.lang_switch(b, r2, z)
    X.help_icon_button(b, r2, z, "active")
    return t


# --- view frame ----------------------------------------------------------------------------------------------------

def tab_switch(b, parent, tab, z, fill=False):
    sg = b.row(parent, "Tabs Help / Legal notes", gap=2, pad=3, fill=C["sunken"], radius=12,
               sizingH="fill" if fill else None)
    for label in ("Help", "Legal notes"):
        on = label == tab
        t = b.row(sg, f"Tab {label}", pad=[z.f(9), z.f(14), z.f(9), z.f(14)], radius=9, sizingH="fill",
                  main="center", fill=C["surface"] if on else "none", h=z.f(42) if z.size == "board" else None,
                  effects=[{"type": "dropShadow", "color": "#00000014", "offset": [0, 1], "radius": 2}] if on else None)
        b.txt(t, label, size=z.f(14), style="SemiBold", color=C["ink"] if on else C["ink2"])
    return sg


def side(b, parent, tab, active, z):
    n = b.col(parent, "Section list", gap=4, w=z.f(264))
    b.txt(n, "Help & legal", size=z.f(28), style="Bold", ls=-0.5)
    b.txt(n, "Works offline. Nothing here is loaded from the internet.", size=z.f(13), color=C["ink2"], fillW=True,
          lh="145%")
    b.node("frame", n, name="Gap", w=10, h=z.f(10), fill="none")
    tab_switch(b, n, tab, z, fill=True)
    b.node("frame", n, name="Gap", w=10, h=z.f(10), fill="none")
    b.txt(n, "ON THIS PAGE", size=z.f(11), style="SemiBold", color=C["muted"], ls=0.8)
    for label in (HELP_SECTIONS if tab == "Help" else LEGAL_SECTIONS):
        on = label == active
        r = b.row(n, f"Anchor {label}", gap=10, pad=[z.f(9), 12, z.f(9), 12], radius=10, sizingH="fill",
                  fill=C["surface"] if on else "none", stroke=C["line"] if on else None,
                  h=z.f(48) if z.size == "board" else None)
        b.rect(r, 3, z.f(20), C["accent"] if on else "#00000000", radius=2, name="Active marker")
        b.txt(r, label, size=z.f(14), style="SemiBold", color=C["ink"] if on else C["ink2"], fillW=True)
    return n


def screen(prefix, name, x, y, tab, active, content, w=1280, h=800, size="wide", origin="setup", theme=None,
           back="setup", title=None):
    b = B(prefix)
    z = Z(size)

    def draw():
        s = b.col(None, name, w=w, h=h, fill=C["bg"], x=x, y=y, clip=True, key="screen")
        if size == "phone":
            bar_phone(b, s, z, origin)
        else:
            bar(b, s, z, origin, title=title, help_state="active", back=back,
                icon_only=z.narrow or (origin == "live" and w < 1440))
        if z.narrow:
            pad = [16, 16, 24, 16] if size == "phone" else [24, 28, 28, 28]
            body = b.col(s, "Body", gap=14, pad=pad, sizingH="fill", sizingV="fill")
            if size != "phone":
                b.txt(body, "Help & legal", size=26, style="Bold", ls=-0.5)
            tab_switch(b, body, tab, z, fill=True)
            S.select(b, body, None, active, "On this page", z, name="Select On this page")
            col = b.col(body, tab, gap=14, sizingH="fill")
            content(b, col, z)
        else:
            body = b.row(s, "Body", gap=z.f(40), pad=[z.f(28), z.f(32), z.f(28), z.f(32)], sizingH="fill",
                         sizingV="fill", cross="min")
            side(b, body, tab, active, z)
            col = b.col(body, tab, gap=z.f(16), w=z.f(READ_W) if w < 1900 else 1100)
            content(b, col, z)
        return s

    if theme:
        with themed(theme):
            draw()
    else:
        draw()
    return b


# --- help content ------------------------------------------------------------------------------------------------

def h2(b, parent, text, z, sub=None):
    hd = b.col(parent, f"h2 {text}", gap=4, sizingH="fill")
    b.txt(hd, text, size=z.f(20), style="Bold", ls=-0.2, fillW=True)
    if sub:
        b.txt(hd, sub, size=z.f(13), color=C["ink2"], fillW=True, lh="145%")
    return hd


def how(b, col, z):
    c = X.card(b, col, "How a meeting works", z, gap=z.f(14))
    h2(b, c, "How a meeting works", z)
    two = not z.narrow
    grid = (b.row(c, "Items", gap=z.f(14), sizingH="fill", wrap=True, crossGap=z.f(14), cross="min") if two
            else b.col(c, "Items", gap=z.f(14), sizingH="fill"))
    for icon, t, txt in HOW:
        it = b.row(grid, t, gap=12, cross="min", sizingH=None if two else "fill",
                   w=(z.f(READ_W) - 2 * z.f(22) - z.f(14)) // 2 - 1 if two and z.size != "board" else
                   (520 if two else None))
        tile = b.row(it, "Glyph", w=z.f(34), h=z.f(34), radius=9, fill=C["accentSoft"], main="center",
                     cross="center")
        b.txt(tile, icon, size=z.f(15), style="Bold", color=C["accentInk"])
        tc = b.col(it, "Text", gap=3, sizingH="fill")
        b.txt(tc, t, size=z.f(15), style="SemiBold", fillW=True)
        b.txt(tc, txt, size=z.f(13), color=C["ink2"], fillW=True, lh="150%")
    return c


def keycap(b, parent, k, z):
    kb = b.row(parent, f"Key {k}", pad=[z.f(3), z.f(8), z.f(3), z.f(8)], radius=6, fill=C["sunken"], stroke=C["line"])
    b.txt(kb, k, size=z.f(12), style="SemiBold", color=C["ink"])
    return kb


def shortcuts(b, col, z):
    c = X.card(b, col, "Keyboard shortcuts", z, gap=0)
    h2(b, c, "Keyboard shortcuts", z, "Generated from the same list the app binds keys with.")
    b.node("frame", c, name="Gap", w=10, h=z.f(10), fill="none")
    for i, (keys, what, where) in enumerate(KEYS):
        r = (b.col if z.size == "phone" else b.row)(c, what, gap=z.f(6) if z.size == "phone" else 16,
                                                    pad=[z.f(10), 0, z.f(10), 0], sizingH="fill",
                                                    sides=[1, 0, 0, 0], stroke=C["line"])
        kr = b.row(r, "Keys", gap=4, w=None if z.size == "phone" else z.f(170))
        for k in keys:
            keycap(b, kr, k, z)
        tc = b.col(r, "Action", gap=1, sizingH="fill")
        b.txt(tc, what, size=z.f(14), style="SemiBold", fillW=True)
        b.txt(tc, where, size=z.f(12), color=C["muted"], fillW=True)
    return c


def trouble(b, col, z):
    c = X.card(b, col, "Troubleshooting", z, gap=z.f(12))
    h2(b, c, "Troubleshooting", z)
    for t, txt, action, tone in TROUBLE:
        e = b.row(c, t, gap=12, pad=[z.f(14), z.f(14), z.f(14), z.f(14)], radius=12, fill=C["sunken"],
                  sizingH="fill", cross="min")
        ic = b.row(e, "Icon", w=z.f(20), h=z.f(20), radius=z.f(10), fill=C[tone], main="center", cross="center")
        b.txt(ic, "!", size=z.f(12), style="Bold", color=C["surface"])
        tc = b.col(e, "Text", gap=6, sizingH="fill")
        b.txt(tc, t, size=z.f(15), style="SemiBold", fillW=True)
        b.txt(tc, txt, size=z.f(13), color=C["ink2"], fillW=True, lh="150%")
        X.btn(b, tc, action, "ghost", z, icon="⚙")
    return c


def help_all(b, col, z):
    how(b, col, z)
    shortcuts(b, col, z)
    trouble(b, col, z)


def help_lower(b, col, z):
    shortcuts(b, col, z)
    trouble(b, col, z)


# --- legal content ---------------------------------------------------------------------------------------------------

PRIVACY = [
    ("What is recorded", "While a meeting records, the app turns speech into text on this device. It keeps the "
                         "transcript and the meeting itself: agenda, topics, notes, decisions and to-dos. Audio is "
                         "never written to disk. The input level only moves the sound wave and is never stored."),
    ("Where it is stored", f"Only on this device, in {APP_DATA}/meetings/. Meetings and transcripts are encrypted "
                           "(XChaCha20-Poly1305); the key is kept in the system keychain."),
    ("What leaves the device", "Nothing. The app sends no audio, transcripts or notes anywhere."),
    ("Consent and indicator", "Recording starts only after the facilitator confirms that everyone was informed. "
                              "While it runs, a red REC indicator is visible."),
    ("How long", "Transcripts and meetings stay until a person deletes them."),
    ("Who is responsible", "The organisation that operates this device. Its details are under Organisation."),
]


def privacy(b, col, z):
    c = X.card(b, col, "Privacy notice", z, gap=z.f(14))
    h2(b, c, "Privacy notice", z, "What this app does with meeting data today. Version 1 · 31 Oct 2026")
    for t, txt in PRIVACY:
        p = b.col(c, t, gap=4, sizingH="fill")
        b.txt(p, t, size=z.f(15), style="SemiBold", fillW=True)
        b.txt(p, txt, size=z.f(14), color=C["ink"], fillW=True, lh="160%")
    return c


def consent(b, col, z):
    c = X.card(b, col, "Consent texts", z, gap=z.f(12))
    h2(b, c, "Consent texts", z, "Exactly what the app asks before a recording starts. The same texts as the "
                                 "consent dialog.")
    d = b.col(c, "Consent dialog (as text)", gap=10, pad=[z.f(16), z.f(18), z.f(16), z.f(18)], radius=12,
              fill=C["sunken"], sizingH="fill")
    b.txt(d, "Transcribe this meeting?", size=z.f(16), style="SemiBold", fillW=True)
    r = b.row(d, "Check", gap=10, sizingH="fill", cross="min")
    bx = b.row(r, "Box", w=z.f(18), h=z.f(18), radius=4, fill=C["surface"], stroke=C["muted"])
    b.txt(r, "Everyone was informed that this meeting is transcribed", size=z.f(14), fillW=True, lh="145%")
    b.txt(d, "Audio stays on this device.", size=z.f(13), color=C["ink2"], fillW=True)
    return c


ORG = [("Organisation", "Grundschule am Lindenpark"), ("Address", "Lindenstraße 12, 14467 Potsdam"),
       ("Controller", "Dr. Sabine Hartmann, Head of School"), ("Data protection officer", "datenschutz@schulamt-potsdam.de"),
       ("Contact", "sekretariat@lindenpark-schule.de · 0331 289 4410"), ("Imprint", "lindenpark-schule.de/impressum")]


def organisation(b, col, z, state="filled"):
    """state: filled | missing | unreadable."""
    c = X.card(b, col, "Organisation", z, gap=z.f(12))
    h2(b, c, "Organisation", z, "Controller and imprint, as provided by your IT. Read-only.")
    if state == "filled":
        dl = b.col(c, "Details", gap=0, sizingH="fill")
        for i, (k, v) in enumerate(ORG):
            side_ = {} if i == 0 else {"sides": [1, 0, 0, 0], "stroke": C["line"]}
            r = (b.col if z.size == "phone" else b.row)(dl, k, gap=z.f(2) if z.size == "phone" else 16,
                                                        pad=[z.f(9), 0, z.f(9), 0], sizingH="fill", **side_)
            b.txt(r, k, size=z.f(13), style="SemiBold", color=C["ink2"],
                  w=None if z.size == "phone" else z.f(200), fillW=z.size == "phone")
            b.txt(r, v, size=z.f(14), color=C["ink"], fillW=True)
        b.txt(c, f"From {APP_DATA}/organisation.json. Shown as text; addresses are not links.", size=z.f(12),
              color=C["muted"], fillW=True)
    else:
        if state == "unreadable":
            info(b, c, "!", "The organisation file could not be read.", z, tone="amber",
                 sub="It is too large, not valid JSON or has fields the app does not know. Ask your IT to check "
                     "organisation.json. The app works as usual.")
        e = b.col(c, "Placeholder", gap=6, pad=[z.f(14), z.f(16), z.f(14), z.f(16)], radius=12, fill=C["sunken"],
                  sizingH="fill")
        b.txt(e, "Your organisation has not added its details yet", size=z.f(14), style="SemiBold", fillW=True)
        b.txt(e, f"IT can place them in {APP_DATA}/organisation.json (name, address, controller, data protection "
                 "contact, contact, imprint).", size=z.f(13), color=C["ink2"], fillW=True, lh="150%")
    return c


def licences(b, col, z, expanded="whisper.cpp"):
    c = X.card(b, col, "Open-source licences", z, gap=0)
    h2(b, c, "Open-source licences", z, "Components bundled with this app, with their full licence texts.")
    b.node("frame", c, name="Gap", w=10, h=z.f(10), fill="none")
    for name, ver, lic, what in LICENCES:
        on = name == expanded
        r = b.row(c, f"Licence {name}", gap=12, pad=[z.f(10), 0, z.f(10), 0], sizingH="fill", sides=[1, 0, 0, 0],
                  stroke=C["line"], h=z.f(56) if z.size == "board" else None)
        tc = b.col(r, "Text", gap=1, sizingH="fill")
        b.txt(tc, f"{name}  {ver}", size=z.f(14), style="SemiBold", fillW=True)
        b.txt(tc, what, size=z.f(12), color=C["muted"], fillW=True)
        b.chip(r, lic, C["ink2"], C["sunken"], size=z.f(11), style="SemiBold")
        b.txt(r, "▴" if on else "▾", size=z.f(13), color=C["ink2"], name="Expand (button, aria-expanded)")
        if on:
            t = b.col(c, "Licence text", pad=[z.f(12), z.f(14), z.f(12), z.f(14)], radius=10, fill=C["sunken"],
                      sizingH="fill")
            b.txt(t, MIT, size=z.f(12), color=C["ink"], fillW=True, lh="155%")
            b.node("frame", c, name="Gap", w=10, h=z.f(8), fill="none")
    m = b.col(c, "Models", gap=6, pad=[z.f(12), 0, 0, 0], sizingH="fill", sides=[1, 0, 0, 0], stroke=C["line"])
    b.txt(m, "Models are not bundled", size=z.f(14), style="SemiBold", fillW=True)
    b.txt(m, "The licence of the model you placed on this device applies. Known licences:", size=z.f(13),
          color=C["ink2"], fillW=True)
    for n, l in MODELS:
        r = b.row(m, n, gap=8, sizingH="fill")
        b.txt(r, n, size=z.f(13), fillW=True)
        b.txt(r, l, size=z.f(13), style="SemiBold", color=C["ink2"])
    return c


def legal_top(b, col, z):
    privacy(b, col, z)
    consent(b, col, z)


def legal_lower(b, col, z):
    organisation(b, col, z, "filled")
    licences(b, col, z)


def build(x=0, y=0):
    return screen("s19_", "19 Help & legal · Help · opened during a meeting", x, y, "Help", "How a meeting works",
                  help_all, w=1280, h=800, origin="live", back="meeting")
