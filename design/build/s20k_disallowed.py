"""20 Voice profiles · Settings › Voice profiles: switched off, existing profiles stay listed and deletable."""
from s20_voices import settings


def build(x=0, y=0):
    return settings("s20k_", "20 Voice profiles · Settings · off, profiles kept", x, y, w=1280, h=900, on=False,
                    state="list")
