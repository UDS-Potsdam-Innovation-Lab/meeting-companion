"""18 Phone view · closed · dark."""
from kit import DARK
from phone import page


def build(x=0, y=0):
    return page("s18f_", "18 Phone view · This page is closed · dark", x, y, "closed", "en", theme=DARK)
