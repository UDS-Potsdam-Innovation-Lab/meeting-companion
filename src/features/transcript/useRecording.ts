import { useCallback, useEffect, useRef, useState } from "react";
import {
  CAPTURE_OFF,
  confirmRecordingConsent,
  loadTranscript,
  onCaptureState,
  onMicrophoneSwitched,
  onTranscriptSegment,
  onTranscriptVoice,
  pauseRecording,
  recordingStatus,
  startRecording,
  stopRecording,
  type CaptureState,
  type SwitchedEvent,
  type RecordReason,
  type TranscriptLoadError,
  type TranscriptSegment,
} from "../../lib/ipc";

export interface Recording {
  /** The core's capture state; drives the REC chip. Never set from UI state alone. */
  capture: CaptureState;
  /** Final lines, oldest first, each with its sequence number and (once known) its voice. */
  lines: TranscriptSegment[];
  /** Final lines that arrived while this view was open (not loaded from the store). */
  received: number;
  /** What is being said right now, replaced by its final line. */
  partial: TranscriptSegment | null;
  transcriptError: TranscriptLoadError | null;
  /** The chosen microphone was lost and recording switched to the system default (until dismissed). */
  switched: SwitchedEvent | null;
  dismissSwitched: () => void;
  /** A command is running (start, pause): buttons wait. */
  busy: boolean;
  /** Stores the consent confirmation, then starts recording. */
  confirmAndStart: () => Promise<void>;
  start: () => Promise<void>;
  pause: () => Promise<void>;
  /** Stops capture (End meeting). */
  stop: () => Promise<void>;
}

function failed(meetingId: string, reason: RecordReason): CaptureState {
  return { state: "error", meetingId, elapsedMs: 0, level: 0, reason };
}

/**
 * The live view's recording: capture state and segments from the core's events, the stored transcript
 * of the meeting, and the recording commands. Microphone, speech model and language come from the
 * settings, which the core reads itself. Recording never starts here on
 * its own; only `confirmAndStart` and `start`, called from buttons, start it.
 */
export function useRecording(meetingId: string, onConsent: (at: number) => void): Recording {
  const [capture, setCapture] = useState<CaptureState>(CAPTURE_OFF);
  const [lines, setLines] = useState<TranscriptSegment[]>([]);
  const [partial, setPartial] = useState<TranscriptSegment | null>(null);
  const [received, setReceived] = useState(0);
  const [transcriptError, setTranscriptError] = useState<TranscriptLoadError | null>(null);
  const [busy, setBusy] = useState(false);
  const [switched, setSwitched] = useState<SwitchedEvent | null>(null);
  const consentRef = useRef(onConsent);
  useEffect(() => {
    consentRef.current = onConsent;
  }, [onConsent]);

  useEffect(() => {
    let cancelled = false;
    const ours = (id: string | null) => id === null || id === meetingId;
    const stopCapture = onCaptureState((s) => {
      if (cancelled || !ours(s.meetingId)) return;
      setCapture(s);
      // A preview line only lives while someone is being recorded.
      if (s.state !== "recording") setPartial(null);
    });
    const stopSegments = onTranscriptSegment((e) => {
      if (cancelled || e.meetingId !== meetingId) return;
      const { meetingId: _id, ...segment } = e;
      void _id;
      if (segment.final) {
        setPartial(null);
        setLines((l) => [...l, segment]);
        setReceived((n) => n + 1);
      } else {
        setPartial(segment);
      }
    });
    const stopVoices = onTranscriptVoice((v) => {
      if (cancelled || v.meetingId !== meetingId) return;
      setLines((l) => l.map((line) => (line.seq === v.seq ? { ...line, voice: v.voice } : line)));
    });
    const stopSwitched = onMicrophoneSwitched((e) => {
      if (!cancelled && e.meetingId === meetingId) setSwitched(e);
    });
    void recordingStatus().then((s) => {
      if (!cancelled && ours(s.meetingId)) setCapture(s);
    });
    void loadTranscript(meetingId).then((t) => {
      if (cancelled) return;
      // A stored line's sequence number is its position. Lines that arrived by event while loading
      // come after the stored ones.
      const stored = t.segments.map((s, i) => ({ ...s, seq: i }));
      setLines((live) => [...stored, ...live.filter((l) => l.seq === undefined || l.seq >= stored.length)]);
      setTranscriptError(t.error);
    });
    return () => {
      cancelled = true;
      stopCapture();
      stopSegments();
      stopVoices();
      stopSwitched();
    };
  }, [meetingId]);

  const run = useCallback(
    async (command: () => Promise<CaptureState>) => {
      setBusy(true);
      try {
        setCapture(await command());
      } catch (e) {
        const err = e as { kind?: string; reason?: RecordReason };
        setCapture(failed(meetingId, err.kind === "failed" && err.reason ? err.reason : "engineFailed"));
      } finally {
        setBusy(false);
      }
    },
    [meetingId],
  );

  const start = useCallback(() => run(() => startRecording(meetingId)), [run, meetingId]);

  const confirmAndStart = useCallback(async () => {
    setBusy(true);
    let at: number;
    try {
      at = await confirmRecordingConsent(meetingId);
    } catch (e) {
      const err = e as { kind?: string; reason?: RecordReason };
      setCapture(failed(meetingId, err.kind === "failed" && err.reason ? err.reason : "storageFailed"));
      setBusy(false);
      return;
    }
    consentRef.current(at);
    await run(() => startRecording(meetingId));
  }, [meetingId, run]);

  const pause = useCallback(() => run(pauseRecording), [run]);
  const stop = useCallback(async () => {
    setCapture(await stopRecording());
  }, []);

  return {
    capture,
    lines,
    received,
    partial,
    transcriptError,
    switched,
    dismissSwitched: useCallback(() => setSwitched(null), []),
    busy,
    confirmAndStart,
    start,
    pause,
    stop,
  };
}
