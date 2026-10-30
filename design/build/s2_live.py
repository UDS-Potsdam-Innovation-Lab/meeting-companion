from kit import B, C, SHADOW, PEOPLE

ITEMS = [
    ("Check-in & goals", 5, 6, "done"),
    ("Beta launch: scope and date", 15, 12, "now"),
    ("Pilot schools: feedback so far", 20, None, "next"),
    ("Budget for Q1 user research", 10, None, "next"),
    ("Open questions & next steps", 5, None, "next"),
]

LINES = [
    ("TB", "10:09", "If we keep the offline mode in scope, we can't make the 7th. Realistically it's the 14th."),
    ("LS", "10:10", "The pilot schools don't need offline for the beta. Two of three have stable Wi-Fi in the classrooms."),
    ("MK", "10:11", "Then let's cut offline from the beta and go with the 14th. Any objections?"),
    ("YA", "10:11", "Fine with me, as long as we tell the third school early."),
    ("MK", "10:12", "Okay. Yusuf, can you write to them this week?"),
]


def segmented(b, parent, items, active, key_prefix=None):
    sg = b.row(parent, "Segmented", gap=2, pad=3, fill=C["sunken"], radius=10)
    keys = {}
    for it in items:
        on = it == active
        s = b.row(sg, f"Tab {it}", pad=[6, 14, 6, 14], radius=8, fill=C["surface"] if on else "none",
                  effects=[{"type": "dropShadow", "color": "#00000014", "offset": [0, 1], "radius": 2}] if on else None,
                  key=f"{key_prefix}{it}" if key_prefix else None)
        b.txt(s, it, size=13, style="SemiBold", color=C["ink"] if on else C["muted"])
    return sg


def build(x=0, y=0):
    b = B("s2_")
    s = b.col(None, "02 Live meeting", w=1440, h=900, fill=C["bg"], x=x, y=y, clip=True, key="screen")
    t = b.topbar(s, "Product sync · Beta launch")
    rec = b.chip(t, "REC  00:23:41", C["red"], C["redSoft"], dot=C["red"])
    b.chip(t, "On-device · DE/EN", C["ink2"], C["sunken"], style="Regular")
    b.button(t, "Pause", "ghost", size=13, pad=(8, 14, 8, 14), icon="❚❚")
    b.button(t, "End meeting", "dark", size=13, pad=(8, 14, 8, 14), key="end")

    body = b.row(s, "Body", gap=20, pad=[20, 24, 20, 24], sizingH="fill", sizingV="fill", cross="min")

    # ---- left: agenda + timekeeping
    left = b.col(body, "Agenda", gap=12, w=300, sizingV="fill")
    clock = b.card(left, "Current item timer", pad=18, gap=10, fill=C["dark"], stroke=None, effects=SHADOW)
    b.txt(clock, "NOW · ITEM 02", size=11, style="SemiBold", color=C["darkMuted"], ls=0.8)
    b.txt(clock, "Beta launch: scope and date", size=16, style="SemiBold", color=C["darkInk"], fillW=True)
    cr = b.row(clock, "Time", gap=8, cross="max")
    b.txt(cr, "3:12", size=44, style="Bold", color="#FFFFFF", ls=-1.5, features={"tnum": True})
    b.txt(cr, "left of 15:00", size=13, color=C["darkMuted"])
    b.progress(clock, 264, 0.79, "#F5B342", track=C["dark3"], h=8)
    br = b.row(clock, "Actions", gap=8, sizingH="fill")
    b.button(br, "+5 min", "darkghost", size=13, pad=(8, 12, 8, 12), fillW=True)
    b.button(br, "Park it", "darkghost", size=13, pad=(8, 12, 8, 12), fillW=True)
    b.button(br, "Next ›", "primary", size=13, pad=(8, 12, 8, 12), fillW=True)

    ag = b.card(left, "Agenda list", pad=8, gap=2, sizingV="fill")
    for i, (title, plan, actual, state) in enumerate(ITEMS, 1):
        r = b.row(ag, f"Item {i}", gap=10, pad=[10, 10, 10, 10], radius=10, sizingH="fill",
                  fill=C["accentSoft"] if state == "now" else "none")
        if state == "done":
            m = b.row(r, "State", w=22, h=22, radius=11, fill=C["greenSoft"], main="center")
            b.txt(m, "✓", size=12, style="Bold", color=C["green"])
        elif state == "now":
            m = b.row(r, "State", w=22, h=22, radius=11, fill=C["accent"], main="center")
            b.dot(m, 8, "#FFFFFF")
        else:
            m = b.row(r, "State", w=22, h=22, radius=11, fill="none", stroke=C["line"], main="center")
            b.txt(m, str(i), size=11, style="SemiBold", color=C["muted"])
        c = b.col(r, "Text", gap=1, sizingH="fill")
        b.txt(c, title, size=13, style="SemiBold", color=C["muted"] if state == "done" else C["ink"], fillW=True)
        if state == "done":
            b.txt(c, f"{actual} of {plan} min · 1 to-do", size=12, color=C["amber"], fillW=True)
        elif state == "now":
            b.txt(c, "12 of 15 min · 1 decision", size=12, color=C["accentInk"], fillW=True)
        else:
            b.txt(c, f"{plan} min", size=12, color=C["muted"], fillW=True)
    b.spacer(ag, "v")
    pk = b.row(ag, "Parking lot", gap=8, pad=[10, 10, 10, 10], sizingH="fill", sides=[1, 0, 0, 0], stroke=C["line"])
    b.txt(pk, "🅿", size=14, color=C["muted"])
    b.txt(pk, "Parking lot", size=13, style="SemiBold", color=C["ink2"])
    b.spacer(pk)
    b.chip(pk, "2", C["ink2"], C["sunken"])
    ov = b.row(left, "Overall", gap=8, pad=[0, 4, 0, 4], sizingH="fill")
    b.txt(ov, "Meeting ends 11:00", size=12, color=C["muted"])
    b.spacer(ov)
    b.txt(ov, "on track (+1 min)", size=12, style="SemiBold", color=C["green"])

    # ---- center: transcript
    mid = b.card(body, "Transcript", pad=0, gap=0, sizingV="fill", effects=SHADOW)
    mh = b.row(mid, "Header", gap=12, pad=[14, 20, 14, 20], sizingH="fill", sides=[0, 0, 1, 0], stroke=C["line"])
    segmented(b, mh, ["Transcript", "Mind map", "Notes"], "Transcript", key_prefix="tab_")
    b.spacer(mh)
    b.txt(mh, "⌕  Search", size=13, color=C["muted"])
    feed = b.col(mid, "Feed", gap=4, pad=[16, 20, 16, 20], sizingH="fill", sizingV="fill")
    for i, (who, ts, line) in enumerate(LINES):
        name, colr = PEOPLE[who]
        hl = i == 2
        r = b.row(feed, f"Line {i}", gap=12, pad=[10, 12, 10, 12], radius=12, sizingH="fill", cross="min",
                  fill="#F3F2FE" if hl else "none", stroke=C["accent"] if hl else None)
        b.avatar(r, who, 30)
        c = b.col(r, "Text", gap=4, sizingH="fill")
        nr = b.row(c, "Meta", gap=8)
        b.txt(nr, name, size=13, style="SemiBold", color=colr)
        b.txt(nr, ts, size=12, color=C["muted"])
        if hl:
            b.chip(nr, "✦ Decision detected", C["accentInk"], C["accentSoft"], size=11, pad=(2, 8, 2, 8))
        if i == 4:
            b.chip(nr, "✦ To-do detected", C["amber"], C["amberSoft"], size=11, pad=(2, 8, 2, 8))
        b.txt(c, line, size=15, color=C["ink"], fillW=True, lh="150%")
    live = b.row(feed, "Live line", gap=12, pad=[10, 12, 10, 12], sizingH="fill", cross="min")
    b.avatar(live, "JR", 30)
    lc = b.col(live, "Text", gap=4, sizingH="fill")
    lm = b.row(lc, "Meta", gap=8)
    b.txt(lm, "Jana Roth", size=13, style="SemiBold", color=PEOPLE["JR"][1])
    b.txt(lm, "speaking…", size=12, color=C["muted"])
    b.txt(lc, "And the release notes for the schools, should those go out in German only or", size=15,
          color=C["muted"], fillW=True, lh="150%")
    foot = b.row(mid, "Listening", gap=10, pad=[12, 20, 12, 20], sizingH="fill", sides=[1, 0, 0, 0], stroke=C["line"])
    wave = b.row(foot, "Level", gap=3)
    for hgt in (6, 12, 18, 10, 22, 14, 8, 16, 20, 9, 5, 12):
        b.rect(wave, 3, hgt, C["accent"], radius=2, name="Bar")
    b.txt(foot, "Listening · 5 speakers", size=12, color=C["muted"])
    b.spacer(foot)
    b.button(foot, "Mark moment", "ghost", size=12, pad=(6, 12, 6, 12), icon="⚑")

    # ---- right: captures
    right = b.col(body, "Captured", gap=12, w=380, sizingV="fill")
    rh = b.row(right, "Header", gap=8, sizingH="fill")
    segmented(b, rh, ["Decisions 2", "To-dos 4", "Questions 1"], "Decisions 2")

    sug = b.card(right, "Suggested decision", pad=16, gap=10, stroke=C["accent"], effects=SHADOW)
    sh = b.row(sug, "Head", gap=8)
    b.chip(sh, "✦ Suggested · 10:11", C["accentInk"], C["accentSoft"], size=11, pad=(3, 8, 3, 8))
    b.txt(sug, "Beta launches on 14 Nov without offline mode", size=16, style="SemiBold", fillW=True)
    b.txt(sug, "Offline support moves to the release after the beta. The third pilot school is informed this week.",
          size=13, color=C["ink2"], fillW=True, lh="145%")
    ar = b.row(sug, "Actions", gap=8, sizingH="fill")
    b.button(ar, "Confirm", "primary", size=13, pad=(8, 14, 8, 14), icon="✓", fillW=True)
    b.button(ar, "Edit", "ghost", size=13, pad=(8, 14, 8, 14))
    b.button(ar, "Dismiss", "ghost", size=13, pad=(8, 14, 8, 14))

    d1 = b.card(right, "Confirmed decision", pad=16, gap=6)
    d1h = b.row(d1, "Head", gap=8)
    b.chip(d1h, "✓ Decided · Item 01", C["green"], C["greenSoft"], size=11, pad=(3, 8, 3, 8))
    b.txt(d1, "Weekly pilot check-ins move to Thursdays", size=14, style="SemiBold", fillW=True)

    td = b.card(right, "To-do suggestion", pad=16, gap=10)
    b.chip(td, "✦ To-do · 10:12", C["amber"], C["amberSoft"], size=11, pad=(3, 8, 3, 8))
    b.txt(td, "Inform the third pilot school that offline mode comes later", size=14, style="SemiBold", fillW=True)
    tr = b.row(td, "Meta", gap=8, sizingH="fill")
    b.avatar(tr, "YA", 22)
    b.txt(tr, "Yusuf Aydin", size=12, color=C["ink2"])
    b.chip(tr, "Due Fri 1 Nov", C["ink2"], C["sunken"], size=11, style="Regular", pad=(3, 8, 3, 8))
    b.spacer(tr)
    b.txt(tr, "→ Jira", size=12, style="SemiBold", color=C["accent"])
    b.spacer(right, "v")
    cap = b.row(right, "Quick capture", gap=8, pad=[12, 14, 12, 14], fill=C["surface"], radius=12, stroke=C["line"], sizingH="fill")
    b.txt(cap, "Type a decision, to-do or note…  ( / for commands )", size=13, color=C["muted"], fillW=True)

    # ---- timekeeping nudge (overlay)
    toast = b.row(s, "Time nudge", gap=14, pad=[12, 14, 12, 18], fill=C["dark"], radius=14, absolute=True,
                  x=390, y=730, effects=SHADOW)
    b.txt(toast, "⏱", size=18, color="#F5B342")
    tc = b.col(toast, "Text", gap=2)
    b.txt(tc, "3 minutes left for item 02", size=14, style="SemiBold", color="#FFFFFF")
    b.txt(tc, "One decision captured. Wrap up, or take 5 min from the buffer?", size=12, color=C["darkMuted"])
    b.button(toast, "Wrap up", "darkghost", size=12, pad=(7, 12, 7, 12))
    b.button(toast, "+5 min", "primary", size=12, pad=(7, 12, 7, 12))
    return b
