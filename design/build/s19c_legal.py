"""19 Help & legal · Legal notes · privacy notice + consent texts (opened from Settings)."""
from s19_help import screen, legal_top


def build(x=0, y=0):
    return screen("s19c_", "19 Help & legal · Legal notes · privacy notice", x, y, "Legal notes", "Privacy notice",
                  legal_top, w=1280, h=880, origin="setup", back="settings")
