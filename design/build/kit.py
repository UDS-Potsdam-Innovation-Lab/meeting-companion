"""Tiny layout DSL on top of FigCraft's node.create, collected into one batch per screen."""

C = {
    "bg": "#F5F4F0",
    "surface": "#FFFFFF",
    "sunken": "#EFEDE7",
    "ink": "#17181C",
    "ink2": "#4A4D55",
    "muted": "#8A8D96",
    "line": "#E4E1D9",
    "accent": "#4338CA",
    "accentSoft": "#ECEBFD",
    "accentInk": "#2E268F",
    "green": "#13804A",
    "greenSoft": "#E3F4EA",
    "amber": "#B86E00",
    "amberSoft": "#FDF0D9",
    "red": "#C93A3F",
    "redSoft": "#FCE6E6",
    "teal": "#0F7C80",
    "tealSoft": "#DDF2F2",
    "dark": "#15161A",
    "dark2": "#22242A",
    "dark3": "#2E3038",
    "darkInk": "#F2F1EC",
    "darkMuted": "#9A9CA5",
}

PEOPLE = {
    "MK": ("Mara Klein", "#4338CA"),
    "TB": ("Tobias Brandt", "#0F7C80"),
    "LS": ("Lena Sommer", "#B86E00"),
    "YA": ("Yusuf Aydin", "#C93A3F"),
    "JR": ("Jana Roth", "#13804A"),
}

SHADOW = [{"type": "dropShadow", "color": "#1A18140F", "offset": [0, 2], "radius": 8},
          {"type": "dropShadow", "color": "#1A18140A", "offset": [0, 12], "radius": 32}]


class B:
    def __init__(self, prefix):
        self.cmds = []
        self.k = 0
        self.prefix = prefix
        self.named = {}

    def _ref(self):
        self.k += 1
        return f"{self.prefix}{self.k}"

    def node(self, type, parent=None, name=None, text=None, path=None, x=None, y=None, w=None, h=None, key=None, **props):
        ref = self._ref()
        p = {"type": type, "select": False}
        if parent is not None:
            p["parent"] = {"$ref": parent}
        if name:
            p["name"] = name
        if text is not None:
            p["text"] = text
        if path is not None:
            p["path"] = path
        for k, v in (("x", x), ("y", y), ("width", w), ("height", h)):
            if v is not None:
                p[k] = v
        if props:
            p["props"] = props
        self.cmds.append({"command": "node.create", "as": ref, "params": p})
        if key:
            self.named[key] = ref
        return ref

    def cmd(self, command, **params):
        self.cmds.append({"command": command, "params": params})

    # --- layout helpers -------------------------------------------------
    def box(self, parent, name="Box", dir="vertical", gap=0, pad=0, fill=None, radius=0, w=None, h=None,
            sizingH=None, sizingV=None, main="min", cross="min", stroke=None, effects=None, x=None, y=None, key=None, sides=None, **extra):
        props = {"layout": dir, "gap": gap, "padding": pad, "mainAlign": main, "crossAlign": cross,
                 "fill": fill or "none", "cornerRadius": radius}
        if stroke:
            props["stroke"] = stroke
            props["strokeWeight"] = 1
            props["strokeAlign"] = "inside"
            if sides:
                props["strokeSides"] = sides
        if effects:
            props["effects"] = effects
        props["sizingH"] = sizingH or ("fixed" if w else "hug")
        props["sizingV"] = sizingV or ("fixed" if h else "hug")
        props.update(extra)
        return self.node("frame", parent, name=name, x=x, y=y, w=w, h=h, key=key, **props)

    def row(self, parent, name="Row", **kw):
        kw.setdefault("cross", "center")
        return self.box(parent, name, dir="horizontal", **kw)

    def col(self, parent, name="Col", **kw):
        return self.box(parent, name, dir="vertical", **kw)

    def txt(self, parent, s, size=14, style="Regular", color=None, fillW=False, w=None, lh=None, name=None,
            align=None, ls=None, key=None, **extra):
        props = {"fontFamily": "Inter", "fontStyle": style, "fontSize": size, "fill": color or C["ink"]}
        if lh:
            props["lineHeight"] = lh
        if ls is not None:
            props["letterSpacing"] = ls
        if align:
            props["textAlign"] = align
        if fillW:
            props["sizingH"] = "fill"
            props["textAutoResize"] = "height"
        elif w:
            props["textAutoResize"] = "height"
        props.update(extra)
        return self.node("text", parent, name=name or s[:28], text=s, w=w, key=key, **props)

    def spacer(self, parent, dir="h"):
        return self.node("frame", parent, name="Spacer", w=1, h=1,
                         fill="none", sizingH="fill" if dir == "h" else "fixed",
                         sizingV="fill" if dir == "v" else "fixed")

    def rect(self, parent, w, h, fill, radius=0, name="Rect", **extra):
        return self.node("rectangle", parent, name=name, w=w, h=h, fill=fill, cornerRadius=radius, **extra)

    def dot(self, parent, d, fill, name="Dot"):
        return self.node("ellipse", parent, name=name, w=d, h=d, fill=fill)

    # --- components (built inline) ---------------------------------------
    def avatar(self, parent, initials, d=28, ring=None):
        _, color = PEOPLE.get(initials, ("", C["muted"]))
        a = self.row(parent, f"Avatar {initials}", w=d, h=d, radius=d / 2, fill=color, main="center", cross="center",
                     stroke=ring)
        self.txt(a, initials, size=round(d * 0.38), style="SemiBold", color="#FFFFFF")
        return a

    def chip(self, parent, label, fg, bg, size=12, pad=(4, 10, 4, 10), dot=None, style="SemiBold", name=None):
        c = self.row(parent, name or f"Chip {label}", gap=6, pad=list(pad), fill=bg, radius=999)
        if dot:
            self.dot(c, 7, dot)
        self.txt(c, label, size=size, style=style, color=fg)
        return c

    def button(self, parent, label, kind="primary", size=14, pad=(10, 18, 10, 18), icon=None, name=None, key=None, fillW=False):
        styles = {
            "primary": (C["accent"], "#FFFFFF", None),
            "dark": (C["ink"], "#FFFFFF", None),
            "ghost": (C["surface"], C["ink"], C["line"]),
            "soft": (C["accentSoft"], C["accentInk"], None),
            "green": (C["green"], "#FFFFFF", None),
            "danger": (C["redSoft"], C["red"], None),
            "darkghost": (C["dark3"], C["darkInk"], None),
        }
        bg, fg, stroke = styles[kind]
        b = self.row(parent, name or f"Button {label}", gap=8, pad=list(pad), fill=bg, radius=10, main="center",
                     stroke=stroke, key=key, sizingH="fill" if fillW else None)
        if icon:
            self.txt(b, icon, size=size, style="SemiBold", color=fg)
        self.txt(b, label, size=size, style="SemiBold", color=fg)
        return b

    def progress(self, parent, w, frac, color, track=None, h=6, name="Progress"):
        p = self.node("frame", parent, name=name, w=w, h=h, fill=track or C["sunken"], cornerRadius=h / 2, clip=True)
        self.rect(p, max(h, round(w * frac)), h, color, radius=h / 2, name="Value")
        return p

    def card(self, parent, name, pad=20, gap=12, fillW=True, **kw):
        kw.setdefault("fill", C["surface"])
        kw.setdefault("radius", 16)
        kw.setdefault("stroke", C["line"])
        return self.col(parent, name, pad=pad, gap=gap, sizingH="fill" if fillW else None, **kw)

    def topbar(self, parent, title, right=None):
        t = self.row(parent, "Top bar", gap=16, pad=[14, 24, 14, 24], fill=C["surface"], sizingH="fill",
                     sides=[0, 0, 1, 0], stroke=C["line"])
        logo = self.row(t, "Logo", gap=10)
        mark = self.row(logo, "Mark", w=30, h=30, radius=9, fill=C["accent"], main="center", cross="center")
        self.txt(mark, "◆", size=14, style="Bold", color="#FFFFFF")
        self.txt(logo, "Companion", size=16, style="Bold")
        self.rect(t, 1, 22, C["line"], name="Divider")
        self.txt(t, title, size=15, style="SemiBold", color=C["ink2"])
        self.spacer(t)
        return t
