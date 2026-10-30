from kit import B, C, SHADOW

PRINCIPLES = [
    ("The assistant suggests, people decide",
     "Decisions and to-dos appear as suggestions. Only a confirm from a person makes them real and lets them leave the room."),
    ("Quiet by default",
     "It never speaks into the meeting unless asked. Nudges are visual: the timer ring changes colour, a card slides in."),
    ("One facilitator, many hands",
     "The facilitator owns the agenda and the clock. Everyone else can capture from the board, their laptop or their phone."),
    ("Everything can be undone",
     "Every suggestion can be edited or dismissed, and the transcript shows where it came from."),
]

LANES = [
    ("Facilitator", "MK", ["Sets the agenda and the goals", "Moves to the next item, grants +5 min",
                           "Confirms decisions (or hands that to the owner)", "Starts the team review, sends results"]),
    ("Participants in the room", "TB", ["Tap the board to capture or vote",
                                        "Say “Companion, note a to-do for Lena”", "Park a topic with one tap",
                                        "Get their own to-dos on the phone"]),
    ("Remote participants", "JR", ["Join through Teams; their name comes along",
                                    "See the same agenda, timer and captures in a web view",
                                    "Confirm their own to-dos", "Vote in the review"]),
    ("The assistant", None, ["Transcribes and names speakers", "Spots decisions, to-dos and questions",
                              "Builds the mind map, follows the slides", "Keeps time and suggests, never decides"]),
]

CUES = [("Touch", "Tap a big button on the board: next item, park, +5 min, capture"),
        ("Voice cue", "“Companion, …” — only for commands, everything else is just transcribed"),
        ("Phone", "QR code joins without an app: own to-dos, voting, private notes"),
        ("Laptop", "Full editor for the facilitator or a note-taker")]


def build(x=0, y=0):
    b = B("s9_")
    s = b.col(None, "09 People and the assistant", w=1920, h=1080, fill=C["bg"], x=x, y=y, clip=True, key="screen",
              pad=[48, 56, 48, 56], gap=28)
    hd = b.col(s, "Heading", gap=6, sizingH="fill")
    b.txt(hd, "INTERACTION MODEL", size=14, style="SemiBold", color=C["accent"], ls=1.2)
    b.txt(hd, "Who does what in the room", size=44, style="Bold", ls=-1)

    pr = b.row(s, "Principles", gap=20, sizingH="fill", cross="min")
    for i, (h_, d_) in enumerate(PRINCIPLES, 1):
        c = b.card(pr, h_, gap=8, pad=22, effects=SHADOW)
        b.txt(c, f"0{i}", size=14, style="Bold", color=C["accent"])
        b.txt(c, h_, size=20, style="Bold", fillW=True)
        b.txt(c, d_, size=15, color=C["ink2"], fillW=True, lh="145%")

    lanes = b.row(s, "Roles", gap=20, sizingH="fill", cross="min")
    for title, ini, items in LANES:
        ai = ini is None
        c = b.card(lanes, title, gap=14, pad=22, h=290, sizingV="fixed", fill=C["dark"] if ai else C["surface"],
                   stroke=None if ai else C["line"])
        h = b.row(c, "Head", gap=10)
        if ai:
            m = b.row(h, "Mark", w=32, h=32, radius=9, fill=C["accent"], main="center")
            b.txt(m, "◆", size=15, style="Bold", color="#FFFFFF")
        else:
            b.avatar(h, ini, 32)
        b.txt(h, title, size=19, style="Bold", color=C["darkInk"] if ai else C["ink"])
        for it in items:
            r = b.row(c, "Item", gap=10, sizingH="fill", cross="min")
            b.txt(r, "→" if not ai else "✦", size=15, color=C["accent"] if not ai else "#A7A2FF")
            b.txt(r, it, size=16, color=C["darkInk"] if ai else C["ink2"], fillW=True, lh="140%")

    seq = b.col(s, "Sequence", gap=14, sizingH="fill", sizingV="fill")
    b.txt(seq, "One decision, start to finish", size=20, style="Bold")
    steps = b.row(seq, "Steps", gap=12, sizingH="fill", sizingV="fill", cross="min")
    STEPS = [("TB", "Tobias says", "“If offline stays in scope, we can't make the 7th.”"),
             (None, "Assistant", "Hears the trade-off, links it to item 02 and the “Offline mode” node."),
             ("MK", "Mara says", "“Let's cut offline and go with the 14th. Objections?”"),
             (None, "Assistant", "Shows a suggested decision on the board, quietly, no sound."),
             ("MK", "Mara taps Confirm", "Or says “Companion, confirm”. The decision is now official."),
             (None, "After the meeting", "Goes to Confluence and the Teams post, linked to the transcript.")]
    for i, (who, h_, d_) in enumerate(STEPS):
        ai = who is None
        c = b.col(steps, f"Step {i+1}", gap=8, pad=18, radius=14, sizingH="fill", sizingV="fill",
                  fill=C["accentSoft"] if ai else C["surface"], stroke=None if ai else C["line"])
        h = b.row(c, "Head", gap=8)
        if ai:
            m = b.row(h, "Mark", w=24, h=24, radius=7, fill=C["accent"], main="center")
            b.txt(m, "◆", size=11, style="Bold", color="#FFFFFF")
        else:
            b.avatar(h, who, 24)
        b.txt(h, h_, size=15, style="SemiBold", color=C["accentInk"] if ai else C["ink"])
        b.txt(c, d_, size=14, color=C["ink2"], fillW=True, lh="140%")
        if i < len(STEPS) - 1:
            b.txt(steps, "→", size=20, color=C["muted"])

    cues = b.row(s, "Channels", gap=16, sizingH="fill")
    b.txt(cues, "Ways in", size=16, style="SemiBold", color=C["muted"], w=90)
    for h_, d_ in CUES:
        c = b.row(cues, h_, gap=10, pad=[14, 16, 14, 16], fill=C["surface"], radius=12, stroke=C["line"], sizingH="fill", cross="min")
        cc = b.col(c, "Text", gap=2, sizingH="fill")
        b.txt(cc, h_, size=15, style="SemiBold", fillW=True)
        b.txt(cc, d_, size=13, color=C["ink2"], fillW=True)
    return b
