"""17 Language model · board 1920×1080 (48 px targets): Claude, key saved, model list open."""
import setx as X
from s17_llm import content


def build(x=0, y=0):
    return X.screen("s17f_", "17 Language model · board 1920 · model list open", x, y,
                    content("claude", key="saved", test="idle", model_open=True), w=1920, h=1080, size="board")
