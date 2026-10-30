from kit import B, C, SHADOW

DECISIONS = [
    ("Beta launches on 14 Nov without offline mode", "Item 02 · 10:11"),
    ("Weekly pilot check-ins move to Thursdays", "Item 01 · 10:04"),
    ("€18k for Q1 user research, in-house recruiting", "Item 04 · 10:44"),
]
TODOS = [
    ("Inform the third pilot school about offline mode", "YA", "Fri 1 Nov", "Jira", True),
    ("Draft German release notes for the beta", "JR", "Wed 6 Nov", "Jira", True),
    ("Book 6 teacher interviews for January", "LS", "Fri 15 Nov", "Planner", True),
    ("Check SSO options for the school districts", "TB", "—", "Parking lot", False),
]
TIMES = [("Check-in & goals", 5, 6), ("Beta launch", 15, 17), ("Pilot schools", 20, 18), ("Q1 research budget", 10, 12),
         ("Open questions", 5, 5)]
TARGETS = [
    ("Jira", "2 issues in project BETA", True),
    ("Microsoft Planner", "1 task in “Research Q1”", True),
    ("Teams channel", "Summary post in #product", True),
    ("Confluence", "Meeting page with transcript", True),
    ("Email recap", "To all 5 participants", False),
]


def build(x=0, y=0):
    b = B("s4_")
    s = b.col(None, "04 Wrap-up & export", w=1440, h=900, fill=C["bg"], x=x, y=y, clip=True, key="screen")
    t = b.topbar(s, "Product sync · Beta launch")
    b.chip(t, "Ended · 58 min", C["ink2"], C["sunken"], dot=C["muted"])
    b.button(t, "Back to setup", "ghost", size=13, pad=(8, 14, 8, 14), key="back")

    body = b.row(s, "Body", gap=24, pad=[24, 32, 24, 32], sizingH="fill", sizingV="fill", cross="min")
    left = b.col(body, "Results", gap=16, sizingH="fill", sizingV="fill")
    hd = b.col(left, "Heading", gap=4, sizingH="fill")
    b.txt(hd, "Review before sending", size=13, style="SemiBold", color=C["accent"])
    b.txt(hd, "3 decisions, 3 to-dos, finished 2 min early", size=28, style="Bold", ls=-0.5)

    sm = b.card(left, "Summary", gap=8, pad=[16, 20, 16, 20], effects=SHADOW)
    sh = b.row(sm, "Head", gap=8, sizingH="fill")
    b.txt(sh, "✦ Summary", size=14, style="SemiBold", color=C["accentInk"])
    b.spacer(sh)
    b.txt(sh, "Edit · Regenerate", size=12, color=C["muted"])
    b.txt(sm, "The beta is set for 14 November; offline mode was cut from it to keep the date. Pilot feedback is "
              "positive overall, onboarding for teachers needs more guidance. The Q1 research budget was approved. "
              "SSO for school districts went to the parking lot.", size=14, color=C["ink2"], fillW=True, lh="155%")

    dc = b.card(left, "Decisions", gap=0, pad=[8, 20, 8, 20], effects=SHADOW)
    b.txt(dc, "DECISIONS", size=11, style="SemiBold", color=C["muted"], ls=0.8)
    for i, (d, src) in enumerate(DECISIONS):
        r = b.row(dc, f"Decision {i+1}", gap=12, pad=[10, 0, 10, 0], sizingH="fill",
                  **({"sides": [1, 0, 0, 0], "stroke": C["line"]} if i else {}))
        m = b.row(r, "Check", w=22, h=22, radius=11, fill=C["greenSoft"], main="center")
        b.txt(m, "✓", size=12, style="Bold", color=C["green"])
        b.txt(r, d, size=14, style="SemiBold", fillW=True)
        b.txt(r, src, size=12, color=C["muted"])

    tc = b.card(left, "To-dos", gap=0, pad=[8, 20, 8, 20], effects=SHADOW)
    th = b.row(tc, "Head", gap=12, pad=[6, 0, 6, 0], sizingH="fill")
    for lbl, w in (("TO-DO", None), ("OWNER", 130), ("DUE", 90), ("GOES TO", 110)):
        b.txt(th, lbl, size=11, style="SemiBold", color=C["muted"], ls=0.8, **({"w": w} if w else {"fillW": True}))
    for i, (task, who, due, dest, on) in enumerate(TODOS):
        r = b.row(tc, f"To-do {i+1}", gap=12, pad=[10, 0, 10, 0], sizingH="fill", sides=[1, 0, 0, 0], stroke=C["line"])
        b.txt(r, task, size=14, style="SemiBold" if on else "Regular", color=C["ink"] if on else C["muted"], fillW=True)
        oc = b.row(r, "Owner", w=130, gap=6)
        b.avatar(oc, who, 22)
        b.txt(oc, {"YA": "Yusuf", "JR": "Jana", "LS": "Lena", "TB": "Tobias"}[who], size=13, color=C["ink2"])
        b.txt(r, due, size=13, color=C["ink2"], w=90)
        dcol = b.row(r, "Dest", w=110)
        if on:
            b.chip(dcol, dest, C["accentInk"], C["accentSoft"], size=12)
        else:
            b.chip(dcol, dest, C["ink2"], C["sunken"], size=12)

    # right column
    right = b.col(body, "Send", gap=16, w=420, sizingV="fill")
    tm = b.card(right, "Time report", gap=10, effects=SHADOW)
    trh = b.row(tm, "Head", gap=8, sizingH="fill")
    b.txt(trh, "Timekeeping", size=14, style="SemiBold")
    b.spacer(trh)
    b.txt(trh, "planned / actual", size=12, color=C["muted"])
    for name, plan, act in TIMES:
        r = b.row(tm, name, gap=10, sizingH="fill")
        b.txt(r, name, size=12, color=C["ink2"], w=118)
        bars = b.col(r, "Bars", gap=3, sizingH="fill")
        b.progress(bars, round(plan * 9), 1, C["line"], track=C["line"], h=6, name="Planned")
        over = act > plan
        b.progress(bars, round(act * 9), 1, C["amber"] if over else C["accent"], h=6, name="Actual")
        b.txt(r, f"{act:>2}/{plan} min", size=12, style="SemiBold", color=C["amber"] if over else C["ink2"], w=62, align="right")

    sd = b.card(right, "Send results", gap=0, pad=[14, 20, 8, 20], effects=SHADOW)
    b.txt(sd, "Send to", size=14, style="SemiBold")
    for i, (app, what, on) in enumerate(TARGETS):
        r = b.row(sd, app, gap=12, pad=[12, 0, 12, 0], sizingH="fill", **({"sides": [1, 0, 0, 0], "stroke": C["line"]} if i else {}))
        ic = b.row(r, "Icon", w=34, h=34, radius=9, fill=C["sunken"], main="center")
        b.txt(ic, app[0], size=14, style="Bold", color=C["ink2"])
        cc = b.col(r, "Text", gap=1, sizingH="fill")
        b.txt(cc, app, size=14, style="SemiBold", fillW=True)
        b.txt(cc, what, size=12, color=C["muted"], fillW=True)
        tg = b.row(r, "Toggle", w=40, h=24, radius=12, pad=3, fill=C["accent"] if on else C["line"], main="max" if on else "min")
        b.dot(tg, 18, "#FFFFFF", name="Knob")
    b.spacer(right, "v")
    b.button(right, "Send to 4 apps", "primary", size=17, pad=(18, 20, 18, 20), fillW=True, key="send")
    b.txt(right, "Owners get a notification. Audio is deleted after 30 days; the transcript stays.", size=12,
          color=C["muted"], fillW=True, align="center")
    return b
