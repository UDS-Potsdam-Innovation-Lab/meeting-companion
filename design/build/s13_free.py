from kit import B, C, SHADOW
from s2_live import segmented
from s3_mindmap import pill, curve

TOPICS = [
    ("Offline mode for the beta", 14, "decided", C["accent"]),
    ("Teacher onboarding", 9, "open", C["amber"]),
    ("Release notes language", 4, "open", C["teal"]),
    ("Interview recruiting", 3, "live", C["red"]),
]


def build(x=0, y=0):
    b = B("s13_")
    s = b.col(None, "13 Agenda-free meeting", w=1440, h=900, fill=C["bg"], x=x, y=y, clip=True, key="screen")
    t = b.topbar(s, "Quick sync · no agenda")
    b.chip(t, "Free mode", C["accentInk"], C["accentSoft"], size=12)
    b.chip(t, "REC  00:30:12", C["red"], C["redSoft"], dot=C["red"])
    b.button(t, "End meeting", "dark", size=13, pad=(8, 14, 8, 14), key="end")

    body = b.row(s, "Body", gap=20, pad=[20, 24, 20, 24], sizingH="fill", sizingV="fill", cross="min")

    # left: topics as they come up
    left = b.col(body, "Topics", gap=12, w=300, sizingV="fill")
    clk = b.card(left, "Meeting time", pad=18, gap=8, fill=C["dark"], stroke=None, effects=SHADOW)
    b.txt(clk, "NO AGENDA · 60 MIN SLOT", size=11, style="SemiBold", color=C["darkMuted"], ls=0.8)
    cr = b.row(clk, "Time", gap=8, cross="max")
    b.txt(cr, "30", size=44, style="Bold", color="#FFFFFF", ls=-1.5)
    b.txt(cr, "min left · ends 11:00", size=13, color=C["darkMuted"])
    b.progress(clk, 264, 0.5, "#8F89FF", track=C["dark3"], h=8)

    tl = b.card(left, "Topic list", pad=[12, 14, 12, 14], gap=10, sizingV="fill")
    th = b.row(tl, "Head", gap=6, sizingH="fill")
    b.txt(th, "Topics so far", size=14, style="SemiBold")
    b.spacer(th)
    b.txt(th, "detected", size=12, color=C["muted"])
    for name, mins, state, col in TOPICS:
        r = b.col(tl, name, gap=6, sizingH="fill", pad=[8, 10, 8, 10], radius=10,
                  fill=C["accentSoft"] if state == "live" else "none")
        rr = b.row(r, "Row", gap=8, sizingH="fill")
        b.dot(rr, 8, col)
        b.txt(rr, name, size=13, style="SemiBold", fillW=True)
        b.txt(rr, f"{mins} min", size=12, color=C["muted"])
        b.progress(r, 240, mins / 30, col, h=4)
        lbl, fg, bg = {"decided": ("✓ 1 decision", C["green"], C["greenSoft"]),
                       "open": ("no outcome yet", C["amber"], C["amberSoft"]),
                       "live": ("● talking now", C["accentInk"], C["surface"])}[state]
        b.chip(r, lbl, fg, bg, size=10, pad=(2, 7, 2, 7))
    b.spacer(tl, "v")
    b.button(tl, "Turn topics into an agenda", "soft", size=12, pad=(8, 12, 8, 12), fillW=True, key="toagenda")

    # center: map growing from the conversation
    mid = b.card(body, "Emerging map", pad=0, gap=0, sizingV="fill", effects=SHADOW)
    mh = b.row(mid, "Header", gap=12, pad=[14, 20, 14, 20], sizingH="fill", sides=[0, 0, 1, 0], stroke=C["line"])
    segmented(b, mh, ["Transcript", "Mind map", "Notes"], "Mind map")
    b.spacer(mh)
    b.txt(mh, "Grouped by topic, not by agenda", size=12, color=C["muted"])
    m = b.node("frame", mid, name="Map", w=660, h=700, fill="none", sizingH="fill", sizingV="fill", clip=True)
    cx, cy = 330, 300
    spots = [(-1, 130, TOPICS[0], ["✓ Beta without offline", "Wi-Fi in 2 of 3 schools"]),
             (1, 150, TOPICS[1], ["Start guide, max 2 pages", "Survey: 38%"]),
             (-1, 470, TOPICS[2], ["? German only"]),
             (1, 450, TOPICS[3], ["6 interviews in Jan"])]
    for side, by, (name, _, state, col), leaves in spots:
        bx = cx + side * 170
        b.node("vector", m, name=f"Link {name}", path=curve(cx + side * 70, cy, bx - side * 85, by), x=0, y=0,
               fill="none", stroke=col, strokeWeight=3, **({"dashes": [6, 5]} if state == "live" else {}))
        for i, lf in enumerate(leaves):
            ly = by + 52 + i * 40
            b.node("vector", m, name="Leaf link", path=f"M {bx} {by + 20} L {bx} {ly - 16}", x=0, y=0, fill="none",
                   stroke=col, strokeWeight=1.5, opacity=0.5)
    pill(b, m, cx, cy, 150, 52, "Quick sync", "#FFFFFF", C["ink"], size=15, style="Bold", name="Center")
    for side, by, (name, _, state, col), leaves in spots:
        bx = cx + side * 170
        pill(b, m, bx, by, 190, 40, name, col if state != "decided" else "#FFFFFF",
             C["surface"] if state == "live" else (col if state == "decided" else C["sunken"]),
             stroke=col if state == "live" else None, size=13, dashed=state == "live", name=f"Topic {name}")
        for i, lf in enumerate(leaves):
            ly = by + 52 + i * 40
            dec = lf.startswith("✓")
            pill(b, m, bx, ly, 180, 30, lf, C["green"] if dec else C["ink2"], C["greenSoft"] if dec else C["surface"],
                 stroke=None if dec else C["line"], size=12, style="Regular" if not dec else "SemiBold", name=f"Leaf {lf}")

    # right: nudges and captures
    right = b.col(body, "Captures", gap=12, w=360, sizingV="fill")
    nd = b.card(right, "Nudge", gap=8, pad=16, fill=C["amberSoft"], stroke=None)
    b.txt(nd, "⏱  Half the time is gone", size=14, style="SemiBold", color=C["amber"])
    b.txt(nd, "Two topics have no outcome yet: teacher onboarding and the release notes language. "
              "Settle them now or park them?", size=13, color=C["ink2"], fillW=True, lh="145%")
    nr = b.row(nd, "Actions", gap=8)
    b.button(nr, "Go back to onboarding", "ghost", size=12, pad=(6, 12, 6, 12))
    b.button(nr, "Park both", "ghost", size=12, pad=(6, 12, 6, 12))
    cp = b.card(right, "Captured", gap=10, pad=16)
    b.txt(cp, "Captured", size=14, style="SemiBold")
    for lbl, fg, bg, txt_ in (("✓ Decision", C["green"], C["greenSoft"], "Beta launches without offline mode"),
                              ("☐ To-do", C["amber"], C["amberSoft"], "Jana drafts the start guide"),
                              ("? Question", C["accentInk"], C["accentSoft"], "Release notes in German only?")):
        r = b.col(cp, lbl, gap=4, pad=[10, 0, 10, 0], sizingH="fill", sides=[1, 0, 0, 0], stroke=C["line"])
        b.chip(r, lbl, fg, bg, size=10, pad=(2, 7, 2, 7))
        b.txt(r, txt_, size=13, style="SemiBold", fillW=True)
    b.spacer(right, "v")
    hint = b.col(right, "How free mode works", gap=6, pad=16, radius=14, fill=C["sunken"], sizingH="fill")
    b.txt(hint, "How free mode works", size=13, style="SemiBold")
    for ln in ("Topics are found from the conversation, not planned",
               "Time is kept for the whole meeting, not per item",
               "Notes and next steps are grouped by topic afterwards"):
        b.txt(hint, "·  " + ln, size=12, color=C["ink2"], fillW=True)
    return b
