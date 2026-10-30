from s14_settings import screen


def build(x=0, y=0):
    return screen("s14i_", "14 Settings · 375 · while recording", x, y, w=375, h=1300, section="Audio",
                  state="recording", size="phone", origin="live")
