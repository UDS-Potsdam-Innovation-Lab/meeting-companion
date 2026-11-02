"""21 Captures · 018 · 1440: inline edit of a confirmed to-do (tap the card or ✎). Not modal: the rest of the
column stays usable. Löschen lives only here, so a stray tap on a card never deletes."""
import s21_captures as S


def build(x=0, y=0):
    t0 = dict(S.CAPS["t"][0], editing=True, item="Punkt 01")
    spec = dict(
        tab="t", counts=(1, 3, 0),
        groups=[("Jetzt · Punkt 02 · Beta-Start", [S.NEW_TODO]),
                ("Punkt 01 · Check-in & Ziele", [t0, S.CAPS["t"][1]])],
        composer=dict(state="rest", kind="t"),
    )
    return S.live("s21c_", "21 Captures · 018 · inline edit", x, y, spec, now_counts="1 Aufgabe")
