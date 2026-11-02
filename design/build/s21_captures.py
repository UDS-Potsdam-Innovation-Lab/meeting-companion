"""21 Captures (job 018 quick capture, job #19 capture suggestions): the right column of frame 02.

German copy (the app's default language). The live view is frame 02 as the app draws it now (SoundWave footer,
one "Transkript" tab), plus the captures column. Helpers for all s21* frames.

Column, top to bottom: kind tabs with counts · list (scrolls; pending suggestions on top, then confirmed captures
grouped by agenda item, the running item first, newest first inside a group) · notice with Undo (non-modal) ·
composer (pinned) · status line (job #19 only; 018 shows none).

Composer: three kind buttons above the field (one tap; `/d` `/t` `/q` also work in the field). The chosen kind
is the open tab, so a saved capture appears at the top of what you see. A to-do gets two optional chip rows,
"Wer" (the meeting's participants) and "Bis" (Heute / Morgen / next Friday / Datum …), no popovers.

Below 800 px the column becomes the second tab of the centre card ("Festgehalten"), and the composer sticks to
the bottom of the window, so quick capture is one tap from either tab.
"""
from kit import B, C, DARK, SHADOW, PEOPLE, themed
import soundwave as W

TITLE = "Produkt-Sync · Beta-Start"


class Z:
    """wide (1280–1440), board (1920×1080, 48 px targets), tablet (768), phone (375)."""

    def __init__(self, size):
        self.size = size
        self.k = 1.25 if size == "board" else 1.0
        self.narrow = size in ("tablet", "phone")
        self.board = size == "board"
        self.tap = 48 if size == "board" else None

    def f(self, n):
        return round(n * self.k)


def dark():
    return C["bg"] == DARK["bg"]


def kinds():
    q = C["accentInk"] if dark() else C["accent"]
    return {
        "d": dict(label="Beschluss", plural="Beschlüsse", done="Beschlossen", glyph="✓", fg=C["green"],
                  bg=C["greenSoft"], cmd="/d"),
        "t": dict(label="Aufgabe", plural="Aufgaben", done="Aufgabe", glyph="☐", fg=C["amber"], bg=C["amberSoft"],
                  cmd="/t"),
        "q": dict(label="Frage", plural="Fragen", done="Frage", glyph="?", fg=q, bg=C["accentSoft"], cmd="/q"),
    }


def tall(b, ref, h):
    """Fix a frame's height (48 px touch targets on the board)."""
    if not h:
        return ref
    c = next(c for c in b.cmds if c.get("as") == ref)
    c["params"]["height"] = h
    c["params"]["props"]["sizingV"] = "fixed"
    return ref


def btn(b, parent, label, kind, z, icon=None, fillW=False, name=None, small=False):
    fs = z.f(12 if small else 13)
    pad = (z.f(6), z.f(12), z.f(6), z.f(12)) if small else (z.f(8), z.f(14), z.f(8), z.f(14))
    r = b.button(parent, label, kind, size=fs, pad=pad, icon=icon, fillW=fillW, name=name)
    return tall(b, r, z.tap)


def focus_ring():
    return [{"type": "dropShadow", "color": C["surface"], "offset": [0, 0], "radius": 0, "spread": 2},
            {"type": "dropShadow", "color": C["accent"], "offset": [0, 0], "radius": 0, "spread": 4}]


def eyebrow(b, parent, text, z, color=None):
    return b.txt(parent, text.upper(), size=z.f(11), style="SemiBold", color=color or C["muted"], ls=0.8,
                 name=f"Eyebrow {text[:24]}")


def kind_chip(b, parent, k, z, text=None, glyph=True):
    K = kinds()[k]
    return b.chip(parent, (K["glyph"] + " " if glyph else "") + (text or K["label"]), K["fg"], K["bg"],
                  size=z.f(11), pad=(z.f(3), z.f(8), z.f(3), z.f(8)))


def ai_chip(b, parent, text, z):
    return b.chip(parent, "✦ " + text, C["accentInk"], C["accentSoft"], size=z.f(11),
                  pad=(z.f(3), z.f(8), z.f(3), z.f(8)))


def icon_button(b, parent, glyph, z, name, d=None):
    d = d or (48 if z.board else 30)
    i = b.row(parent, name, w=d, h=d, radius=8, main="center", cross="center", fill="none")
    b.txt(i, glyph, size=z.f(14), style="SemiBold", color=C["muted"])
    return i


def owner_line(b, parent, owner, due, z, prefix=None):
    r = b.row(parent, "Owner + due", gap=z.f(8), sizingH="fill")
    if prefix:
        b.txt(r, prefix, size=z.f(12), color=C["muted"])
    if owner:
        b.avatar(r, owner, z.f(22))
        b.txt(r, PEOPLE[owner][0], size=z.f(12), color=C["ink2"])
    if due:
        b.chip(r, "bis " + due, C["ink2"], C["sunken"], size=z.f(11), style="Regular",
               pad=(z.f(3), z.f(8), z.f(3), z.f(8)))
    return r


# --- cards ---------------------------------------------------------------------------------------------------

def capture_card(b, parent, cap, z, focus=False):
    """A confirmed capture. cap: kind, text, item, time, owner?, due?, src? ('suggested'), new?, edited?"""
    K = kinds()[cap["kind"]]
    new = cap.get("new")
    c = b.card(parent, f"Capture {cap['text'][:24]}", pad=[z.f(12), z.f(10), z.f(14), z.f(16)], gap=z.f(6),
               stroke=K["fg"] if new else (C["accent"] if focus else C["line"]))
    if new or focus:
        b.cmds[-1]["params"]["props"]["strokeWeight"] = 2
    h = b.row(c, "Head", gap=z.f(8), sizingH="fill")
    kind_chip(b, h, cap["kind"], z, K["done"])
    meta = f"{cap['item']} · {cap['time']}" if cap.get("show_item") else cap["time"]
    if cap.get("edited"):
        meta += " · bearbeitet"
    b.txt(h, meta, size=z.f(12), color=C["muted"])
    if cap.get("src") == "suggested":
        b.txt(h, "✦", size=z.f(12), color=C["accentInk"] if dark() else C["accent"], name="From suggestion")
    b.spacer(h)
    if new:
        b.txt(h, "gerade gespeichert", size=z.f(12), style="SemiBold", color=K["fg"])
    else:
        icon_button(b, h, "✎", z, "Button Bearbeiten (icon)", d=None if z.board else 26)
    b.txt(c, cap["text"], size=z.f(14), style="SemiBold", fillW=True, lh="140%")
    if cap["kind"] == "t" and (cap.get("owner") or cap.get("due")):
        owner_line(b, c, cap.get("owner"), cap.get("due"), z)
    return c


def suggestion_card(b, parent, s, z, focus=False):
    """A pending suggestion (job #19): nothing is stored until a person taps Bestätigen."""
    K = kinds()[s["kind"]]
    c = b.card(parent, f"Suggestion {s['text'][:24]}" + (" (focus)" if focus else ""), pad=z.f(16), gap=z.f(10),
               stroke=C["accent"], effects=SHADOW)
    if focus:  # focus moved here from the transcript chip: a 2.5 px ring instead of the 1 px edge
        b.cmds[-1]["params"]["props"]["strokeWeight"] = 2.5
    h = b.row(c, "Head", gap=z.f(6), sizingH="fill")
    ai_chip(b, h, "Vorschlag · " + s["time"], z)
    kind_chip(b, h, s["kind"], z, glyph=False)  # no ✓ before a person confirmed it
    b.txt(c, s["text"], size=z.f(15), style="SemiBold", fillW=True, lh="140%")
    if s["kind"] == "t" and (s.get("owner") or s.get("due")):
        owner_line(b, c, s.get("owner"), s.get("due"), z, prefix="Vorschlag:")
    src = b.row(c, "Source", gap=z.f(4), sizingH="fill")
    b.txt(src, "Aus dem Transkript:", size=z.f(12), color=C["muted"])
    b.txt(src, f"{PEOPLE[s['who']][0]}, {s['time']} ›", size=z.f(12), style="SemiBold",
          color=C["accentInk"] if dark() else C["accent"], name="Link source line")
    if z.size == "phone":
        ac = b.col(c, "Actions", gap=8, sizingH="fill")
        btn(b, ac, "Bestätigen", "primary", z, icon="✓", fillW=True)
        ar = b.row(ac, "More", gap=8, sizingH="fill")
        btn(b, ar, "Bearbeiten", "ghost", z, fillW=True)
        btn(b, ar, "Verwerfen", "ghost", z, fillW=True)
        return c
    ar = b.row(c, "Actions", gap=z.f(8), sizingH="fill")
    btn(b, ar, "Bestätigen", "primary", z, icon="✓", fillW=True)
    btn(b, ar, "Bearbeiten", "ghost", z)
    btn(b, ar, "Verwerfen", "ghost", z)
    return c


# --- editor (composer, inline edit, suggestion edit) -----------------------------------------------------------

def kind_picker(b, parent, active, z, fill=True):
    r = b.row(parent, "Kind", gap=z.f(6), sizingH="fill" if fill else None)
    for k, K in kinds().items():
        on = k == active
        p = b.row(r, f"Kind {K['label']}", gap=z.f(6), pad=[z.f(5), z.f(10), z.f(5), z.f(10)], radius=999,
                  fill=K["bg"] if on else C["surface"], stroke=K["fg"] if on else C["line"], main="center",
                  sizingH="fill" if fill else None)
        if on:
            b.cmds[-1]["params"]["props"]["strokeWeight"] = 1.5
        tall(b, p, z.tap)
        b.dot(p, z.f(8), K["fg"])
        b.txt(p, K["label"], size=z.f(12), style="SemiBold", color=K["fg"] if on else C["ink2"])
    return r


def text_field(b, parent, z, text, kind, state="typing", lines=None):
    """state: rest | typing | error."""
    K = kinds()[kind]
    stroke = {"rest": C["line"], "typing": C["accent"], "error": C["red"]}[state]
    f = b.row(parent, "Field", gap=0, pad=[z.f(10), z.f(12), z.f(10), z.f(12)], radius=10, fill=C["surface"],
              stroke=stroke, sizingH="fill", cross="max")
    if state != "rest":
        b.cmds[-1]["params"]["props"]["strokeWeight"] = 2
    tall(b, f, z.tap if state == "rest" else None)
    if text:
        b.txt(f, text, size=z.f(14), fillW=True, lh="145%")
        if state == "typing":
            b.rect(f, 1.5, z.f(18), C["accent"], name="Caret")
    else:
        if state == "typing":
            b.rect(f, 1.5, z.f(18), C["accent"], name="Caret")
        b.txt(f, f"{K['label']} notieren …", size=z.f(14), color=C["muted"], fillW=True)
        b.txt(f, K["cmd"], size=z.f(12), color=C["muted"], name="Command hint")
    return f


def chip_choice(b, parent, label, on, z, avatar=None):
    c = b.row(parent, f"Choice {label}", gap=z.f(6), pad=[z.f(4), z.f(10), z.f(4), z.f(6) if avatar else z.f(10)],
              radius=999, fill=C["accentSoft"] if on else C["surface"], stroke=C["accent"] if on else C["line"])
    if on:
        b.cmds[-1]["params"]["props"]["strokeWeight"] = 1.5
    tall(b, c, z.tap)
    if avatar:
        b.avatar(c, avatar, z.f(20))
    if on and not avatar:
        b.txt(c, "✓", size=z.f(12), style="Bold", color=C["accentInk"])
    b.txt(c, label, size=z.f(12), style="SemiBold" if on else "Regular",
          color=C["accentInk"] if on else C["ink2"])
    return c


OWNERS = ["YA", "MK", "TB", "LS", "JR"]
DUES = ["Heute", "Morgen", "Fr 6. Nov.", "Datum …"]


def todo_rows(b, parent, z, owner, due):
    dues = DUES if (due is None or due in DUES) else DUES[:-1] + [due]
    for lab, opts in (("Wer", OWNERS), ("Bis", dues)):
        r = b.row(parent, f"{lab} row", gap=z.f(8), sizingH="fill", cross="min")
        lw = b.row(r, "Label", w=z.f(28), pad=[z.f(5), 0, 0, 0])
        b.txt(lw, lab, size=z.f(12), style="SemiBold", color=C["muted"])
        ch = b.row(r, "Choices", gap=z.f(6), wrap=True, crossGap=z.f(6), sizingH="fill")
        for o in opts:
            if lab == "Wer":
                chip_choice(b, ch, PEOPLE[o][0].split()[0], o == owner, z, avatar=o)
            else:
                chip_choice(b, ch, o, o == due, z)


def editor(b, parent, z, kind, text, owner=None, due=None, mode="new", attach="Punkt 02", state="typing",
           error=None, name=None, count=None):
    """mode: new (the composer) | edit (a confirmed capture) | suggestion (a pending suggestion)."""
    focus = state != "rest"
    e = b.col(parent, name or f"Editor {mode}", gap=z.f(10), pad=z.f(12), radius=14, fill=C["surface"],
              stroke=C["accent"] if (focus and mode != "new") else C["line"], sizingH="fill",
              effects=SHADOW if focus else None)
    if mode == "suggestion":
        h = b.row(e, "Head", gap=z.f(6), sizingH="fill")
        ai_chip(b, h, "Vorschlag · 10:12", z)
        b.txt(h, "wird bearbeitet", size=z.f(12), color=C["muted"])
    elif mode == "edit":
        h = b.row(e, "Head", gap=z.f(6), sizingH="fill")
        b.txt(h, "Bearbeiten", size=z.f(13), style="SemiBold")
        b.txt(h, f"· {attach}", size=z.f(12), color=C["muted"])
    kind_picker(b, e, kind, z)
    text_field(b, e, z, text, kind, state if state in ("typing", "error", "rest") else "typing")
    if error:
        er = b.row(e, "Error", gap=z.f(6), sizingH="fill", cross="min")
        W.badge(b, er, "!", C["red"], C["surface"], z.f(14))
        b.txt(er, error, size=z.f(12), color=C["red"], fillW=True, lh="140%")
    if kind == "t" and focus:
        todo_rows(b, e, z, owner, due)
    if not focus:
        return e
    ft = b.row(e, "Footer", gap=z.f(8), sizingH="fill")
    if mode == "edit":
        btn(b, ft, "Löschen", "danger", z, small=True)
        b.spacer(ft)
        btn(b, ft, "Abbrechen", "ghost", z, small=True)
        btn(b, ft, "Speichern", "primary", z, small=True)
    elif mode == "suggestion":
        b.txt(ft, "Esc bricht ab", size=z.f(11), color=C["muted"])
        b.spacer(ft)
        btn(b, ft, "Abbrechen", "ghost", z, small=True)
        btn(b, ft, "Bestätigen", "primary", z, icon="✓", small=True)
    else:
        b.txt(ft, f"→ {attach}", size=z.f(12), style="SemiBold", color=C["ink2"], name="Attach to", fillW=True,
              maxLines=1, textAutoResize="truncate")
        if count:
            b.txt(ft, count, size=z.f(11), color=C["red"] if error else C["muted"], features={"tnum": True})
        if not z.narrow and len(attach) < 22:
            b.txt(ft, "Enter speichert", size=z.f(11), color=C["muted"])
        btn(b, ft, "Speichern", "primary", z, small=True)
    return e


def composer(b, parent, z, comp):
    """comp: dict(state rest|typing|error, kind, text, owner, due, attach, error, count)."""
    comp = dict(comp)
    st = comp.pop("state", "rest")
    return editor(b, parent, z, comp.pop("kind", "d"), comp.pop("text", ""), mode="new", state=st,
                  name="Quick capture", **comp)


# --- notice, status line ---------------------------------------------------------------------------------------

def notice(b, parent, z, text, sub=None, undo=True, frac=None, fillW=True, name=None):
    """Dark, non-modal, like frame 02's nudge. Undo stays for 8 s (the thin bar runs down)."""
    n = b.col(parent, name or f"Notice {text}", gap=0, radius=12, fill=C["dark"], effects=SHADOW, clip=True,
              sizingH="fill" if fillW else None, stroke=C["dark3"] if dark() else None)
    t = b.row(n, "Row", gap=z.f(12), pad=[z.f(10), z.f(10), z.f(10), z.f(14)], sizingH="fill" if fillW else None)
    tc = b.col(t, "Text", gap=2, sizingH="fill" if fillW else None)
    b.txt(tc, text, size=z.f(13), style="SemiBold", color="#FFFFFF", fillW=fillW)
    if sub:
        b.txt(tc, sub, size=z.f(12), color=C["darkMuted"], fillW=fillW)
    if undo:
        btn(b, t, "Rückgängig", "darkghost", z, small=True)
    if frac is not None:
        tr = b.row(n, "Undo time", h=3, fill=C["dark3"], sizingH="fill")
        b.rect(tr, round(340 * frac), 3, "#8F89FF", name="Left")
    return n


ERRORS = {  # engine error -> quiet line (job #19, AC5)
    "Offline": "Vorschläge pausiert: keine Internetverbindung.",
    "NoApiKey": "Vorschläge pausiert: Kein Claude-API-Schlüssel gespeichert.",
    "Unauthorized": "Vorschläge pausiert: Anthropic lehnt den API-Schlüssel ab.",
    "RateLimited": "Vorschläge pausiert: Anthropic bremst gerade (Limit erreicht).",
    "NoModel": "Vorschläge pausiert: Das Modell auf diesem Gerät fehlt.",
    "Failed": "Vorschläge pausiert: Das Sprachmodell hat nicht geantwortet.",
}


def status_line(b, parent, z, state, err="Offline", fillW=True):
    """Job #19: one line where the transcript text goes. off | local | cloud | error. Glyph + words, not colour."""
    r = b.row(parent, f"Status {state}", gap=z.f(8), pad=[z.f(2), z.f(4), z.f(2), z.f(4)],
              sizingH="fill" if fillW else None, cross="center")
    acc = C["accentInk"] if dark() else C["accent"]
    if state == "off":
        b.txt(r, "○", size=z.f(12), color=C["muted"])
        b.txt(r, "Vorschläge aus ·", size=z.f(12), color=C["ink2"])
        b.txt(r, "Sprachmodell wählen", size=z.f(12), style="SemiBold", color=acc, textDecoration="underline",
              name="Link Einstellungen › Sprachmodell")
    elif state == "local":
        b.txt(r, "✦", size=z.f(12), color=acc)
        b.txt(r, "Vorschläge auf diesem Gerät", size=z.f(12), color=C["ink2"])
    elif state == "cloud":
        c = b.row(r, "Cloud tag", pad=[z.f(1), z.f(6), z.f(1), z.f(6)], radius=5, stroke=C["amber"])
        b.txt(c, "Cloud", size=z.f(11), style="SemiBold", color=C["amber"])
        b.txt(r, "Vorschläge über Anthropic · Transkripttext verlässt dieses Gerät", size=z.f(12),
              color=C["ink2"], fillW=fillW, lh="140%")
    else:
        W.badge(b, r, "!", C["amber"], C["surface"], z.f(14))
        b.txt(r, ERRORS[err], size=z.f(12), color=C["ink2"], fillW=fillW, lh="140%")
    return r


# --- the column ----------------------------------------------------------------------------------------------

def kind_tabs(b, parent, active, counts, z, pending=(), fill=True):
    sg = b.row(parent, "Kind tabs", gap=2, pad=3, fill=C["sunken"], radius=10, sizingH="fill" if fill else None)
    for (k, K), n in zip(kinds().items(), counts):
        on = k == active
        t = b.row(sg, f"Tab {K['plural']}", gap=z.f(6), pad=[z.f(6), z.f(10), z.f(6), z.f(10)], radius=8,
                  main="center", fill=C["surface"] if on else "none", sizingH="fill" if fill else None,
                  effects=[{"type": "dropShadow", "color": "#00000014", "offset": [0, 1], "radius": 2}] if on else None)
        tall(b, t, z.tap)
        b.txt(t, K["plural"], size=z.f(13), style="SemiBold", color=C["ink"] if on else C["muted"])
        b.txt(t, str(n), size=z.f(13), style="SemiBold", color=C["ink2"] if on else C["muted"],
              features={"tnum": True})
        if k in pending:
            b.dot(t, z.f(7), C["accent"], name="Pending suggestion")
    return sg


def column_body(b, col, z, spec):
    """spec: tab, counts, pending[(k,...)] , suggestions[], groups[(eyebrow, [caps])], empty, composer{}, notice{},
    status, err, scroll."""
    sugs = spec.get("suggestions") or []
    if sugs:  # pinned above the scrolling list: they stay in view until someone acts on them
        pin = b.col(col, "Pending suggestions (pinned)", gap=z.f(8), sizingH="fill")
        eyebrow(b, pin, f"✦ Vorschläge · {len(sugs) + spec.get('more_sugs', 0)}", z,
                color=C["accentInk"] if dark() else C["accent"])
        for s in sugs:
            if s.get("edit"):
                editor(b, pin, z, s["kind"], s["text"], s.get("owner"), s.get("due"), mode="suggestion")
            else:
                suggestion_card(b, pin, s, z, focus=s.get("focus", False))
        if spec.get("more_sugs"):
            m = b.row(pin, "More suggestions", gap=6, pad=[2, 4, 2, 4], sizingH="fill")
            b.txt(m, f"{spec['more_sugs']} weiterer Vorschlag", size=z.f(12), style="SemiBold",
                  color=C["accentInk"] if dark() else C["accent"])
            b.txt(m, "· erscheint, sobald dieser erledigt ist", size=z.f(12), color=C["muted"])
    lst = b.col(col, "List", gap=z.f(10), sizingH="fill", sizingV="fill" if spec.get("fillV", True) else None,
                clip=True)
    if spec.get("empty"):
        e = b.col(lst, "Empty state", gap=z.f(6), pad=[z.f(20), z.f(16), z.f(20), z.f(16)], radius=14,
                  stroke=C["line"], sizingH="fill")
        b.cmds[-1]["params"]["props"]["dashes"] = [4, 4]
        t, s = spec["empty"]
        b.txt(e, t, size=z.f(14), style="SemiBold", color=C["ink2"], fillW=True)
        b.txt(e, s, size=z.f(13), color=C["muted"], fillW=True, lh="150%")
    for head, caps in spec.get("groups", []):
        g = b.col(lst, f"Group {head}", gap=z.f(8), sizingH="fill")
        hr = b.row(g, "Group head", gap=z.f(6), pad=[z.f(6), 2, 0, 2], sizingH="fill")
        eyebrow(b, hr, head, z, color=C["accentInk"] if "jetzt" in head.lower() or "läuft" in head.lower() else None)
        if not caps:
            b.txt(g, "Noch nichts zu diesem Thema", size=z.f(12), color=C["muted"], name="Group empty")
        for cap in caps:
            if cap.get("editing"):
                editor(b, g, z, cap["kind"], cap["text"], cap.get("owner"), cap.get("due"), mode="edit",
                       attach=cap["item"])
            else:
                capture_card(b, g, cap, z, focus=cap.get("focus", False))
    if spec.get("scroll"):
        y0, hh = spec["scroll"]
        b.col(lst, "Scroll position", w=4, h=hh, fill=C["muted"] + "88", radius=2, absolute=True,
              x=spec["_w"] - 4, y=y0)
    if spec.get("notice"):
        notice(b, col, z, **spec["notice"])
    if spec.get("composer") is not None:
        composer(b, col, z, spec["composer"])
    if spec.get("status"):
        status_line(b, col, z, spec["status"], spec.get("err", "Offline"))
    return lst


def column(b, parent, z, spec, w):
    col = b.col(parent, "Festgehalten", gap=z.f(12), w=w, sizingV="fill")
    spec = dict(spec, _w=w)
    kind_tabs(b, col, spec["tab"], spec["counts"], z, pending=spec.get("pending", ()))
    column_body(b, col, z, spec)
    return col


# --- left column, transcript ---------------------------------------------------------------------------------

ITEMS = [
    ("Check-in & Ziele", 5, "done", "6 von 5 Min. · 1 Beschluss · 2 Aufgaben"),
    ("Beta-Start: Umfang und Termin", 15, "now", "12 von 15 Min.{now}"),
    ("Pilotschulen: bisheriges Feedback", 20, "next", None),
    ("Budget für Q1-Nutzerforschung", 10, "next", None),
    ("Offene Fragen & nächste Schritte", 5, "next", None),
]


def agenda_column(b, parent, z, now_counts="1 Beschluss · 1 Aufgabe", w=300, compact=False):
    left = b.col(parent, "Agenda", gap=12, w=w, sizingV="fill" if not compact else None,
                 sizingH="fill" if compact else None)
    clock = b.card(left, "Current item timer", pad=z.f(18), gap=z.f(10), fill=C["dark"], stroke=None,
                   effects=SHADOW)
    eyebrow(b, clock, "Jetzt · Punkt 02", z, color=C["darkMuted"])
    b.txt(clock, "Beta-Start: Umfang und Termin", size=z.f(16), style="SemiBold", color=C["darkInk"], fillW=True)
    cr = b.row(clock, "Time", gap=8, cross="max")
    b.txt(cr, "3:12", size=z.f(44), style="Bold", color="#FFFFFF", ls=-1.5, features={"tnum": True})
    b.txt(cr, "von 15:00 übrig", size=z.f(13), color=C["darkMuted"])
    b.progress(clock, (w - 2 * z.f(18)) if not compact else 700, 0.79, "#F5B342", track=C["dark3"], h=8)
    br = b.row(clock, "Actions", gap=8, sizingH="fill")
    for lab, kind in (("+5 Min.", "darkghost"), ("Parken", "darkghost"), ("Weiter ›", "primary")):
        r = b.button(br, lab, kind, size=z.f(13), pad=(z.f(8), 12, z.f(8), 12), fillW=True)
        tall(b, r, z.tap)
    ag = b.card(left, "Agenda list", pad=8, gap=2, sizingV="fill" if not compact else None)
    for i, (title, plan, state, sub) in enumerate(ITEMS, 1):
        if compact and state == "next" and i > 3:
            continue
        r = b.row(ag, f"Item {i}", gap=10, pad=[z.f(10), 10, z.f(10), 10], radius=10, sizingH="fill",
                  fill=C["accentSoft"] if state == "now" else "none")
        d = z.f(22)
        if state == "done":
            m = b.row(r, "State", w=d, h=d, radius=d / 2, fill=C["greenSoft"], main="center", cross="center")
            b.txt(m, "✓", size=z.f(12), style="Bold", color=C["green"])
        elif state == "now":
            m = b.row(r, "State", w=d, h=d, radius=d / 2, fill=C["accent"], main="center", cross="center")
            b.dot(m, z.f(8), C.get("onAccent", "#FFFFFF"))
        else:
            m = b.row(r, "State", w=d, h=d, radius=d / 2, stroke=C["line"], main="center", cross="center")
            b.txt(m, str(i), size=z.f(11), style="SemiBold", color=C["muted"])
        c = b.col(r, "Text", gap=1, sizingH="fill")
        b.txt(c, title, size=z.f(13), style="SemiBold", color=C["muted"] if state == "done" else C["ink"], fillW=True)
        if state == "done":
            b.txt(c, sub, size=z.f(12), color=C["amber"], fillW=True)
        elif state == "now":
            b.txt(c, sub.format(now=" · " + now_counts if now_counts else ""), size=z.f(12), color=C["accentInk"], fillW=True)
        else:
            b.txt(c, f"{plan} Min.", size=z.f(12), color=C["muted"], fillW=True)
    if compact:
        b.txt(ag, "+ 2 weitere Punkte", size=z.f(12), color=C["muted"], name="More items")
        return left
    b.spacer(ag, "v")
    pk = b.row(ag, "Parkplatz", gap=8, pad=[10, 10, 10, 10], sizingH="fill", sides=[1, 0, 0, 0], stroke=C["line"])
    b.txt(pk, "🅿", size=z.f(14), color=C["muted"])
    b.txt(pk, "Parkplatz", size=z.f(13), style="SemiBold", color=C["ink2"])
    b.spacer(pk)
    b.chip(pk, "2", C["ink2"], C["sunken"])
    ov = b.row(left, "Overall", gap=8, pad=[0, 4, 0, 4], sizingH="fill")
    b.txt(ov, "Meeting endet 11:00", size=z.f(12), color=C["muted"])
    b.spacer(ov)
    b.txt(ov, "im Plan (+1 Min.)", size=z.f(12), style="SemiBold", color=C["green"])
    return left


LINES = [
    ("TB", "10:09", "Wenn der Offline-Modus drinbleibt, schaffen wir den 7. nicht. Realistisch ist der 14."),
    ("LS", "10:10", "Die Pilotschulen brauchen offline für die Beta nicht. Zwei von drei haben stabiles WLAN in "
                    "den Klassenräumen."),
    ("MK", "10:11", "Dann nehmen wir offline aus der Beta raus und starten am 14. Einwände?"),
    ("YA", "10:11", "Passt für mich, solange wir der dritten Schule früh Bescheid geben."),
    ("MK", "10:12", "Gut. Yusuf, kannst du ihnen diese Woche schreiben?"),
]
LIVE = ("JR", "Und die Release Notes für die Schulen, gehen die nur auf Deutsch raus oder")


def tline(b, parent, z, who, ts, text, chip=None, hl=False, live=False, chip_focus=False):
    name, colr = PEOPLE[who]
    if dark() and who == "MK":
        colr = DARK["accent"]
    r = b.row(parent, f"Line {who} {ts}", gap=12, pad=[z.f(10), 12, z.f(10), 12], radius=12, sizingH="fill",
              cross="min", fill=C["accentSoft"] if hl else "none", stroke=C["accent"] if hl else None)
    b.avatar(r, who, z.f(30))
    c = b.col(r, "Text", gap=4, sizingH="fill")
    nr = b.row(c, "Meta", gap=8)
    b.txt(nr, name, size=z.f(13), style="SemiBold", color=colr)
    b.txt(nr, "spricht…" if live else ts, size=z.f(12), color=C["muted"])
    if chip:
        k, st = chip
        K = kinds()[k]
        if st == "detected":
            ch = b.chip(nr, f"✦ {K['label']} erkannt", C["accentInk"] if k != "t" else K["fg"],
                        C["accentSoft"] if k != "t" else K["bg"], size=z.f(11), pad=(2, 8, 2, 8),
                        name=f"Chip detected {K['label']}")
            if chip_focus:
                pr = b.cmds[next(i for i, c2 in enumerate(b.cmds) if c2.get("as") == ch)]["params"]["props"]
                pr.update(stroke=C["accent"], strokeWeight=1.5, strokeAlign="inside")
        else:
            b.chip(nr, f"✓ {K['label']} festgehalten", K["fg"], K["bg"], size=z.f(11), pad=(2, 8, 2, 8),
                   name=f"Chip kept {K['label']}")
    b.txt(c, text, size=z.f(15) if not z.narrow else 14, color=C["muted"] if live else C["ink"], fillW=True,
          lh="150%")
    return r


def footer(b, parent, z, size):
    g = W.SIZES[size]
    f = b.row(parent, "Listening", gap=z.f(10), pad=g["pad"], sizingH="fill", sides=[1, 0, 0, 0], stroke=C["line"])
    W.sound_wave(b, f, "speech", size)
    sb = b.row(f, "Button Hört zu · 5 Stimmen", gap=6, pad=list(g["bpad"]), radius=8, fill=C["surface"],
               stroke=C["line"])
    b.txt(sb, "Hört zu", size=g["fs"], style="SemiBold")
    b.txt(sb, "· 5 Stimmen", size=g["fs"], color=C["ink2"])
    b.txt(sb, "›", size=g["fs"] + 2, style="SemiBold", color=C["muted"])
    b.spacer(f)
    if size == "phone":
        m = b.row(f, "Button Moment markieren (icon)", w=32, h=32, radius=8, fill=C["surface"], stroke=C["line"],
                  main="center", cross="center")
        b.txt(m, "⚑", size=14, style="SemiBold")
    else:
        r = b.button(f, "Moment markieren", "ghost", size=z.f(12), pad=(z.f(6), 12, z.f(6), 12), icon="⚑")
        tall(b, r, z.tap)
    return f


def transcript_card(b, parent, z, lines, live=LIVE, size="wide", tabs=("Transkript",), active="Transkript",
                    fillV=True, h=None, body=None, pending_tab=False):
    """The centre card. `body` (callable) replaces the feed, for the narrow "Festgehalten" tab."""
    k = b.card(parent, "Transkript", pad=0, gap=0, sizingV="fill" if fillV else ("fixed" if h else None), h=h,
               effects=SHADOW)
    hd = b.row(k, "Header", gap=12, pad=[z.f(12), z.f(16), z.f(12), z.f(16)] if size != "wide" else [14, 20, 14, 20],
               sizingH="fill", sides=[0, 0, 1, 0], stroke=C["line"])
    sg = b.row(hd, "Segmented", gap=2, pad=3, fill=C["sunken"], radius=10, sizingH="fill" if z.narrow else None)
    for t in tabs:
        on = t == active
        s = b.row(sg, f"Tab {t}", gap=6, pad=[6, 14, 6, 14], radius=8, fill=C["surface"] if on else "none",
                  main="center", sizingH="fill" if z.narrow else None,
                  effects=[{"type": "dropShadow", "color": "#00000014", "offset": [0, 1], "radius": 2}] if on else None)
        b.txt(s, t, size=13, style="SemiBold", color=C["ink"] if on else C["muted"])
        if pending_tab and t.startswith("Festgehalten"):
            b.dot(s, 7, C["accent"], name="Pending suggestion")
    if body:
        body(k)
        return k
    feed = b.col(k, "Feed", gap=z.f(4), pad=[z.f(12), z.f(16), z.f(12), z.f(16)] if size != "phone" else [8, 4, 8, 4],
                 sizingH="fill", sizingV="fill", clip=True, mainAlign="max")
    for ln in lines:
        who, ts, text = ln[:3]
        opts = ln[3] if len(ln) > 3 else {}
        tline(b, feed, z, who, ts, text, **opts)
    if live:
        tline(b, feed, z, live[0], "", live[1], live=True)
    footer(b, k, z, size)
    return k


# --- top bars ------------------------------------------------------------------------------------------------

def topbar(b, s, z, w, title=TITLE, free=False, cloud=False, rec="00:23:41"):
    t = b.row(s, "Top bar", gap=z.f(16), pad=[z.f(14), 24, z.f(14), 24], fill=C["surface"], sizingH="fill",
              sides=[0, 0, 1, 0], stroke=C["line"])
    logo = b.row(t, "Logo", gap=10)
    d = z.f(30)
    mark = b.row(logo, "Mark", w=d, h=d, radius=9, fill=C["accent"], main="center", cross="center")
    b.txt(mark, "◆", size=z.f(14), style="Bold", color=C.get("onAccent", "#FFFFFF"))
    b.txt(logo, "Companion", size=z.f(16), style="Bold")
    b.rect(t, 1, 22, C["line"], name="Divider")
    b.txt(t, title, size=z.f(15), style="SemiBold", color=C["ink2"])
    b.spacer(t)
    if free:
        b.chip(t, "Freier Modus", C["accentInk"], C["accentSoft"], size=z.f(12))
    b.chip(t, "REC  " + rec, C["red"], C["redSoft"], dot=C["red"], size=z.f(12))
    if w >= 1440 or z.board:
        b.chip(t, "Auf dem Gerät · DE/EN", C["ink2"], C["sunken"], style="Regular", size=z.f(12))
    if cloud:
        c = b.row(t, "Chip Vorschläge: Cloud", gap=6, pad=[4, 10, 4, 10], radius=999, stroke=C["amber"])
        b.txt(c, "Vorschläge: Anthropic (Cloud)", size=z.f(12), style="SemiBold", color=C["amber"])
    r = b.button(t, "Pause", "ghost", size=z.f(13), pad=(8, 14, 8, 14), icon="❚❚")
    tall(b, r, z.tap)
    r = b.button(t, "Meeting beenden", "dark", size=z.f(13), pad=(8, 14, 8, 14))
    tall(b, r, z.tap)
    return t


def topbar_narrow(b, s, z, phone=False, title=TITLE):
    t = b.col(s, "Top bar", gap=10, pad=[12, 16, 12, 16], fill=C["surface"], sizingH="fill",
              sides=[0, 0, 1, 0], stroke=C["line"])
    r1 = b.row(t, "Row 1", gap=10, sizingH="fill")
    m = b.row(r1, "Mark", w=28, h=28, radius=8, fill=C["accent"], main="center", cross="center")
    b.txt(m, "◆", size=13, style="Bold", color=C.get("onAccent", "#FFFFFF"))
    if phone:
        b.txt(r1, "Produkt-Sync", size=16, style="Bold")
    else:
        b.txt(r1, "Companion", size=16, style="Bold")
        b.rect(r1, 1, 22, C["line"], name="Divider")
        b.txt(r1, title, size=15, style="SemiBold", color=C["ink2"])
    b.spacer(r1)
    b.chip(r1, "REC  23:41" if phone else "REC  00:23:41", C["red"], C["redSoft"], dot=C["red"])
    r2 = b.row(t, "Row 2", gap=8, sizingH="fill")
    b.button(r2, "Pause", "ghost", size=13, pad=(8, 12, 8, 12), icon="❚❚")
    b.spacer(r2)
    b.button(r2, "Meeting beenden", "dark", size=13, pad=(8, 12, 8, 12))
    return t


# --- data ----------------------------------------------------------------------------------------------------

P01, P02 = "Punkt 01", "Punkt 02"
CAPS = {
    "d": [
        dict(kind="d", text="Pilot-Check-ins finden ab jetzt donnerstags statt", item=P01, time="10:04"),
    ],
    "t": [
        dict(kind="t", text="Einladungen für die Donnerstags-Check-ins neu verschicken", item=P01, time="10:05",
             owner="MK", due="Mo 9. Nov."),
        dict(kind="t", text="Feedbackbogen an die drei Pilotschulen schicken", item=P01, time="10:06", owner="LS"),
    ],
    "q": [],
}


def frame(prefix, name, x, y, w, h, theme=None):
    b = B(prefix)
    s = b.col(None, name, w=w, h=h, fill=C["bg"], x=x, y=y, clip=True, key="screen")
    return b, s


def live(prefix, name, x, y, spec, w=1440, h=900, size="wide", lines=None, cloud=False, colw=None, overlay=None,
         now_counts="1 Beschluss · 1 Aufgabe", free=False):
    """Frame 02 with the captures column. overlay(b, s): absolute extras."""
    z = Z(size)
    b, s = frame(prefix, name, x, y, w, h)
    topbar(b, s, z, w, cloud=cloud, free=free, title=FREE_TITLE if free else TITLE,
           rec="00:24:12" if free else "00:23:41")
    body = b.row(s, "Body", gap=20, pad=[20, 24, 20, 24], sizingH="fill", sizingV="fill", cross="min")
    if free:
        free_left(b, body, z)
    else:
        agenda_column(b, body, z, now_counts, w=380 if z.board else 300)
    transcript_card(b, body, z, lines if lines is not None else [l + ({},) for l in LINES], size=size,
                    live=FREE_LIVE if free else LIVE)
    column(b, body, z, spec, colw or (460 if z.board else (380 if w >= 1440 else 360)))
    if overlay:
        overlay(b, s)
    return b


def run_dark(fn):
    with themed(DARK):
        b = fn()
    for c in b.cmds:
        pr = c["params"].get("props", {})
        if pr.get("stroke") == "#FFFFFF":
            pr["stroke"] = DARK["surface"]
    return b


# --- frame 21: quick capture, a to-do being typed (job 018) -------------------------------------------------

def spec_typing():
    return dict(
        tab="t", counts=(1, 2, 0),
        groups=[("Punkt 01 · Check-in & Ziele", CAPS["t"])],
        composer=dict(state="typing", kind="t", text="Dritter Pilotschule schreiben, dass der Offline-Modus "
                                                     "später kommt", owner="YA", due="Fr 6. Nov.",
                      attach="Punkt 02 · Beta-Start"),
    )


def build(x=0, y=0):
    return live("s21_", "21 Captures · 018 · quick capture · to-do with owner and date", x, y, spec_typing(),
                now_counts=None)


# --- narrow (768, 375): captures are the centre card's second tab -------------------------------------------

def narrow(prefix, name, x, y, spec, w=768, h=None, comp=None, lines=None):
    """< 800 px: one column (styles.css). The centre card gets the tabs "Transkript | Festgehalten n"; the
    composer sticks to the bottom of the window above everything, so it is one tap away from both tabs."""
    phone = w < 600
    z = Z("phone" if phone else "tablet")
    b = B(prefix)
    s = b.col(None, name, w=w, h=h, fill=C["bg"], x=x, y=y, clip=True, key="screen",
              sizingV="fixed" if h else "hug")
    topbar_narrow(b, s, z, phone=phone)
    pad = 12 if phone else 16
    body = b.col(s, "Body", gap=12 if phone else 16, pad=pad, sizingH="fill")
    if not phone:
        agenda_column(b, body, z, None, w=w - 2 * pad, compact=True)
    else:
        k = b.card(body, "Current item timer", pad=14, gap=6, fill=C["dark"], stroke=None, effects=SHADOW)
        eyebrow(b, k, "Jetzt · Punkt 02", z, color=C["darkMuted"])
        r = b.row(k, "Row", gap=10, sizingH="fill", cross="max")
        b.txt(r, "Beta-Start: Umfang und Termin", size=15, style="SemiBold", color=C["darkInk"], fillW=True)
        b.txt(r, "3:12", size=28, style="Bold", color="#FFFFFF", ls=-1, features={"tnum": True})
        b.progress(k, w - 2 * pad - 28, 0.79, "#F5B342", track=C["dark3"], h=6)
    n = sum(spec["counts"])
    pend = bool(spec.get("pending"))

    def pane(card):
        p = b.col(card, "Festgehalten pane", gap=12, pad=[12, 12, 16, 12] if phone else [14, 16, 16, 16],
                  sizingH="fill")
        kind_tabs(b, p, spec["tab"], spec["counts"], z, pending=spec.get("pending", ()))
        sp = dict(spec)
        sp.pop("composer", None)
        sp.pop("notice", None)  # the notice sits on the sticky bar, next to where you typed
        sp.pop("status", None)
        sp["fillV"] = False
        column_body(b, p, z, sp)

    transcript_card(b, body, z, lines or [], size="phone" if phone else "tablet",
                    tabs=("Transkript", f"Festgehalten {n}"), active=f"Festgehalten {n}", fillV=False,
                    body=pane, pending_tab=pend)
    bar = b.col(s, "Composer (sticky, bottom of the window)", gap=8, pad=[10, pad, pad, pad], fill=C["bg"],
                sizingH="fill", sides=[1, 0, 0, 0], stroke=C["line"],
                effects=[{"type": "dropShadow", "color": "#1A181414", "offset": [0, -6], "radius": 16}])
    if spec.get("notice"):
        notice(b, bar, z, **spec["notice"])
    composer(b, bar, z, comp or spec.get("composer") or dict(state="rest", kind=spec["tab"]))
    if spec.get("status"):
        status_line(b, bar, z, spec["status"], spec.get("err", "Offline"))
    return b


# --- shared specs -----------------------------------------------------------------------------------------

NEW_TODO = dict(kind="t", text="Dritter Pilotschule schreiben, dass der Offline-Modus später kommt", item=P02,
                time="10:13", owner="YA", due="Fr 6. Nov.")
SUG_DEC = dict(kind="d", text="Beta startet am 14. Nov. ohne Offline-Modus", time="10:11", who="MK")
SUG_TODO = dict(kind="t", text="Dritter Pilotschule schreiben, dass der Offline-Modus später kommt", time="10:12",
                who="MK", owner="YA", due="Fr 6. Nov.")
SUG_Q = dict(kind="q", text="Gehen die Release Notes nur auf Deutsch raus?", time="10:13", who="JR")


def lines_detected(dec="detected", todo="detected", focus_dec=False):
    """Frame 02's lines with the "detected" chips (job #19)."""
    out = []
    for who, ts, text in LINES:
        o = {}
        if who == "MK" and ts == "10:11" and dec:
            o = dict(chip=("d", dec), hl=focus_dec, chip_focus=focus_dec)
        if who == "MK" and ts == "10:12" and todo:
            o = dict(chip=("t", todo))
        out.append((who, ts, text, o))
    return out


# --- agenda-free (frame 16) ----------------------------------------------------------------------------------

FREE_TITLE = "Kurzer Sync · ohne Agenda"
FREE_TOPICS = [("Offline-Modus für die Beta", 11, None), ("Onboarding der Lehrkräfte", 7, "1 Aufgabe"),
               ("Sprache der Release Notes", 4, "1 Beschluss"), ("Interview-Rekrutierung", 2, None)]
FREE_LINES = [
    ("LS", "10:22", "Nächstes Thema: die Interviews im Januar. Wir brauchen noch sechs Lehrkräfte, am besten von "
                    "Schulen außerhalb des Piloten."),
    ("TB", "10:23", "Ich kann die zwei Schulen aus dem Herbst-Workshop fragen. Die haben Hilfe angeboten."),
    ("MK", "10:23", "Gut. Machen wir die remote, oder muss das vor Ort sein?"),
    ("YA", "10:24", "Remote reicht für die erste Runde. Nur für die Nachbefragung brauchen wir einen Besuch "
                    "im Klassenraum."),
]
FREE_LIVE = ("JR", "Dann schreibe ich heute die Einladung, aber vorher sollten wir uns beim Gutschein einigen")


def free_left(b, parent, z, w=300):
    left = b.col(parent, "Left", gap=12, w=w, sizingV="fill")
    k = b.card(left, "Meeting time", pad=18, gap=8, fill=C["dark"], stroke=None, effects=SHADOW)
    eyebrow(b, k, "Ohne Agenda · 60-Min.-Termin", z, color=C["darkMuted"])
    r = b.row(k, "Time", gap=8, cross="max")
    b.txt(r, "36", size=44, style="Bold", color="#FFFFFF", ls=-1.5, features={"tnum": True})
    b.txt(r, "Min. übrig · endet 11:00", size=13, color=C["darkMuted"])
    b.progress(k, w - 36, 0.40, "#8F89FF", track=C["dark3"], h=8)
    t = b.card(left, "Bisherige Themen", pad=[12, 10, 10, 10], gap=4, sizingV="fill")
    h = b.row(t, "Head", gap=6, pad=[2, 4, 6, 4], sizingH="fill")
    b.txt(h, "Bisherige Themen", size=14, style="SemiBold")
    b.spacer(h)
    b.txt(h, "4 Themen", size=12, color=C["muted"])
    for i, (title, mins, counts) in enumerate(FREE_TOPICS):
        cur = i == len(FREE_TOPICS) - 1
        r = b.row(t, f"Topic {title}", gap=10, pad=[9, 10, 9, 10], radius=10, sizingH="fill",
                  fill=C["accentSoft"] if cur else "none")
        if cur:
            m = b.row(r, "State", w=22, h=22, radius=11, fill=C["accent"], main="center", cross="center")
            b.dot(m, 8, C.get("onAccent", "#FFFFFF"))
        else:
            b.row(r, "State", w=22, h=22, radius=11, stroke=C["line"])
        c = b.col(r, "Text", gap=1, sizingH="fill")
        b.txt(c, title, size=13, style="SemiBold", fillW=True)
        sub = ("● läuft gerade" + (" · " + counts if counts else "")) if cur else counts
        if sub:
            b.txt(c, sub, size=12, style="SemiBold" if cur else "Regular",
                  color=C["accentInk"] if cur else C["muted"], fillW=True)
        b.txt(r, f"{mins} Min.", size=12, color=C["accentInk"] if cur else C["muted"], features={"tnum": True})
    b.spacer(t, "v")
    a = b.row(t, "Thema hinzufügen", gap=8, pad=[10, 8, 6, 8], sizingH="fill", sides=[1, 0, 0, 0], stroke=C["line"])
    b.txt(a, "+", size=16, style="SemiBold", color=C["accent"])
    b.txt(a, "Thema hinzufügen", size=13, style="SemiBold", color=C["accent"])
    return left
