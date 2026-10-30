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

/** A voice label, `A` to `Z`: a voice the core told apart, not a person. */
export type VoiceLabel = string;

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
  /** The voice of a final line, once known. */
  voice?: VoiceLabel | null;
  /** A final line's number in the meeting's transcript; line choices refer to it. */
  seq?: number;
}

export interface SegmentEvent extends TranscriptSegment {
  meetingId: string;
}

/** The voice of a stored final line (`transcript-voice` event). */
export interface VoiceEvent {
  meetingId: string;
  seq: number;
  voice: VoiceLabel;
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
export const EVENT_VOICE = "transcript-voice";

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

// ---- speakers ---------------------------------------------------------------------------------------
// The UI sees voice labels, people and choices; never an embedding or an engine type.

export interface SpeakerParticipant {
  id: string;
  name: string;
  /** Added in the speakers view; not on the invite. */
  guest?: boolean;
}

/** How a voice's person was found: the name round (confirmed by a person) or picked by hand. */
export type NameSource = "nameRound" | "manual";

/** A person's choice for a voice. `participantId` null: "Unassigned". */
export interface VoiceChoice {
  voice: VoiceLabel;
  participantId: string | null;
  source: NameSource;
  confirmed: boolean;
}

/** A person's choice for one line. `participantId` null: nobody is shown for it. */
export interface LineChoice {
  seq: number;
  participantId: string | null;
}

/** A name-round suggestion. `unsure`: several people, or a person named by two voices. */
export interface Suggestion {
  voice: VoiceLabel;
  candidates: string[];
  unsure: boolean;
}

export interface SpeakerState {
  participants: SpeakerParticipant[];
  voices: VoiceChoice[];
  lines: LineChoice[];
  suggestions: Suggestion[];
}

export type LineTarget = { kind: "person"; participantId: string } | { kind: "nobody" } | { kind: "voice" };

export type GuestNameCode = "empty" | "tooLong" | "duplicate" | "tooMany";

export type SpeakerError =
  | { kind: "invalidName"; code: GuestNameCode }
  | {
      kind:
        | "noMeeting"
        | "invalidVoice"
        | "unknownVoice"
        | "unknownParticipant"
        | "unknownLine"
        | "locked"
        | "storageFailed"
        | "transcriptUnreadable"
        | "unknown";
    };

export interface SpeakerModel {
  id: string;
  name: string;
  sizeBytes: number;
  source: ModelSource;
  folder: string;
}

export interface SpeakerModelList {
  /** Preferred (smallest) first; the core uses the first. */
  models: SpeakerModel[];
  searched: string[];
}

function speakerError(e: unknown): SpeakerError {
  const err = e as { kind?: unknown; code?: unknown } | undefined;
  if (err?.kind === "invalidName" && typeof err.code === "string") return err as SpeakerError;
  if (typeof err?.kind === "string" && err.kind !== "invalidName") return { kind: err.kind } as SpeakerError;
  return { kind: "unknown" };
}

async function speakerCommand<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw speakerError(e);
  }
}

/** The people, choices and name-round suggestions of a meeting. Rejects with a {@link SpeakerError}. */
export function loadSpeakers(meetingId: string): Promise<SpeakerState> {
  return speakerCommand("load_speakers", { meetingId });
}

/** Sets the person for a voice (null: "Unassigned"). */
export function chooseVoice(
  meetingId: string,
  voice: VoiceLabel,
  participantId: string | null,
): Promise<SpeakerState> {
  return speakerCommand("choose_voice", { meetingId, voice, participantId });
}

/** Sets who said one line, or lets it follow its voice again. */
export function chooseLine(meetingId: string, seq: number, target: LineTarget): Promise<SpeakerState> {
  return speakerCommand("choose_line", { meetingId, seq, target });
}

/** Adds a guest; resolves with the guest's id and the new state. */
export function addGuest(
  meetingId: string,
  name: string,
): Promise<{ participantId: string; state: SpeakerState }> {
  return speakerCommand("add_guest", { meetingId, name });
}

/** "Apply names to transcript": confirms every unique name-round suggestion. */
export function applyNameRound(meetingId: string): Promise<SpeakerState> {
  return speakerCommand("apply_name_round", { meetingId });
}

export async function listSpeakerModels(): Promise<SpeakerModelList> {
  try {
    return await invoke<SpeakerModelList>("list_speaker_models");
  } catch {
    return { models: [], searched: [] };
  }
}

/** Calls `onVoice` when the voice of a stored line is known. Returns the function that stops listening. */
export function onTranscriptVoice(onVoice: (v: VoiceEvent) => void): () => void {
  return subscribe<VoiceEvent>(EVENT_VOICE, onVoice);
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
