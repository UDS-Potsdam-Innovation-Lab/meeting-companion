"""16 Agenda-free · 01 setup: frame 01 with "Agenda-free" selected.

The agenda list, the budget line, the draft prompt, its sources and the agenda hint go away; a card says what
the companion does instead. The heading changes. The right column stays as in frame 01, "Start meeting" is
enabled with no items. Typed agenda items are kept, and one line says so. The selected option of the switch
carries a check mark, so the state does not rely on colour alone (AC1).
"""
from kit import B, C, SHADOW


def switch(b, parent, active):
    sg = b.row(parent, "Mode switch", gap=2, pad=3, fill=C["sunken"], radius=10)
    for it in ("With agenda", "Agenda-free"):
        on = it == active
        s = b.row(sg, f"Option {it}", gap=6, pad=[6, 14, 6, 14], radius=8, fill=C["surface"] if on else "none",
                  effects=[{"type": "dropShadow", "color": "#00000014", "offset": [0, 1], "radius": 2}] if on else None,
                  key=f"mode_{it}")
        if on:
            b.txt(s, "✓", size=12, style="Bold", color=C["accent"])
        b.txt(s, it, size=13, style="SemiBold", color=C["ink"] if on else C["ink2"])
    return sg


def right_column(b, body):
    """Frame 01's right column, unchanged apart from the timekeeping line."""
    right = b.col(body, "Settings", gap=16, w=400, sizingV="fill")
    meta = b.card(right, "Meeting", gap=14, effects=SHADOW)
    b.txt(meta, "Quick sync", size=18, style="Bold", fillW=True)
    mr = b.row(meta, "When", gap=8)
    b.txt(mr, "Today, 10:00 – 11:00", size=14, color=C["ink2"])
    b.chip(mr, "Room Aurora · Smart board", C["ink2"], C["sunken"], size=12, style="Regular")
    pr = b.row(meta, "People", gap=-6)
    for ini in ("MK", "TB", "LS", "YA", "JR"):
        b.avatar(pr, ini, 32, ring=C["surface"])
    b.txt(pr, "   5 participants · 2 remote", size=13, color=C["ink2"])

    st = b.card(right, "Assistant settings", gap=0, pad=[6, 20, 6, 20], effects=SHADOW)
    opts = [
        ("Transcription", "On this device · German + English", True),
        ("Timekeeping", "Whole meeting · nudge at half time", True),
        ("Capture decisions & to-dos", "Suggest, a person confirms", True),
        ("Live mind map", "Group by topic", True),
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
    return right


def build(x=0, y=0):
    b = B("s16a_")
    s = b.col(None, "16 Agenda-free · 01 setup", w=1440, h=900, fill=C["bg"], x=x, y=y, clip=True, key="screen")
    t = b.topbar(s, "New meeting")
    b.chip(t, "On-device transcription", C["green"], C["greenSoft"], dot=C["green"])
    b.avatar(t, "MK", 30)
    body = b.row(s, "Body", gap=24, pad=[28, 32, 28, 32], sizingH="fill", sizingV="fill", cross="min")

    left = b.col(body, "Agenda-free setup", gap=18, sizingH="fill", sizingV="fill")
    head = b.col(left, "Heading", gap=6, sizingH="fill")
    hr = b.row(head, "Mode", gap=12, sizingH="fill")
    b.txt(hr, "Step 1 of 2 · Before you start", size=13, style="SemiBold", color=C["accent"])
    b.spacer(hr)
    switch(b, hr, "Agenda-free")
    b.txt(head, "A meeting without an agenda", size=32, style="Bold", ls=-0.6)
    b.txt(head, "Start right away. The companion keeps time for the whole slot and records as usual.",
          size=15, color=C["ink2"], fillW=True)

    card = b.card(left, "What happens in the meeting", pad=[8, 24, 8, 24], gap=0, effects=SHADOW)
    rows = [
        ("⏱", "Time for the whole meeting",
         "60 min slot, 10:00 – 11:00, from the meeting card. If you start late, the time left is shorter."),
        ("½", "A nudge at half time",
         "“Half the time is gone” with the minutes left. It never interrupts or blocks anything."),
        ("+", "Topics as they come up",
         "Add a topic when the conversation turns. Tap the one you are talking about, and its minutes add up."),
    ]
    for i, (glyph, title, sub) in enumerate(rows):
        r = b.row(card, title, gap=16, pad=[18, 0, 18, 0], sizingH="fill", cross="min",
                  **({"sides": [1, 0, 0, 0], "stroke": C["line"]} if i else {}))
        ic = b.row(r, "Icon", w=36, h=36, radius=10, fill=C["accentSoft"], main="center", cross="center")
        b.txt(ic, glyph, size=16, style="Bold", color=C["accentInk"])
        c = b.col(r, "Text", gap=3, sizingH="fill")
        b.txt(c, title, size=15, style="SemiBold", fillW=True)
        b.txt(c, sub, size=13, color=C["ink2"], fillW=True, lh="145%")

    kept = b.row(left, "Kept agenda items", gap=12, pad=[12, 16, 12, 16], radius=12, fill=C["sunken"],
                 sizingH="fill")
    b.txt(kept, "↺", size=16, style="SemiBold", color=C["ink2"])
    b.txt(kept, "The 5 agenda items you typed are kept. Switch back to “With agenda” to see them.", size=13,
          color=C["ink2"], fillW=True)

    right_column(b, body)
    return b
