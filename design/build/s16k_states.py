"""16 Agenda-free · states: timer card, "Topics so far" with "Add topic" and its errors, the half-time toast."""
from kit import B, C, DARK, themed
import s16_free as F

TOPICS = [("Offline mode for the beta", 14), ("Teacher onboarding", 9), ("Release notes language", 4),
          ("Interview recruiting", 3)]
TIMERS = [
    ("Start · 0 %", "59 min left. Whole minutes, rounded down.", dict(left=59, frac=0.02), 60),
    ("49 %", "No nudge yet.", dict(left=31, frac=0.49), 60),
    ("50 % · nudge", "The toast appears once per run.", dict(left=30, frac=0.50), 60),
    ("Late start", "Started 10:15: 45 of the 60 min are left to use; half time is 10:37.", dict(left=23, frac=0.49), 60),
    ("Overrun", "“N min over” as text, bar full in the overrun colour.", dict(over=6, frac=1.0), 60),
    ("Started after the end", "Started 11:03: over from the first second; no nudge.", dict(over=3, frac=1.0), 60),
]
LIMIT = [("Parent evening dates", 2), ("Printer in room 2.14", 1), ("Homework app login problems", 4)]


def caption(b, parent, title, sub, w=300):
    c = b.col(parent, f"State {title}", gap=10, w=w)
    b.txt(c, title, size=14, style="SemiBold", fillW=True)
    b.txt(c, sub, size=12, color=C["ink2"], fillW=True, lh="140%")
    return c


def section(b, parent, title, sub):
    s = b.col(parent, title, gap=16)
    h = b.col(s, "Heading", gap=4)
    b.txt(h, title, size=18, style="Bold")
    if sub:
        b.txt(h, sub, size=13, color=C["ink2"])
    return b.row(s, "Strip", gap=24, cross="min")


def build(x=0, y=0):
    b = B("s16k_")
    s = b.col(None, "16 Agenda-free · states", fill=C["bg"], x=x, y=y, pad=48, gap=40, key="screen")
    hd = b.col(s, "Title", gap=6)
    b.txt(hd, "Agenda-free mode · states", size=28, style="Bold", ls=-0.5)
    b.txt(hd, "Job 009: no topic detection, no “Turn topics into an agenda”. Every value comes from stored "
              "timestamps and the clock.", size=14, color=C["ink2"])

    r = section(b, s, "Whole-meeting timer card", "Time available = scheduled end − actual start.")
    for title, sub, timer, slot in TIMERS:
        c = caption(b, r, title, sub)
        F.timer_card(b, c, timer, slot=slot)

    r = section(b, s, "Topics so far · Add topic",
                "“Add topic” stays pinned at the bottom of the card; the list scrolls above it.")
    cases = [
        ("Empty", "Start of the meeting.", [], None, "button"),
        ("No topic current", "The current topic was tapped again.", TOPICS, None, "button"),
        ("Talking now", "Marker as text, not only the tint.", TOPICS, 3, "button"),
        ("Adding", "Inline field; the new topic becomes “talking now”.", TOPICS, 3, "field"),
        ("Error · empty", "Inline, by key, after “Add”.", TOPICS, 3, "error_empty"),
        ("Error · too long", "1–200 characters, as agenda titles.", TOPICS, 3, "error_long"),
        ("100 topics", "List scrolled to the end; “Add topic” is disabled.", LIMIT, 2, "limit"),
    ]
    for title, sub, topics, cur, add in cases:
        c = caption(b, r, title, sub)
        F.topics_card(b, c, topics, cur, add=add, fillV=False, count=100 if add == "limit" else None)

    r = section(b, s, "Half-time nudge", "Frame 02’s dark toast: not modal, takes no focus, announced once "
                                         "through the polite live region. One action: Dismiss.")
    c = caption(b, r, "Light · over the transcript card", "72 px above the card’s bottom edge.", w=380)
    F.toast(b, c)
    with themed(DARK):
        p = b.col(r, "Dark panel", gap=10, pad=20, radius=16, fill=C["bg"])
        b.txt(p, "Dark", size=14, style="SemiBold")
        b.txt(p, "1 px dark3 outline so the toast stays apart from the card.", size=12, color=C["ink2"])
        F.toast(b, p)
    c = caption(b, r, "375 · sticky, full width", "At the bottom of the viewport, 12 px inset.", w=351)
    F.toast(b, c, fillW=True)
    return b
