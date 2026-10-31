"""20 Voice profiles · Settings › Voice profiles at 1280: allowed, three profiles, one asks before deleting."""
from s20_voices import settings


def build(x=0, y=0):
    return settings("s20i_", "20 Voice profiles · Settings · list + delete confirm", x, y, w=1280, h=900, on=True,
                    state="list", confirm="LS")
