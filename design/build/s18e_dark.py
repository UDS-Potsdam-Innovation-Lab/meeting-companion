"""18 Phone view · Connected · dark (the phone is set to dark)."""
from kit import DARK
from phone import page


def build(x=0, y=0):
    return page("s18e_", "18 Phone view · Connected · dark", x, y, "connected", "en", theme=DARK)
