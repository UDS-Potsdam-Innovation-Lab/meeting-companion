from kit import B, C, SHADOW
from s2_live import segmented

MW, MH = 1392, 746
CX, CY, CW, CH = 696, 320, 250, 64
BW, BH, LW, LH = 210, 46, 196, 38

# (title, colour, soft, side, y, state, leaves[(label, kind)])
BRANCHES = [
    ("01 Check-in & goals", C["teal"], C["tealSoft"], -1, 100, "done",
     [("Goal: commit to a beta date", "topic"), ("✓ Check-ins → Thursdays", "decision")]),
    ("02 Beta launch", C["accent"], C["accentSoft"], 1, 170, "now",
     [("Offline mode", "selected"), ("✓ Launch 14 Nov", "decision"), ("? Release notes in DE only", "question")]),
    ("03 Pilot schools", C["amber"], C["amberSoft"], 1, 500, "next",
     [("Wi-Fi in 2 of 3 schools", "topic"), ("☐ Inform school 3 (Yusuf)", "todo")]),
    ("04 Q1 research budget", C["red"], C["redSoft"], -1, 320, "next", []),
    ("05 Open questions", C["ink2"], C["sunken"], -1, 560, "next",
     [("Parked: SSO for schools", "parked"), ("Parked: dark mode", "parked")]),
]


def curve(x1, y1, x2, y2):
    mx = (x1 + x2) / 2
    return f"M {x1} {y1} C {mx} {y1} {mx} {y2} {x2} {y2}"


def pill(b, parent, cx, cy, w, h, label, fg, bg, stroke=None, size=14, style="SemiBold", dashed=False, name=None, key=None):
    p = b.row(parent, name or label, w=w, h=h, x=round(cx - w / 2), y=round(cy - h / 2), radius=h / 2, fill=bg,
              main="center", stroke=stroke, key=key, **({"dashes": [5, 4]} if dashed else {}))
    b.txt(p, label, size=size, style=style, color=fg)
    return p


def build(x=0, y=0):
    b = B("s3_")
    s = b.col(None, "03 Mind map", w=1440, h=900, fill=C["bg"], x=x, y=y, clip=True, key="screen")
    t = b.topbar(s, "Product sync · Beta launch")
    b.chip(t, "REC  00:23:58", C["red"], C["redSoft"], dot=C["red"])
    b.button(t, "End meeting", "dark", size=13, pad=(8, 14, 8, 14), key="end")
    body = b.col(s, "Body", pad=[20, 24, 20, 24], sizingH="fill", sizingV="fill")
    card = b.card(body, "Mind map card", pad=0, gap=0, sizingV="fill", effects=SHADOW)
    hd = b.row(card, "Header", gap=12, pad=[14, 20, 14, 20], sizingH="fill", sides=[0, 0, 1, 0], stroke=C["line"])
    segmented(b, hd, ["Transcript", "Mind map", "Notes"], "Mind map", key_prefix="tab_")
    b.spacer(hd)
    for lbl, fg, bg in (("✓ Decision", C["green"], C["greenSoft"]), ("☐ To-do", C["amber"], C["amberSoft"]),
                        ("? Open question", C["accentInk"], C["accentSoft"]), ("Parked", C["ink2"], C["sunken"])):
        b.chip(hd, lbl, fg, bg, size=12)
    b.txt(hd, "   Grouped by agenda item", size=12, color=C["muted"])

    m = b.node("frame", card, name="Map", w=MW, h=MH, fill="none", sizingH="fill", sizingV="fill", clip=True)

    # connections first, so nodes sit on top
    for title, fg, soft, side, by, state, leaves in BRANCHES:
        cx_edge = CX + side * CW / 2
        bx = CX + side * 304
        b_edge_in = bx - side * BW / 2
        b.node("vector", m, name=f"Link {title}", path=curve(cx_edge, CY, b_edge_in, by), x=0, y=0,
               fill="none", stroke=fg, strokeWeight=3 if state != "next" else 2, opacity=1 if state != "next" else 0.5,
               **({"dashes": [6, 5]} if state == "next" else {}))
        if not leaves:
            continue
        lx = bx + side * 254
        n = len(leaves)
        for i, (lbl, kind) in enumerate(leaves):
            ly = by + (i - (n - 1) / 2) * 62
            b.node("vector", m, name=f"Link {lbl}", path=curve(bx + side * BW / 2, by, lx - side * LW / 2, ly), x=0, y=0,
                   fill="none", stroke=fg, strokeWeight=2, opacity=0.55)

    pill(b, m, CX, CY, CW, CH, "Product sync · Beta launch", "#FFFFFF", C["ink"], size=16, style="Bold", name="Center")

    leaf_style = {
        "topic": (C["ink"], C["surface"], C["line"]),
        "selected": (C["accentInk"], C["surface"], C["accent"]),
        "decision": (C["green"], C["greenSoft"], None),
        "todo": (C["amber"], C["amberSoft"], None),
        "question": (C["accentInk"], C["accentSoft"], None),
        "parked": (C["ink2"], C["sunken"], None),
    }
    for title, fg, soft, side, by, state, leaves in BRANCHES:
        bx = CX + side * 304
        if state == "next":
            pill(b, m, bx, by, BW, BH, title, fg, C["surface"], stroke=fg, dashed=True, name=f"Branch {title}")
        else:
            pill(b, m, bx, by, BW, BH, title, "#FFFFFF" if state == "now" else fg, fg if state == "now" else soft,
                 name=f"Branch {title}")
        lx = bx + side * 254
        n = len(leaves)
        for i, (lbl, kind) in enumerate(leaves):
            ly = by + (i - (n - 1) / 2) * 62
            lfg, lbg, lst = leaf_style[kind]
            p = pill(b, m, lx, ly, LW, LH, lbl, lfg, lbg, stroke=lst, size=13,
                     style="SemiBold" if kind != "topic" else "Regular", name=f"Leaf {lbl}")
            if kind == "selected":
                b.cmds[-2]["params"]["props"]["strokeWeight"] = 2
                b.cmds[-2]["params"]["props"]["effects"] = [{"type": "dropShadow", "color": "#4338CA33", "offset": [0, 0], "radius": 0, "spread": 4}]

    # popover for the selected node
    pop = b.col(m, "Topic popover", gap=10, pad=18, w=280, x=556, y=420, fill=C["surface"], radius=14,
                stroke=C["line"], effects=SHADOW)
    b.txt(pop, "Offline mode", size=16, style="Bold")
    b.txt(pop, "Mentioned 7× · 10:03 – 10:11 · Tobias, Lena, Mara", size=12, color=C["muted"], fillW=True)
    b.txt(pop, "“If we keep the offline mode in scope, we can't make the 7th.”", size=13, color=C["ink2"],
          fillW=True, lh="145%", fontStyle="Italic")
    lk = b.row(pop, "Linked", gap=8, pad=[8, 10, 8, 10], fill=C["greenSoft"], radius=8, sizingH="fill")
    b.txt(lk, "✓ Decision: launch 14 Nov without offline mode", size=12, style="SemiBold", color=C["green"], fillW=True)
    pr = b.row(pop, "Actions", gap=8)
    b.button(pr, "Jump to transcript", "soft", size=12, pad=(7, 12, 7, 12))
    b.button(pr, "Move to…", "ghost", size=12, pad=(7, 12, 7, 12))

    # replay scrubber
    sc = b.row(m, "Replay", gap=12, pad=[10, 16, 10, 16], x=40, y=MH - 72, w=520, fill=C["surface"], radius=12,
               stroke=C["line"], effects=SHADOW)
    b.txt(sc, "▶", size=13, color=C["accent"])
    b.txt(sc, "10:00", size=12, color=C["muted"])
    b.progress(sc, 300, 0.95, C["accent"], h=6)
    b.txt(sc, "now", size=12, style="SemiBold", color=C["accent"])
    return b
