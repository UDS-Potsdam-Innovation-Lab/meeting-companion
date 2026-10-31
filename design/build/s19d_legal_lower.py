"""19 Help & legal · Legal notes · organisation (filled) + licences (one expanded)."""
from s19_help import screen, legal_lower


def build(x=0, y=0):
    return screen("s19d_", "19 Help & legal · Legal notes · organisation + licences", x, y, "Legal notes",
                  "Open-source licences", legal_lower, w=1280, h=1340, origin="setup", back="settings")
