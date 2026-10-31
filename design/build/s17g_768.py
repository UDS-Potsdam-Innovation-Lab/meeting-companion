"""17 Language model · 768: On this device, chosen model not found any more."""
import setx as X
from s17_llm import content


def build(x=0, y=0):
    return X.screen("s17g_", "17 Language model · 768 · model not found any more", x, y,
                    content("local", local="gone", test="nomodel"), w=768, h=1360, size="tablet")
