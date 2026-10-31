"""20 Voice profiles · Settings › Voice profiles · 375."""
from s20_voices import settings


def build(x=0, y=0):
    return settings("s20m_", "20 Voice profiles · Settings · 375", x, y, w=375, h=1080, size="phone", on=True,
                    state="list")
