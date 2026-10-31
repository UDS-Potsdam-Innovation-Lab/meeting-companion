"""19 Help & legal · board 1920×1080 (48 px targets): Help, troubleshooting, during a meeting."""
from s19_help import screen, help_lower


def build(x=0, y=0):
    return screen("s19k_", "19 Help & legal · board 1920 · troubleshooting", x, y, "Help", "Troubleshooting",
                  help_lower, w=1920, h=1080, size="board", origin="live", back="meeting")
