from s14_settings import screen


def build(x=0, y=0):
    return screen("s14c_", "14 Settings · Audio · chosen device missing", x, y, section="Audio", state="missing",
                  origin="setup")
