from kit import B, C

D = {"bg": "#0F1014", "card": "#1A1C22", "card2": "#24262E", "line": "#2E3039", "ink": "#F4F3EE", "muted": "#9497A1"}
ITEMS = [("Check-in & goals", "done"), ("Beta launch: scope and date", "now"), ("Pilot schools", "next"),
         ("Q1 research budget", "next"), ("Open questions", "next")]


def bigbtn(b, parent, label, icon, bg, fg="#FFFFFF", key=None):
    btn = b.col(parent, f"Board {label}", gap=6, pad=[18, 12, 18, 12], fill=bg, radius=20, sizingH="fill",
                cross="center", main="center", h=120, key=key)
    b.txt(btn, icon, size=30, style="Bold", color=fg)
    b.txt(btn, label, size=20, style="SemiBold", color=fg)
    return btn


def build(x=0, y=0):
    b = B("s5_")
    s = b.col(None, "05 Smart board (touch)", w=1920, h=1080, fill=D["bg"], x=x, y=y, clip=True, key="screen",
              pad=[32, 40, 32, 40], gap=28)
    top = b.row(s, "Top", gap=20, sizingH="fill")
    mark = b.row(top, "Mark", w=44, h=44, radius=12, fill=C["accent"], main="center")
    b.txt(mark, "◆", size=20, style="Bold", color="#FFFFFF")
    b.txt(top, "Product sync · Beta launch", size=26, style="SemiBold", color=D["ink"])
    b.chip(top, "REC 00:23:41", "#FF8A8E", "#3A1D20", dot="#FF5A60", size=16, pad=(8, 14, 8, 14))
    b.spacer(top)
    for ini in ("MK", "TB", "LS", "YA", "JR"):
        b.avatar(top, ini, 44, ring=D["bg"])
    b.txt(top, "10:21", size=26, style="SemiBold", color=D["muted"])

    body = b.row(s, "Body", gap=28, sizingH="fill", sizingV="fill", cross="min")

    # timer column
    tcol = b.col(body, "Timer", gap=24, w=620, sizingV="fill", pad=32, fill=D["card"], radius=28, cross="center")
    b.txt(tcol, "ITEM 2 OF 5", size=16, style="SemiBold", color=D["muted"], ls=1.5)
    b.txt(tcol, "Beta launch: scope and date", size=30, style="Bold", color=D["ink"], align="center", fillW=True)
    ring = b.node("frame", tcol, name="Ring", w=380, h=380, fill="none")
    b.node("ellipse", ring, name="Track", x=0, y=0, w=380, h=380, fill=D["card2"], arcInner=0.86)
    b.node("ellipse", ring, name="Elapsed", x=0, y=0, w=380, h=380, fill="#F5B342", arcInner=0.86,
           arcStart=-90, arcSweep=284)
    lbl = b.col(ring, "Label", w=380, h=380, x=0, y=0, main="center", cross="center", gap=4)
    b.txt(lbl, "3:12", size=104, style="Bold", color="#FFFFFF", ls=-3, features={"tnum": True})
    b.txt(lbl, "left of 15 min", size=20, color=D["muted"])
    br = b.row(tcol, "Timer actions", gap=14, sizingH="fill")
    bigbtn(b, br, "+5 min", "＋", D["card2"])
    bigbtn(b, br, "Park it", "P", D["card2"])
    bigbtn(b, br, "Next item", "›", C["accent"], key="next")

    b.spacer(tcol, "v")
    nx = b.row(tcol, "Up next", gap=12, pad=[18, 20, 18, 20], fill=D["card2"], radius=16, sizingH="fill")
    b.txt(nx, "Up next", size=18, color=D["muted"])
    b.txt(nx, "Pilot schools · 20 min · Lena", size=18, style="SemiBold", color=D["ink"], fillW=True)
    b.chip(nx, "Parking lot 2", D["ink"], D["line"], size=15, pad=(5, 12, 5, 12))

    # captures column
    mid = b.col(body, "Captures", gap=20, sizingH="fill", sizingV="fill")
    b.txt(mid, "Captured in this item", size=18, style="SemiBold", color=D["muted"])
    sug = b.col(mid, "Decision", gap=14, pad=28, fill=D["card"], radius=24, sizingH="fill", stroke=C["accent"],
                strokeWeight=2)
    b.chip(sug, "✦ Suggested decision", "#C9C5FF", "#2B2860", size=15, pad=(6, 14, 6, 14))
    b.txt(sug, "Beta launches on 14 Nov without offline mode", size=32, style="Bold", color=D["ink"], fillW=True, lh="125%")
    sr = b.row(sug, "Actions", gap=14, sizingH="fill")
    for lab, kind in (("✓  Confirm", C["green"]), ("Edit", D["card2"]), ("Dismiss", D["card2"])):
        bb = b.row(sr, f"Board {lab}", pad=[20, 28, 20, 28], radius=16, fill=kind, main="center",
                   sizingH="fill" if lab.startswith("✓") else None)
        b.txt(bb, lab, size=22, style="SemiBold", color="#FFFFFF")
    td = b.col(mid, "To-do", gap=12, pad=28, fill=D["card"], radius=24, sizingH="fill")
    b.chip(td, "To-do", "#FFCF7A", "#3A2C12", size=15, pad=(6, 14, 6, 14))
    b.txt(td, "Inform the third pilot school", size=26, style="SemiBold", color=D["ink"], fillW=True)
    tr = b.row(td, "Owner", gap=12)
    b.avatar(tr, "YA", 36)
    b.txt(tr, "Yusuf · due Friday", size=20, color=D["muted"])
    b.spacer(mid, "v")
    say = b.row(mid, "Voice hint", gap=14, pad=[18, 24, 18, 24], fill=D["card"], radius=18, sizingH="fill")
    b.txt(say, "🎙", size=24)
    b.txt(say, "Say “Companion, note a decision” or tap below", size=20, color=D["muted"], fillW=True)
    qc = b.row(mid, "Quick capture", gap=14, sizingH="fill")
    for lab, ic, fg in (("Decision", "✓", "#8FE0B0"), ("To-do", "☐", "#FFCF7A"), ("Question", "?", "#C9C5FF"), ("Note", "✎", D["ink"])):
        bigbtn(b, qc, lab, ic, D["card"], fg=fg)

    # agenda column
    ag = b.col(body, "Agenda", gap=10, w=440, sizingV="fill", pad=24, fill=D["card"], radius=28)
    b.txt(ag, "Agenda", size=18, style="SemiBold", color=D["muted"])
    for i, (it, st) in enumerate(ITEMS, 1):
        r = b.row(ag, f"Board item {i}", gap=16, pad=[18, 18, 18, 18], radius=16, sizingH="fill",
                  fill=C["accent"] if st == "now" else "none")
        b.txt(r, "✓" if st == "done" else str(i), size=20, style="Bold",
              color="#8FE0B0" if st == "done" else ("#FFFFFF" if st == "now" else D["muted"]), w=24)
        b.txt(r, it, size=21, style="SemiBold", color="#FFFFFF" if st != "done" else D["muted"], fillW=True)
    b.spacer(ag, "v")
    mm = b.row(ag, "Open mind map", gap=12, pad=[20, 20, 20, 20], radius=16, fill=D["card2"], sizingH="fill",
               main="center", key="map")
    b.txt(mm, "◎  Show mind map", size=20, style="SemiBold", color=D["ink"])
    return b
