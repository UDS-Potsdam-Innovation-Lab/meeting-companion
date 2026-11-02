import { useCallback, useEffect, useRef, useState } from "react";
import {
  dismissSuggestion,
  loadSuggestions,
  type CaptureError,
  type CaptureSuggestion,
  type LlmError,
} from "../../lib/ipc";
import { useClock } from "../../lib/clock";
import { SUGGESTIONS_EVERY_MS } from "./suggestions";

export interface Suggestions {
  /** Waiting suggestions, as the core holds them. */
  pending: CaptureSuggestion[];
  /** Why the last run gave nothing (a kind only). */
  error: LlmError | null;
  /** Verwerfen. Resolves with the core's error, or null. */
  dismiss: (id: string) => Promise<CaptureError | null>;
  /** Reads the core's state now (after a confirm or its Undo). */
  refresh: () => void;
  /** The core confirmed it: it leaves the list at once. */
  drop: (id: string) => void;
  /** The suggestion a transcript chip brought to the front of its tab, and a request to focus it. */
  front: string | null;
  focusRequest: number;
  bringForward: (id: string) => void;
  /** The suggestion whose inline editor is open. */
  editing: string | null;
  setEditing: (id: string | null) => void;
}

/**
 * The waiting capture suggestions of the running meeting. The core keeps them in memory; the view reads
 * them every second by the clock and after each action. A new suggestion is reported once through
 * `onNew` (for the polite live region); it never takes focus.
 */
export function useSuggestions(meetingId: string, onNew?: (s: CaptureSuggestion) => void): Suggestions {
  const clock = useClock();
  const [pending, setPending] = useState<CaptureSuggestion[]>([]);
  const [error, setError] = useState<LlmError | null>(null);
  const [front, setFront] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const seen = useRef<Set<string> | null>(null);
  // Bumped by every change the view makes: a read that started before it is stale and ignored.
  const generation = useRef(0);
  const newRef = useRef(onNew);
  useEffect(() => {
    newRef.current = onNew;
  }, [onNew]);

  const take = useCallback((list: CaptureSuggestion[], err: LlmError | null) => {
    // The first read shows what was waiting already; only later ones are announced as new.
    const known = seen.current;
    if (known) {
      for (const s of list) if (!known.has(s.id)) newRef.current?.(s);
    }
    seen.current = new Set([...(known ?? []), ...list.map((s) => s.id)]);
    setPending((old) =>
      old.length === list.length && old.every((s, i) => s.id === list[i]!.id) ? old : list,
    );
    setError((old) => (old?.kind === err?.kind ? old : err));
  }, []);

  const read = useCallback(
    (isLive: () => boolean = () => true) => {
      const at = generation.current;
      void loadSuggestions(meetingId).then((s) => {
        if (isLive() && at === generation.current) take(s.pending, s.error);
      });
    },
    [meetingId, take],
  );
  const refresh = useCallback(() => {
    generation.current += 1;
    read();
  }, [read]);

  const drop = useCallback((id: string) => {
    generation.current += 1;
    setPending((p) => p.filter((s) => s.id !== id));
    setFront((f) => (f === id ? null : f));
    setEditing((e) => (e === id ? null : e));
  }, []);

  useEffect(() => {
    let live = true;
    const isLive = () => live;
    const once = () => read(isLive);
    once();
    const stop = clock.every(SUGGESTIONS_EVERY_MS, once);
    return () => {
      live = false;
      stop();
    };
  }, [clock, read]);

  const dismiss = useCallback(
    async (id: string) => {
      try {
        const s = await dismissSuggestion(meetingId, id);
        generation.current += 1;
        take(s.pending, s.error);
        setFront((f) => (f === id ? null : f));
        return null;
      } catch (e) {
        refresh();
        return e as CaptureError;
      }
    },
    [meetingId, refresh, take],
  );

  const bringForward = useCallback((id: string) => {
    setFront(id);
    setFocusRequest((n) => n + 1);
  }, []);

  return { pending, error, dismiss, refresh, drop, front, focusRequest, bringForward, editing, setEditing };
}
