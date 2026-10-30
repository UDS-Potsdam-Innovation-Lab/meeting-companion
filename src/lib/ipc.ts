// The only module that talks to the Tauri core. Everything else imports from here.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Meeting } from "../features/agenda/model";

/** `keyUnavailable`: the data key is not in the OS keychain; nothing can be read or saved. */
export type LoadError = "corrupt" | "unreadable" | "keyUnavailable";

export interface LoadResult {
  meeting: Meeting | null;
  error: LoadError | null;
}

export type SaveError =
  | { kind: "invalid"; fields: { field: string; code: string }[] }
  | { kind: "io" }
  | { kind: "locked" }
  | { kind: "unknown" };

/** The most recently edited meeting, or why it could not be read. */
export async function loadLatestMeeting(): Promise<LoadResult> {
  try {
    return await invoke<LoadResult>("load_latest_meeting");
  } catch {
    return { meeting: null, error: "unreadable" };
  }
}

/** Saves the meeting on this device. Resolves with the save time; rejects with a {@link SaveError}. */
export async function saveMeeting(meeting: Meeting): Promise<number> {
  try {
    return await invoke<number>("save_meeting", { meeting });
  } catch (e) {
    const err = e as Partial<SaveError> | undefined;
    throw err && (err.kind === "invalid" || err.kind === "io" || err.kind === "locked")
      ? err
      : { kind: "unknown" };
  }
}

/** Tells the core a view finished rendering (used by the smoke run of the built app). */
export async function viewReady(view: string): Promise<void> {
  try {
    await invoke("view_ready", { view });
  } catch {
    // Not fatal for the app.
  }
}

// ---- recording and transcript ---------------------------------------------------------------------
// The core runs microphone and speech-to-text; the UI only sees capture states and segments. No engine
// type crosses this boundary.

export type CaptureKind = "off" | "recording" | "paused" | "error";

export type RecordReason =
  | "noMicrophone"
  | "microphoneBlocked"
  | "microphoneLost"
  | "noModel"
  | "engineFailed"
  | "storageFailed"
  | "transcriptUnreadable"
  | "locked";

/** The recording indicator's state, from the `capture-state` event and the recording commands. */
export interface CaptureState {
  state: CaptureKind;
  meetingId: string | null;
  /** Recorded time of the meeting; paused time does not count. */
  elapsedMs: number;
  /** Input level 0..1 while recording. */
  level: number;
  reason: RecordReason | null;
}

export const CAPTURE_OFF: CaptureState = {
  state: "off",
  meetingId: null,
  elapsedMs: 0,
  level: 0,
  reason: null,
};

export type Lang = "de" | "en";

/** One transcript line. The text is untrusted and rendered as text only. */
export interface TranscriptSegment {
  /** Offsets in recorded time, ms. */
  startMs: number;
  endMs: number;
  /** Wall-clock start, ms since epoch. */
  at: number;
  text: string;
  lang: Lang;
  /** False for the running preview of what is being said. */
  final: boolean;
}

export interface SegmentEvent extends TranscriptSegment {
  meetingId: string;
}

export type RecordError =
  | { kind: "noConsent" }
  | { kind: "notRunning" }
  | { kind: "noMeeting" }
  | { kind: "failed"; reason: RecordReason };

export type TranscriptLoadError = "corrupt" | "keyUnavailable" | "unreadable";

export interface TranscriptLoad {
  segments: TranscriptSegment[];
  error: TranscriptLoadError | null;
}

export type ModelSource =
  "app" | "voxtype" | "whisperCpp" | "pywhispercpp" | "buzz" | "macWhisper" | "huggingFace" | "test";

/** A speech model the core found on this device. */
export interface SpeechModel {
  id: string;
  name: string;
  sizeBytes: number;
  source: ModelSource;
  multilingual: boolean;
  folder: string;
}

export interface ModelList {
  /** Preferred first. */
  models: SpeechModel[];
  /** Every folder searched. */
  searched: string[];
}

export const EVENT_CAPTURE = "capture-state";
export const EVENT_SEGMENT = "transcript-segment";

function recordError(e: unknown): RecordError {
  const err = e as Partial<RecordError> | undefined;
  if (err && (err.kind === "noConsent" || err.kind === "notRunning" || err.kind === "noMeeting")) {
    return { kind: err.kind };
  }
  if (err && err.kind === "failed" && typeof (err as { reason?: unknown }).reason === "string") {
    return err as RecordError;
  }
  return { kind: "failed", reason: "engineFailed" };
}

/** Stores that everyone was informed. Resolves with the stored time; rejects with a {@link RecordError}. */
export async function confirmRecordingConsent(meetingId: string): Promise<number> {
  try {
    return await invoke<number>("confirm_recording_consent", { meetingId });
  } catch (e) {
    throw recordError(e);
  }
}

/** Starts or resumes recording. Rejects with a {@link RecordError}, e.g. without stored consent. */
export async function startRecording(meetingId: string, modelId: string | null): Promise<CaptureState> {
  try {
    return await invoke<CaptureState>("start_recording", { meetingId, modelId });
  } catch (e) {
    throw recordError(e);
  }
}

export async function pauseRecording(): Promise<CaptureState> {
  return invoke<CaptureState>("pause_recording");
}

export async function stopRecording(): Promise<CaptureState> {
  try {
    return await invoke<CaptureState>("stop_recording");
  } catch {
    return CAPTURE_OFF;
  }
}

export async function recordingStatus(): Promise<CaptureState> {
  try {
    return await invoke<CaptureState>("recording_status");
  } catch {
    return CAPTURE_OFF;
  }
}

export async function loadTranscript(meetingId: string): Promise<TranscriptLoad> {
  try {
    return await invoke<TranscriptLoad>("load_transcript", { meetingId });
  } catch {
    return { segments: [], error: "unreadable" };
  }
}

export async function listSpeechModels(): Promise<ModelList> {
  try {
    return await invoke<ModelList>("list_speech_models");
  } catch {
    return { models: [], searched: [] };
  }
}

/** Calls `onState` for every capture state the core sends. Returns the function that stops listening. */
export function onCaptureState(onState: (s: CaptureState) => void): () => void {
  return subscribe<CaptureState>(EVENT_CAPTURE, onState);
}

/** Calls `onSegment` for every partial and final segment. Returns the function that stops listening. */
export function onTranscriptSegment(onSegment: (s: SegmentEvent) => void): () => void {
  return subscribe<SegmentEvent>(EVENT_SEGMENT, onSegment);
}

function subscribe<T>(event: string, handler: (payload: T) => void): () => void {
  let stopped = false;
  let unlisten: (() => void) | null = null;
  listen<T>(event, (e) => {
    if (!stopped) handler(e.payload);
  }).then(
    (u) => {
      if (stopped) u();
      else unlisten = u;
    },
    () => {
      // No event channel (e.g. a test without one): nothing to stop.
    },
  );
  return () => {
    stopped = true;
    unlisten?.();
  };
}
