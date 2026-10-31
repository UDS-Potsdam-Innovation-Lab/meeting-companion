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
  | "chosenMicrophoneMissing"
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
export const EVENT_SETTINGS = "settings-changed";
export const EVENT_MIC_TEST = "mic-test";
export const EVENT_SWITCHED = "microphone-switched";
/** The input level for the sound wave, 25 per second while audio arrives (job 007). */
export const EVENT_LEVEL = "capture-level";
/** The phone web view opened or closed, and why (job 012). */
export const EVENT_PHONE_VIEW = "phone-view-state";

/**
 * One level reading from the capture side: numbers only, never audio. `meetingId` is null for the
 * microphone test. The last event before capture stops has level 0.
 */
export interface LevelEvent {
  meetingId: string | null;
  /** Scaled RMS, 0..1 (the same scale as `CaptureState.level`). */
  level: number;
  /** Highest absolute sample of the block, 0..1. */
  peak: number;
}

/**
 * Calls `onLevel` for every level event. Meant for refs and animation frames, never React state:
 * 25 events a second must not re-render a view. Returns the function that stops listening.
 */
export function onCaptureLevel(onLevel: (e: LevelEvent) => void): () => void {
  return subscribe<LevelEvent>(EVENT_LEVEL, onLevel);
}

/** The chosen microphone was lost and recording carries on with the system default. */
export interface SwitchedEvent {
  meetingId: string;
  /** Wall-clock time of the switch, ms since epoch. */
  at: number;
  elapsedMs: number;
}

export function onMicrophoneSwitched(handler: (e: SwitchedEvent) => void): () => void {
  return subscribe<SwitchedEvent>(EVENT_SWITCHED, handler);
}

// ---- settings ------------------------------------------------------------------------------------
// Stored by the core, encrypted, in one file. The UI caches only locale and theme (first paint).

export type DeviceLost = "stop" | "switchToDefault";
export type MeetingLanguage = "auto" | "de" | "en";
export type ThemeSetting = "light" | "dark" | "system";
export type LocaleSetting = "de" | "en";

export interface Settings {
  /** `null`: the system default. */
  inputDevice: string | null;
  deviceLost: DeviceLost;
  /** `null`: the preferred model of the core's scan. */
  speechModel: string | null;
  /** `null`: the preferred speaker model of the core's scan. */
  speakerModel: string | null;
  meetingLanguage: MeetingLanguage;
  locale: LocaleSetting;
  theme: ThemeSetting;
}

export const DEFAULT_SETTINGS: Settings = {
  inputDevice: null,
  deviceLost: "stop",
  speechModel: null,
  speakerModel: null,
  meetingLanguage: "auto",
  locale: "de",
  theme: "system",
};

export type SettingChange =
  | { key: "inputDevice"; value: string | null }
  | { key: "deviceLost"; value: DeviceLost }
  | { key: "speechModel"; value: string | null }
  | { key: "speakerModel"; value: string | null }
  | { key: "meetingLanguage"; value: MeetingLanguage }
  | { key: "locale"; value: LocaleSetting }
  | { key: "theme"; value: ThemeSetting };

/** `stored`: read from the file. Otherwise the defaults (plus the UI's cached locale and theme). */
export type SettingsStatus = "stored" | "missing" | "corrupt" | "unreadable" | "locked";

export interface SettingsLoad {
  settings: Settings;
  status: SettingsStatus;
  /** Where meetings and transcripts are stored (read-only). */
  storageFolder: string;
}

/** Values the UI cached before the store existed, taken over once when no settings file is readable. */
export interface CachedSettings {
  locale?: string | null;
  theme?: string | null;
  speechModel?: string | null;
}

export interface SettingsUpdate {
  settings: Settings;
  /** False: the change holds for this session only (no data key, disk error). */
  saved: boolean;
}

export type MicTestKind = "off" | "running" | "error";

export interface MicTestState {
  state: MicTestKind;
  remainingMs: number;
  level: number;
  reason: RecordReason | null;
}

export const MIC_TEST_OFF: MicTestState = { state: "off", remainingMs: 0, level: 0, reason: null };

export type MicTestError = { kind: "busy" } | { kind: "failed"; reason: RecordReason };

export async function loadSettings(cached: CachedSettings): Promise<SettingsLoad | null> {
  try {
    return await invoke<SettingsLoad>("load_settings", { cached });
  } catch {
    return null;
  }
}

/** Sends one change to the core. Rejects if the core refused it. */
export async function updateSetting(change: SettingChange): Promise<SettingsUpdate> {
  return invoke<SettingsUpdate>("update_setting", { change });
}

export async function listInputDevices(): Promise<string[]> {
  try {
    return await invoke<string[]>("list_input_devices");
  } catch {
    return [];
  }
}

/** Opens the chosen microphone for at most 10 s; rejects with a {@link MicTestError}. */
export async function startMicTest(): Promise<MicTestState> {
  try {
    return await invoke<MicTestState>("start_mic_test");
  } catch (e) {
    const err = e as Partial<MicTestError> | undefined;
    if (err?.kind === "busy") throw { kind: "busy" } satisfies MicTestError;
    const reason = (err as { reason?: RecordReason } | undefined)?.reason;
    throw { kind: "failed", reason: reason ?? "microphoneBlocked" } satisfies MicTestError;
  }
}

export async function stopMicTest(): Promise<void> {
  try {
    await invoke("stop_mic_test");
  } catch {
    // Nothing to stop.
  }
}

export function onSettingsChanged(handler: (s: Settings) => void): () => void {
  return subscribe<Settings>(EVENT_SETTINGS, handler);
}

export function onMicTest(handler: (s: MicTestState) => void): () => void {
  return subscribe<MicTestState>(EVENT_MIC_TEST, handler);
}

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

/**
 * Starts or resumes recording with the microphone, speech model and language from the settings (the
 * core reads them itself). Rejects with a {@link RecordError}, e.g. without stored consent.
 */
export async function startRecording(meetingId: string): Promise<CaptureState> {
  try {
    return await invoke<CaptureState>("start_recording", { meetingId });
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

// ---- phone web view (job 012) ---------------------------------------------------------------------
// A consumer (voice profiles, team review) opens the view during a recording and shows the QR code. The
// URL holds the access token: show it only as the QR code and the short address, never store or log it.

export type PhoneViewErrorKey =
  "phoneView.error.notRecording" | "phoneView.error.noLocalNetwork" | "phoneView.error.failed";

export interface PhoneViewOpened {
  /** `http://<ip>:<port>/#t=<token>`. */
  url: string;
  /** The QR code of `url` as SVG markup from the core (no script, no external reference). */
  qrSvg: string;
}

export type PhoneViewCloseReason = "requested" | "recordingStopped" | "meetingEnded" | "appExit";

/** The `phone-view-state` event. */
export interface PhoneViewState {
  state: "open" | "closed";
  meetingId: string | null;
  /** Set when closed. */
  reason: PhoneViewCloseReason | null;
}

const PHONE_VIEW_ERRORS: readonly string[] = [
  "phoneView.error.notRecording",
  "phoneView.error.noLocalNetwork",
  "phoneView.error.failed",
];

/** Opens the phone view for a recording meeting. Rejects with `{ key }`, a translation key. */
export async function phoneViewOpen(meetingId: string): Promise<PhoneViewOpened> {
  try {
    return await invoke<PhoneViewOpened>("phone_view_open", { meetingId });
  } catch (e) {
    const key = (e as { key?: unknown } | undefined)?.key;
    throw {
      key: typeof key === "string" && PHONE_VIEW_ERRORS.includes(key) ? key : "phoneView.error.failed",
    } as { key: PhoneViewErrorKey };
  }
}

/** Closes the phone view (nothing happens if it is closed). */
export async function phoneViewClose(): Promise<void> {
  try {
    await invoke("phone_view_close");
  } catch {
    // The core closes the view on its own when recording stops; nothing to undo here.
  }
}

/** Calls `handler` whenever the phone view opens or closes. Returns the function that stops listening. */
export function onPhoneViewState(handler: (s: PhoneViewState) => void): () => void {
  return subscribe<PhoneViewState>(EVENT_PHONE_VIEW, handler);
}
