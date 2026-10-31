"""17 Language model · On this device, three GGUF models found, test running (live meeting open)."""
import setx as X
from s17_llm import content


def build(x=0, y=0):
    return X.screen("s17d_", "17 Language model · On this device · test running", x, y,
                    content("local", local="found", test="running"), h=960, origin="live")
