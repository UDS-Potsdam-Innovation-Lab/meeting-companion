from kit import B, C, SHADOW
from s2_live import segmented


def slide(b, parent, w, h, n, title, active=False, big=False, name=None):
    sl = b.col(parent, name or f"Slide {n}", w=w, h=h, pad=round(w * 0.06), gap=round(h * 0.05), fill="#FFFFFF",
               radius=6 if not big else 12, stroke=C["accent"] if active else C["line"],
               strokeWeight=3 if active else 1, clip=True)
    b.rect(sl, round(w * 0.12), max(2, round(h * 0.025)), C["amber"], name="Accent")
    b.txt(sl, title, size=max(6, round(w * 0.05)), style="Bold", fillW=True)
    if big:
        row = b.row(sl, "Content", gap=28, sizingH="fill", sizingV="fill", cross="max")
        for lbl, v, col in (("Easy to start", 0.82, C["green"]), ("Fits lessons", 0.64, C["accent"]),
                            ("Teacher onboarding", 0.38, C["amber"]), ("Works offline", 0.21, C["red"])):
            cc = b.col(row, lbl, gap=8, sizingH="fill", cross="center")
            b.txt(cc, f"{round(v*100)}%", size=18, style="Bold", color=col)
            b.rect(cc, 70, round(220 * v), col, radius=6, name="Bar")
            b.txt(cc, lbl, size=13, color=C["ink2"], align="center")
        b.txt(sl, "Survey of 46 teachers in 3 pilot schools, October", size=12, color=C["muted"])
    else:
        for wd in (0.8, 0.6, 0.7):
            b.rect(sl, round((w - 2 * w * 0.06) * wd), max(2, round(h * 0.04)), C["sunken"], radius=2, name="Line")
    return sl


def build(x=0, y=0):
    b = B("s7_")
    s = b.col(None, "07 Slides in the meeting", w=1440, h=900, fill=C["bg"], x=x, y=y, clip=True, key="screen")
    t = b.topbar(s, "Product sync · Beta launch")
    b.chip(t, "Item 03 · Pilot schools", C["amber"], C["amberSoft"])
    b.chip(t, "REC  00:31:05", C["red"], C["redSoft"], dot=C["red"])
    b.button(t, "End meeting", "dark", size=13, pad=(8, 14, 8, 14), key="end")

    body = b.row(s, "Body", gap=20, pad=[20, 24, 20, 24], sizingH="fill", sizingV="fill", cross="min")
    left = b.col(body, "Deck", gap=14, sizingH="fill", sizingV="fill")
    dh = b.row(left, "Deck head", gap=10, sizingH="fill")
    b.avatar(dh, "LS", 30)
    dc = b.col(dh, "Text", gap=1)
    b.txt(dc, "Lena is presenting “Pilot feedback.pptx”", size=15, style="SemiBold")
    b.txt(dc, "Detected from the board's HDMI input · slide changes are logged automatically", size=12, color=C["muted"])
    b.spacer(dh)
    b.chip(dh, "Slide 7 / 14", C["ink2"], C["surface"], size=12)
    b.chip(dh, "On pace · 9 of 20 min", C["green"], C["greenSoft"], size=12)
    slide(b, left, 872, 490, 7, "What teachers told us", big=True, name="Current slide")
    strip = b.row(left, "Slide strip", gap=10, sizingH="fill")
    titles = ["Pilot overview", "Schools", "Timeline", "Usage", "Top requests", "Quotes", "What teachers told us",
              "Onboarding gaps"]
    for i, ti in enumerate(titles, 1):
        c = b.col(strip, f"Thumb {i}", gap=4)
        slide(b, c, 96, 54, i, ti, active=i == 7)
        meta = {3: "1 question", 5: "1 to-do", 7: "live"}.get(i, "")
        b.txt(c, f"{i}  {meta}", size=10, color=C["accent"] if i == 7 else C["muted"])

    tips = b.row(left, "How slides work", gap=12, sizingH="fill", cross="min")
    for h_, d_ in (("Split view on the board", "Slides take 70% of the board, the companion keeps 30%: timer, captures, agenda."),
                   ("Slides feed the timekeeper", "14 slides in 20 min: the pace shows if the deck will fit the slot."),
                   ("Notes per slide", "After the meeting, each slide is exported with what was said and decided on it.")):
        c = b.card(tips, h_, gap=4, pad=14, radius=12)
        b.txt(c, h_, size=13, style="SemiBold", fillW=True)
        b.txt(c, d_, size=12, color=C["ink2"], fillW=True, lh="140%")

    right = b.col(body, "Per slide", gap=12, w=420, sizingV="fill")
    rh = b.row(right, "Head", gap=8, sizingH="fill")
    segmented(b, rh, ["This slide", "Transcript", "Mind map"], "This slide")
    sc = b.card(right, "Slide notes", gap=10, effects=SHADOW)
    b.txt(sc, "SLIDE 7 · SAID WHILE IT WAS SHOWN", size=11, style="SemiBold", color=C["muted"], ls=0.8)
    for who, line in (("LS", "Onboarding is the weak spot. Teachers want a 10-minute start guide."),
                      ("TB", "Can we ship that guide with the beta?"),
                      ("MK", "Only if it's short. Jana, could you draft it?")):
        r = b.row(sc, who, gap=10, sizingH="fill", cross="min")
        b.avatar(r, who, 24)
        b.txt(r, line, size=13, color=C["ink2"], fillW=True, lh="145%")
    sg = b.card(right, "Suggested to-do", gap=8, stroke=C["accent"])
    b.chip(sg, "✦ To-do from slide 7", C["amber"], C["amberSoft"], size=11, pad=(3, 8, 3, 8))
    b.txt(sg, "Draft a 10-minute start guide for teachers", size=14, style="SemiBold", fillW=True)
    sr = b.row(sg, "Actions", gap=8, sizingH="fill")
    b.avatar(sr, "JR", 22)
    b.txt(sr, "Jana · before beta", size=12, color=C["ink2"])
    b.spacer(sr)
    b.button(sr, "Confirm", "primary", size=12, pad=(6, 12, 6, 12))
    mp = b.card(right, "Slide on the map", gap=8, fill=C["sunken"], stroke=None)
    b.txt(mp, "On the mind map", size=13, style="SemiBold")
    b.txt(mp, "The slide title becomes a node under item 03; numbers on the slide are read and kept with the notes.",
          size=12, color=C["ink2"], fillW=True)
    b.spacer(right, "v")
    src = b.card(right, "Sources", gap=8)
    b.txt(src, "Slides can come from", size=13, style="SemiBold")
    sw = b.row(src, "Chips", gap=6, wrap=True, crossGap=6, sizingH="fill")
    for c_ in ("HDMI / screen share", "Teams share", "Uploaded PPTX / PDF", "Link to the deck"):
        b.chip(sw, c_, C["ink2"], C["sunken"], size=12, style="Regular")
    return b
