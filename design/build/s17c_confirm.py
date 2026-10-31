"""17 Language model · Claude chosen, inline confirmation open; the setting is still Off."""
import setx as X
from s17_llm import content


def build(x=0, y=0):
    return X.screen("s17c_", "17 Language model · Claude API · confirm destination", x, y,
                    content("off", pending=True, test="idle"), h=900)
