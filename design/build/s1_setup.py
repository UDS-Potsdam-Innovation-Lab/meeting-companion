from kit import B, C, SHADOW
from s2_live import segmented

AGENDA = [
    ("Check-in & goals", "MK", 5, "Inform", "teal"),
    ("Beta launch: scope and date", "TB", 15, "Decide", "accent"),
    ("Pilot schools: feedback so far", "LS", 15, "Discuss", "amber"),
    ("Budget for Q1 user research", "YA", 10, "Decide", "accent"),
    ("Open questions & next steps", "MK", 10, "Discuss", "amber"),
]
KIND = {"teal": (C["teal"], C["tealSoft"]), "accent": (C["accentInk"], C["accentSoft"]), "amber": (C["amber"], C["amberSoft"])}


def build(x=0, y=0):
    b = B("s1_")
    s = b.col(None, "01 Agenda setup", w=1440, h=900, fill=C["bg"], x=x, y=y, clip=True, key="screen")
    t = b.topbar(s, "New meeting")
    b.chip(t, "On-device transcription", C["green"], C["greenSoft"], dot=C["green"])
    b.avatar(t, "MK", 30)

    body = b.row(s, "Body", gap=24, pad=[28, 32, 28, 32], sizingH="fill", sizingV="fill", cross="min")

    # ---- left: agenda builder
    left = b.col(body, "Agenda builder", gap=18, sizingH="fill", sizingV="fill")
    head = b.col(left, "Heading", gap=6, sizingH="fill")
    hr = b.row(head, "Mode", gap=12, sizingH="fill")
    b.txt(hr, "Step 1 of 2 · Before you start", size=13, style="SemiBold", color=C["accent"])
    b.spacer(hr)
    segmented(b, hr, ["With agenda", "Agenda-free"], "With agenda", key_prefix="mode_")
    b.txt(head, "What's on the agenda?", size=32, style="Bold", ls=-0.6)
    b.txt(head, "Type it, paste the calendar invite, or let the assistant draft it from last meeting's open items.",
          size=15, color=C["ink2"], fillW=True)

    ask = b.row(left, "Prompt", gap=12, pad=[14, 14, 14, 18], fill=C["surface"], radius=14, stroke=C["accent"],
                sizingH="fill", effects=[{"type": "dropShadow", "color": "#4338CA22", "offset": [0, 0], "radius": 0, "spread": 4}])
    b.txt(ask, "✦", size=18, style="Bold", color=C["accent"])
    b.txt(ask, "Product sync, 60 min. Decide beta date, review pilot feedback, Q1 research budget…", size=15,
          color=C["ink2"], fillW=True)
    b.button(ask, "Draft agenda", "primary", size=14)

    sources = b.row(left, "Sources", gap=8)
    b.txt(sources, "Also from:", size=13, color=C["muted"])
    for s_ in ("📅  Calendar invite", "↺  Last meeting's open items (3)", "📄  Paste document"):
        b.chip(sources, s_, C["ink2"], C["surface"], size=13, pad=(6, 12, 6, 12), style="Regular")

    lst = b.card(left, "Agenda list", pad=8, gap=0, effects=SHADOW)
    lh = b.row(lst, "List header", gap=12, pad=[10, 14, 10, 14], sizingH="fill")
    for label, wdt in (("#", 24), ("Topic", None), ("Lead", 70), ("Goal", 90), ("Time", 72)):
        tt = b.txt(lh, label.upper(), size=11, style="SemiBold", color=C["muted"], ls=0.6)
        if wdt is None:
            b.cmds[-1]["params"]["props"].update({"sizingH": "fill", "textAutoResize": "height"})
        else:
            b.cmds[-1]["params"]["width"] = wdt
            b.cmds[-1]["params"]["props"]["textAutoResize"] = "height"
    for i, (title, lead, mins, kind, col) in enumerate(AGENDA, 1):
        r = b.row(lst, f"Item {i}", gap=12, pad=[12, 14, 12, 14], sizingH="fill", radius=10,
                  fill=C["accentSoft"] if i == 2 else "none")
        b.txt(r, f"{i:02d}", size=14, style="SemiBold", color=C["muted"], w=24)
        tcol = b.col(r, "Topic", gap=2, sizingH="fill")
        b.txt(tcol, title, size=15, style="SemiBold", fillW=True)
        if i == 2:
            b.txt(tcol, "Outcome: a launch date everyone commits to", size=13, color=C["ink2"], fillW=True)
        lc = b.row(r, "Lead", w=70, gap=6)
        b.avatar(lc, lead, 26)
        gc = b.row(r, "Goal", w=90)
        fg, bg = KIND[col]
        b.chip(gc, kind, fg, bg)
        tc = b.row(r, "Time", w=72, gap=4, pad=[6, 10, 6, 10], fill=C["surface"], radius=8, stroke=C["line"], main="center")
        b.txt(tc, f"{mins} min", size=13, style="SemiBold")
    add = b.row(lst, "Add item", gap=10, pad=[12, 14, 12, 14], sizingH="fill")
    b.txt(add, "+  Add topic", size=14, style="SemiBold", color=C["accent"])
    b.spacer(add)
    b.txt(add, "55 of 60 min planned · 5 min buffer", size=13, color=C["muted"])

    hint = b.row(left, "Assistant hint", gap=14, pad=[14, 18, 14, 18], fill=C["amberSoft"], radius=14, sizingH="fill")
    b.txt(hint, "⏱", size=20, color=C["amber"])
    hc = b.col(hint, "Text", gap=2, sizingH="fill")
    b.txt(hc, "Pilot feedback ran 8 min over in the last two meetings", size=14, style="SemiBold", fillW=True)
    b.txt(hc, "Plan 20 min for item 03 and shorten the open questions to 5?", size=13, color=C["ink2"], fillW=True)
    b.button(hint, "Apply", "ghost", size=13, pad=(8, 14, 8, 14))

    # ---- right: settings
    right = b.col(body, "Settings", gap=16, w=400, sizingV="fill")
    meta = b.card(right, "Meeting", gap=14, effects=SHADOW)
    b.txt(meta, "Product sync · Beta launch", size=18, style="Bold", fillW=True)
    mr = b.row(meta, "When", gap=8)
    b.txt(mr, "Today, 10:00 – 11:00", size=14, color=C["ink2"])
    b.chip(mr, "Room Aurora · Smart board", C["ink2"], C["sunken"], size=12, style="Regular")
    pr = b.row(meta, "People", gap=-6)
    for ini in ("MK", "TB", "LS", "YA", "JR"):
        b.avatar(pr, ini, 32, ring="#FFFFFF")
    b.txt(pr, "   5 participants · 2 remote", size=13, color=C["ink2"])

    st = b.card(right, "Assistant settings", gap=0, pad=[6, 20, 6, 20], effects=SHADOW)
    opts = [
        ("Transcription", "On this device · German + English", True),
        ("Timekeeping", "Nudge at 80% · ask before overrunning", True),
        ("Capture decisions & to-dos", "Suggest, a person confirms", True),
        ("Live mind map", "Group by agenda item", True),
        ("Speaker names", "Match voices to participants", False),
    ]
    for i, (h, sub, on) in enumerate(opts):
        o = b.row(st, h, gap=12, pad=[14, 0, 14, 0], sizingH="fill",
                  **({"sides": [1, 0, 0, 0], "stroke": C["line"]} if i else {}))
        oc = b.col(o, "Label", gap=2, sizingH="fill")
        b.txt(oc, h, size=14, style="SemiBold", fillW=True)
        b.txt(oc, sub, size=12, color=C["muted"], fillW=True)
        tg = b.row(o, "Toggle", w=40, h=24, radius=12, pad=3, fill=C["accent"] if on else C["line"],
                   main="max" if on else "min")
        b.dot(tg, 18, "#FFFFFF", name="Knob")

    ex = b.card(right, "After the meeting", gap=10, effects=SHADOW)
    b.txt(ex, "Send results to", size=14, style="SemiBold")
    er = b.row(ex, "Targets", gap=6, wrap=True, crossGap=6, sizingH="fill")
    for name in ("Jira", "MS Planner", "Teams post", "Confluence", "Email recap"):
        b.chip(er, name, C["ink2"], C["sunken"], size=12, style="Regular")
    b.spacer(right, "v")
    b.button(right, "Start meeting", "primary", size=17, pad=(18, 20, 18, 20), icon="●", fillW=True, key="start")
    b.txt(right, "Recording starts only after everyone is informed. Audio stays on this device.", size=12,
          color=C["muted"], fillW=True, align="center")
    return b
