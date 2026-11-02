"""21 Captures · states: composer, cards, notices, empty tab (job 018); suggestion card, status line, detected chips
(job #19); agenda-free labels; dark. Captions are design notes; the UI copy is German, the app's default."""
from kit import C, DARK, themed
import setx as X
import s21_captures as S

Z = S.Z("wide")
W = 380


def build(x=0, y=0):
    b, s = X.board("s21s_", "21 Captures · states", x, y, "Captures · states",
                   "Right column of frames 02 and 16 (380 px at 1440, 360 at 1280, 460 on the board). Nothing here is "
                   "modal and nothing takes focus on its own. Everything the assistant produces carries ✦ and stays a "
                   "suggestion until a person taps Bestätigen.")

    # --- composer
    sec = X.section(b, s, "Composer · job 018",
                    "Pinned at the bottom of the column. The kind is the open tab; a kind button or /d /t /q switches "
                    "both. Enter saves, Esc clears the field. The core validates; “gespeichert” only after the file "
                    "is written.")
    r = b.row(sec, "Composer states", gap=24, cross="min", wrap=True, crossGap=24, w=4 * W + 3 * 24)
    for cap, sub, comp in (
            ("Rest", "Kind = open tab. The hint shows the command.", dict(state="rest", kind="d")),
            ("Typing a decision", "Save appears; → shows where it goes.",
             dict(state="typing", kind="d", text="Beta startet am 14. Nov.", attach="Punkt 02 · Beta-Start")),
            ("/t typed", "The command switches kind and tab, then is removed from the text.",
             dict(state="typing", kind="t", text="Raum für den Workshop anfragen", attach="Punkt 02")),
            ("To-do with owner and date", "Both optional; one tap each, tap again to clear.",
             dict(state="typing", kind="t", text="Raum für den Workshop anfragen", owner="LS", due="Morgen",
                  attach="Punkt 02")),
            ("Too long (core: 1–500 characters)", "Counter from 450 on; nothing is stored.",
             dict(state="error", kind="d", text="Die Beta startet am 14. November ohne Offline-Modus, und die "
                                                "dritte Pilotschule wird noch diese Woche informiert, weil …",
                  error="Höchstens 500 Zeichen (jetzt 512).", count="512 / 500", attach="Punkt 02")),
            ("Not saved (core error)", "The text stays in the field; nothing is lost.",
             dict(state="error", kind="q", text="Gehen die Release Notes nur auf Deutsch raus?",
                  error="Nicht gespeichert: Das Meeting konnte auf diesem Gerät nicht geschrieben werden. "
                        "Versuch es noch einmal.", attach="Punkt 02")),
            ("Agenda-free, a topic is current", "Frame 16: captures go to the topic marked “läuft gerade”.",
             dict(state="typing", kind="d", text="Erste Runde remote", attach="Interview-Rekrutierung")),
            ("Agenda-free, no topic is current", "Stored without a topic, grouped under “Ohne Thema”.",
             dict(state="typing", kind="d", text="Offline-Modus kommt nach der Beta",
                  attach="Ohne Thema · links ein Thema antippen")),
    ):
        c = X.cell(b, r, cap, sub, w=W)
        S.composer(b, c, Z, comp)

    # --- cards
    sec = X.section(b, s, "Cards · job 018",
                    "Grouped by agenda item (running item first, then earlier ones), newest first. ✎ or a tap on the "
                    "card opens the inline editor; Löschen only lives there.")
    r = b.row(sec, "Cards", gap=24, cross="min", wrap=True, crossGap=24, w=4 * W + 3 * 24)
    for cap, sub, card in (
            ("Decision", None, dict(kind="d", text="Pilot-Check-ins finden ab jetzt donnerstags statt", item="Punkt 01",
                                    time="10:04", show_item=True)),
            ("To-do with owner and date", None, S.NEW_TODO | dict(show_item=True)),
            ("Question", None, dict(kind="q", text="Gehen die Release Notes nur auf Deutsch raus?", item="Punkt 02",
                                    time="10:15", show_item=True)),
            ("Just saved (kind-coloured edge, 2 s)", None, S.NEW_TODO | dict(new=True)),
            ("From a suggestion (✦), edited", "source: suggested",
             dict(kind="t", text="Termin 14. Nov. im Schulportal ankündigen", item="Punkt 02", time="10:14",
                  owner="TB", src="suggested", edited=True, show_item=True)),
    ):
        c = X.cell(b, r, cap, sub, w=W)
        S.capture_card(b, c, card, Z)
    c = X.cell(b, r, "Inline edit", "Esc cancels, Enter saves. Not modal.", w=W)
    S.editor(b, c, Z, "t", "Einladungen für die Donnerstags-Check-ins neu verschicken", "MK", "Mo 9. Nov.",
             mode="edit", attach="Punkt 01")
    c = X.cell(b, r, "Empty tab", "Other tabs keep their entries.", w=W)
    S.column_body(b, c, Z, dict(empty=("Noch keine Fragen", "Offene Fragen aus diesem Meeting erscheinen hier."),
                                fillV=False))
    c = X.cell(b, r, "Empty column", "All counts 0.", w=W)
    S.column_body(b, c, Z, dict(empty=("Noch nichts festgehalten",
                                       "Halte Beschlüsse, Aufgaben und Fragen unten fest. Sie landen beim laufenden "
                                       "Punkt. Im Feld gehen auch /d, /t und /q."), fillV=False))

    # --- notices
    sec = X.section(b, s, "Notices · job 018",
                    "Dark, above the composer, 8 s (AC1: at least 5 s), the bar runs down. A new notice replaces the "
                    "old one. Announced through the polite live region; focus stays in the field.")
    r = b.row(sec, "Notices", gap=24, cross="min")
    for cap, kw in (("Saved", dict(text="Aufgabe gespeichert · Punkt 02", sub="Yusuf Aydin · bis Fr 6. Nov.",
                                   frac=0.7)),
                    ("Deleted", dict(text="Aufgabe gelöscht", sub="„Einladungen für die Donnerstags-…“", frac=0.45)),
                    ("After Undo", dict(text="Wiederhergestellt", sub=None, undo=False)),
                    ("Confirmed suggestion (#19)", dict(text="Beschluss gespeichert · Punkt 02", sub="aus Vorschlag",
                                                        frac=0.8))):
        c = X.cell(b, r, cap, None, w=W)
        S.notice(b, c, Z, **kw)

    # --- suggestions
    sec = X.section(b, s, "Suggestion card · job #19",
                    "Pinned above the list until someone acts. One at a time per tab; more wait behind it. Bestätigen "
                    "stores it with source “suggested”; Verwerfen drops it for this meeting. Nothing confirms on a "
                    "timer, at the end of an item or of the meeting.")
    r = b.row(sec, "Suggestions", gap=24, cross="min", wrap=True, crossGap=24, w=4 * W + 3 * 24)
    for cap, sub, sg, focus in (("Decision", None, S.SUG_DEC, False),
                                ("To-do with suggested owner and date", "Owner only if it matches a participant.",
                                 S.SUG_TODO, False),
                                ("Question", None, S.SUG_Q, False),
                                ("Focused from the transcript chip", "2.5 px edge; the source line is marked.",
                                 S.SUG_DEC, True)):
        c = X.cell(b, r, cap, sub, w=W)
        S.suggestion_card(b, c, sg, Z, focus=focus)
    c = X.cell(b, r, "Bearbeiten", "Inline. Bestätigen saves the edited version.", w=W)
    S.editor(b, c, Z, "t", S.SUG_TODO["text"], "YA", "Fr 6. Nov.", mode="suggestion")
    c = X.cell(b, r, "Waiting behind", None, w=W)
    S.column_body(b, c, Z, dict(suggestions=[S.SUG_DEC], more_sugs=1, fillV=False))

    # --- status line
    sec = X.section(b, s, "Status line · job #19",
                    "One line under the composer, from the languageModel setting. Glyph + words, never colour alone. "
                    "Errors replace it quietly; recording and quick capture go on; no retry loop (the next run waits "
                    "for the next trigger). With Claude, the top bar also carries “Vorschläge: Anthropic (Cloud)”.")
    r = b.row(sec, "Status", gap=24, cross="min", wrap=True, crossGap=16, w=4 * W + 3 * 24)
    for cap, st, err in (("Off · the link opens Settings › Sprachmodell", "off", None),
                         ("On this device", "local", None),
                         ("Claude · while it is chosen and a recording runs", "cloud", None)):
        c = X.cell(b, r, cap, None, w=W)
        S.status_line(b, c, Z, st)
    c = X.cell(b, r, "Top bar chip (Claude only)", None, w=W)
    ch = b.row(c, "Chip Vorschläge: Cloud", gap=6, pad=[4, 10, 4, 10], radius=999, stroke=C["amber"])
    b.txt(ch, "Vorschläge: Anthropic (Cloud)", size=12, style="SemiBold", color=C["amber"])
    for err in S.ERRORS:
        c = X.cell(b, r, f"Error · {err}", None, w=W)
        S.status_line(b, c, Z, "error", err)

    # --- detected chips
    sec = X.section(b, s, "Transcript chips · job #19",
                    "On the source line. A tap moves focus to the card (and opens the tab). After Bestätigen the chip "
                    "turns into “festgehalten”; after Verwerfen it disappears.")
    r = b.col(sec, "Chips", gap=4, w=760, pad=8, radius=16, fill=C["surface"], stroke=C["line"])
    S.tline(b, r, Z, "MK", "10:11", "Dann nehmen wir offline aus der Beta raus und starten am 14. Einwände?",
            chip=("d", "detected"))
    S.tline(b, r, Z, "MK", "10:12", "Gut. Yusuf, kannst du ihnen diese Woche schreiben?", chip=("t", "detected"))
    S.tline(b, r, Z, "JR", "10:13", "Gehen die Release Notes eigentlich nur auf Deutsch raus?",
            chip=("q", "detected"))
    S.tline(b, r, Z, "MK", "10:11", "Dann nehmen wir offline aus der Beta raus und starten am 14. Einwände?",
            chip=("d", "detected"), hl=True, chip_focus=True)
    S.tline(b, r, Z, "MK", "10:11", "Dann nehmen wir offline aus der Beta raus und starten am 14. Einwände?",
            chip=("d", "kept"))

    # --- dark
    with themed(DARK):
        dk = b.col(s, "Dark", gap=16, pad=32, radius=20, fill=C["bg"])
        b.txt(dk, "Dark", size=18, style="Bold")
        r = b.row(dk, "Dark row", gap=24, cross="min")
        c = b.col(r, "A", w=W, gap=12)
        S.suggestion_card(b, c, S.SUG_TODO, Z)
        S.capture_card(b, c, S.NEW_TODO, Z)
        c = b.col(r, "B", w=W, gap=12)
        S.composer(b, c, Z, dict(state="typing", kind="t", text="Raum anfragen", owner="LS", attach="Punkt 02"))
        S.notice(b, c, Z, text="Aufgabe gelöscht", sub=None, frac=0.45)
        c = b.col(r, "C", w=W, gap=12)
        for st in ("off", "local", "cloud"):
            S.status_line(b, c, Z, st)
        S.status_line(b, c, Z, "error", "RateLimited")
    return b
