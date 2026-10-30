from kit import B, C, SHADOW, PEOPLE

NOTES = [
    ("01 Check-in & goals", "Goal for today: commit to a beta date. Pilot check-ins move to Thursdays.", None, "👍 4"),
    ("02 Beta launch", "The beta launches on 14 Nov without offline mode. Offline support follows in the next release; "
                       "the third pilot school is informed this week.", None, "👍 5"),
    ("03 Pilot schools", "Feedback is positive overall. Onboarding scored lowest at {old}{new} in the October survey; "
                         "teachers ask for a short start guide.", ("LS", "52%", "38%"), "💬 1"),
    ("04 Q1 research budget", "€18k approved, recruiting in-house.", None, "👍 3"),
]

STEPS = [
    ("Inform the third pilot school", "YA", "Fri 1 Nov", "accepted", "Accepted by Yusuf"),
    ("Draft a 10-minute start guide for teachers", "JR", "Wed 6 Nov → Fri 8 Nov", "proposed", "Jana proposes a later date"),
    ("Book 6 teacher interviews for January", "LS", "Fri 15 Nov", "accepted", "Accepted by Lena"),
    ("Check SSO options for the school districts", "TB", "—", "reassign", "Tobias: “Not mine, Yusuf knows the districts”"),
]


def build(x=0, y=0):
    b = B("s8_")
    s = b.col(None, "08 Team review (optional)", w=1440, h=900, fill=C["bg"], x=x, y=y, clip=True, key="screen")
    t = b.topbar(s, "Product sync · Beta launch")
    b.chip(t, "Ended · 58 min", C["ink2"], C["sunken"], dot=C["muted"])
    b.button(t, "Skip review", "ghost", size=13, pad=(8, 14, 8, 14), key="skip")

    body = b.col(s, "Body", gap=18, pad=[24, 32, 24, 32], sizingH="fill", sizingV="fill")
    hd = b.row(body, "Heading", gap=16, sizingH="fill", cross="max")
    hc = b.col(hd, "Text", gap=4, sizingH="fill")
    b.txt(hc, "Team review · optional · before anything is sent", size=13, style="SemiBold", color=C["accent"])
    b.txt(hc, "Check the notes and next steps together", size=30, style="Bold", ls=-0.6)
    st = b.row(hd, "Status", gap=6)
    for ini, done in (("MK", 1), ("TB", 1), ("LS", 1), ("YA", 1), ("JR", 0)):
        b.avatar(st, ini, 28, ring=C["green"] if done else C["line"])
    b.txt(st, "  4 of 5 have reviewed", size=13, color=C["ink2"])

    cols = b.row(body, "Columns", gap=20, sizingH="fill", sizingV="fill", cross="min")

    # notes
    nt = b.card(cols, "Notes", gap=0, pad=[8, 22, 8, 22], sizingV="fill", effects=SHADOW)
    nh = b.row(nt, "Head", gap=8, pad=[10, 0, 10, 0], sizingH="fill")
    b.txt(nh, "Notes", size=16, style="Bold")
    b.txt(nh, "draft by the assistant · edited by 2 people", size=12, color=C["muted"])
    for i, (h_, body_, edit, react) in enumerate(NOTES):
        sec = b.col(nt, h_, gap=6, pad=[12, 0, 12, 0], sizingH="fill", sides=[1, 0, 0, 0], stroke=C["line"])
        sh = b.row(sec, "Head", gap=8, sizingH="fill")
        b.txt(sh, h_, size=13, style="SemiBold", color=C["accentInk"])
        b.spacer(sh)
        b.txt(sh, react, size=12, color=C["muted"])
        if edit:
            who, old, new = edit
            pre, post = body_.split("{old}{new}")
            full = pre + old + " " + new + post
            tx = b.txt(sec, full, size=14, color=C["ink"], fillW=True, lh="150%")
            # mark the suggested change: old struck, new highlighted
            a = len(pre)
            b.cmd("text.style", id={"$ref": tx}, start=a, end=a + len(old), textDecoration="strikethrough",
                  textFills=[{"type": "solid", "color": C["red"]}])
            b.cmd("text.style", id={"$ref": tx}, start=a + len(old) + 1, end=a + len(old) + 1 + len(new),
                  textDecoration="underline", textFills=[{"type": "solid", "color": C["green"]}], fontStyle="SemiBold")
            sg = b.row(sec, "Suggestion", gap=8, pad=[8, 10, 8, 10], radius=8, fill=C["amberSoft"], sizingH="fill")
            b.avatar(sg, who, 20)
            b.txt(sg, "Lena: the 52% was July, October is 38%", size=12, color=C["ink2"], fillW=True)
            b.button(sg, "Accept", "primary", size=11, pad=(4, 10, 4, 10))
            b.button(sg, "Reject", "ghost", size=11, pad=(4, 10, 4, 10))
        else:
            b.txt(sec, body_, size=14, color=C["ink"], fillW=True, lh="150%")
    pk = b.row(nt, "Parked", gap=8, pad=[12, 0, 12, 0], sizingH="fill", sides=[1, 0, 0, 0], stroke=C["line"])
    b.txt(pk, "Parked: SSO for schools, dark mode → next meeting's agenda", size=13, color=C["muted"], fillW=True)

    # next steps
    ns = b.card(cols, "Next steps", gap=0, pad=[8, 20, 8, 20], w=440, fillW=False, sizingV="fill", effects=SHADOW)
    nsh = b.row(ns, "Head", gap=8, pad=[10, 0, 10, 0], sizingH="fill")
    b.txt(nsh, "Next steps", size=16, style="Bold")
    b.spacer(nsh)
    b.txt(nsh, "owners confirm their own", size=12, color=C["muted"])
    for task, who, due, state, note in STEPS:
        r = b.col(ns, task, gap=6, pad=[12, 0, 12, 0], sizingH="fill", sides=[1, 0, 0, 0], stroke=C["line"])
        tr = b.row(r, "Title", gap=8, sizingH="fill", cross="min")
        b.avatar(tr, who, 22)
        b.txt(tr, task, size=14, style="SemiBold", fillW=True)
        mr = b.row(r, "Meta", gap=8, sizingH="fill", pad=[0, 0, 0, 30])
        b.txt(mr, due, size=12, color=C["ink2"])
        b.spacer(mr)
        fg, bg, lbl = {"accepted": (C["green"], C["greenSoft"], "✓ Accepted"),
                       "proposed": (C["amber"], C["amberSoft"], "New date?"),
                       "reassign": (C["red"], C["redSoft"], "Hand over?")}[state]
        b.chip(mr, lbl, fg, bg, size=11, pad=(2, 8, 2, 8))
        if state != "accepted":
            q = b.row(r, "Question", gap=8, pad=[8, 10, 8, 10], radius=8, fill=C["sunken"], sizingH="fill")
            b.txt(q, note, size=12, color=C["ink2"], fillW=True)
            b.button(q, "OK", "primary", size=11, pad=(4, 10, 4, 10))
    dc = b.row(ns, "Decisions", gap=8, pad=[12, 0, 12, 0], sizingH="fill", sides=[1, 0, 0, 0], stroke=C["line"])
    b.txt(dc, "✓", size=13, style="Bold", color=C["green"])
    b.txt(dc, "3 decisions · no objections", size=13, style="SemiBold", fillW=True)

    # phone
    side = b.col(cols, "Phone column", gap=12, w=240, sizingV="fill", cross="center")
    ph = b.col(side, "Phone", w=240, h=470, pad=[16, 14, 16, 14], gap=10, fill=C["surface"], radius=32,
               stroke=C["ink"], strokeWeight=6, clip=True)
    b.rect(ph, 64, 6, C["ink"], radius=3, name="Notch")
    b.txt(ph, "Your next steps · Jana", size=12, color=C["muted"])
    pc = b.col(ph, "To-do", gap=8, pad=12, radius=12, fill=C["bg"], sizingH="fill")
    b.txt(pc, "Draft a 10-minute start guide for teachers", size=14, style="Bold", fillW=True, lh="130%")
    b.txt(pc, "Due Wed 6 Nov · goes to Jira", size=11, color=C["ink2"], fillW=True)
    b.button(pc, "Accept", "primary", size=12, pad=(8, 10, 8, 10), fillW=True)
    rr = b.row(pc, "More", gap=6, sizingH="fill")
    b.button(rr, "Other date", "ghost", size=11, pad=(6, 8, 6, 8), fillW=True)
    b.button(rr, "Not mine", "ghost", size=11, pad=(6, 8, 6, 8), fillW=True)
    b.txt(ph, "Notes", size=12, style="SemiBold")
    nn = b.col(ph, "Notes preview", gap=4, pad=10, radius=10, fill=C["bg"], sizingH="fill")
    b.txt(nn, "02 Beta launch · 14 Nov without offline…", size=11, color=C["ink2"], fillW=True)
    b.txt(nn, "Tap a line to comment", size=10, color=C["muted"], fillW=True)
    b.txt(side, "Scan the QR on the board, or open the link in the Teams chat", size=11, color=C["muted"], fillW=True,
          align="center")

    ft = b.row(body, "Footer", gap=16, sizingH="fill")
    b.txt(ft, "If nobody objects, the review closes at 12:00 and results are sent as they are.", size=13,
          color=C["muted"], fillW=True)
    b.button(ft, "Approve and send to 4 apps", "primary", size=15, pad=(14, 22, 14, 22), key="continue")
    return b
