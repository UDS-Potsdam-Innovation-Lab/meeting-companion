"""19 Help & legal · dark · Help (from setup)."""
from kit import DARK
from s19_help import screen, help_all


def build(x=0, y=0):
    return screen("s19h_", "19 Help & legal · dark · Help", x, y, "Help", "How a meeting works", help_all,
                  w=1280, h=800, origin="setup", back="setup", theme=DARK)
