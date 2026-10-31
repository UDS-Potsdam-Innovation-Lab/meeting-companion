"""20 Voice profiles · phone · delete my voice with the code."""
from s20_voices import phone_page, delete


def build(x=0, y=0):
    return phone_page("s20h_", "20 Voice profiles · phone · delete my voice", x, y, delete("entry"))
