"""19 Help & legal · 768 · Legal notes."""
from s19_help import screen, legal_top


def build(x=0, y=0):
    return screen("s19l_", "19 Help & legal · 768 · Legal notes", x, y, "Legal notes", "Privacy notice", legal_top,
                  w=768, h=1024, size="tablet", origin="setup", back="setup")
