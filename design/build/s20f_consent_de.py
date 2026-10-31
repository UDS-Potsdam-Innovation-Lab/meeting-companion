"""20 Voice profiles · phone · consent text DE (whole page)."""
from phone import page
from s20_voices import consent


def build(x=0, y=0):
    return page("s20f_", "20 Voice profiles · phone · consent · DE", x, y, "connected", "de", slot=consent("de"), h=1180)
