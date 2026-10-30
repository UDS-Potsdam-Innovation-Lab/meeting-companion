from kit import B, C, SHADOW, PEOPLE
from teams import T, call_window, tile


def build(x=0, y=0):
    b = B("s11_")
    s, body = call_window(b, "11 Teams call · shared to stage", x, y)
    stage = b.col(body, "Stage", gap=12, sizingH="fill", sizingV="fill")
    strip = b.row(stage, "Video strip", gap=10, sizingH="fill", h=130)
    for lbl, ini in (("Room Aurora (3)", None), ("Lena Sommer", "LS"), ("Jana Roth", "JR"), ("Yusuf Aydin", "YA")):
        t = tile(b, strip, lbl, ini, PEOPLE.get(ini, ("", C["muted"]))[1] if ini else None, room=ini is None,
                 speaking=ini == "LS")
        b.cmds[-1]  # keep tiles small
    app = b.col(stage, "Companion on stage", gap=0, sizingH="fill", sizingV="fill", fill=C["bg"], radius=12, clip=True)
    hd = b.row(app, "Stage head", gap=12, pad=[14, 20, 14, 20], fill=C["surface"], sizingH="fill", sides=[0, 0, 1, 0],
               stroke=C["line"])
    m = b.row(hd, "Mark", w=26, h=26, radius=7, fill=C["accent"], main="center")
    b.txt(m, "◆", size=12, style="Bold", color="#FFFFFF")
    b.txt(hd, "Companion · shared by Mara", size=15, style="SemiBold")
    b.chip(hd, "Live for all 6", C["green"], C["greenSoft"], dot=C["green"], size=12)
    b.spacer(hd)
    b.txt(hd, "Everyone can add notes and vote · decisions need the organizer", size=12, color=C["muted"])

    main = b.row(app, "Stage content", gap=16, pad=20, sizingH="fill", sizingV="fill", cross="min")
    ag = b.col(main, "Agenda", gap=8, w=360, sizingV="fill", pad=16, fill=C["surface"], radius=14, stroke=C["line"])
    b.txt(ag, "Agenda", size=14, style="SemiBold")
    for i, (it, st, tm) in enumerate((("Check-in & goals", "done", "6/5"), ("Beta launch", "done", "17/15"),
                                       ("Pilot schools", "now", "9/20"), ("Q1 research budget", "next", "10"),
                                       ("Open questions", "next", "5")), 1):
        r = b.row(ag, it, gap=10, pad=[10, 10, 10, 10], radius=10, sizingH="fill",
                  fill=C["amberSoft"] if st == "now" else "none")
        b.txt(r, "✓" if st == "done" else str(i), size=13, style="Bold",
              color=C["green"] if st == "done" else C["ink2"], w=16)
        b.txt(r, it, size=14, style="SemiBold" if st == "now" else "Regular",
              color=C["muted"] if st == "done" else C["ink"], fillW=True)
        b.txt(r, f"{tm} min", size=12, color=C["muted"])
    b.spacer(ag, "v")
    vt = b.col(ag, "Quick poll", gap=8, pad=12, radius=10, fill=C["accentSoft"], sizingH="fill")
    b.txt(vt, "Quick poll · 4 of 6 voted", size=12, style="SemiBold", color=C["accentInk"])
    b.txt(vt, "Ship the start guide with the beta?", size=14, style="SemiBold", fillW=True)
    for lbl, v in (("Yes", 0.75), ("Later", 0.25)):
        pr = b.row(vt, lbl, gap=8, sizingH="fill")
        b.txt(pr, lbl, size=12, w=40)
        b.progress(pr, 240, v, C["accent"], track="#FFFFFF", h=8)

    mp = b.col(main, "Map + captures", gap=16, sizingH="fill", sizingV="fill")
    cap = b.row(mp, "Captures", gap=16, sizingH="fill")
    for chip_, fg, bg, txt_, who in (("✓ Decided", C["green"], C["greenSoft"], "Beta launches on 14 Nov without offline mode", "MK"),
                                     ("☐ To-do", C["amber"], C["amberSoft"], "Draft a 10-minute start guide for teachers", "JR"),
                                     ("? Open", C["accentInk"], C["accentSoft"], "Release notes in German only?", "TB")):
        c = b.col(cap, chip_, gap=8, pad=16, radius=14, fill=C["surface"], stroke=C["line"], sizingH="fill")
        b.chip(c, chip_, fg, bg, size=11, pad=(3, 8, 3, 8))
        b.txt(c, txt_, size=15, style="SemiBold", fillW=True)
        rr = b.row(c, "Who", gap=6)
        b.avatar(rr, who, 20)
        b.txt(rr, {"MK": "Mara", "JR": "Jana", "TB": "Tobias"}[who], size=12, color=C["ink2"])
    sl = b.row(mp, "Slide + notes", gap=16, sizingH="fill", sizingV="fill", cross="min")
    sv = b.col(sl, "Current slide", gap=10, pad=24, radius=14, fill="#FFFFFF", stroke=C["line"], sizingH="fill", sizingV="fill")
    b.txt(sv, "LENA'S DECK · SLIDE 7 / 14", size=11, style="SemiBold", color=C["muted"], ls=0.8)
    b.rect(sv, 70, 5, C["amber"], name="Accent")
    b.txt(sv, "What teachers told us", size=28, style="Bold")
    bars = b.row(sv, "Bars", gap=24, sizingH="fill", sizingV="fill", cross="max")
    for lbl, v, col in (("Easy to start", 0.82, C["green"]), ("Fits lessons", 0.64, C["accent"]),
                        ("Onboarding", 0.38, C["amber"]), ("Offline", 0.21, C["red"])):
        cc = b.col(bars, lbl, gap=6, sizingH="fill", cross="center")
        b.txt(cc, f"{round(v*100)}%", size=14, style="Bold", color=col)
        b.rect(cc, 56, round(200 * v), col, radius=5, name="Bar")
        b.txt(cc, lbl, size=12, color=C["ink2"])
    nt = b.col(sl, "Shared notes", gap=10, pad=16, w=360, radius=14, fill=C["surface"], stroke=C["line"], sizingV="fill")
    b.txt(nt, "Notes on this slide", size=14, style="SemiBold")
    for who, line in (("JR", "Start guide: max 2 pages, with screenshots"), ("LS", "Onboarding score was 52% at the July pilot"),
                      ("TB", "Ask the district about a training slot")):
        r = b.row(nt, who, gap=8, sizingH="fill", cross="min")
        b.avatar(r, who, 22)
        b.txt(r, line, size=13, color=C["ink2"], fillW=True, lh="140%")
    b.spacer(nt, "v")
    inp = b.row(nt, "Add note", pad=[10, 12, 10, 12], radius=10, fill=C["bg"], stroke=C["line"], sizingH="fill")
    b.txt(inp, "Add a note…", size=13, color=C["muted"])
    return b
