from kit import DARK
from s14_settings import screen


def build(x=0, y=0):
    return screen("s14j_", "14 Settings · dark · Audio while recording", x, y, section="Audio", state="recording",
                  origin="live", theme=DARK)
