"""20 Voice profiles · 06 Speakers · setting allowed, card off (every meeting starts like this)."""
from s20_voices import speakers


def build(x=0, y=0):
    return speakers("s20c_", "20 Voice profiles · 06 Speakers · card off", x, y, "off", None)
