"""18 Phone view · This page is closed · EN. No button: the phone cannot reopen it."""
from phone import page


def build(x=0, y=0):
    return page("s18c_", "18 Phone view · This page is closed · EN", x, y, "closed", "en")
