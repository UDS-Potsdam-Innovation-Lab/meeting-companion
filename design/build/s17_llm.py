"""17 Language model (job 011): the new Settings section that chooses the language model engine.

Decisions drawn here:
- Its own section between "On this device" and "General" (it holds a cloud option and a secret, which do
  not belong under "On this device"). Icon ✦, the app's mark for assistant suggestions.
- The three-way choice is a radio group like "Default meeting language" (each option needs a one-line
  consequence; a segmented control has no room for it).
- Choosing "Claude API (cloud)" shows an inline confirmation under the group. "Off" stays checked until
  "Use Claude API" is pressed; "Cancel" closes it and nothing changes.
- While Claude is chosen, the destination line is the first thing in the Claude card and never scrolls away
  from the key.
- The key is never shown: "Key saved" + "Replace key" / "Remove key". The field is a password field and is
  cleared after saving.
- The local engine never falls back: a vanished model shows "Not found any more" and no feature uses a
  model until a person chooses again (unlike the speaker model, which has an automatic fallback).

Siblings: s17b… (states, sizes, dark, board). Shared parts: setx.py.
"""
from kit import B, C, DARK, SHADOW
import setx as X
from setx import card_head, setting_row, info, select, radio_option, folders, disabled_button, btn, status, field

APP_DATA = "~/.local/share/de.udspotsdam.meetingcompanion"
SAMPLE = ("Summarise in one sentence: The team agreed to launch the beta on 14 November without offline mode "
          "and to tell the third pilot school this week.")
REPLY = ("The team will launch the beta on 14 November without offline mode and inform the third pilot school "
         "this week.")
CLAUDE_MODELS = [("Claude Sonnet 5.5", "Default · good results at moderate cost"),
                 ("Claude Haiku 5.5", "Fastest, lowest cost"),
                 ("Claude Opus 5.5", "Most capable, slower and dearer")]
LOCAL = [("Qwen2.5-3B-Instruct-Q4_K_M.gguf", "2.0 GB", "~/.cache/huggingface/hub", "Hugging Face"),
         ("Llama-3.2-3B-Instruct-Q4_K_M.gguf", "2.0 GB", f"{APP_DATA}/models", "Meeting Companion"),
         ("gemma-3-4b-it-Q4_K_M.gguf", "2.5 GB", "~/.cache/huggingface/hub", "Hugging Face")]
DEST = "Anthropic · api.anthropic.com · USA"


def engine_card(b, body, z, engine, pending=False):
    c = X.card(b, body, "Language model", z, gap=12)
    card_head(b, c, "Language model", "Later features use it to suggest captures, find topics and write "
                                      "summaries. None of them uses it yet.", z)
    grp = b.box(c, "Radio group", dir="vertical" if z.narrow else "horizontal", gap=12, sizingH="fill", cross="min")
    radio_option(b, grp, "Off", "No language model. Nothing is sent.", engine == "off", z)
    radio_option(b, grp, "On this device", "A GGUF model here. Nothing leaves the device.", engine == "local", z)
    if pending:
        o = b.row(grp, "Option Claude API (cloud) · waiting for confirmation", gap=12,
                  pad=[z.f(12), z.f(14), z.f(12), z.f(14)], radius=12, fill=C["surface"], stroke=C["accent"],
                  cross="min", sizingH="fill")
        b.cmds[-1]["params"]["props"]["strokeWeight"] = 2
        X.radio_dot(b, o, False, z)
        oc = b.col(o, "Label", gap=4, sizingH="fill")
        b.txt(oc, "Claude API (cloud)", size=z.f(14), style="SemiBold", fillW=True)
        b.txt(oc, "Anthropic’s Claude, over the internet.", size=z.f(12), color=C["muted"],
              fillW=True, lh="140%")
        status(b, oc, "…", "Confirm below to switch", C["accentInk"], C["accentSoft"], z)
    else:
        radio_option(b, grp, "Claude API (cloud)", "Anthropic’s Claude, over the internet.",
                     engine == "claude", z)
    if pending:
        confirm(b, c, z)
    return c


def confirm(b, parent, z):
    """Inline, non-modal: the setting changes only on "Use Claude API"."""
    p = b.col(parent, "Cloud confirmation (inline)", gap=z.f(14), pad=[z.f(18), z.f(20), z.f(18), z.f(20)], radius=12,
              fill=C["accentSoft"], stroke=C["accent"], sizingH="fill")
    hd = b.row(p, "Head", gap=12, cross="min", sizingH="fill")
    ic = b.row(hd, "Icon", w=z.f(32), h=z.f(32), radius=z.f(16), fill=C["surface"], main="center", cross="center")
    b.txt(ic, "☁", size=z.f(16), color=C["accentInk"])
    hc = b.col(hd, "Text", gap=3, sizingH="fill")
    b.txt(hc, "Send text to Anthropic?", size=z.f(16), style="SemiBold", color=C["accentInk"], fillW=True)
    b.txt(hc, "Nothing is sent until you confirm. You can switch back at any time.", size=z.f(13),
          color=C["ink2"], fillW=True, lh="145%")
    dl = b.col(p, "Details", gap=0, radius=10, fill=C["surface"], sizingH="fill", pad=[z.f(4), z.f(14), z.f(4), z.f(14)])
    for i, (k, v) in enumerate((("Destination", DEST),
                                ("What is sent", "Text from your meetings, when a feature asks for it. "
                                                 "Here only the fixed test text."),
                                ("Needs", "Your own API key, kept in the system keychain"))):
        side = {} if i == 0 else {"sides": [1, 0, 0, 0], "stroke": C["line"]}
        r = (b.col if z.narrow else b.row)(dl, k, gap=z.f(4) if z.narrow else 16, pad=[z.f(10), 0, z.f(10), 0],
                                           sizingH="fill", **side)
        b.txt(r, k, size=z.f(13), style="SemiBold", color=C["ink2"], w=None if z.narrow else z.f(120),
              fillW=z.narrow)
        b.txt(r, v, size=z.f(13), style="SemiBold" if i == 0 else "Regular", color=C["ink"], fillW=True, lh="145%")
    ar = X.actions(b, p, z)
    btn(b, ar, "Use Claude API", "primary", z, fillW=z.size == "phone")
    btn(b, ar, "Cancel", "ghost", z, fillW=z.size == "phone")
    return p


def destination(b, parent, z):
    d = b.row(parent, "Destination line", gap=10, pad=[z.f(10), z.f(12), z.f(10), z.f(12)], radius=10,
              fill=C["accentSoft"], sizingH="fill", cross="min")
    b.txt(d, "☁", size=z.f(15), color=C["accentInk"])
    dc = b.col(d, "Text", gap=2, sizingH="fill")
    b.txt(dc, f"Text goes to {DEST.replace(' · ', ', ')}", size=z.f(13), style="SemiBold", color=C["accentInk"],
          fillW=True, lh="140%")
    b.txt(dc, "Only when a feature asks for it, or when you press Test.", size=z.f(12), color=C["ink2"],
          fillW=True, lh="140%")
    return d


def key_block(b, ctl, z, state):
    """state: none | typing | saved | remove | invalid | keychain."""
    if state in ("saved", "remove"):
        r = b.row(ctl, "Key status", gap=10, sizingH="fill", wrap=z.narrow, crossGap=6)
        status(b, r, "✓", "Key saved", C["green"], C["greenSoft"], z)
        b.txt(r, "In the system keychain. The app never shows it.", size=z.f(12), color=C["ink2"],
              fillW=not z.narrow, w=None)
        if state == "saved":
            ar = X.actions(b, ctl, z)
            btn(b, ar, "Replace key", "ghost", z)
            btn(b, ar, "Remove key", "danger", z)
        else:
            p = b.col(ctl, "Remove confirmation (inline)", gap=10, pad=[z.f(12), z.f(14), z.f(12), z.f(14)],
                      radius=10, fill=C["redSoft"], sizingH="fill")
            b.txt(p, "Remove the key from the keychain?", size=z.f(14), style="SemiBold", color=C["red"], fillW=True)
            b.txt(p, "Claude stops working until you add a key again. The engine stays on Claude API.",
                  size=z.f(13), color=C["ink"], fillW=True, lh="145%")
            ar = X.actions(b, p, z)
            fs, pad = z.btn
            b.button(ar, "Remove key", "primary", size=fs, pad=pad, name="Button Remove key (confirm)")
            b.cmds[-2]["params"]["props"]["fill"] = C["red"]
            b.cmds[-1]["params"]["props"]["fill"] = "#FFFFFF" if C["bg"] != DARK["bg"] else DARK["bg"]
            btn(b, ar, "Cancel", "ghost", z)
        return
    if state == "keychain":
        r = b.row(ctl, "Key status", gap=10, sizingH="fill")
        status(b, r, "○", "No key", C["ink2"], C["sunken"], z)
        info(b, ctl, "!", "System keychain not available", z, tone="red",
             sub="It is locked or missing, so the key cannot be saved. Unlock the keychain (Secret Service, e.g. "
                 "GNOME Keyring or KWallet) and try again. The app keeps the key nowhere else.")
        ar = X.actions(b, ctl, z)
        btn(b, ar, "Try again", "ghost", z)
        return
    r = b.row(ctl, "Key status", gap=10, sizingH="fill")
    status(b, r, "○", "No key", C["ink2"], C["sunken"], z)
    if state == "none":
        b.txt(r, "Create one at console.anthropic.com › API keys.", size=z.f(12), color=C["ink2"], fillW=True)
    fr = (b.col if z.narrow else b.row)(ctl, "Key input", gap=z.f(8), sizingH="fill", cross="min" if z.narrow else "center")
    text = {"none": "Paste your API key", "typing": "••••••••••••••••••••••••••••••",
            "invalid": "•••••••••• •••••••"}[state]
    field(b, fr, z, text, {"none": "empty", "typing": "typing", "invalid": "invalid"}[state],
          name="API key (type=password, autocomplete=off)")
    if state == "none":
        disabled_button(b, fr, "Save key", z)
    else:
        btn(b, fr, "Save key", "primary", z)
    if state == "invalid":
        e = b.row(ctl, "Error", gap=8, sizingH="fill", cross="min")
        ic = b.row(e, "Icon", w=z.f(18), h=z.f(18), radius=z.f(9), fill=C["red"], main="center", cross="center")
        b.txt(ic, "!", size=z.f(11), style="Bold", color=C["surface"])
        b.txt(e, "Not a valid key. Use 1–512 characters without spaces or line breaks.", size=z.f(13),
              style="SemiBold", color=C["red"], fillW=True, lh="140%")
    elif state == "typing":
        b.txt(ctl, "Saved to the system keychain, then this field is cleared.", size=z.f(12), color=C["muted"],
              fillW=True)


def claude_card(b, body, z, key="saved", model_open=False):
    c = X.card(b, body, "Claude API", z, gap=4)

    def right(h):
        status(b, h, "☁", "Cloud", C["accentInk"], C["accentSoft"], z)
    card_head(b, c, "Claude API", "Uses your own Anthropic API key. Requests go from this app straight to "
                                  "Anthropic, nowhere else.", z, right=right)
    b.node("frame", c, name="Gap", w=10, h=z.f(8), fill="none")
    destination(b, c, z)
    ctl = setting_row(b, c, "Model", "Sonnet suits most meetings.", z, first=True)
    select(b, ctl, "✦", "Claude Sonnet 5.5", "Default · good results at moderate cost", z,
           state="open" if model_open else "ok")
    if model_open:
        lst = b.col(ctl, "Model list", gap=2, pad=6, radius=12, fill=C["surface"], stroke=C["line"], sizingH="fill",
                    effects=SHADOW)
        for n, sub in CLAUDE_MODELS:
            on = n == "Claude Sonnet 5.5"
            r = b.row(lst, f"Model {n}", gap=12, pad=[z.f(10), 12, z.f(10), 12], radius=8, sizingH="fill",
                      fill=C["accentSoft"] if on else "none")
            b.txt(r, "✓" if on else "", size=z.f(14), style="Bold", color=C["accent"], w=z.f(14))
            cc = b.col(r, "Text", gap=1, sizingH="fill")
            b.txt(cc, n, size=z.f(14), style="SemiBold", color=C["accentInk"] if on else C["ink"], fillW=True)
            b.txt(cc, sub, size=z.f(12), color=C["ink2"] if on else C["muted"], fillW=True)
    ctl = setting_row(b, c, "API key", "Stored only in the system keychain.", z, first=False)
    key_block(b, ctl, z, key)
    return c


def local_card(b, body, z, state="found"):
    """state: found | none | gone."""
    c = X.card(b, body, "Model on this device", z, gap=4)

    def right(h):
        status(b, h, "✓", "On-device", C["green"], C["greenSoft"], z)
    card_head(b, c, "Model on this device", "GGUF models already on this device, run by llama.cpp. "
                                            "Nothing is downloaded and nothing is sent.", z, right=right)
    ctl = setting_row(b, c, "Run with", "Takes effect at once.", z)
    if state == "found":
        for i, (name, size, folder, src) in enumerate(LOCAL):
            def extra(cc, folder=folder):
                b.txt(cc, f"Found in {folder}", size=z.f(12), color=C["muted"], fillW=True)
            radio_option(b, ctl, name, f"{size} · {src}", i == 0, z, extra=extra)
    elif state == "gone":
        select(b, ctl, "✦", LOCAL[0][0], "Not found any more", z, state="gone")
        info(b, ctl, "!", "The chosen model was moved or deleted.", z, tone="amber",
             sub="No feature uses a language model until you choose one again. The app does not switch to "
                 "another model or to Claude by itself.")
        for i, (name, size, folder, src) in enumerate(LOCAL[1:]):
            def extra(cc, folder=folder):
                b.txt(cc, f"Found in {folder}", size=z.f(12), color=C["muted"], fillW=True)
            radio_option(b, ctl, name, f"{size} · {src}", False, z, extra=extra)
    else:
        e = b.col(ctl, "No model", gap=8, pad=[14, 16, 14, 16], radius=12, fill=C["sunken"], sizingH="fill")
        b.txt(e, "No language model found on this device", size=z.f(14), style="SemiBold", fillW=True)
        b.txt(e, "The app looks for GGUF files (….gguf) in these folders:", size=z.f(13), color=C["ink2"],
              fillW=True)
        folders(b, e, [(f"{APP_DATA}/models", "Meeting Companion"), ("~/.cache/huggingface/hub", "Hugging Face")], z)
        b.txt(e, "Place a model there and open this section again.", size=z.f(12), color=C["ink2"], fillW=True)
    return c


TEST_ERRORS = {
    "offline": ("Offline", "No connection to api.anthropic.com within 10 s. Check the network, then test again."),
    "unauth": ("Key not accepted (401)", "Anthropic rejected the saved key. Replace it with a valid key."),
    "rate": ("Rate limited (429)", "Anthropic is limiting requests for this key. Wait a minute, then test again."),
    "failed": ("Test failed", "Anthropic answered with a server error or took longer than 60 s. Try again later."),
    "nomodel": ("No model", "Qwen2.5-3B-Instruct-Q4_K_M.gguf is not on this device any more. Choose a model above."),
    "nokey": ("No key", "Save an API key first."),
    "cancelled": ("Cancelled", "The test was stopped. Nothing else happened."),
}


def test_result(b, parent, z, state, engine="claude"):
    who = "Claude Sonnet 5.5" if engine == "claude" else "Qwen2.5-3B-Instruct"
    if state == "running":
        r = b.col(parent, "Result · running", gap=8, pad=[z.f(12), z.f(14), z.f(12), z.f(14)], radius=10,
                  fill=C["sunken"], sizingH="fill")
        b.txt(r, f"Waiting for {who}… 2 s", size=z.f(13), style="SemiBold", color=C["accentInk"], fillW=True,
              features={"tnum": True})
        p = b.progress(r, 300, 0.35, C["accent"], track=C["surface"], h=4, name="Busy (indeterminate)")
        b.cmds[-2]["params"]["props"]["sizingH"] = "fill"
        return r
    if state == "reply":
        r = b.col(parent, "Result · reply (plain text)", gap=8, pad=[z.f(12), z.f(14), z.f(12), z.f(14)], radius=10,
                  fill=C["surface"], stroke=C["line"], sizingH="fill")
        h = b.row(r, "Head", gap=8, sizingH="fill", wrap=z.narrow, crossGap=4)
        status(b, h, "✓", "Reply received", C["green"], C["greenSoft"], z)
        b.txt(h, f"{who} · 1.4 s", size=z.f(12), color=C["ink2"], features={"tnum": True})
        b.txt(r, REPLY, size=z.f(14), color=C["ink"], fillW=True, lh="150%")
        return r
    t, sub = TEST_ERRORS[state]
    tone = "neutral" if state == "cancelled" else "red"
    return info(b, parent, "!" if tone == "red" else "i", t, z, tone=tone, sub=sub, name=f"Result · {state}")


def test_card(b, body, z, engine="claude", state="idle"):
    c = X.card(b, body, "Test", z, gap=4)
    card_head(b, c, "Test", "Sends a fixed sample text through the chosen engine. Never meeting data.", z)
    ctl = setting_row(b, c, "Sample text", None, z)
    smp = b.row(ctl, "Sample", pad=[z.f(10), 12, z.f(10), 12], radius=10, fill=C["sunken"], sizingH="fill")
    b.txt(smp, f"“{SAMPLE}”", size=z.f(13), color=C["ink2"], fillW=True, lh="145%")
    ar = b.row(ctl, "Test", gap=12, sizingH="fill", wrap=z.narrow, crossGap=8)
    if engine == "off":
        disabled_button(b, ar, "Test", z, icon="▶")
        b.txt(ar, "Choose an engine to test it.", size=z.f(12), color=C["ink2"], fillW=True)
    elif state == "running":
        btn(b, ar, "Cancel test", "ghost", z, icon="■")
        b.txt(ar, "Stops within a second. The settings stay usable meanwhile.", size=z.f(12), color=C["muted"],
              fillW=True)
    else:
        btn(b, ar, "Test again" if state not in ("idle",) else "Test", "ghost", z, icon="▶")
        if engine == "claude" and state == "idle":
            b.txt(ar, "Sends the sample text to api.anthropic.com.", size=z.f(12), color=C["ink2"], fillW=True)
    if engine != "off" and state != "idle":
        test_result(b, ctl, z, state, engine)
    return c


def content(engine="claude", pending=False, key="saved", test="reply", local="found", model_open=False):
    def draw(b, sec, z):
        engine_card(b, sec, z, engine, pending)
        if engine == "claude":
            claude_card(b, sec, z, key, model_open)
        elif engine == "local":
            local_card(b, sec, z, local)
        test_card(b, sec, z, engine, test)
    return draw


def build(x=0, y=0):
    return X.screen("s17_", "17 Language model · Claude API · key saved · test reply", x, y,
                    content("claude", key="saved", test="reply"), w=1440, h=1000, origin="setup")
