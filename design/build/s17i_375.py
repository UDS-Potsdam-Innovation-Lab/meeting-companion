"""17 Language model · 375: Claude, key saved, test reply."""
import setx as X
from s17_llm import content


def build(x=0, y=0):
    return X.screen("s17i_", "17 Language model · 375 · Claude, test reply", x, y,
                    content("claude", key="saved", test="reply"), w=375, h=1680, size="phone")
