"""21 Captures · 1280: many captures. The list scrolls between the pinned tabs and the composer. Pending
suggestions (job #19) stay on top; then the running item; then earlier items, newest first."""
import s21_captures as S


def build(x=0, y=0):
    P02, P01 = S.P02, S.P01
    spec = dict(
        tab="t", counts=(3, 6, 2), pending=("t",),
        suggestions=[S.SUG_TODO],
        groups=[("Jetzt · Punkt 02 · Beta-Start", [
                    dict(kind="t", text="Release Notes auf Deutsch vorbereiten", item=P02, time="10:16", owner="JR",
                         due="Do 5. Nov."),
                    dict(kind="t", text="Termin 14. Nov. im Schulportal ankündigen", item=P02, time="10:14",
                         owner="TB", src="suggested")]),
                ("Punkt 01 · Check-in & Ziele", [
                    dict(kind="t", text="Einladungen für die Donnerstags-Check-ins neu verschicken", item=P01,
                         time="10:05", owner="MK", due="Mo 9. Nov.", edited=True),
                    dict(kind="t", text="Feedbackbogen an die drei Pilotschulen schicken", item=P01, time="10:06",
                         owner="LS"),
                    dict(kind="t", text="Raum für den Workshop im Januar anfragen", item=P01, time="10:03"),
                    dict(kind="t", text="Protokoll der letzten Runde nachreichen", item=P01, time="10:02",
                         owner="YA")])],
        scroll=(2, 110), more_sugs=1,
        composer=dict(state="rest", kind="t"),
        status="local",
    )
    return S.live("s21f_", "21 Captures · many, scrolling · 1280", x, y, spec, w=1280, h=800,
                  lines=S.lines_detected(dec="kept"), now_counts="1 Beschluss · 2 Aufgaben")
