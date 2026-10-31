"""17 Language model · Claude just confirmed, no key yet, the key is being typed."""
import setx as X
from s17_llm import content


def build(x=0, y=0):
    return X.screen("s17e_", "17 Language model · Claude API · entering the key", x, y,
                    content("claude", key="typing", test="nokey"), h=960)
