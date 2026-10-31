"""19 Help & legal · entry and states: the Help & legal button in every top bar and size, its states, the link
in Settings, and the organisation block (filled / placeholder / file could not be read)."""
from kit import B, C, DARK, SHADOW, themed
from s14_settings import Z
import s14_settings as S
import setx as X
import s19_help as H


def framed(b, parent, name, w):
    return b.col(parent, name, radius=12, stroke=C["line"], clip=True, w=w, effects=SHADOW, fill=C["bg"])


def build(x=0, y=0):
    b, s = X.board("s19s_", "19 Help & legal · entry + states", x, y, "Help & legal · entry and states",
                   "The “Help & legal” button sits between the language switch and Settings. It keeps its label "
                   "where there is room and becomes a 36 px “?” icon (accessible name “Help & legal”, tooltip) in the "
                   "1280 live bar, at 768 and at 375; 48 px on the board.")
    wide, tab, board = Z("wide"), Z("tablet"), Z("board")

    sec = X.section(b, s, "Top bars")
    rows = [
        ("Setup · 1440", 1440, lambda f: H.bar(b, f, wide, "setup")),
        ("Live · 1440 (label fits next to Pause and End meeting)", 1440,
         lambda f: H.bar(b, f, wide, "live", live_controls=True)),
        ("Live · 1280 (icon)", 1280, lambda f: H.bar(b, f, wide, "live", live_controls=True, icon_only=True)),
        ("Settings view · 1440 (Settings open)", 1440,
         lambda f: H.bar(b, f, wide, "setup", settings_state="active", back="setup")),
        ("Help & legal view during a meeting · 1440 (Help open, REC stays)", 1440,
         lambda f: H.bar(b, f, wide, "live", help_state="active", back="meeting")),
        ("Setup · 768 (icon)", 768, lambda f: H.bar(b, f, tab, "setup")),
        ("Live · board 1920 (label, 48 px)", 1920, lambda f: H.bar(b, f, board, "live", live_controls=True)),
    ]
    for label, w, fn in rows:
        c = b.col(sec, label, gap=8)
        b.txt(c, label, size=13, style="SemiBold", color=C["ink2"])
        fn(framed(b, c, label, w))
    c = b.col(sec, "375", gap=8)
    b.txt(c, "Settings view during a meeting · 375 (icon in row 2)", size=13, style="SemiBold", color=C["ink2"])
    f = framed(b, c, "375 bar", 375)
    X.bar_phone(b, f, Z("phone"), "live", help_btn=True)

    sec = X.section(b, s, "Button states")
    r = b.row(sec, "States", gap=28, cross="max")
    for name, fn in (("Rest", lambda p: H.help_button(b, p, wide)),
                     ("Open (view shown)", lambda p: H.help_button(b, p, wide, "active")),
                     ("Icon · rest", lambda p: X.help_icon_button(b, p, wide)),
                     ("Icon · open", lambda p: X.help_icon_button(b, p, wide, "active")),
                     ("Icon · board 48", lambda p: X.help_icon_button(b, p, board))):
        cc = b.col(r, name, gap=10)
        fn(cc)
        b.txt(cc, name, size=12, color=C["muted"])
    b.txt(sec, "F1 opens it; Esc or “Back” returns to where it was opened and focuses this button again.",
          size=13, color=C["ink2"])

    sec = X.section(b, s, "Link from Settings",
                    "Under the section list (wide) or at the end of the section (narrow). Not a section of its own: "
                    "it leaves Settings, so it gets a › and its own separator.")
    r = b.row(sec, "Settings link", gap=32, cross="min")
    c = b.col(r, "Wide", gap=8)
    b.txt(c, "Wide · section list", size=13, style="SemiBold", color=C["ink2"])
    p = b.col(c, "Nav", pad=20, radius=12, fill=C["bg"], stroke=C["line"])
    X.nav(b, p, X.SECTIONS_ALL, "General", wide, help_link=True)
    c = b.col(r, "Narrow", gap=8, w=375)
    b.txt(c, "375 · after the section", size=13, style="SemiBold", color=C["ink2"])
    p = b.col(c, "Narrow end", pad=16, radius=12, fill=C["bg"], stroke=C["line"], sizingH="fill")
    X.help_entry(b, p, Z("phone"), compact=True)

    sec = X.section(b, s, "Organisation block", "From the IT-deployed organisation.json; text only.")
    r = b.row(sec, "Org states", gap=24, cross="min")
    for st, t in (("filled", "Filled"), ("missing", "No file · placeholder"),
                  ("unreadable", "File could not be read (too large, invalid JSON, unknown keys)")):
        c = X.cell(b, r, t, None, w=700)
        H.organisation(b, c, wide, st)
    with themed(DARK):
        dk = b.col(s, "Dark", gap=16, pad=32, radius=20, fill=C["bg"])
        b.txt(dk, "Dark", size=18, style="Bold")
        f = b.col(dk, "bar", radius=12, stroke=C["line"], clip=True, w=1440)
        H.bar(b, f, wide, "live", help_state="active", back="meeting")
        r = b.row(dk, "Org", gap=24, cross="min")
        for st in ("missing", "unreadable"):
            c = b.col(r, st, w=700)
            H.organisation(b, c, wide, st)
    return b
