from kit import DARK
from s14_settings import screen


def build(x=0, y=0):
    return screen("s14k_", "14 Settings · dark · General", x, y, section="General", origin="live", theme=DARK,
                  gtheme="dark")
