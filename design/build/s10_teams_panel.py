from kit import B, C, SHADOW, PEOPLE
from teams import T, call_window, tile


def build(x=0, y=0):
    b = B("s10_")
    s, body = call_window(b, "10 Teams call · side panel", x, y)

    grid = b.col(body, "Gallery", gap=12, sizingH="fill", sizingV="fill")
    r1 = b.row(grid, "Row 1", gap=12, sizingH="fill", sizingV="fill")
    tile(b, r1, "Room Aurora (3)", room=True, speaking=True)
    tile(b, r1, "Lena Sommer", "LS", PEOPLE["LS"][1])
    r2 = b.row(grid, "Row 2", gap=12, sizingH="fill", sizingV="fill")
    tile(b, r2, "Jana Roth", "JR", PEOPLE["JR"][1])
    tile(b, r2, "Companion (notes)", "◆", C["accent"])

    # in-meeting notification bubble
    bub = b.row(s, "In-meeting notification", gap=14, pad=[14, 16, 14, 18], fill="#FFFFFF", radius=12, absolute=True,
                x=560, y=78, effects=SHADOW)
    b.txt(bub, "⏱", size=20, color=C["amber"])
    bc = b.col(bub, "Text", gap=2)
    b.txt(bc, "Companion · 3 min left for item 02", size=14, style="SemiBold")
    b.txt(bc, "Shown to the organizer only", size=12, color=C["muted"])
    b.button(bub, "+5 min", "ghost", size=12, pad=(6, 12, 6, 12))
    b.button(bub, "Next item", "primary", size=12, pad=(6, 12, 6, 12))

    # side panel, 320 px like a meeting side panel
    p = b.col(body, "Companion side panel", w=320, sizingV="fill", fill=C["bg"], radius=10, gap=0, clip=True)
    ph = b.row(p, "Panel head", gap=8, pad=[12, 14, 12, 14], fill=C["surface"], sizingH="fill", sides=[0, 0, 1, 0],
               stroke=C["line"])
    m = b.row(ph, "Mark", w=22, h=22, radius=6, fill=C["accent"], main="center")
    b.txt(m, "◆", size=10, style="Bold", color="#FFFFFF")
    b.txt(ph, "Companion", size=14, style="Bold")
    b.spacer(ph)
    b.txt(ph, "⤢  ✕", size=13, color=C["muted"])
    pc = b.col(p, "Panel body", gap=12, pad=12, sizingH="fill", sizingV="fill")

    tm = b.col(pc, "Timer", gap=8, pad=14, radius=12, fill=C["dark"], sizingH="fill")
    b.txt(tm, "ITEM 2 OF 5", size=10, style="SemiBold", color=C["darkMuted"], ls=0.8)
    b.txt(tm, "Beta launch: scope and date", size=14, style="SemiBold", color=C["darkInk"], fillW=True)
    tr = b.row(tm, "Time", gap=6, cross="max")
    b.txt(tr, "3:12", size=30, style="Bold", color="#FFFFFF")
    b.txt(tr, "left of 15:00", size=12, color=C["darkMuted"])
    b.progress(tm, 268, 0.79, "#F5B342", track=C["dark3"], h=6)

    tabs = b.row(pc, "Tabs", gap=2, pad=3, fill=C["sunken"], radius=8, sizingH="fill")
    for lbl, on in (("Captures", True), ("Agenda", False), ("Map", False)):
        t_ = b.row(tabs, lbl, pad=[5, 8, 5, 8], radius=6, fill=C["surface"] if on else "none", main="center", sizingH="fill")
        b.txt(t_, lbl, size=12, style="SemiBold", color=C["ink"] if on else C["muted"])

    sg = b.col(pc, "Suggested decision", gap=8, pad=12, radius=10, fill=C["surface"], stroke=C["accent"], sizingH="fill")
    b.chip(sg, "✦ Suggested decision", C["accentInk"], C["accentSoft"], size=10, pad=(2, 7, 2, 7))
    b.txt(sg, "Beta launches on 14 Nov without offline mode", size=13, style="SemiBold", fillW=True)
    ar = b.row(sg, "Actions", gap=6, sizingH="fill")
    b.button(ar, "Confirm", "primary", size=12, pad=(6, 10, 6, 10), fillW=True)
    b.button(ar, "Edit", "ghost", size=12, pad=(6, 10, 6, 10))

    td = b.col(pc, "To-do", gap=6, pad=12, radius=10, fill=C["surface"], stroke=C["line"], sizingH="fill")
    b.chip(td, "To-do", C["amber"], C["amberSoft"], size=10, pad=(2, 7, 2, 7))
    b.txt(td, "Inform the third pilot school", size=13, style="SemiBold", fillW=True)
    tr2 = b.row(td, "Owner", gap=6)
    b.avatar(tr2, "YA", 18)
    b.txt(tr2, "Yusuf · Fri", size=11, color=C["ink2"])

    tx = b.col(pc, "Transcript tail", gap=6, pad=12, radius=10, fill=C["surface"], stroke=C["line"], sizingH="fill")
    b.txt(tx, "LIVE TRANSCRIPT", size=10, style="SemiBold", color=C["muted"], ls=0.8)
    for who, line in (("MK", "Then let's cut offline and go with the 14th."), ("YA", "Fine, as long as we tell the third school.")):
        r = b.row(tx, who, gap=6, sizingH="fill", cross="min")
        b.avatar(r, who, 18)
        b.txt(r, line, size=12, color=C["ink2"], fillW=True)
    b.spacer(pc, "v")
    b.button(pc, "Share to stage", "dark", size=13, pad=(10, 12, 10, 12), icon="⇪", fillW=True, key="stage")
    b.txt(pc, "Everyone sees the agenda and map; only the organizer can confirm.", size=11, color=C["muted"],
          fillW=True, align="center")
    return b
