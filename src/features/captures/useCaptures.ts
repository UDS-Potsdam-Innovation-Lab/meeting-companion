import { useCallback, useEffect, useRef, useState } from "react";
import {
  addCapture,
  confirmSuggestion,
  deleteCapture,
  loadCaptures,
  restoreCapture,
  unconfirmSuggestion,
  updateCapture,
  type Capture,
  type CaptureChange,
  type CaptureError,
  type ConfirmSuggestion,
  type NewCapture,
} from "../../lib/ipc";
import { useClock } from "../../lib/clock";
import { JUST_SAVED_MS, UNDO_MS, UNDONE_MS } from "./model";

/**
 * The notice above the composer: "saved" and "deleted" carry Undo for 8 s; "restored" (after Undo of a
 * delete) and "removed" (after Undo of a save) are short confirmations without an action.
 */
export interface CaptureNotice {
  type: "saved" | "deleted" | "restored" | "removed";
  capture: Capture;
  /** Clock time when it goes away. */
  until: number;
  /** Increases with every new notice, so a replaced notice restarts its bar. */
  seq: number;
}

export type CaptureResult = { ok: true; capture: Capture } | { ok: false; error: CaptureError };

export interface Captures {
  captures: Capture[];
  /** Loading failed; the list is empty and capturing still works. */
  loadFailed: boolean;
  notice: CaptureNotice | null;
  /** The card that says "just saved" (for 2 s after the core wrote it). */
  justSaved: string | null;
  add: (input: NewCapture) => Promise<CaptureResult>;
  /** Bestätigen of a suggestion (job 019): the core stores it with `source: "suggested"`. */
  confirm: (confirm: ConfirmSuggestion) => Promise<CaptureResult>;
  update: (id: string, change: CaptureChange) => Promise<CaptureResult>;
  remove: (id: string) => Promise<CaptureResult>;
  /** Undo of the notice's action. */
  undo: () => Promise<CaptureResult | null>;
  /** An Undo failed (the core refused or could not write). */
  undoFailed: boolean;
  /** The capture whose inline editor is open; the composer collapses meanwhile (frame 21c). */
  editing: string | null;
  setEditing: (id: string | null) => void;
}

/**
 * The captures of a running meeting, as the core stores them. Nothing is shown as saved before the
 * core has answered: the list is replaced by the core's list after every command. Notices expire by
 * the clock (8 s for Undo), so tests run them on a fake clock.
 */
export function useCaptures(meetingId: string, onSaved?: (capture: Capture) => void): Captures {
  const clock = useClock();
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState<CaptureNotice | null>(null);
  const [justSaved, setJustSaved] = useState<{ id: string; until: number } | null>(null);
  const [undoFailed, setUndoFailed] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const seq = useRef(0);
  const savedRef = useRef(onSaved);
  useEffect(() => {
    savedRef.current = onSaved;
  }, [onSaved]);

  useEffect(() => {
    let cancelled = false;
    loadCaptures(meetingId).then(
      (list) => {
        if (!cancelled) setCaptures(list);
      },
      () => {
        if (!cancelled) setLoadFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  // Notices and the "just saved" mark go away by the clock.
  useEffect(() => {
    if (!notice && !justSaved) return;
    const check = () => {
      const now = clock.now();
      setNotice((n) => (n && now >= n.until ? null : n));
      setJustSaved((j) => (j && now >= j.until ? null : j));
    };
    check();
    return clock.every(250, check);
  }, [clock, notice, justSaved]);

  const show = useCallback(
    (type: CaptureNotice["type"], capture: Capture) => {
      seq.current += 1;
      const ms = type === "saved" || type === "deleted" ? UNDO_MS : UNDONE_MS;
      setNotice({ type, capture, until: clock.now() + ms, seq: seq.current });
      setUndoFailed(false);
    },
    [clock],
  );

  const run = useCallback(
    async (
      call: () => Promise<{ capture: Capture; captures: Capture[] }>,
      after?: (c: Capture) => void,
    ): Promise<CaptureResult> => {
      try {
        const saved = await call();
        setCaptures(saved.captures);
        after?.(saved.capture);
        return { ok: true, capture: saved.capture };
      } catch (e) {
        return { ok: false, error: e as CaptureError };
      }
    },
    [],
  );

  const add = useCallback(
    (input: NewCapture) =>
      run(
        () => addCapture(meetingId, input),
        (c) => {
          show("saved", c);
          setJustSaved({ id: c.id, until: clock.now() + JUST_SAVED_MS });
          savedRef.current?.(c);
        },
      ),
    [clock, meetingId, run, show],
  );

  const confirm = useCallback(
    (c: ConfirmSuggestion) =>
      run(
        () => confirmSuggestion(meetingId, c),
        (saved) => {
          show("saved", saved);
          setJustSaved({ id: saved.id, until: clock.now() + JUST_SAVED_MS });
          savedRef.current?.(saved);
        },
      ),
    [clock, meetingId, run, show],
  );

  const update = useCallback(
    (id: string, change: CaptureChange) => run(() => updateCapture(meetingId, id, change)),
    [meetingId, run],
  );

  const remove = useCallback(
    (id: string) =>
      run(
        () => deleteCapture(meetingId, id),
        (c) => show("deleted", c),
      ),
    [meetingId, run, show],
  );

  const undo = useCallback(async () => {
    if (!notice || (notice.type !== "saved" && notice.type !== "deleted")) return null;
    const { type, capture } = notice;
    // Undo of a save removes the capture (a confirmed suggestion waits again); Undo of a delete asks the
    // core to put back its own copy, by id only.
    const result =
      type === "saved"
        ? await run(
            () =>
              capture.source === "suggested"
                ? unconfirmSuggestion(meetingId, capture.id)
                : deleteCapture(meetingId, capture.id),
            (c) => show("removed", c),
          )
        : await run(
            () => restoreCapture(meetingId, capture.id),
            (c) => show("restored", c),
          );
    if (!result.ok) setUndoFailed(true);
    else setJustSaved(null);
    return result;
  }, [meetingId, notice, run, show]);

  return {
    captures,
    loadFailed,
    notice,
    justSaved: justSaved?.id ?? null,
    add,
    confirm,
    update,
    remove,
    undo,
    undoFailed,
    editing,
    setEditing,
  };
}
