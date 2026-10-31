"""16 Agenda-free · 1024×768: two columns as frame 02; "Add topic" open with a typed title."""
from s16_free import live


def build(x=0, y=0):
    return live("s16g_", "16 Agenda-free · 1024×768 · adding a topic", x, y, w=1024, h=768, state="now",
                add="field", last=5)
