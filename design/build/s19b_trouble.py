"""19 Help & legal · Help scrolled to shortcuts and troubleshooting (opened from setup)."""
from s19_help import screen, help_lower


def build(x=0, y=0):
    return screen("s19b_", "19 Help & legal · Help · shortcuts + troubleshooting", x, y, "Help", "Troubleshooting",
                  help_lower, w=1280, h=1080, origin="setup", back="setup")
