import { useCallback, useEffect, useRef, useState } from "react";
import {
  CAPTURE_OFF,
  confirmRecordingConsent,
  listSpeechModels,
  loadTranscript,
  onCaptureState,
  onTranscriptSegment,
  pauseRecording,
  recordingStatus,
  startRecording,
  stopRecording,
  type CaptureState,
  type ModelList,
  type RecordReason,
  type TranscriptLoadError,
  type TranscriptSegment,
} from "../../lib/ipc";

/** Where the facilitator's model choice is remembered on this device. */
export const MODEL_STORAGE_KEY = "meeting-companion.speechModel";

function storedModel(): string | null {
  try {
    return localStorage.getItem(MODEL_STORAGE_KEY);
  } catch {
    return null;
  }
}

export interface Recording {
  /** The core's capture state; drives the REC chip. Never set from UI state alone. */
  capture: CaptureState;
  /** Final lines, oldest first. */
  lines: TranscriptSegment[];
  /** Final lines that arrived while this view was open (not loaded from the store). */
  received: number;
  /** What is being said right now, replaced by its final line. */
  partial: TranscriptSegment | null;
  transcriptError: TranscriptLoadError | null;
  models: ModelList | null;
  /** The chosen model's id (the preferred one unless the facilitator picked another). */
  modelId: string | null;
  chooseModel: (id: string) => void;
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
 * of the meeting, the speech models found, and the recording commands. Recording never starts here on
 * its own; only `confirmAndStart` and `start`, called from buttons, start it.
 */
export function useRecording(meetingId: string, onConsent: (at: number) => void): Recording {
  const [capture, setCapture] = useState<CaptureState>(CAPTURE_OFF);
  const [lines, setLines] = useState<TranscriptSegment[]>([]);
  const [partial, setPartial] = useState<TranscriptSegment | null>(null);
  const [received, setReceived] = useState(0);
  const [transcriptError, setTranscriptError] = useState<TranscriptLoadError | null>(null);
  const [models, setModels] = useState<ModelList | null>(null);
  const [picked, setPicked] = useState<string | null>(storedModel);
  const [busy, setBusy] = useState(false);
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
    void recordingStatus().then((s) => {
      if (!cancelled && ours(s.meetingId)) setCapture(s);
    });
    void loadTranscript(meetingId).then((t) => {
      if (cancelled) return;
      // Lines that arrived by event while loading come after the stored ones.
      setLines((live) => [
        ...t.segments,
        ...live.filter((l) => !t.segments.some((s) => s.startMs === l.startMs)),
      ]);
      setTranscriptError(t.error);
    });
    void listSpeechModels().then((m) => {
      if (!cancelled) setModels(m);
    });
    return () => {
      cancelled = true;
      stopCapture();
      stopSegments();
    };
  }, [meetingId]);

  const available = models?.models ?? [];
  const modelId = available.find((m) => m.id === picked)?.id ?? available[0]?.id ?? null;

  const chooseModel = useCallback((id: string) => {
    setPicked(id);
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, id);
    } catch {
      // The choice still holds for this session.
    }
  }, []);

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

  const start = useCallback(() => run(() => startRecording(meetingId, modelId)), [run, meetingId, modelId]);

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
    await run(() => startRecording(meetingId, modelId));
  }, [meetingId, modelId, run]);

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
    models,
    modelId,
    chooseModel,
    busy,
    confirmAndStart,
    start,
    pause,
    stop,
  };
}
