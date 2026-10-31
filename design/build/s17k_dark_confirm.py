"""17 Language model · dark: inline confirmation."""
from kit import DARK
import setx as X
from s17_llm import content


def build(x=0, y=0):
    return X.screen("s17k_", "17 Language model · dark · confirm destination", x, y,
                    content("off", pending=True, test="idle"), h=900, theme=DARK)
