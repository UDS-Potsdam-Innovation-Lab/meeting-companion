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
  EVENT_CAPTURE,
  EVENT_SEGMENT,
  type CaptureState,
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
  | "live-no-model";

const SEEDS: Partial<Record<Fixture, () => Meeting>> = {
  filled: filledMeeting,
  over: overBudgetMeeting,
  live: liveMeeting,
  "live-done": liveDoneMeeting,
  "live-transcript": liveConsentedMeeting,
  "live-paused": liveConsentedMeeting,
  "live-mic-error": liveConsentedMeeting,
  "live-no-model": liveMeeting,
};

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
  for (const k of [CORRUPT_KEY, LOCKED_KEY, AUDIO_KEY, MODELS_KEY]) localStorage.removeItem(k);
  const make = SEEDS[fixture];
  const meetings: Meeting[] = make ? [make()] : [];
  localStorage.setItem(KEY, JSON.stringify(meetings));
  localStorage.setItem(TRANSCRIPTS_KEY, "{}");
  if (fixture === "corrupt") localStorage.setItem(CORRUPT_KEY, "1");
  if (fixture === "locked") localStorage.setItem(LOCKED_KEY, "1");
  if (fixture === "live-no-model") localStorage.setItem(MODELS_KEY, "none");
  const id = meetings[0]?.id ?? null;
  if (fixture === "live-transcript" || fixture === "live-paused" || fixture === "live-mic-error") {
    setTranscript(id!, LIVE_TRANSCRIPT);
  }
  // Fixed states for screenshots: the script does not run, so nothing moves.
  if (fixture === "live-transcript") {
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
          return localStorage.getItem(MODELS_KEY) === "none" ? { models: [], searched: SEARCHED } : MODELS;
        default:
          throw new Error(`mock backend: unknown command ${cmd}`);
      }
    },
    { shouldMockEvents: true },
  );
}
