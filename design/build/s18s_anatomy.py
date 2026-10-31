"""18 Phone view · anatomy: where consumer views mount, what the header may show, and the decisions."""
from kit import B, C, DARK, SHADOW
import setx as X
import phone as P


def slot_demo(b, slot, t):
    c = b.col(slot, "Consumer slot (outline)", gap=10, pad=[24, 18, 24, 18], radius=16, fill=C["accentSoft"],
              stroke=C["accent"], sizingH="fill", sizingV="fill", cross="center", main="center")
    b.cmds[-1]["params"]["props"]["strokeWeight"] = 2
    b.txt(c, "Consumer slot", size=18, style="Bold", color=C["accentInk"], align="center", fillW=True)
    b.txt(c, "One view at a time, registered by a consumer job through 012’s route API:", size=14,
          color=C["ink"], align="center", fillW=True, lh="145%")
    for ln in ("010 · Save my voice / Delete my voice", "08 · Team review (later)"):
        b.chip(c, ln, C["accentInk"], C["surface"], size=13)
    b.txt(c, "Fills the width (16 px gutters), scrolls with the page. The header and footer stay.", size=13,
          color=C["ink2"], align="center", fillW=True, lh="145%")


def build(x=0, y=0):
    b, s = X.board("s18s_", "18 Phone view · anatomy", x, y, "Phone view · anatomy",
                   "The shell that 010 and 08 mount into. 375×667, targets 48 px, strings by key, language "
                   "from navigator.language (de default).")
    r = b.row(s, "Row", gap=48, cross="min")
    ph = b.col(r, "Phone", radius=24, stroke=C["line"], clip=True, effects=SHADOW, w=375, h=667, fill=C["bg"])
    P.header(b, ph, P.T["en"], "connected")
    body = b.col(ph, "Consumer slot", gap=16, pad=[20, 16, 8, 16], sizingH="fill", sizingV="fill")
    slot_demo(b, body, P.T["en"])
    P.footer(b, ph, P.T["en"]["foot"])
    notes = b.col(r, "Decisions", gap=18, w=760)
    for h, txt in (
        ("Header", "App mark, “Meeting Companion” and a status word with a dot (“Connected” / “Closed”). "
                   "No meeting title, names, time or recording state: nothing from the meeting crosses the "
                   "network in this job, and a photo of the phone shows nothing either."),
        ("Waiting state", "When no consumer view is active, a calm card: “Connected to the meeting screen”. "
                          "No spinner: nothing is loading, the phone waits for the meeting."),
        ("Closed", "“This page is closed” with the reason in plain words and the hint to scan the QR code on "
                   "the meeting screen again. No Reload or Reconnect button: the phone cannot reopen the view, "
                   "and a reload would only reach a dead port (browser error)."),
        ("Theme", "Follows the phone’s light/dark setting (prefers-color-scheme). There is no switch on the phone. "
                  "Both themes use the app’s tokens; no extra colours."),
        ("Footer", "One line on where the page comes from (local network) and that it shows nothing from the "
                   "meeting. Closed: nothing from the page was kept on the phone (no storage, the token is "
                   "removed from the address bar at once)."),
        ("Targets", "Every control a consumer adds is ≥ 48×48 px with a visible focus ring. The shell itself has "
                    "no controls.")):
        n = b.col(notes, h, gap=4, sizingH="fill")
        b.txt(n, h, size=15, style="SemiBold")
        b.txt(n, txt, size=14, color=C["ink2"], fillW=True, lh="150%")
    return b
