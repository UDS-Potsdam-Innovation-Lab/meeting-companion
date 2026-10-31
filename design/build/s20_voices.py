"""20 Voice profiles (job 010): frame 06 with "Ask people to save their voice" on, the room-visible notices, the
marker next to REC on frame 02, the consent pages on the phone (inside 012's shell) and Settings › Voice profiles.

Decisions drawn here:
- Frame 06, card on: the toggle row grows into a card with 012's QR code (132 px) and the short URL, the line
  "Phones can save voices" and a link to the privacy notes. While it is on, "How names are found" is folded away
  (Help & legal carries it), so the card fits at 1280×800 next to "Invited" and "Apply names to transcript".
- The marker: frame 02 has no REC in its footer (REC lives in the top bar), so the persistent marker is a chip
  directly after the REC chip: "◉ Phones can save voices". Same chip on frame 06's top bar.
- Notices: frame 02's dark toast pattern, bottom left, 8 s, never blocks. A save has "Undo"; a delete has none.
- Phone: "Save my voice" and "No thanks" are two equal outlined buttons, stacked, neither filled, neither first by
  colour. Names are first name + initials only. The deletion code is shown once, large, in two groups of four.
- Settings: a new section "Voice profiles" (between Language model and General) with the switch "Allow voice
  profiles on this device" first, then the list. Delete asks inline in the row.
"""
import random
from kit import B, C, DARK, SHADOW, PEOPLE, themed
import setx as X
import phone as P
from s14_settings import Z, card_head, setting_row, info
import s19_help as H

URL = "192.168.178.24:52817"
CODE = ("K7QM", "4XPR")
PROFILES = [("MK", "Mara Klein", "12 Sep 2026", "29 Oct 2026", "v1"),
            ("TB", "Tobias Brandt", "12 Sep 2026", "22 Oct 2026", "v1"),
            ("LS", "Lena Sommer", "31 Oct 2026", "31 Oct 2026", "v1")]


# --- QR code ----------------------------------------------------------------------------------------------------

def qr(b, parent, px=132, n=25, name="QR code (qrcodegen SVG)"):
    """A stand-in QR code: finder patterns + seeded modules, quiet zone of 2 modules, always dark on white."""
    m = px / (n + 4)
    q = b.node("frame", parent, name=name, w=px, h=px, fill="#FFFFFF", cornerRadius=8, clip=True)
    rnd = random.Random(12)
    finder = [(0, 0), (n - 7, 0), (0, n - 7)]

    def in_finder(x, y):
        return any(fx - 1 <= x <= fx + 7 and fy - 1 <= y <= fy + 7 for fx, fy in finder)

    def mod(x, y, w=1, h=1):
        b.node("rectangle", q, name="m", x=round((x + 2) * m, 2), y=round((y + 2) * m, 2), w=round(w * m + 0.3, 2),
               h=round(h * m + 0.3, 2), fill="#17181C")
    for fx, fy in finder:
        mod(fx, fy, 7, 1); mod(fx, fy + 6, 7, 1); mod(fx, fy + 1, 1, 5); mod(fx + 6, fy + 1, 1, 5)
        mod(fx + 2, fy + 2, 3, 3)
    for y in range(n):
        run = None
        for x in range(n + 1):
            on = x < n and not in_finder(x, y) and rnd.random() < 0.47
            if on and run is None:
                run = x
            if not on and run is not None:
                mod(run, y, x - run, 1)
                run = None
    return q


# --- frame 06 / 02 pieces -------------------------------------------------------------------------------------------

def marker_chip(b, parent, size=12, name="Marker Phones can save voices"):
    return b.chip(parent, "◉  Phones can save voices", C["accentInk"], C["accentSoft"], size=size, name=name)


def voice_card(b, parent, state="on"):
    """state: on | off | error (no local network)."""
    on = state == "on"
    c = b.col(parent, "Ask people to save their voice", gap=12, pad=[14, 16, 14, 16], fill=C["surface"], radius=12,
              stroke=C["accent"] if on else C["line"], sizingH="fill", effects=SHADOW if on else None)
    tg = b.row(c, "Toggle row", gap=12, sizingH="fill")
    tc = b.col(tg, "Text", gap=1, sizingH="fill")
    b.txt(tc, "Ask people to save their voice", size=14, style="SemiBold", fillW=True)
    b.txt(tc, "Each person decides on their own phone", size=12, color=C["muted"], fillW=True)
    X.toggle(b, tg, on, Z("wide"))
    if on:
        r = b.row(c, "QR", gap=14, sizingH="fill", cross="min")
        fr = b.row(r, "QR frame", pad=4, radius=10, stroke=C["line"], fill="#FFFFFF")
        qr(b, fr, 124)
        rc = b.col(r, "How", gap=6, sizingH="fill")
        b.txt(rc, "Phones can save voices", size=15, style="SemiBold", color=C["accentInk"], fillW=True)
        b.txt(rc, "Scan with the phone camera. Same Wi-Fi as this device.", size=12, color=C["ink2"], fillW=True,
              lh="145%")
        u = b.row(rc, "Short URL", pad=[5, 8, 5, 8], radius=6, fill=C["sunken"])
        b.txt(u, URL, size=13, style="SemiBold", color=C["ink"], features={"tnum": True})
        b.txt(rc, "Closes when you switch it off or the recording stops.", size=12, color=C["muted"], fillW=True,
              lh="145%")
        X.link(b, c, "Privacy: voice profiles", Z("wide"), size=12)
    elif state == "error":
        info(b, c, "!", "No local network found", Z("wide"), tone="amber",
             sub="Phones reach this device over Wi-Fi or Ethernet. Connect it to the room’s network, then try again.")
    return c


def toast(b, parent, text, undo=True, x=24, y=700, absolute=True, sub=None):
    kw = dict(absolute=True, x=x, y=y) if absolute else {}
    t = b.row(parent, f"Notice {text}", gap=14, pad=[12, 14, 12, 18], fill=C["dark"], radius=14, effects=SHADOW,
              **kw)
    b.txt(t, "◉", size=16, color="#8F89FF")
    tc = b.col(t, "Text", gap=2)
    b.txt(tc, text, size=14, style="SemiBold", color="#FFFFFF")
    b.txt(tc, sub or "From a phone in this room · just now", size=12, color=C["darkMuted"])
    if undo:
        b.button(t, "Undo", "darkghost", size=12, pad=(7, 12, 7, 12))
    return t


def _desc(cmds, root):
    refs = {root}
    for c in cmds:
        p = c["params"].get("parent")
        if p and p["$ref"] in refs and "as" in c:
            refs.add(c["as"])
    return refs


def _ref(cmds, name):
    return next(c["as"] for c in cmds if c["params"].get("name") == name)


def speakers(prefix, name, x, y, state="on", notice="saved", theme=None):
    """Frame 06 at 1280×800 with the card in `state`; notice: saved | deleted | None."""
    import s6_speakers

    def make():
        b = s6_speakers.build(x, y)
        cmds = b.cmds
        drop = set()
        drop |= _desc(cmds, _ref(cmds, "Remember"))
        if state == "on":
            drop |= _desc(cmds, _ref(cmds, "How names are found"))
        right = _ref(cmds, "Attendees")
        apply_i = next(i for i, c in enumerate(cmds) if c.get("as") == _ref(cmds, "Button Apply names to transcript"))
        nb = B(prefix + "v")
        voice_card(nb, "__right__", state)
        for c in nb.cmds:
            p = c["params"].get("parent")
            if p and p["$ref"] == "__right__":
                p["$ref"] = right
        rec_txt = next(i for i, c in enumerate(cmds) if c["params"].get("name", "").startswith("Chip REC"))
        rec_par = cmds[rec_txt]["params"]["parent"]["$ref"]
        mk = B(prefix + "k")
        if state == "on":
            marker_chip(mk, "__bar__")
            for c in mk.cmds:
                p = c["params"].get("parent")
                if p and p["$ref"] == "__bar__":
                    p["$ref"] = rec_par
        tb = B(prefix + "t")
        if notice == "saved":
            toast(tb, "__s__", "Mara Klein saved her voice", undo=True, y=704)
        elif notice == "deleted":
            toast(tb, "__s__", "A voice profile was deleted", undo=False, y=704)
        out = []
        for i, c in enumerate(cmds):
            if i == apply_i:
                out += nb.cmds
            if c.get("as") in drop:
                continue
            out.append(c)
            if i == rec_txt + 2:  # after the REC chip's dot + text
                out += mk.cmds
        out += tb.cmds
        root = out[0]["as"]
        for c in tb.cmds:
            if c["params"].get("parent", {}).get("$ref") == "__s__":
                c["params"]["parent"]["$ref"] = root
        return out

    if theme:
        with themed(theme):
            cmds = make()
    else:
        cmds = make()
    for c in cmds:
        if "as" in c and c["as"].startswith("s6_"):
            c["as"] = prefix + c["as"][3:]
        p = c["params"].get("parent")
        if p and p["$ref"].startswith("s6_"):
            p["$ref"] = prefix + p["$ref"][3:]
    cmds[0]["params"].update(name=name, width=1280, height=800)
    out = B(prefix)
    out.cmds = cmds
    out.named = {"screen": cmds[0]["as"]}
    return out


def live(prefix, name, x, y, notice="saved"):
    """Frame 02 at 1280×800 (SoundWave footer) with the marker after REC and a notice."""
    import soundwave as W
    b = W.live_screen(prefix, name, x, y, w=1280, h=800, state="speech")
    cmds = b.cmds
    rec_i = next(i for i, c in enumerate(cmds) if c["params"].get("name", "").startswith("Chip REC"))
    bar = cmds[rec_i]["params"]["parent"]["$ref"]
    mk = B(prefix + "k")
    marker_chip(mk, "__bar__")
    z = Z("wide")
    import s14_settings as S
    S.lang_switch(mk, "__bar__", z)
    X.help_icon_button(mk, "__bar__", z)
    S.settings_button(mk, "__bar__", z, "rest")
    for c in mk.cmds:
        if c["params"].get("parent", {}).get("$ref") == "__bar__":
            c["params"]["parent"]["$ref"] = bar
    # drop the static "On-device" chip at 1280 to keep the bar on one line
    od = next((c["as"] for c in cmds if c["params"].get("name") == "Chip On-device · DE/EN"), None)
    drop = _desc(cmds, od) if od else set()
    tb = B(prefix + "t")
    if notice == "saved":
        toast(tb, cmds[0]["as"], "Mara Klein saved her voice", undo=True, x=344, y=640)
    elif notice == "deleted":
        toast(tb, cmds[0]["as"], "A voice profile was deleted", undo=False, x=344, y=640)
    out = []
    for i, c in enumerate(cmds):
        if c.get("as") in drop:
            continue
        out.append(c)
        if i == rec_i + 2:
            out += mk.cmds
    out += tb.cmds
    b.cmds = out
    return b


# --- phone pages -----------------------------------------------------------------------------------------------------

PT = {
    "en": dict(
        pick_t="Who are you?",
        pick_s="Pick your own name. Only people whose voice was confirmed in this meeting are listed.",
        pick_del="Delete my voice instead", privacy="Read the privacy notes",
        c_t="Save your voice on this device?",
        c_i="Mara, if you agree, Meeting Companion keeps a voice profile so that it can suggest your name in "
            "transcripts made on this device.",
        c=[("What is stored", "Voice features from what you said in this meeting, not audio. Also your name, when "
                              "you agreed and the version of this text."),
           ("Where", "Only on this device, encrypted with a key of its own. It never leaves the device."),
           ("What for", "To suggest your name in transcripts made here. A person always confirms it."),
           ("Who is responsible", "Grundschule am Lindenpark · datenschutz@schulamt-potsdam.de"),
           ("How long", "Until you or someone at this device deletes it. It is deleted automatically 12 months after "
                        "it was last used."),
           ("Changing your mind", "Delete it at any time on this page with your deletion code, or ask anyone at "
                                  "the device to delete it in Settings.")],
        save="Save my voice", no="No thanks", version="Consent text v1 · 31 Oct 2026",
        s_t="Your voice is saved", s_code="Your deletion code. It is shown only now:",
        s_hint="Write it down or take a photo. With it you can delete your voice from this page at any time.",
        s_also="Lost it? Anyone at the device can delete your voice in Settings.", done="Done",
        d_t="Delete my voice", d_s="Enter the 8-character code you got when you saved your voice.",
        d_btn="Delete my voice", d_lost="Lost the code? Ask someone at the device to delete it in Settings › "
                                       "Voice profiles."),
    "de": dict(
        c_t="Deine Stimme auf diesem Gerät speichern?",
        c_i="Mara, wenn du zustimmst, speichert Meeting Companion ein Stimmprofil, damit es deinen Namen in "
            "Transkripten auf diesem Gerät vorschlagen kann.",
        c=[("Was gespeichert wird", "Stimmmerkmale aus dem, was du in diesem Meeting gesagt hast, kein Audio. Dazu "
                                    "dein Name, wann du zugestimmt hast und die Version dieses Textes."),
           ("Wo", "Nur auf diesem Gerät, verschlüsselt mit einem eigenen Schlüssel. Es verlässt das Gerät nie."),
           ("Wofür", "Um deinen Namen in Transkripten vorzuschlagen, die hier entstehen. Ein Mensch bestätigt ihn "
                     "immer."),
           ("Verantwortlich", "Grundschule am Lindenpark · datenschutz@schulamt-potsdam.de"),
           ("Wie lange", "Bis du oder jemand an diesem Gerät es löscht. Zwölf Monate nach der letzten Nutzung wird es "
                         "automatisch gelöscht."),
           ("Es dir anders überlegen", "Lösche es jederzeit auf dieser Seite mit deinem Löschcode, oder bitte jemanden "
                                       "am Gerät, es in den Einstellungen zu löschen.")],
        save="Meine Stimme speichern", no="Nein, danke", version="Einwilligungstext v1 · 31.10.2026",
        privacy="Datenschutzhinweise lesen"),
}


def big_button(b, parent, label, kind="outline", name=None):
    """48 px+ phone button. outline = equal-weight choice, danger, primary."""
    fill, fg, stroke = {"outline": (C["surface"], C["ink"], C["ink2"]), "danger": (C["red"], "#FFFFFF", None),
                        "primary": (C["accent"], C.get("onAccent", "#FFFFFF"), None)}[kind]
    r = b.row(parent, name or f"Button {label}", h=52, radius=12, fill=fill, stroke=stroke, sizingH="fill",
              main="center", cross="center")
    if stroke:
        b.cmds[-1]["params"]["props"]["strokeWeight"] = 1.5
    b.txt(r, label, size=16, style="SemiBold", color=fg)
    return r


def phone_link(b, parent, text):
    r = b.row(parent, f"Link {text}", h=48, sizingH="fill", main="center", cross="center")
    b.txt(r, text, size=15, style="SemiBold", color=C["accent"] if C["bg"] != DARK["bg"] else C["accentInk"],
          textDecoration="underline")
    return r


def pick(b, slot, t):
    t2 = PT["en"]
    c = b.col(slot, "Pick your name", gap=12, sizingH="fill")
    b.txt(c, t2["pick_t"], size=22, style="Bold", fillW=True)
    b.txt(c, t2["pick_s"], size=15, color=C["ink2"], fillW=True, lh="150%")
    lst = b.col(c, "Names", gap=8, sizingH="fill")
    for ini in ("MK", "TB", "LS"):
        r = b.row(lst, f"Name {PEOPLE[ini][0].split()[0]}", gap=12, pad=[0, 14, 0, 14], h=56, radius=12,
                  fill=C["surface"], stroke=C["line"], sizingH="fill")
        b.avatar(r, ini, 34)
        b.txt(r, PEOPLE[ini][0].split()[0], size=17, style="SemiBold", fillW=True)
        b.txt(r, "›", size=20, color=C["muted"])
    b.node("frame", c, name="Gap", w=10, h=4, fill="none")
    phone_link(b, c, t2["pick_del"])
    phone_link(b, c, t2["privacy"])


def consent(lang):
    def draw(b, slot, t):
        t2 = PT[lang]
        c = b.col(slot, "Consent", gap=14, sizingH="fill")
        hd = b.row(c, "Who", gap=10, sizingH="fill")
        b.avatar(hd, "MK", 36)
        b.txt(hd, "Mara · MK", size=15, style="SemiBold", color=C["ink2"], fillW=True)
        b.txt(c, t2["c_t"], size=22, style="Bold", fillW=True, lh="125%")
        b.txt(c, t2["c_i"], size=15, color=C["ink"], fillW=True, lh="150%")
        card = b.col(c, "Consent text", gap=0, pad=[4, 16, 4, 16], radius=14, fill=C["surface"], stroke=C["line"],
                     sizingH="fill")
        for i, (k, v) in enumerate(t2["c"]):
            side = {} if i == 0 else {"sides": [1, 0, 0, 0], "stroke": C["line"]}
            r = b.col(card, k, gap=3, pad=[11, 0, 11, 0], sizingH="fill", **side)
            b.txt(r, k, size=14, style="SemiBold", fillW=True)
            b.txt(r, v, size=14, color=C["ink2"], fillW=True, lh="150%")
        phone_link(b, c, t2["privacy"])
        b.txt(c, t2["version"], size=12, color=C["muted"], fillW=True, align="center")
        big_button(b, c, t2["save"])
        big_button(b, c, t2["no"])
    return draw


def saved(b, slot, t):
    t2 = PT["en"]
    c = b.col(slot, "Saved", gap=14, pad=[24, 20, 24, 20], radius=16, fill=C["surface"], stroke=C["line"],
              sizingH="fill", cross="center", effects=SHADOW)
    ring = b.row(c, "Icon", w=56, h=56, radius=28, fill=C["greenSoft"], main="center", cross="center")
    b.txt(ring, "✓", size=24, style="Bold", color=C["green"])
    b.txt(c, t2["s_t"], size=21, style="Bold", align="center", fillW=True)
    b.txt(c, t2["s_code"], size=14, color=C["ink2"], align="center", fillW=True)
    code = b.row(c, "Deletion code (shown once)", gap=10, pad=[12, 18, 12, 18], radius=12, fill=C["sunken"],
                 main="center")
    for g in CODE:
        b.txt(code, g, size=30, style="Bold", ls=3, features={"tnum": True})
    b.txt(c, t2["s_hint"], size=14, color=C["ink"], align="center", fillW=True, lh="150%")
    b.txt(c, t2["s_also"], size=13, color=C["ink2"], align="center", fillW=True, lh="145%")
    big_button(b, c, t2["done"], "primary")


def delete(state="entry"):
    def draw(b, slot, t):
        t2 = PT["en"]
        c = b.col(slot, "Delete my voice", gap=12, sizingH="fill")
        b.txt(c, t2["d_t"], size=22, style="Bold", fillW=True)
        b.txt(c, t2["d_s"], size=15, color=C["ink2"], fillW=True, lh="150%")
        lab = b.txt(c, "Deletion code", size=14, style="SemiBold")
        f = b.row(c, "Code input", gap=8, pad=[0, 14, 0, 14], h=52, radius=12, fill=C["surface"],
                  stroke=C["red"] if state == "wrong" else C["accent"], sizingH="fill",
                  effects=None if state == "wrong" else
                  [{"type": "dropShadow", "color": C["accent"] + "33", "offset": [0, 0], "radius": 0, "spread": 3}])
        b.cmds[-1]["params"]["props"]["strokeWeight"] = 2
        b.txt(f, "K7QM 4XPR" if state != "wrong" else "K7QM 4XRP", size=20, style="SemiBold", ls=2, fillW=True)
        if state == "wrong":
            e = b.row(c, "Error", gap=8, sizingH="fill", cross="min")
            ic = b.row(e, "Icon", w=18, h=18, radius=9, fill=C["red"], main="center", cross="center")
            b.txt(ic, "!", size=11, style="Bold", color=C["surface"])
            b.txt(e, "That code did not work. Check it and try again.", size=14, style="SemiBold", color=C["red"],
                  fillW=True, lh="145%")
        big_button(b, c, t2["d_btn"], "danger")
        b.txt(c, t2["d_lost"], size=13, color=C["ink2"], fillW=True, lh="150%")
    return draw


def phone_page(prefix, name, x, y, slot, h=667, theme=None):
    return P.page(prefix, name, x, y, "connected", "en", slot=slot, h=h, theme=theme)


# --- Settings › Voice profiles -----------------------------------------------------------------------------------------

def settings_bar(b, s, z):
    H.bar(b, s, z, "setup", settings_state="active", back="setup")


def allow_card(b, sec, z, on=True):
    c = X.card(b, sec, "Allow voice profiles", z, gap=12)
    r = b.row(c, "Switch row", gap=16, sizingH="fill", cross="min")
    tc = b.col(r, "Text", gap=4, sizingH="fill")
    b.txt(tc, "Allow voice profiles on this device", size=z.f(16), style="SemiBold", fillW=True)
    b.txt(tc, "People can then save their voice from their own phone during a meeting, so the app can suggest their "
              "name next time. Off by default. Anyone with access to Settings on this device can change it.",
          size=z.f(13), color=C["ink2"], fillW=True, lh="150%")
    X.link(b, tc, "Privacy: voice profiles", z)
    X.toggle(b, r, on, z, name="Switch Allow voice profiles (role=switch)")
    if not on:
        info(b, c, "i", "Voice profiles are off on this device.", z, tone="neutral",
             sub="No voice is recognised or saved, and the card in Speakers is hidden. Saved profiles stay listed "
                 "below until someone deletes them.")
    return c


def list_card(b, sec, z, state="list", confirm=None):
    """state: list | empty."""
    c = X.card(b, sec, "Saved voices", z, gap=0)

    def right(h):
        if state == "list":
            X.status(b, h, "◉", f"{len(PROFILES)} saved", C["accentInk"], C["accentSoft"], z)
    card_head(b, c, "Saved voices", "Each profile has its own key. Deleting it removes the key and the file; "
                                    "transcripts stay as they are.", z, right=right)
    b.node("frame", c, name="Gap", w=10, h=z.f(12), fill="none")
    if state == "empty":
        e = b.col(c, "Empty", gap=6, pad=[z.f(18), z.f(18), z.f(18), z.f(18)], radius=12, fill=C["sunken"],
                  sizingH="fill", cross="center")
        b.txt(e, "◉", size=z.f(22), color=C["muted"])
        b.txt(e, "No voices saved on this device", size=z.f(15), style="SemiBold", align="center", fillW=True)
        b.txt(e, "When someone saves their voice from their phone in a meeting, it is listed here.", size=z.f(13),
              color=C["ink2"], align="center", fillW=True)
        return c
    if not z.narrow:
        hr = b.row(c, "Header", gap=16, pad=[z.f(8), 0, z.f(8), 0], sizingH="fill", sides=[0, 0, 1, 0],
                   stroke=C["line"])
        for lbl, w in (("Name", None), ("Agreed on", 120), ("Last used", 120), ("Text", 60), ("", 96)):
            b.txt(hr, lbl, size=z.f(12), style="SemiBold", color=C["muted"], w=w, fillW=w is None)
    for i, (ini, name, agreed, last, ver) in enumerate(PROFILES):
        side = {"sides": [1, 0, 0, 0], "stroke": C["line"]} if i or z.narrow else {}
        if confirm == ini:
            r = b.col(c, f"Profile {name} · confirm delete", gap=10, pad=[z.f(14), z.f(14), z.f(14), z.f(14)],
                      radius=12, fill=C["redSoft"], sizingH="fill")
            hr = b.row(r, "Head", gap=10, sizingH="fill")
            b.avatar(hr, ini, 30)
            b.txt(hr, f"Delete {name}’s voice?", size=z.f(15), style="SemiBold", color=C["red"], fillW=True)
            b.txt(r, "The profile and its key are removed from this device. Unconfirmed “Remembered voice” "
                     "suggestions go back to “Voice A, B…”. Meetings and transcripts are not changed.",
                  size=z.f(13), color=C["ink"], fillW=True, lh="150%")
            ar = X.actions(b, r, z)
            fs, pad = z.btn
            b.button(ar, "Delete voice", "primary", size=fs, pad=pad, name="Button Delete voice (confirm)")
            b.cmds[-2]["params"]["props"]["fill"] = C["red"]
            b.cmds[-1]["params"]["props"]["fill"] = "#FFFFFF" if C["bg"] != DARK["bg"] else DARK["bg"]
            X.btn(b, ar, "Cancel", "ghost", z)
            continue
        if z.narrow:
            r = b.col(c, f"Profile {name}", gap=8, pad=[z.f(12), 0, z.f(12), 0], sizingH="fill", **side)
            hr = b.row(r, "Head", gap=10, sizingH="fill")
            b.avatar(hr, ini, 30)
            b.txt(hr, name, size=z.f(15), style="SemiBold", fillW=True)
            X.btn(b, hr, "Delete", "danger", z)
            b.txt(r, f"Agreed {agreed} · last used {last} · text {ver}", size=z.f(12), color=C["ink2"], fillW=True)
        else:
            r = b.row(c, f"Profile {name}", gap=16, pad=[z.f(10), 0, z.f(10), 0], sizingH="fill", **side)
            nm = b.row(r, "Name", gap=10, sizingH="fill")
            b.avatar(nm, ini, 30)
            b.txt(nm, name, size=z.f(14), style="SemiBold", fillW=True)
            b.txt(r, agreed, size=z.f(13), color=C["ink2"], w=120)
            b.txt(r, last, size=z.f(13), color=C["ink2"], w=120)
            b.txt(r, ver, size=z.f(13), color=C["ink2"], w=60)
            d = b.row(r, "Delete cell", w=96, main="max")
            X.btn(b, d, "Delete", "danger", z)
    ft = b.row(c, "Footnote", pad=[z.f(12), 0, 0, 0], sizingH="fill")
    b.txt(ft, "Profiles not used for 12 months are deleted automatically when the app starts.", size=z.f(12),
          color=C["muted"], fillW=True)
    return c


def settings_content(on=True, state="list", confirm=None):
    def draw(b, sec, z):
        allow_card(b, sec, z, on)
        list_card(b, sec, z, state, confirm)
    return draw


def settings(prefix, name, x, y, w=1440, h=900, size="wide", theme=None, **kw):
    return X.screen(prefix, name, x, y, settings_content(**kw), w=w, h=h, size=size, theme=theme,
                    sections=X.SECTIONS_ALL, active="Voice profiles", help_link=True,
                    topbar=settings_bar if size != "phone" else None)


def build(x=0, y=0):
    return speakers("s20_", "20 Voice profiles · 06 Speakers · card on · saved notice", x, y, "on", "saved")
