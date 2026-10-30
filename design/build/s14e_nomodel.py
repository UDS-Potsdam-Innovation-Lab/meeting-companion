from s14_settings import screen


def build(x=0, y=0):
    return screen("s14e_", "14 Settings · On this device · none found", x, y, h=1120, section="On this device",
                  state="none", origin="setup")
