"""21 Captures · #19 · 1440: editing a suggested to-do inline before confirming it. Bestätigen saves the edited
version (source "suggested"); Abbrechen returns to the pending card. On this device, nothing leaves it."""
import s21_captures as S


def build(x=0, y=0):
    spec = dict(
        tab="t", counts=(2, 2, 0), pending=("t",),
        suggestions=[dict(S.SUG_TODO, edit=True, text="Dritter Pilotschule bis Freitag schreiben, dass der "
                                                       "Offline-Modus später kommt")],
        groups=[("Punkt 01 · Check-in & Ziele", S.CAPS["t"])],
        composer=dict(state="rest", kind="t"),
        status="local",
    )
    return S.live("s21h_", "21 Captures · #19 · suggestion, inline edit · on this device", x, y, spec,
                  lines=S.lines_detected(dec="kept"), now_counts="1 Beschluss")
