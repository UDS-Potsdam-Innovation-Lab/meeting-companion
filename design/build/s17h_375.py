"""17 Language model · 375: Claude chosen, inline confirmation (whole page, it scrolls)."""
import setx as X
from s17_llm import content


def build(x=0, y=0):
    return X.screen("s17h_", "17 Language model · 375 · confirm destination", x, y,
                    content("off", pending=True, test="idle"), w=375, h=1440, size="phone", origin="live")
