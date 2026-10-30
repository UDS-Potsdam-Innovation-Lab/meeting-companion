"""Shared chrome for the Teams call mockups (schematic call window, no vendor logos)."""
from kit import C

T = {"bg": "#1B1B1F", "bar": "#26262C", "tile": "#34343C", "tile2": "#2C2C33", "ink": "#F3F2F5", "muted": "#A4A3AC",
     "line": "#3A3A42", "leave": "#C4314B"}


def call_window(b, name, x, y, title="Product sync · Beta launch", key="screen", panel_w=None):
    s = b.col(None, name, w=1920, h=1080, fill=T["bg"], x=x, y=y, clip=True, key=key)
    top = b.row(s, "Call bar", gap=14, pad=[10, 20, 10, 20], fill=T["bar"], sizingH="fill")
    b.txt(top, "◷  23:41", size=14, style="SemiBold", color=T["ink"])
    b.txt(top, title, size=14, color=T["muted"])
    b.spacer(top)
    for lbl, active in (("Chat", False), ("People 6", False), ("React", False), ("Apps", True), ("Camera", False),
                        ("Mic", False), ("Share", False)):
        it = b.col(top, f"Tool {lbl}", gap=2, pad=[6, 10, 6, 10], radius=8, cross="center",
                   fill=C["accent"] if active else "none")
        b.txt(it, {"Chat": "💬", "People 6": "👥", "React": "☺", "Apps": "◆", "Camera": "◉", "Mic": "🎙",
                   "Share": "⇪"}[lbl], size=16, color=T["ink"])
        b.txt(it, lbl, size=11, color=T["ink"])
    lv = b.row(top, "Leave", pad=[9, 18, 9, 18], radius=8, fill=T["leave"])
    b.txt(lv, "Leave", size=14, style="SemiBold", color="#FFFFFF")
    body = b.row(s, "Call body", gap=12, pad=12, sizingH="fill", sizingV="fill", cross="min")
    return s, body


def tile(b, parent, label, initials=None, color=None, w=None, h=None, fill=True, speaking=False, room=False):
    t = b.col(parent, f"Tile {label}", w=w, h=h, fill=T["tile"], radius=10, main="center", cross="center", gap=10,
              sizingH="fill" if fill else None, sizingV="fill" if fill else None,
              stroke=C["accent"] if speaking else None, strokeWeight=3 if speaking else 1)
    if room:
        b.txt(t, "▭", size=48, color=T["muted"])
    elif initials:
        av = b.row(t, "Avatar", w=88, h=88, radius=44, fill=color, main="center")
        b.txt(av, initials, size=30, style="SemiBold", color="#FFFFFF")
    nm = b.row(t, "Name", gap=6, pad=[4, 10, 4, 10], radius=6, fill="#00000066")
    b.txt(nm, label, size=13, color=T["ink"])
    return t
