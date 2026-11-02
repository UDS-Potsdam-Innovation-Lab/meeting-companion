AMENDED

## Spec review 1 (human, 2026-11-02)

Split. 018 is quick capture only (AC1 and AC6 for the capture parts; edit, delete with Undo, durable storage, no language model, no network, Human gate: no). Suggestions from the transcript (AC2–AC5) move to their own job "Capture suggestions", which depends on 018 and keeps the human gate.

The design is done once for both: the captures column frames include the suggestion states (pending suggestion card, status line off/local/cloud/error, "detected" chip), so the suggestions job finds its design already approved. 018 builds only the quick-capture parts; the status line in 018 may show nothing about suggestions yet.

Decision for the suggestions job (record there): with Claude, real speaker names (as matched to attendees) are sent with the transcript text; the status line says the text goes to Anthropic.
