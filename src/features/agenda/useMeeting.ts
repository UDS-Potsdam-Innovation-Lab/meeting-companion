import { useCallback, useEffect, useRef, useState } from "react";
import { loadLatestMeeting, saveMeeting, type LoadError } from "../../lib/ipc";
import { isEnded } from "../live/run";
import { createMeeting, isMeetingValid, type Meeting } from "./model";

export type MeetingEdit = (current: Meeting) => Meeting;

export interface MeetingState {
  meeting: Meeting | null;
  loadError: LoadError | null;
  saveFailed: boolean;
  /** Applies the edit if the result is valid and saves it. Returns false (and changes nothing) otherwise. */
  update: (edit: MeetingEdit) => boolean;
  startNew: () => void;
  dismissLoadError: () => void;
}

/**
 * Loads the most recently edited meeting on start (or starts an empty one) and saves every valid
 * change through the store, one save at a time and in order. Timekeeping actions are changes like any
 * other, so each one is saved at once.
 */
export function useMeeting(defaultTitle: () => string): MeetingState {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const current = useRef<Meeting | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const titleRef = useRef(defaultTitle);
  useEffect(() => {
    titleRef.current = defaultTitle;
  }, [defaultTitle]);

  useEffect(() => {
    let cancelled = false;
    void loadLatestMeeting().then((result) => {
      if (cancelled) return;
      // An ended meeting is never reopened; it stays stored for the wrap-up.
      const loaded = result.meeting && !isEnded(result.meeting) ? result.meeting : null;
      const m = loaded ?? createMeeting(titleRef.current());
      current.current = m;
      setMeeting(m);
      setLoadError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((m: Meeting) => {
    queue.current = queue.current
      .then(() => saveMeeting(m))
      .then(
        () => setSaveFailed(false),
        () => setSaveFailed(true),
      );
  }, []);

  const update = useCallback(
    (edit: MeetingEdit) => {
      if (!current.current) return false;
      const next = edit(current.current);
      if (next === current.current || !isMeetingValid(next)) return false;
      current.current = next;
      setMeeting(next);
      persist(next);
      return true;
    },
    [persist],
  );

  const startNew = useCallback(() => {
    const m = createMeeting(titleRef.current());
    current.current = m;
    setMeeting(m);
    // A missing key is not solved by a new meeting; that message stays.
    setLoadError((e) => (e === "keyUnavailable" ? e : null));
    persist(m);
  }, [persist]);

  const dismissLoadError = useCallback(() => setLoadError((e) => (e === "keyUnavailable" ? e : null)), []);

  return { meeting, loadError, saveFailed, update, startNew, dismissLoadError };
}
