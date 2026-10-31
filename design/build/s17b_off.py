"""17 Language model · Off (the default): no engine card, Test disabled."""
import setx as X
from s17_llm import content


def build(x=0, y=0):
    return X.screen("s17b_", "17 Language model · Off (default)", x, y, content("off", test="idle"), h=900)
