from s14_settings import screen


def build(x=0, y=0):
    return screen("s14g_", "14 Settings · board 1920 · device list open", x, y, w=1920, h=1080, section="Audio",
                  state="open", size="board", origin="setup")
