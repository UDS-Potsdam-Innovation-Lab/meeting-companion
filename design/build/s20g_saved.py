"""20 Voice profiles · phone · saved, deletion code shown once."""
from s20_voices import phone_page, saved


def build(x=0, y=0):
    return phone_page("s20g_", "20 Voice profiles · phone · saved + deletion code", x, y, saved)
