"""21 Captures · 018 · agenda-free (frame 16 / s16b) · 1280. Captures go to the topic marked "läuft gerade" and are
grouped by topic. What was captured while no topic was current is grouped under "Ohne Thema" and can be moved to a
topic by editing it."""
import s21_captures as S


def build(x=0, y=0):
    spec = dict(
        tab="d", counts=(2, 1, 0),
        groups=[("Läuft gerade · Interview-Rekrutierung", []),
                ("Sprache der Release Notes", [dict(kind="d", text="Release Notes erst auf Deutsch, Englisch eine "
                                                                    "Woche später", item="", time="10:21")]),
                ("Ohne Thema", [dict(kind="d", text="Offline-Modus kommt nach der Beta", item="", time="10:02")])],
        composer=dict(state="typing", kind="d", text="Erste Interview-Runde remote, Nachbefragung vor Ort",
                      attach="Interview-Rekrutierung"),
    )
    lines = [l + ({},) for l in S.FREE_LINES]
    b = S.live("s21o_", "21 Captures · 018 · agenda-free · 1280", x, y, spec, w=1280, h=800, lines=lines, free=True)
    return b
