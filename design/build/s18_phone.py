"""18 Phone view (job 012): the phone page at 375×667, "Connected" with no consumer view active (EN).
Siblings s18b… (DE, closed, dark, anatomy). Shared shell: phone.py."""
from phone import page


def build(x=0, y=0):
    return page("s18_", "18 Phone view · Connected · waiting · EN", x, y, "connected", "en")
