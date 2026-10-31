"""17 Language model · dark: Claude, key saved, test reply."""
from kit import DARK
import setx as X
from s17_llm import content


def build(x=0, y=0):
    return X.screen("s17j_", "17 Language model · dark · Claude, test reply", x, y,
                    content("claude", key="saved", test="reply"), h=1000, theme=DARK)
