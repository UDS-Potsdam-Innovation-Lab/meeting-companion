from s14_settings import screen


def build(x=0, y=0):
    return screen("s14h_", "14 Settings · 768", x, y, w=768, h=1024, section="Audio", state="idle", size="tablet",
                  origin="setup")
