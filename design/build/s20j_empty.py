"""20 Voice profiles · Settings › Voice profiles: allowed, nothing saved yet."""
from s20_voices import settings


def build(x=0, y=0):
    return settings("s20j_", "20 Voice profiles · Settings · empty", x, y, w=1280, h=800, on=True, state="empty")
