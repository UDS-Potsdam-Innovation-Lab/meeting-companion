"""20 Voice profiles · phone · consent text EN (whole page, it scrolls past 667)."""
from s20_voices import phone_page, consent


def build(x=0, y=0):
    return phone_page("s20e_", "20 Voice profiles · phone · consent · EN", x, y, consent("en"), h=1100)
