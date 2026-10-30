"""Frame 02 in the dark tokens (reference for the UI review)."""
from kit import DARK, themed
import s2_live


def build(x=0, y=0):
    with themed(DARK):
        b = s2_live.build(x, y)
    b.prefix = "s14p_"
    for c in b.cmds:
        p = c["params"]
        c["as"] = c["as"].replace("s2_", "s14p_")
        if p.get("parent"):
            p["parent"]["$ref"] = p["parent"]["$ref"].replace("s2_", "s14p_")
        pr = p.get("props", {})
        if pr.get("stroke") == "#FFFFFF":
            pr["stroke"] = DARK["surface"]
        if pr.get("fill") == "#F3F2FE":
            pr["fill"] = DARK["accentSoft"]
    b.named = {k: v.replace("s2_", "s14p_") for k, v in b.named.items()}
    b.cmds[0]["params"]["name"] = "02 Live meeting · dark"
    return b
