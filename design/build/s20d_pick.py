"""20 Voice profiles · phone · pick your name (confirmed voices only, first name + initials)."""
from s20_voices import phone_page, pick


def build(x=0, y=0):
    return phone_page("s20d_", "20 Voice profiles · phone · pick your name", x, y, pick)
