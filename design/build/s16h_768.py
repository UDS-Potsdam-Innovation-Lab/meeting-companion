"""16 Agenda-free · 768×1024: one column (below 800 px), recording controls on the bar's second row."""
from s16_free import live


def build(x=0, y=0):
    return live("s16h_", "16 Agenda-free · 768×1024", x, y, w=768, h=1024, state="now")
