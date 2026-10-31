"""16 Agenda-free (job 009): the free mode as it ships without the language model.

Helpers for the s16* frames. The live view is frame 02's layout as the app draws it (left column 300 px +
transcript card; no right column, the captures come later), with frame 13's timer card and "Topics so far".
What is left out on purpose (job 009 scope): topic detection and "detected", per-topic progress bars, outcome
badges, "Turn topics into an agenda", the mind map / notes tabs, "Captured" and "How free mode works".

Half-time nudge: frame 02's dark toast (AC3 "uses the frame 02 nudge pattern"), floating over the bottom of
the transcript card, one "Dismiss" action. Frame 13's amber card at the top right is not used.
"""
from kit import B, C, DARK, SHADOW, PEOPLE, themed
from s2_live import segmented
import soundwave as W

TITLE = "Quick sync · no agenda"
BAR = "#8F89FF"  # frame 13's whole-meeting bar on the dark card
BAR_OVER = "#FF8086"  # overrun colour on the dark card (6.0:1 on #15161A)

# state -> clock, REC, timer, topics (title, minutes), current index, transcript lines, live line
STATES = {
    "empty": dict(
        rec="00:01:12", timer=dict(left=59, frac=0.02),
        topics=[], current=None,
        lines=[("MK", "10:00", "Morning, everyone. No agenda today, so let's just go round and see what's urgent."),
               ("TB", "10:01", "The offline mode question for the beta is the big one for me.")],
        live=("LS", "Same here, and I'd like a few minutes on teacher onboarding after that, because the")),
    "now": dict(
        rec="00:24:12", timer=dict(left=36, frac=0.40),
        topics=[("Offline mode for the beta", 11), ("Teacher onboarding", 7), ("Release notes language", 4),
                ("Interview recruiting", 2)], current=3,
        lines=[("JR", "10:21", "So the release notes go out in German first, and the English version a week later."),
               ("MK", "10:21", "Okay, that settles the language. What's next?"),
               ("LS", "10:22", "Next thing: the January interviews. We still need six teachers, ideally from "
                               "schools outside the pilot."),
               ("TB", "10:23", "I can ask the two schools from the autumn workshop. They offered to help."),
               ("MK", "10:23", "Good. Can we do them remotely, or does it have to be on site?"),
               ("YA", "10:24", "Remote is fine for the first round. We only need a classroom visit for the "
                               "follow-up.")],
        live=("JR", "Then I'll draft the invitation today, but we should agree on the thank-you voucher first, maybe")),
    "half": dict(
        rec="00:30:05", timer=dict(left=30, frac=0.50),
        topics=[("Offline mode for the beta", 14), ("Teacher onboarding", 9), ("Release notes language", 4),
                ("Interview recruiting", 3)], current=3,
        lines=[("JR", "10:26", "So the release notes go out in German first, and the English version a week later."),
               ("MK", "10:26", "Okay, that settles the language. What's next?"),
               ("LS", "10:27", "Next thing: the January interviews. We still need six teachers, ideally from "
                               "schools outside the pilot."),
               ("TB", "10:28", "I can ask the two schools from the autumn workshop. They offered to help."),
               ("MK", "10:29", "Good. Can we do them remotely, or does it have to be on site?"),
               ("YA", "10:30", "Remote is fine for the first round. We only need a classroom visit for the "
                               "follow-up.")],
        live=("JR", "Then I'll draft the invitation today, but we should agree on the thank-you voucher first, maybe")),
    "over": dict(
        rec="01:06:20", timer=dict(over=6, frac=1.0),
        topics=[("Offline mode for the beta", 14), ("Teacher onboarding", 12), ("Release notes language", 9),
                ("Interview recruiting", 8), ("Q1 research budget", 23)], current=4,
        lines=[("YA", "11:04", "If we fund twelve interviews instead of six, the research budget runs out in "
                               "February."),
               ("LS", "11:05", "Then six in January, and we decide on the rest after the first results."),
               ("MK", "11:05", "Agreed. We're over time, so let's stop here and pick this up on Thursday."),
               ("TB", "11:06", "Fine. I'll put the budget on Thursday's agenda.")],
        live=("JR", "One last thing before we close, can someone send round the")),
}


# --- parts ---------------------------------------------------------------------------------------------

def timer_card(b, parent, timer, slot=60, end="11:00", bar_w=264, fillW=True, w=None, big=44):
    """Frame 13's dark whole-meeting card. `timer` = {left: N} or {over: N}, plus `frac`."""
    k = b.card(parent, "Meeting time", pad=18, gap=8, fill=C["dark"], stroke=None, effects=SHADOW,
               fillW=fillW, w=w)
    b.txt(k, f"NO AGENDA · {slot} MIN SLOT", size=11, style="SemiBold", color=C["darkMuted"], ls=0.8)
    r = b.row(k, "Time", gap=8, cross="max")
    if "over" in timer:
        b.txt(r, str(timer["over"]), size=big, style="Bold", color=BAR_OVER, ls=-1.5, features={"tnum": True})
        b.txt(r, f"min over · slot ended {end}", size=13, style="SemiBold", color=BAR_OVER)
        b.progress(k, bar_w, 1.0, BAR_OVER, track=C["dark3"], h=8)
    else:
        b.txt(r, str(timer["left"]), size=big, style="Bold", color="#FFFFFF", ls=-1.5, features={"tnum": True})
        b.txt(r, f"min left · ends {end}", size=13, color=C["darkMuted"])
        b.progress(k, bar_w, timer["frac"], BAR, track=C["dark3"], h=8)
    return k


def topic_row(b, parent, title, mins, current):
    r = b.row(parent, f"Topic {title}", gap=10, pad=[9, 10, 9, 10], radius=10, sizingH="fill",
              fill=C["accentSoft"] if current else "none")
    if current:
        m = b.row(r, "State", w=22, h=22, radius=11, fill=C["accent"], main="center", cross="center")
        b.dot(m, 8, C.get("onAccent", "#FFFFFF"))
    else:
        b.row(r, "State", w=22, h=22, radius=11, fill="none", stroke=C["line"])
    c = b.col(r, "Text", gap=1, sizingH="fill")
    b.txt(c, title, size=13, style="SemiBold", fillW=True)
    if current:
        b.txt(c, "● talking now", size=12, style="SemiBold", color=C["accentInk"], fillW=True)
    b.txt(r, f"{mins} min", size=12, style="SemiBold" if current else "Regular",
          color=C["accentInk"] if current else C["muted"], features={"tnum": True})
    return r


def add_control(b, parent, add="button", typed="Pilot school visits in March"):
    """The pinned bottom row of "Topics so far": button, inline field, its errors, the 100-topic limit."""
    a = b.col(parent, "Add topic", gap=8, pad=[10, 4, 4, 4], sizingH="fill", sides=[1, 0, 0, 0], stroke=C["line"])
    if add in ("button", "limit"):
        on = add == "button"
        btn = b.row(a, "Button Add topic", gap=8, pad=[6, 8, 6, 8], radius=8)
        b.txt(btn, "+", size=16, style="SemiBold", color=C["accent"] if on else C["muted"])
        b.txt(btn, "Add topic", size=13, style="SemiBold", color=C["accent"] if on else C["muted"])
        if not on:
            b.txt(a, "A meeting can have up to 100 topics.", size=12, color=C["ink2"], fillW=True, lh="140%")
        return a
    err = add in ("error_empty", "error_long")
    b.txt(a, "New topic", size=12, style="SemiBold", color=C["ink2"])
    f = b.row(a, "Field", gap=0, pad=[8, 10, 8, 10], radius=8, fill=C["surface"], sizingH="fill",
              stroke=C["red"] if err else C["accent"], strokeWeight=2)
    if add == "error_empty":
        b.rect(f, 1.5, 16, C["ink"], name="Caret")
    elif add == "error_long":
        b.txt(f, "Ask the pilot schools whether the teachers who joined after the autumn workshop can still …",
              size=13, fillW=True, maxLines=1, textAutoResize="truncate")
    else:
        b.txt(f, typed, size=13)
        b.rect(f, 1.5, 16, C["accent"], name="Caret")
    if err:
        e = b.row(a, "Error", gap=6, sizingH="fill", cross="min")
        W.badge(b, e, "!", C["red"], C["surface"], 14)
        b.txt(e, "Enter a title for the topic." if add == "error_empty"
              else "Keep the title to 200 characters or fewer (now 214).", size=12, color=C["red"], fillW=True,
              lh="140%")
    ar = b.row(a, "Actions", gap=8, sizingH="fill")
    b.button(ar, "Add", "primary", size=12, pad=(6, 14, 6, 14))
    b.button(ar, "Cancel", "ghost", size=12, pad=(6, 12, 6, 12))
    b.spacer(ar)
    b.txt(ar, "Enter adds · Esc cancels", size=11, color=C["muted"])
    return a


def topics_card(b, parent, topics, current, add="button", fillV=True, fillW=True, w=None, name="Topics so far",
                count=None):
    k = b.card(parent, name, pad=[12, 10, 10, 10], gap=4, sizingV="fill" if fillV else None, fillW=fillW, w=w)
    h = b.row(k, "Head", gap=6, pad=[2, 4, 6, 4], sizingH="fill")
    b.txt(h, "Topics so far", size=14, style="SemiBold")
    b.spacer(h)
    if topics:
        n = count or len(topics)
        b.txt(h, f"{n} topics" if n != 1 else "1 topic", size=12, color=C["muted"])
    if not topics:
        e = b.col(k, "Empty state", gap=4, pad=[6, 4, 10, 4], sizingH="fill")
        b.txt(e, "No topics yet", size=13, style="SemiBold", color=C["ink2"], fillW=True)
        b.txt(e, "Add a topic when the conversation turns to something new. The one marked “talking now” "
                 "collects the minutes.", size=12, color=C["muted"], fillW=True, lh="145%")
    lst = b.col(k, "Topic list", gap=2, sizingH="fill")
    for i, (t, m) in enumerate(topics):
        topic_row(b, lst, t, m, i == current)
    if topics and current is None:
        b.txt(k, "No topic is current. Tap one when the talk turns to it.", size=12, color=C["muted"],
              fillW=True, lh="145%", name="Hint no current topic")
    if fillV:
        b.spacer(k, "v")
    add_control(b, k, add)
    return k


def transcript_card(b, parent, st, size="wide", fillV=True, h=None):
    fs, av = {"wide": (15, 30), "tablet": (14, 28), "phone": (14, 26)}[size]
    k = b.card(parent, "Transcript", pad=0, gap=0, sizingV="fill" if fillV else ("fixed" if h else None), h=h,
               effects=SHADOW)
    hd = b.row(k, "Header", gap=12, pad=[14, 20, 14, 20] if size == "wide" else [10, 12, 10, 12], sizingH="fill",
               sides=[0, 0, 1, 0], stroke=C["line"])
    segmented(b, hd, ["Transcript"], "Transcript")  # the app's one heading tab; no Mind map / Notes in job 009
    feed = b.col(k, "Feed", gap=2 if size != "wide" else 4, pad=[8, 4, 8, 4] if size == "phone" else [12, 16, 12, 16],
                 sizingH="fill", sizingV="fill", clip=True, mainAlign="max")
    for who, ts, line in st["lines"]:
        W.line(b, feed, who, ts, line, fs=fs, avatar=av)
    who, text = st["live"]
    W.line(b, feed, who, "", text, fs=fs, avatar=av, live=True)
    W.footer(b, k, "speech", "wide" if size == "wide" else size)
    return k


def toast(b, parent, left=30, end="11:00", fillW=False):
    """Frame 02's dark nudge with the free-mode text: not modal, takes no focus, one dismiss action."""
    t = b.row(parent, "Half-time nudge", gap=14, pad=[12, 14, 12, 18], fill=C["dark"], radius=14, effects=SHADOW,
              sizingH="fill" if fillW else None, stroke=C["dark3"] if W.dark() else None)
    b.txt(t, "⏱", size=18, color="#F5B342")
    c = b.col(t, "Text", gap=2, sizingH="fill" if fillW else None)
    b.txt(c, "Half the time is gone", size=14, style="SemiBold", color="#FFFFFF")
    b.txt(c, f"{left} min left, ends {end}", size=12, color=C["darkMuted"])
    b.button(t, "Dismiss", "darkghost", size=12, pad=(7, 12, 7, 12))
    return t


# --- top bars ------------------------------------------------------------------------------------------

def topbar_wide(b, s, st, w):
    t = b.topbar(s, TITLE)
    b.chip(t, "Free mode", C["accentInk"], C["accentSoft"], size=12)
    b.chip(t, "REC  " + st["rec"], C["red"], C["redSoft"], dot=C["red"])
    if w >= 1280:
        b.chip(t, "On-device · DE/EN", C["ink2"], C["sunken"], style="Regular")
    b.button(t, "Pause", "ghost", size=13, pad=(8, 14, 8, 14), icon="❚❚")
    b.button(t, "End meeting", "dark", size=13, pad=(8, 14, 8, 14), key="end")


def mark(b, parent, d=28):
    m = b.row(parent, "Mark", w=d, h=d, radius=8, fill=C["accent"], main="center", cross="center")
    b.txt(m, "◆", size=13, style="Bold", color=C.get("onAccent", "#FFFFFF"))


def topbar_tablet(b, s, st):
    """< 900 px: the recording controls move to a second row of the bar (styles.css)."""
    t = b.col(s, "Top bar", gap=10, pad=[12, 16, 12, 16], fill=C["surface"], sizingH="fill",
              sides=[0, 0, 1, 0], stroke=C["line"])
    r1 = b.row(t, "Row 1", gap=12, sizingH="fill")
    mark(b, r1, 30)
    b.txt(r1, "Companion", size=16, style="Bold")
    b.rect(r1, 1, 22, C["line"], name="Divider")
    b.txt(r1, TITLE, size=15, style="SemiBold", color=C["ink2"])
    b.spacer(r1)
    b.chip(r1, "Free mode", C["accentInk"], C["accentSoft"], size=12)
    r2 = b.row(t, "Row 2", gap=8, sizingH="fill")
    b.chip(r2, "REC  " + st["rec"], C["red"], C["redSoft"], dot=C["red"])
    b.button(r2, "Pause", "ghost", size=13, pad=(8, 14, 8, 14), icon="❚❚")
    b.spacer(r2)
    b.button(r2, "End meeting", "dark", size=13, pad=(8, 14, 8, 14), key="end")


def topbar_phone(b, s, st):
    t = b.col(s, "Top bar", gap=10, pad=[12, 16, 12, 16], fill=C["surface"], sizingH="fill",
              sides=[0, 0, 1, 0], stroke=C["line"])
    r1 = b.row(t, "Row 1", gap=10, sizingH="fill")
    mark(b, r1)
    b.txt(r1, "Quick sync", size=16, style="Bold")
    b.chip(r1, "Free mode", C["accentInk"], C["accentSoft"], size=11, pad=(3, 8, 3, 8))
    b.spacer(r1)
    b.chip(r1, "REC  " + st["rec"][3:] if st["rec"].startswith("00:") else "REC  " + st["rec"], C["red"],
           C["redSoft"], dot=C["red"])
    r2 = b.row(t, "Row 2", gap=8, sizingH="fill")
    b.button(r2, "Pause", "ghost", size=13, pad=(8, 12, 8, 12), icon="❚❚")
    b.spacer(r2)
    b.button(r2, "End meeting", "dark", size=13, pad=(8, 12, 8, 12), key="end")


# --- screens -------------------------------------------------------------------------------------------

def live(prefix, name, x, y, w=1280, h=800, state="now", add="button", nudge=False, last=None):
    """The free live view. w >= 800: two columns (frame 02); < 800: one column, as styles.css stacks it.
    `last`: draw only the newest N final lines, so the scrolled feed does not cut a line in half."""
    st = dict(STATES[state])
    if last:
        st["lines"] = st["lines"][-last:]
    b = B(prefix)
    if w >= 800:
        s = b.col(None, name, w=w, h=h, fill=C["bg"], x=x, y=y, clip=True, key="screen")
        topbar_wide(b, s, st, w)
        body = b.row(s, "Body", gap=20, pad=[20, 24, 20, 24], sizingH="fill", sizingV="fill", cross="min")
        left = b.col(body, "Left", gap=12, w=300, sizingV="fill")
        timer_card(b, left, st["timer"])
        topics_card(b, left, st["topics"], st["current"], add=add)
        transcript_card(b, body, st, "wide")
        if nudge:
            # live__stage: over the centre column, the toast 72 px above the card's bottom edge
            top = 62 + 20
            stage = b.col(s, "Stage (nudge)", w=w - 368, h=h - top - 20, x=344, y=top, absolute=True,
                          main="max", cross="center", pad=[0, 0, 72, 0])
            toast(b, stage, st["timer"].get("left", 0))
        return b
    phone = w < 600
    s = b.col(None, name, w=w, h=h, fill=C["bg"], x=x, y=y, clip=True, key="screen",
              sizingV="hug" if h is None else "fixed")
    (topbar_phone if phone else topbar_tablet)(b, s, st)
    pad = 12 if phone else 16
    body = b.col(s, "Body", gap=12 if phone else 16, pad=pad, sizingH="fill",
                 sizingV="fill" if (h and not phone) else None)
    timer_card(b, body, st["timer"], bar_w=w - 2 * pad - 36)
    topics_card(b, body, st["topics"], st["current"], add=add, fillV=False)
    if phone:
        transcript_card(b, body, st, "phone", fillV=False, h=480)
    else:
        transcript_card(b, body, st, "tablet")
    if nudge:
        hh = 150
        stage = b.col(s, "Stage (nudge, sticky)", w=w, h=hh, x=0, y=h - hh, absolute=True, main="max",
                      pad=[0, pad, pad, pad])
        toast(b, stage, st["timer"].get("left", 0), fillW=True)
    return b


def darken(build):
    """Run a builder on the dark tokens, with the fixes frame 02 · dark uses (s15f / soundwave.live_screen)."""
    with themed(DARK):
        b = build()
    for c in b.cmds:
        p = c["params"]
        pr = p.get("props", {})
        if pr.get("stroke") == "#FFFFFF":
            pr["stroke"] = DARK["surface"]
        if p.get("type") == "text" and pr.get("fill") == PEOPLE["MK"][1]:  # indigo name, 2:1 on dark
            pr["fill"] = DARK["accent"]
    return b
