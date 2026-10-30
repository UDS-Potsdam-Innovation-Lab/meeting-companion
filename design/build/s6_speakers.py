from kit import B, C, SHADOW, PEOPLE

# detected voice, matched attendee (or None), confidence, talk share, sample line, source
VOICES = [
    ("Voice A", "MK", 0.96, 0.27, "Okay. Let's start with a quick check-in…", "Name round"),
    ("Voice B", "TB", 0.91, 0.22, "If we keep the offline mode in scope…", "Name round"),
    ("Voice C", "LS", 0.88, 0.24, "The pilot schools don't need offline…", "Remembered voice"),
    ("Voice D", None, 0.54, 0.15, "Fine with me, as long as we tell the third…", "Unsure: Yusuf or Jana?"),
    ("Voice E", None, 0.0, 0.08, "Hi, I'm from the district office, just listening…", "Not on the invite"),
]


def build(x=0, y=0):
    b = B("s6_")
    s = b.col(None, "06 Who is speaking", w=1440, h=900, fill=C["bg"], x=x, y=y, clip=True, key="screen")
    t = b.topbar(s, "Product sync · Beta launch")
    b.chip(t, "REC  00:02:10", C["red"], C["redSoft"], dot=C["red"])
    b.button(t, "Back to meeting", "ghost", size=13, pad=(8, 14, 8, 14), key="back")

    body = b.row(s, "Body", gap=24, pad=[24, 32, 24, 32], sizingH="fill", sizingV="fill", cross="min")
    left = b.col(body, "Voices", gap=16, sizingH="fill", sizingV="fill")
    hd = b.col(left, "Heading", gap=4, sizingH="fill")
    b.txt(hd, "Speakers", size=13, style="SemiBold", color=C["accent"])
    b.txt(hd, "5 voices detected · 3 matched", size=28, style="Bold", ls=-0.5)
    b.txt(hd, "Tap a voice to hear it, then pick the person. Names apply to the whole transcript, also backwards.",
          size=14, color=C["ink2"], fillW=True)

    lst = b.card(left, "Voice list", pad=8, gap=0, effects=SHADOW)
    for i, (voice, who, conf, share, line, src) in enumerate(VOICES):
        unsure = who is None
        r = b.row(lst, voice, gap=14, pad=[14, 14, 14, 14], radius=12, sizingH="fill",
                  fill=C["amberSoft"] if i == 3 else "none",
                  **({"sides": [1, 0, 0, 0], "stroke": C["line"]} if i and i != 3 and i != 4 else {}))
        play = b.row(r, "Play", w=40, h=40, radius=20, fill=C["accentSoft"], main="center")
        b.txt(play, "▶", size=14, color=C["accent"])
        vc = b.col(r, "Voice", gap=4, sizingH="fill")
        vr = b.row(vc, "Meta", gap=8)
        b.txt(vr, voice, size=14, style="SemiBold")
        wave = b.row(vr, "Wave", gap=2)
        for h_ in (4, 9, 14, 7, 12, 5, 10, 13, 6, 8):
            b.rect(wave, 2, h_, C["muted"], radius=1, name="Bar")
        b.txt(vr, f"{round(share*100)}% talk time", size=12, color=C["muted"])
        b.txt(vc, f"“{line}”", size=13, color=C["ink2"], fillW=True, fontStyle="Italic")
        b.txt(r, "→", size=16, color=C["muted"])
        pick = b.row(r, "Person", gap=8, pad=[6, 12, 6, 8], w=230, radius=10, fill=C["surface"],
                     stroke=C["accent"] if i == 3 else C["line"])
        if who:
            b.avatar(pick, who, 26)
            pc = b.col(pick, "Name", gap=0, sizingH="fill")
            b.txt(pc, PEOPLE[who][0], size=13, style="SemiBold", fillW=True)
            b.txt(pc, f"{round(conf*100)}% · {src}", size=11, color=C["green"], fillW=True)
        elif i == 3:
            b.avatar(pick, "YA", 26)
            pc = b.col(pick, "Name", gap=0, sizingH="fill")
            b.txt(pc, "Yusuf Aydin?", size=13, style="SemiBold", fillW=True)
            b.txt(pc, src, size=11, color=C["amber"], fillW=True)
        else:
            gb = b.row(pick, "Guest", w=26, h=26, radius=13, fill=C["sunken"], main="center")
            b.txt(gb, "+", size=14, style="Bold", color=C["ink2"])
            pc = b.col(pick, "Name", gap=0, sizingH="fill")
            b.txt(pc, "Add guest…", size=13, style="SemiBold", fillW=True)
            b.txt(pc, src, size=11, color=C["muted"], fillW=True)
        b.txt(pick, "▾", size=12, color=C["muted"])

    tl = b.card(left, "Timeline", gap=10, effects=SHADOW)
    th = b.row(tl, "Head", gap=8, sizingH="fill")
    b.txt(th, "Who spoke when", size=14, style="SemiBold")
    b.spacer(th)
    b.txt(th, "first 2 min · name round", size=12, color=C["muted"])
    cols = {"Voice A": PEOPLE["MK"][1], "Voice B": PEOPLE["TB"][1], "Voice C": PEOPLE["LS"][1], "Voice D": C["amber"], "Voice E": C["muted"]}
    for v, segs in (("Voice A", [(0, 60), (300, 40), (560, 50)]), ("Voice B", [(70, 70), (420, 90)]),
                    ("Voice C", [(150, 80), (620, 60)]), ("Voice D", [(240, 50), (520, 30)]), ("Voice E", [(350, 60)])):
        r = b.row(tl, v, gap=12, sizingH="fill")
        b.txt(r, v, size=12, color=C["ink2"], w=60)
        lane = b.node("frame", r, name="Lane", w=700, h=14, fill=C["sunken"], cornerRadius=4, sizingH="fill", clip=True)
        for sx, sw in segs:
            b.node("rectangle", lane, name="Turn", x=sx, y=0, w=sw, h=14, fill=cols[v], cornerRadius=4)

    # right column: attendees + how matching works
    right = b.col(body, "Attendees", gap=16, w=400, sizingV="fill")
    at = b.card(right, "Invited", gap=0, pad=[14, 20, 8, 20], effects=SHADOW)
    b.txt(at, "Invited · 5", size=14, style="SemiBold")
    rows = [("MK", "In the room", "Voice A"), ("TB", "In the room", "Voice B"), ("LS", "Remote · Teams", "Voice C"),
            ("YA", "In the room", "Voice D?"), ("JR", "Remote · Teams", "Teams name")]
    for i, (ini, where, src) in enumerate(rows):
        r = b.row(at, PEOPLE[ini][0], gap=10, pad=[10, 0, 10, 0], sizingH="fill", sides=[1, 0, 0, 0], stroke=C["line"])
        b.avatar(r, ini, 30)
        cc = b.col(r, "Text", gap=1, sizingH="fill")
        b.txt(cc, PEOPLE[ini][0], size=14, style="SemiBold", fillW=True)
        b.txt(cc, where, size=12, color=C["muted"], fillW=True)
        q = src.endswith("?")
        b.chip(r, src, C["amber"] if q else C["green"], C["amberSoft"] if q else C["greenSoft"], size=11)

    how = b.card(right, "How names are found", gap=10, fill=C["sunken"], stroke=None)
    b.txt(how, "How names are found", size=14, style="SemiBold")
    for ln in ("1  Name round at check-in: everyone says their name once",
               "2  Remote people come with their Teams / Zoom name",
               "3  Voices are remembered only for people who opted in",
               "4  Anything unsure waits for a person to confirm"):
        b.txt(how, ln, size=13, color=C["ink2"], fillW=True)
    b.spacer(right, "v")
    tg = b.row(right, "Remember", gap=12, pad=[14, 16, 14, 16], fill=C["surface"], radius=12, stroke=C["line"], sizingH="fill")
    tc = b.col(tg, "Text", gap=1, sizingH="fill")
    b.txt(tc, "Ask people to save their voice", size=14, style="SemiBold", fillW=True)
    b.txt(tc, "Each person decides on their own device", size=12, color=C["muted"], fillW=True)
    k = b.row(tg, "Toggle", w=40, h=24, radius=12, pad=3, fill=C["line"], main="min")
    b.dot(k, 18, "#FFFFFF", name="Knob")
    b.button(right, "Apply names to transcript", "primary", size=16, pad=(16, 20, 16, 20), fillW=True, key="apply")
    return b
