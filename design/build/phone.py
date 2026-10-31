"""Job 012: the phone page shell (phone.html), served over the local network to phones that scanned the QR code.

Header: the app mark and name plus a status word ("Connected" / "Closed"). Never the meeting title, people or
anything else from the meeting. Below it one consumer slot (010's voice pages, later 08's review). A small
footer says where the page comes from. Language follows the phone (de default); theme follows the phone's
light/dark setting (there is nowhere to choose it on the phone). Targets are 48 px.
"""
from kit import B, C, DARK, SHADOW, themed

T = {
    "en": dict(app="Meeting Companion", connected="Connected", closed="Closed",
               wait_t="Connected to the meeting screen",
               wait_s="Nothing to do right now. When the meeting asks you for something, it appears here.",
               closed_t="This page is closed",
               closed_s="The meeting screen closed it, or the recording has stopped.",
               closed_h="To take part again, scan the QR code on the meeting screen.",
               foot="Local network only. This page shows nothing from the meeting.",
               foot_closed="Nothing from this page was kept on your phone."),
    "de": dict(app="Meeting Companion", connected="Verbunden", closed="Geschlossen",
               wait_t="Mit dem Besprechungsbildschirm verbunden",
               wait_s="Gerade gibt es nichts zu tun. Wenn die Besprechung Sie um etwas bittet, erscheint es hier.",
               closed_t="Diese Seite ist geschlossen",
               closed_s="Der Besprechungsbildschirm hat sie geschlossen, oder die Aufnahme wurde beendet.",
               closed_h="Um wieder teilzunehmen, scannen Sie den QR-Code auf dem Besprechungsbildschirm erneut.",
               foot="Nur im lokalen Netzwerk. Diese Seite zeigt nichts aus der Besprechung.",
               foot_closed="Von dieser Seite bleibt nichts auf Ihrem Telefon."),
}


def header(b, s, t, state):
    h = b.row(s, "Header", gap=10, pad=[14, 16, 14, 16], fill=C["surface"], sizingH="fill", sides=[0, 0, 1, 0],
              stroke=C["line"])
    mark = b.row(h, "Mark", w=32, h=32, radius=9, fill=C["accent"], main="center", cross="center")
    b.txt(mark, "◆", size=14, style="Bold", color=C.get("onAccent", "#FFFFFF"))
    b.txt(h, t["app"], size=16, style="Bold")
    b.spacer(h)
    if state == "connected":
        st = b.row(h, "Status Connected", gap=6, pad=[5, 10, 5, 8], radius=999, fill=C["greenSoft"])
        b.dot(st, 8, C["green"])
        b.txt(st, t["connected"], size=13, style="SemiBold", color=C["green"])
    else:
        st = b.row(h, "Status Closed", gap=6, pad=[5, 10, 5, 8], radius=999, fill=C["sunken"])
        b.txt(st, "○", size=12, style="Bold", color=C["ink2"])
        b.txt(st, t["closed"], size=13, style="SemiBold", color=C["ink2"])
    return h


def footer(b, s, text):
    f = b.row(s, "Footer", gap=8, pad=[12, 20, 16, 20], sizingH="fill", cross="min")
    b.txt(f, text, size=12, color=C["ink2"], fillW=True, lh="145%")
    return f


def waiting(b, slot, t):
    c = b.col(slot, "Waiting (no consumer view)", gap=14, pad=[28, 22, 28, 22], radius=16, fill=C["surface"],
              stroke=C["line"], sizingH="fill", cross="center", effects=SHADOW)
    ring = b.row(c, "Icon", w=56, h=56, radius=28, fill=C["greenSoft"], main="center", cross="center")
    b.txt(ring, "✓", size=24, style="Bold", color=C["green"])
    b.txt(c, t["wait_t"], size=18, style="SemiBold", align="center", fillW=True, lh="130%")
    b.txt(c, t["wait_s"], size=15, color=C["ink2"], align="center", fillW=True, lh="150%")
    return c


def closed(b, slot, t):
    c = b.col(slot, "Closed", gap=14, pad=[32, 22, 32, 22], radius=16, fill=C["surface"], stroke=C["line"],
              sizingH="fill", cross="center", effects=SHADOW)
    ring = b.row(c, "Icon", w=56, h=56, radius=28, fill=C["sunken"], main="center", cross="center")
    b.txt(ring, "⏻", size=24, style="Bold", color=C["ink2"])
    b.txt(c, t["closed_t"], size=20, style="Bold", align="center", fillW=True, lh="130%")
    b.txt(c, t["closed_s"], size=15, color=C["ink2"], align="center", fillW=True, lh="150%")
    hint = b.row(c, "Hint", gap=12, pad=[12, 14, 12, 14], radius=12, fill=C["accentSoft"], sizingH="fill", cross="min")
    q = b.col(hint, "QR glyph", w=32, h=32, radius=6, fill=C["surface"], main="center", cross="center")
    b.txt(q, "▦", size=20, color=C["accentInk"])
    b.txt(hint, t["closed_h"], size=15, style="SemiBold", color=C["accentInk"], fillW=True, lh="145%")
    return c


def page(prefix, name, x, y, state="connected", lang="en", theme=None, slot=None, h=667, w=375):
    """slot(b, parent, t) draws a consumer view; None draws the waiting card (connected) or the closed card."""
    b = B(prefix)
    t = T[lang]

    def draw():
        s = b.col(None, name, w=w, h=h, fill=C["bg"], x=x, y=y, clip=True, key="screen")
        header(b, s, t, state)
        body = b.col(s, "Consumer slot", gap=16, pad=[20, 16, 8, 16], sizingH="fill", sizingV="fill")
        if state == "closed":
            closed(b, body, t)
        elif slot:
            slot(b, body, t)
        else:
            waiting(b, body, t)
        footer(b, s, t["foot_closed"] if state == "closed" else t["foot"])
        return s

    if theme:
        with themed(theme):
            draw()
    else:
        draw()
    return b
