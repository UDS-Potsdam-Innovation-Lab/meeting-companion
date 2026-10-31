"""20 Voice profiles · states: the frame 06 card (off / on / no local network), the room-visible notices, the
marker, phone results (No thanks, wrong code), and dark."""
from kit import B, C, DARK, SHADOW, themed
import setx as X
import phone as P
import s20_voices as V


def build(x=0, y=0):
    b, s = X.board("s20s_", "20 Voice profiles · states", x, y, "Voice profiles · states",
                   "Card, notices and marker are visible to everyone in the room; nothing here ever blocks the "
                   "meeting. With “Allow voice profiles on this device” off, frame 06 shows no card at all.")
    sec = X.section(b, s, "Frame 06 card · right column (400 px)")
    r = b.row(sec, "Cards", gap=24, cross="min")
    for st, t, sub in (("off", "Off", "Every meeting starts here. Only while recording, only on this device."),
                       ("on", "On", "012’s QR code and short URL; the token is in the code, never shown as text."),
                       ("error", "Could not open", "phoneView.error.noLocalNetwork. The switch flips back to off.")):
        c = X.cell(b, r, t, sub, w=400)
        V.voice_card(b, c, st)

    sec = X.section(b, s, "Notices · frames 06 and 02, 8 s, bottom left, never modal")
    r = b.row(sec, "Notices", gap=24, cross="min")
    for t, undo, sub, cap in (("Mara Klein saved her voice", True, None, "Save · with Undo"),
                              ("A voice profile was deleted", False, None, "Delete · from a phone or Settings"),
                              ("Mara Klein’s voice was not kept", False, "Undone at the meeting screen", "After Undo")):
        c = X.cell(b, r, cap, None, w=440)
        V.toast(b, c, t, undo=undo, absolute=False, sub=sub)
    b.txt(sec, "A delete notice names nobody: the name could reveal who removed a profile from their own phone.",
          size=13, color=C["ink2"])

    sec = X.section(b, s, "Marker after REC (frames 02 and 06, while the card is on)")
    r = b.row(sec, "Marker", gap=12)
    b.chip(r, "REC  00:23:41", C["red"], C["redSoft"], dot=C["red"])
    V.marker_chip(b, r)
    b.txt(r, "Disappears with the QR code: switch off, recording stops, meeting ends.", size=13, color=C["ink2"])

    sec = X.section(b, s, "Phone · results")
    r = b.row(sec, "Phone results", gap=24, cross="min")

    def nothanks(b2, slot, t):
        c = b2.col(slot, "No thanks", gap=12, pad=[24, 20, 24, 20], radius=16, fill=C["surface"], stroke=C["line"],
                   sizingH="fill", cross="center", effects=SHADOW)
        b2.txt(c, "Nothing was saved", size=20, style="Bold", align="center", fillW=True)
        b2.txt(c, "Your voice is not remembered. You can close this page.", size=15, color=C["ink2"],
               align="center", fillW=True, lh="150%")
    for cap, slot in (("No thanks", nothanks), ("Wrong code (counts towards 012’s rate limit)", V.delete("wrong"))):
        c = X.cell(b, r, cap, None, w=375)
        ph = b.col(c, "Phone", w=375, h=520, radius=16, clip=True, stroke=C["line"], fill=C["bg"])
        P.header(b, ph, P.T["en"], "connected")
        body = b.col(ph, "Consumer slot", gap=16, pad=[20, 16, 8, 16], sizingH="fill", sizingV="fill")
        slot(b, body, P.T["en"])

    with themed(DARK):
        dk = b.col(s, "Dark", gap=16, pad=32, radius=20, fill=C["bg"])
        b.txt(dk, "Dark", size=18, style="Bold")
        r = b.row(dk, "Dark row", gap=24, cross="min")
        c = b.col(r, "Card", w=400)
        V.voice_card(b, c, "on")
        c = b.col(r, "Notice", gap=12)
        V.toast(b, c, "Mara Klein saved her voice", undo=True, absolute=False)
        V.marker_chip(b, c)
        ph = b.col(r, "Phone consent buttons", w=375, gap=12, pad=16, radius=16, fill=C["bg"], stroke=C["line"])
        V.big_button(b, ph, "Save my voice")
        V.big_button(b, ph, "No thanks")
    return b
