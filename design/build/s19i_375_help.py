"""19 Help & legal · 375 · Help, whole page (scrolls), opened during a meeting."""
from s19_help import screen, help_all


def build(x=0, y=0):
    return screen("s19i_", "19 Help & legal · 375 · Help", x, y, "Help", "How a meeting works", help_all,
                  w=375, h=2300, size="phone", origin="live", back="meeting")
