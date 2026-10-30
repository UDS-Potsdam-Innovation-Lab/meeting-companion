"""Frame 01 in the dark tokens (reference for the UI review)."""
from kit import DARK, themed
import s1_setup


def build(x=0, y=0):
    with themed(DARK):
        b = s1_setup.build(x, y)
    b.prefix = "s14o_"
    for c in b.cmds:
        p = c["params"]
        c["as"] = c["as"].replace("s1_", "s14o_")
        if p.get("parent"):
            p["parent"]["$ref"] = p["parent"]["$ref"].replace("s1_", "s14o_")
        pr = p.get("props", {})
        if pr.get("stroke") == "#FFFFFF":
            pr["stroke"] = DARK["surface"]
    b.named = {k: v.replace("s1_", "s14o_") for k, v in b.named.items()}
    b.cmds[0]["params"]["name"] = "01 Agenda setup · dark"
    return b
