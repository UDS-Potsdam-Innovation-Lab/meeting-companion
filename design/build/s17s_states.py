"""17 Language model · states: API key field, local model list, Test results, the cloud marker decision,
and the key/test states in dark."""
from kit import B, C, DARK, SHADOW, themed
import setx as X
from s14_settings import Z
import s14_settings as S
import s17_llm as L

KEY = [("none", "No key", "Placeholder only; “Save key” is disabled until something is typed."),
       ("typing", "Entering", "type=password, autocomplete=off. The field is cleared after saving."),
       ("saved", "Key saved", "Never the key, not even its last characters. Replace or remove."),
       ("remove", "Remove · confirm", "Inline, no dialog. Removing deletes the keychain entry."),
       ("invalid", "Invalid", "Trimmed, 1–512 printable ASCII. The message names no value."),
       ("keychain", "Keychain unavailable", "Locked or missing Secret Service. The app keeps running.")]
TESTS = [("running", "Running", "Cancel returns “Cancelled” within 1 s."),
         ("reply", "Reply", "Rendered as plain text, never as markup."),
         ("offline", "Offline", "Connect 10 s / total 60 s timeouts, no retry loop."),
         ("unauth", "Unauthorized · 401", "No response body text is shown."),
         ("rate", "Rate limited · 429", "No automatic retry."),
         ("failed", "Failed · 5xx or timeout", ""),
         ("nomodel", "No model (local)", "The chosen GGUF file disappeared."),
         ("cancelled", "Cancelled", "Neutral, not an error.")]
W = 460


def key_cell(b, parent, z, st, title, sub):
    c = X.cell(b, parent, title, sub, w=W)
    k = b.card(c, "API key", gap=10, pad=18, effects=SHADOW)
    L.key_block(b, k, z, st)
    return c


def test_cell(b, parent, z, st, title, sub):
    c = X.cell(b, parent, title, sub, w=W)
    k = b.card(c, "Test result", gap=10, pad=18, effects=SHADOW)
    L.test_result(b, k, z, st, engine="local" if st in ("nomodel", "running") else "claude")
    return c


def build(x=0, y=0):
    z = Z("wide")
    b, s = X.board("s17s_", "17 Language model · states", x, y, "Language model · states",
                   "Every state of the API key, the local model list and the Test result, plus the cloud marker "
                   "decision. Status is always a glyph and a word, never colour alone.")

    sec = X.section(b, s, "API key", "Settings › Language model › Claude API. The UI only ever learns "
                                     "“key set: yes / no”.")
    r = b.row(sec, "Key states", gap=24, cross="min")
    for st, t, sub in KEY:
        key_cell(b, r, z, st, t, sub)

    sec = X.section(b, s, "Model on this device", "Found · none found (folders searched) · not found any more "
                                                  "(no fallback to another engine).")
    r = b.row(sec, "Local states", gap=24, cross="min")
    for st, t in (("found", "Found"), ("none", "None found"), ("gone", "Not found any more")):
        c = X.cell(b, r, t, None, w=900 if st != "none" else 760)
        L.local_card(b, c, z, st)

    sec = X.section(b, s, "Test result", "Under the Test button. The reason is in words; red marks the error, "
                                         "it does not carry it.")
    r = b.row(sec, "Test states", gap=24, cross="min", wrap=True, crossGap=24, w=W * 4 + 24 * 3)
    for st, t, sub in TESTS:
        test_cell(b, r, z, st, t, sub)

    sec = X.section(b, s, "Cloud marker in the top bar",
                    "Recommendation: draw it now, ship it with the first feature that sends meeting text. In this job "
                    "only the fixed test text can leave the device, so a permanent marker would claim more than "
                    "happens.")
    r = b.row(sec, "Marker", gap=24, cross="min")
    for label, cloud in (("Today · Off or On this device", False), ("Later · Claude chosen and a feature sends text", True)):
        c = X.cell(b, r, label, None, w=900)
        f = b.col(c, "Bar", radius=12, stroke=C["line"], clip=True, sizingH="fill", effects=SHADOW)
        t = b.topbar(f, "Product sync")
        b.chip(t, "REC  00:23:41", C["red"], C["redSoft"], dot=C["red"])
        b.chip(t, "On-device · DE/EN", C["ink2"], C["sunken"], style="Regular")
        if cloud:
            b.chip(t, "☁  Claude · Anthropic", C["accentInk"], C["accentSoft"], name="Cloud marker")
        S.settings_button(b, t, z, "rest")
    note = b.col(sec, "Why", gap=6, w=1824)
    for ln in ("• Same chip family as “On-device · DE/EN”: a fact about where things run, not a warning.",
               "• Click opens Settings › Language model. It names the provider, not only “Cloud”, so the destination is clear.",
               "• Not shown in this job: no meeting feature calls the engine yet (AC6)."):
        b.txt(note, ln, size=13, color=C["ink2"], fillW=True)

    with themed(DARK):
        dk = b.col(s, "Dark", gap=16, pad=32, radius=20, fill=C["bg"])
        b.txt(dk, "Dark", size=18, style="Bold")
        r = b.row(dk, "Dark states", gap=24, cross="min")
        for st, t, sub in (KEY[2], KEY[4], KEY[5]):
            key_cell(b, r, z, st, t, sub)
        r = b.row(dk, "Dark tests", gap=24, cross="min")
        for st, t, sub in (TESTS[0], TESTS[1], TESTS[3]):
            test_cell(b, r, z, st, t, sub)
    return b
