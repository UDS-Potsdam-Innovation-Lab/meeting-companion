// A stand-in for the Tauri core, used only by the browser build for Playwright and screenshots
// (`vite build --mode e2e`). It keeps meetings and transcripts in localStorage so a page reload acts
// like a restart; the recording state lives in memory, so after a reload recording is off, as after
// an app restart. While "recording" it emits scripted segments (German and English) as events.
import { mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import {
  filledMeeting,
  LIVE_ELAPSED_MS,
  LIVE_PARTIAL,
  LIVE_TRANSCRIPT,
  liveConsentedMeeting,
  liveDoneMeeting,
  liveMeeting,
  overBudgetMeeting,
} from "../features/agenda/fixtures";
import { isMeetingValid, type Meeting } from "../features/agenda/model";
import {
  CAPTURE_OFF,
  DEFAULT_SETTINGS,
  EVENT_CAPTURE,
  EVENT_MIC_TEST,
  EVENT_SEGMENT,
  EVENT_SETTINGS,
  MIC_TEST_OFF,
  type CachedSettings,
  type CaptureState,
  type MicTestState,
  type SettingChange,
  type Settings,
  type SettingsLoad,
  type LoadResult,
  type ModelList,
  type RecordReason,
  type SegmentEvent,
  type TranscriptLoad,
  type TranscriptSegment,
} from "./ipc";

const KEY = "mock-backend.meetings";
const TRANSCRIPTS_KEY = "mock-backend.transcripts";
const CORRUPT_KEY = "mock-backend.corrupt";
const LOCKED_KEY = "mock-backend.locked";
/** `noMicrophone` or `microphoneBlocked`: starting recording fails with that reason. */
const AUDIO_KEY = "mock-backend.audio";
/** `none`: no speech model is found. */
const MODELS_KEY = "mock-backend.models";
/** The "settings file" of the fake core; survives a reload like the real one. */
const SETTINGS_KEY = "mock-backend.settings";
/** `fixed`: the microphone test shows a still state (screenshots). */
const MIC_TEST_KEY = "mock-backend.mic-test";

type Fixture =
  | "empty"
  | "filled"
  | "over"
  | "corrupt"
  | "locked"
  | "live"
  | "live-done"
  | "live-transcript"
  | "live-paused"
  | "live-mic-error"
  | "live-no-model"
  | "settings"
  | "settings-no-model"
  | "settings-mic-test"
  | "settings-recording"
  | "settings-dark"
  | "settings-missing"
  | "live-mic-missing";

const SEEDS: Partial<Record<Fixture, () => Meeting>> = {
  filled: filledMeeting,
  over: overBudgetMeeting,
  live: liveMeeting,
  "live-done": liveDoneMeeting,
  "live-transcript": liveConsentedMeeting,
  "live-paused": liveConsentedMeeting,
  "live-mic-error": liveConsentedMeeting,
  "live-no-model": liveMeeting,
  settings: filledMeeting,
  "settings-no-model": filledMeeting,
  "settings-mic-test": filledMeeting,
  "settings-recording": liveConsentedMeeting,
  "settings-dark": liveConsentedMeeting,
  "settings-missing": filledMeeting,
  "live-mic-missing": liveConsentedMeeting,
};

/** Input devices of the fake core: the system default is not one of them. */
const DEVICES = ["Built-in Audio Analog Stereo", "Jabra Speak 510", "Logitech BRIO"];
const STORAGE_FOLDER = "/home/user/.local/share/de.udspotsdam.meetingcompanion/meetings";

const MODELS: ModelList = {
  models: [
    {
      id: "/home/user/.local/share/voxtype/models/ggml-base.bin",
      name: "ggml-base.bin",
      sizeBytes: 147_951_465,
      source: "voxtype",
      multilingual: true,
      folder: "/home/user/.local/share/voxtype/models",
    },
    {
      id: "/home/user/.cache/huggingface/hub/models--ggerganov--whisper.cpp/blobs/1f2e",
      name: "ggml-small.bin",
      sizeBytes: 487_601_967,
      source: "huggingFace",
      multilingual: true,
      folder: "/home/user/.cache/huggingface/hub/models--ggerganov--whisper.cpp/snapshots/5359861",
    },
    {
      id: "/home/user/.local/share/voxtype/models/ggml-base.en.bin",
      name: "ggml-base.en.bin",
      sizeBytes: 147_964_211,
      source: "voxtype",
      multilingual: false,
      folder: "/home/user/.local/share/voxtype/models",
    },
  ],
  searched: [],
};

const SEARCHED = [
  "/home/user/.local/share/de.udspotsdam.meetingcompanion/models",
  "/home/user/.local/share/voxtype/models",
  "/home/user/whisper.cpp/models",
  "/home/user/.local/share/pywhispercpp/models",
  "/home/user/.cache/huggingface/hub",
];

/** What the scripted "speakers" say while recording in the e2e build. */
const SCRIPT: { text: string; lang: "de" | "en" }[] = [
  { text: "Okay, let's start with the beta launch scope.", lang: "en" },
  { text: "Die Pilotschulen brauchen den Offline-Modus nicht für die Beta.", lang: "de" },
  { text: "Then we can keep the date on the fourteenth.", lang: "en" },
  { text: "Gut, dann informieren wir die dritte Schule diese Woche.", lang: "de" },
];
const STEP_MS = 400;

// ---- recording state (in memory: a reload is a restart) -----------------------------------------
let capture: CaptureState = CAPTURE_OFF;
let timer: ReturnType<typeof setInterval> | null = null;
let step = 0;

function seed(fixture: Fixture) {
  for (const k of [CORRUPT_KEY, LOCKED_KEY, AUDIO_KEY, MODELS_KEY, SETTINGS_KEY, MIC_TEST_KEY]) {
    localStorage.removeItem(k);
  }
  const make = SEEDS[fixture];
  const meetings: Meeting[] = make ? [make()] : [];
  localStorage.setItem(KEY, JSON.stringify(meetings));
  localStorage.setItem(TRANSCRIPTS_KEY, "{}");
  if (fixture === "corrupt") localStorage.setItem(CORRUPT_KEY, "1");
  if (fixture === "locked") localStorage.setItem(LOCKED_KEY, "1");
  if (fixture === "live-no-model" || fixture === "settings-no-model")
    localStorage.setItem(MODELS_KEY, "none");
  if (fixture.startsWith("settings") || fixture === "live-mic-missing") {
    // "Jabra Speak 710" is chosen but not connected.
    const missing = fixture === "settings-missing" || fixture === "live-mic-missing";
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      locale: (localStorage.getItem("meeting-companion.locale") as Settings["locale"]) ?? "en",
      inputDevice: missing ? "Jabra Speak 710" : "Jabra Speak 510",
      theme: fixture === "settings-dark" ? "dark" : "light",
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    localStorage.setItem("meeting-companion.theme", settings.theme);
  }
  if (fixture === "settings-mic-test") localStorage.setItem(MIC_TEST_KEY, "fixed");
  const id = meetings[0]?.id ?? null;
  if (
    fixture === "live-transcript" ||
    fixture === "live-paused" ||
    fixture === "live-mic-error" ||
    fixture === "settings-recording" ||
    fixture === "settings-dark"
  ) {
    setTranscript(id!, LIVE_TRANSCRIPT);
  }
  // Fixed states for screenshots: the script does not run, so nothing moves.
  if (fixture === "live-transcript" || fixture === "settings-recording" || fixture === "settings-dark") {
    capture = { state: "recording", meetingId: id, elapsedMs: LIVE_ELAPSED_MS, level: 0.55, reason: null };
    pendingPartial = { ...LIVE_PARTIAL, meetingId: id! };
  }
  if (fixture === "live-paused") {
    capture = { state: "paused", meetingId: id, elapsedMs: LIVE_ELAPSED_MS, level: 0, reason: null };
  }
  if (fixture === "live-mic-error") {
    localStorage.setItem(AUDIO_KEY, "noMicrophone");
    capture = { state: "error", meetingId: id, elapsedMs: LIVE_ELAPSED_MS, level: 0, reason: "noMicrophone" };
  }
}

/** A partial line a fixture shows once the view listens. */
let pendingPartial: SegmentEvent | null = null;

function all(): Meeting[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Meeting[];
  } catch {
    return [];
  }
}

function transcripts(): Record<string, TranscriptSegment[]> {
  try {
    return JSON.parse(localStorage.getItem(TRANSCRIPTS_KEY) ?? "{}") as Record<string, TranscriptSegment[]>;
  } catch {
    return {};
  }
}

function setTranscript(id: string, segments: TranscriptSegment[]) {
  localStorage.setItem(TRANSCRIPTS_KEY, JSON.stringify({ ...transcripts(), [id]: segments }));
}

function setCapture(next: CaptureState) {
  capture = next;
  void emit(EVENT_CAPTURE, capture);
}

function stopScript() {
  if (timer !== null) clearInterval(timer);
  timer = null;
}

function startScript(meetingId: string) {
  stopScript();
  timer = setInterval(() => {
    const line = SCRIPT[Math.floor(step / 3) % SCRIPT.length]!;
    const phase = step % 3;
    step += 1;
    const recorded = transcripts()[meetingId] ?? [];
    const startMs = capture.elapsedMs;
    const words = line.text.split(" ");
    const segment: TranscriptSegment = {
      startMs,
      endMs: startMs + 2_000,
      at: Date.now(),
      lang: line.lang,
      final: phase === 2,
      text: phase === 2 ? line.text : words.slice(0, Math.ceil((words.length * (phase + 1)) / 3)).join(" "),
    };
    if (segment.final) setTranscript(meetingId, [...recorded, segment]);
    setCapture({ ...capture, elapsedMs: capture.elapsedMs + STEP_MS, level: 0.3 + 0.4 * ((step % 4) / 3) });
    void emit(EVENT_SEGMENT, { ...segment, meetingId } satisfies SegmentEvent);
  }, STEP_MS);
}

// ---- settings and the microphone test ---------------------------------------------------------
/** The settings in effect, like the core's memory: the cached values taken over at load included. */
let current: Settings | null = null;
let testTimer: ReturnType<typeof setInterval> | null = null;

function storedSettings(): Settings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) } : null;
  } catch {
    return null;
  }
}

function modelList(): ModelList {
  return localStorage.getItem(MODELS_KEY) === "none" ? { models: [], searched: SEARCHED } : MODELS;
}

const ENUMS: Partial<Record<SettingChange["key"], readonly string[]>> = {
  deviceLost: ["stop", "switchToDefault"],
  meetingLanguage: ["auto", "de", "en"],
  locale: ["de", "en"],
  theme: ["light", "dark", "system"],
};

/** Like the core: only values in the schema, connected devices and models of the scan. */
function valid(change: SettingChange): boolean {
  const { key, value } = change;
  if (key === "inputDevice") return value === null || DEVICES.includes(value);
  if (key === "speechModel") return value === null || modelList().models.some((m) => m.id === value);
  return ENUMS[key]?.includes(value as string) ?? false;
}

function emitTest(state: MicTestState) {
  void emit(EVENT_MIC_TEST, state);
}

function stopTest() {
  if (testTimer !== null) clearInterval(testTimer);
  testTimer = null;
}

function startTest(): MicTestState {
  stopTest();
  if (localStorage.getItem(MIC_TEST_KEY) === "fixed") {
    const fixed: MicTestState = { state: "running", remainingMs: 6_400, level: 0.6, reason: null };
    setTimeout(() => emitTest(fixed), 0);
    return fixed;
  }
  const started = Date.now();
  testTimer = setInterval(() => {
    const remainingMs = Math.max(0, 10_000 - (Date.now() - started));
    if (remainingMs === 0) {
      stopTest();
      emitTest(MIC_TEST_OFF);
      return;
    }
    emitTest({
      state: "running",
      remainingMs,
      level: 0.3 + 0.4 * Math.abs(Math.sin(remainingMs / 300)),
      reason: null,
    });
  }, 150);
  return { state: "running", remainingMs: 10_000, level: 0, reason: null };
}

function fail(meetingId: string, reason: RecordReason): never {
  setCapture({ ...capture, state: "error", meetingId, level: 0, reason });
  throw { kind: "failed", reason };
}

export function installMockBackend() {
  const url = new URL(window.location.href);
  const fixture = url.searchParams.get("fixture") as Fixture | null;
  if (fixture) {
    seed(fixture);
    url.searchParams.delete("fixture");
    window.history.replaceState(null, "", url);
  }

  mockIPC(
    (cmd, args) => {
      const a = (args ?? {}) as Record<string, unknown>;
      switch (cmd) {
        case "load_latest_meeting": {
          if (localStorage.getItem(LOCKED_KEY)) {
            return { meeting: null, error: "keyUnavailable" } satisfies LoadResult;
          }
          if (localStorage.getItem(CORRUPT_KEY)) {
            localStorage.removeItem(CORRUPT_KEY);
            return { meeting: null, error: "corrupt" } satisfies LoadResult;
          }
          const list = all();
          return { meeting: list[list.length - 1] ?? null, error: null } satisfies LoadResult;
        }
        case "save_meeting": {
          if (localStorage.getItem(LOCKED_KEY)) throw { kind: "locked" };
          const meeting = a.meeting as Meeting;
          if (!isMeetingValid(meeting)) throw { kind: "invalid", fields: [] };
          const now = Date.now();
          const previous = all().find((m) => m.id === meeting.id);
          const list = all().filter((m) => m.id !== meeting.id);
          // Like the core: consent is kept from the store, never taken from the UI.
          list.push({ ...meeting, updatedAt: now, recordingConsentAt: previous?.recordingConsentAt ?? null });
          localStorage.setItem(KEY, JSON.stringify(list));
          if (meeting.run?.endedAt && capture.meetingId === meeting.id) {
            stopScript();
            setCapture(CAPTURE_OFF);
          }
          return now;
        }
        case "view_ready":
          return null;
        case "confirm_recording_consent": {
          const id = a.meetingId as string;
          const list = all();
          const m = list.find((x) => x.id === id);
          if (!m) throw { kind: "noMeeting" };
          if (!m.run || m.run.endedAt) throw { kind: "notRunning" };
          m.recordingConsentAt ??= Date.now();
          localStorage.setItem(KEY, JSON.stringify(list));
          return m.recordingConsentAt;
        }
        case "start_recording": {
          const id = a.meetingId as string;
          const m = all().find((x) => x.id === id);
          if (!m) throw { kind: "noMeeting" };
          if (!m.run || m.run.endedAt) throw { kind: "notRunning" };
          if (!m.recordingConsentAt) throw { kind: "noConsent" };
          if (capture.state === "recording" && capture.meetingId === id) return capture;
          stopTest();
          const device = storedSettings()?.inputDevice ?? null;
          if (device !== null && !DEVICES.includes(device)) fail(id, "chosenMicrophoneMissing");
          if (localStorage.getItem(MODELS_KEY) === "none") fail(id, "noModel");
          const audio = localStorage.getItem(AUDIO_KEY) as RecordReason | null;
          if (audio) fail(id, audio);
          const recorded = transcripts()[id] ?? [];
          const base = capture.meetingId === id ? capture.elapsedMs : (recorded.at(-1)?.endMs ?? 0);
          setCapture({ state: "recording", meetingId: id, elapsedMs: base, level: 0, reason: null });
          startScript(id);
          return capture;
        }
        case "pause_recording":
          if (capture.state !== "recording") return capture;
          stopScript();
          setCapture({ ...capture, state: "paused", level: 0 });
          return capture;
        case "stop_recording":
          stopScript();
          setCapture(CAPTURE_OFF);
          return capture;
        case "recording_status": {
          // A fixture's partial line arrives once the view listens.
          const partial = pendingPartial;
          pendingPartial = null;
          if (partial) setTimeout(() => void emit(EVENT_SEGMENT, partial), 0);
          return capture;
        }
        case "load_transcript":
          return {
            segments: transcripts()[a.meetingId as string] ?? [],
            error: null,
          } satisfies TranscriptLoad;
        case "list_speech_models":
          return modelList();
        case "load_settings": {
          const stored = storedSettings();
          if (stored) {
            return {
              settings: stored,
              status: "stored",
              storageFolder: STORAGE_FOLDER,
            } satisfies SettingsLoad;
          }
          // No "file" yet: take over the UI's cached locale and theme, as the core does.
          const cached = (a.cached ?? {}) as CachedSettings;
          const settings = { ...DEFAULT_SETTINGS };
          for (const key of ["locale", "theme"] as const) {
            const value = cached[key];
            if (value && valid({ key, value } as SettingChange))
              (settings as Record<string, unknown>)[key] = value;
          }
          current = settings;
          return { settings, status: "missing", storageFolder: STORAGE_FOLDER } satisfies SettingsLoad;
        }
        case "update_setting": {
          const change = a.change as SettingChange;
          if (!valid(change)) throw { kind: "invalid", key: change.key };
          const settings = {
            ...(storedSettings() ?? current ?? DEFAULT_SETTINGS),
            [change.key]: change.value,
          } as Settings;
          current = settings;
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
          void emit(EVENT_SETTINGS, settings);
          return { settings, saved: true };
        }
        case "list_input_devices":
          return DEVICES;
        case "start_mic_test": {
          if (capture.state === "recording" || capture.state === "paused") throw { kind: "busy" };
          const device = storedSettings()?.inputDevice ?? null;
          if (device !== null && !DEVICES.includes(device)) {
            throw { kind: "failed", reason: "chosenMicrophoneMissing" };
          }
          return startTest();
        }
        case "stop_mic_test":
          stopTest();
          emitTest(MIC_TEST_OFF);
          return null;
        default:
          throw new Error(`mock backend: unknown command ${cmd}`);
      }
    },
    { shouldMockEvents: true },
  );
}
