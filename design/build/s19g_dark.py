"""19 Help & legal · dark · Legal notes during a meeting."""
from kit import DARK
from s19_help import screen, legal_top


def build(x=0, y=0):
    return screen("s19g_", "19 Help & legal · dark · Legal notes during a meeting", x, y, "Legal notes",
                  "Privacy notice", legal_top, w=1280, h=880, origin="live", back="meeting", theme=DARK)
