"""19 Help & legal · 375 · Legal notes, whole page (long text reflows, no horizontal scroll)."""
from s19_help import screen, legal_top, legal_lower


def build(x=0, y=0):
    def all_(b, col, z):
        legal_top(b, col, z)
        legal_lower(b, col, z)
    return screen("s19j_", "19 Help & legal · 375 · Legal notes", x, y, "Legal notes", "Privacy notice", all_,
                  w=375, h=3040, size="phone", origin="setup", back="setup")
