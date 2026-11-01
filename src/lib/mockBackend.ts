// A stand-in for the Tauri core, used only by the browser build for Playwright and screenshots
// (`vite build --mode e2e`). It keeps meetings and transcripts in localStorage so a page reload acts
// like a restart; the recording state lives in memory, so after a reload recording is off, as after
// an app restart. While "recording" it emits scripted segments (German and English) as events.
import { mockIPC } from "@tauri-apps/api/mocks";
import phoneQrSvg from "./fixtures/phone-qr.svg?raw";
import { emit } from "@tauri-apps/api/event";
import {
  filledMeeting,
  freeSetupMeeting,
  liveFreeEmptyMeeting,
  liveFreeMeeting,
  LIVE_ELAPSED_MS,
  LIVE_PARTIAL,
  LIVE_SPEAKER_CHOICES,
  LIVE_TRANSCRIPT,
  liveConsentedMeeting,
  liveDoneMeeting,
  liveMeeting,
  overBudgetMeeting,
  SPEAKER_CHOICES,
  SPEAKER_TRANSCRIPT,
} from "../features/agenda/fixtures";
import { isMeetingValid, type Meeting } from "../features/agenda/model";
import {
  CAPTURE_OFF,
  DEFAULT_SETTINGS,
  EVENT_CAPTURE,
  EVENT_LEVEL,
  EVENT_MIC_TEST,
  EVENT_PHONE_VIEW,
  EVENT_SEGMENT,
  EVENT_SETTINGS,
  EVENT_SWITCHED,
  EVENT_VOICE,
  MIC_TEST_OFF,
  type CachedSettings,
  type CaptureState,
  type LevelEvent,
  type LineChoice,
  type LineTarget,
  type MicTestState,
  type PhoneViewCloseReason,
  type PhoneViewOpened,
  type PhoneViewState,
  type SettingChange,
  type Settings,
  type SettingsLoad,
  type SwitchedEvent,
  type LoadResult,
  type ModelList,
  type RecordReason,
  type SegmentEvent,
  type SpeakerModelList,
  type SpeakerParticipant,
  type SpeakerState,
  type Suggestion,
  type TranscriptLoad,
  type TranscriptSegment,
  type VoiceChoice,
  type VoiceEvent,
  type LlmModelList,
  type LlmTestReply,
} from "./ipc";

const KEY = "mock-backend.meetings";
const TRANSCRIPTS_KEY = "mock-backend.transcripts";
const CORRUPT_KEY = "mock-backend.corrupt";
const LOCKED_KEY = "mock-backend.locked";
/** `noMicrophone` or `microphoneBlocked`: starting recording fails with that reason. */
const AUDIO_KEY = "mock-backend.audio";
/** `none`: no speech model is found. */
const MODELS_KEY = "mock-backend.models";
/** `none`: no speaker model is found (recording runs without voices). */
const SPEAKER_MODELS_KEY = "mock-backend.speakerModels";
/** The "settings file" of the fake core; survives a reload like the real one. */
const SETTINGS_KEY = "mock-backend.settings";
/** `fixed`: the microphone test shows a still state (screenshots). */
const MIC_TEST_KEY = "mock-backend.mic-test";
/** Milliseconds `stop_recording` takes to answer (a core whose engine is slow to stop). */
export const STOP_DELAY_KEY = "mock-backend.stop-delay-ms";
/** `none`: no GGUF language model is found. */
const LLM_MODELS_KEY = "mock-backend.llmModels";
/** `set`: an API key is in the fake keychain. The key itself is never kept, not even here. */
const API_KEY_KEY = "mock-backend.apiKey";
/** How the fake engine answers the Test: `reply` (default), `slow` (until cancelled) or an error kind. */
const LLM_TEST_KEY = "mock-backend.llmTest";
/** The level the fake microphone delivers: `speech` (default), `silence` or `none` (no events). */
const LEVEL_KEY = "mock-backend.level";
/** `none`: `phone_view_open` finds no local network. */
export const PHONE_NETWORK_KEY = "mock-backend.phone-network";
/** The phone view's fixed URL and QR code (the core's rendering of this URL; job 012). */
export const MOCK_PHONE_VIEW: PhoneViewOpened = {
  url: "http://192.168.178.20:49152/#t=FAKE-TOKEN-for-tests-only",
  qrSvg: phoneQrSvg.trim(),
};

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
  | "speakers"
  | "speakers-empty"
  | "speakers-no-model"
  | "live-speakers"
  | "settings"
  | "settings-no-model"
  | "settings-mic-test"
  | "settings-recording"
  | "settings-dark"
  | "settings-missing"
  | "settings-llm-off"
  | "settings-llm-local"
  | "settings-llm-none-found"
  | "settings-llm-claude"
  | "settings-llm-claude-nokey"
  | "settings-llm-error"
  | "settings-llm-local-failed"
  | "live-mic-missing"
  | "live-switched"
  | "free"
  | "live-free-empty"
  | "live-free"
  | "live-level-speech"
  | "live-level-silence"
  | "live-no-signal";

const SEEDS: Partial<Record<Fixture, () => Meeting>> = {
  filled: filledMeeting,
  over: overBudgetMeeting,
  live: liveMeeting,
  "live-done": liveDoneMeeting,
  "live-transcript": liveConsentedMeeting,
  "live-paused": liveConsentedMeeting,
  "live-mic-error": liveConsentedMeeting,
  "live-no-model": liveMeeting,
  speakers: liveConsentedMeeting,
  "speakers-empty": liveConsentedMeeting,
  "speakers-no-model": liveConsentedMeeting,
  "live-speakers": liveConsentedMeeting,
  settings: filledMeeting,
  "settings-no-model": filledMeeting,
  "settings-mic-test": filledMeeting,
  "settings-recording": liveConsentedMeeting,
  "settings-dark": liveConsentedMeeting,
  "settings-missing": filledMeeting,
  "settings-llm-off": filledMeeting,
  "settings-llm-local": filledMeeting,
  "settings-llm-none-found": filledMeeting,
  "settings-llm-claude": filledMeeting,
  "settings-llm-claude-nokey": filledMeeting,
  "settings-llm-error": filledMeeting,
  "settings-llm-local-failed": filledMeeting,
  "live-mic-missing": liveConsentedMeeting,
  "live-switched": liveConsentedMeeting,
  free: freeSetupMeeting,
  "live-free-empty": liveFreeEmptyMeeting,
  "live-free": liveFreeMeeting,
  "live-level-speech": liveConsentedMeeting,
  "live-level-silence": liveConsentedMeeting,
  "live-no-signal": liveConsentedMeeting,
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

const SPEAKER_MODELS: SpeakerModelList = {
  models: [
    {
      id: "/home/user/.local/share/de.udspotsdam.meetingcompanion/models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
      name: "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
      sizeBytes: 28_281_164,
      source: "app",
      folder: "/home/user/.local/share/de.udspotsdam.meetingcompanion/models",
    },
  ],
  searched: [],
};

const SPEAKER_SEARCHED = [
  "/home/user/.local/share/de.udspotsdam.meetingcompanion/models",
  "/home/user/.cache/huggingface/hub",
];

const LLM_FOLDER = "/home/user/.local/share/de.udspotsdam.meetingcompanion/models";
const HF_FOLDER = "/home/user/.cache/huggingface/hub";
const LLM_MODELS: LlmModelList = {
  models: [
    {
      id: `${HF_FOLDER}/models--Qwen--Qwen2.5-3B-Instruct-GGUF/snapshots/1/Qwen2.5-3B-Instruct-Q4_K_M.gguf`,
      name: "Qwen2.5-3B-Instruct-Q4_K_M.gguf",
      sizeBytes: 1_986_000_000,
      source: "huggingFace",
      folder: HF_FOLDER,
    },
    {
      id: `${LLM_FOLDER}/Llama-3.2-3B-Instruct-Q4_K_M.gguf`,
      name: "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
      sizeBytes: 2_019_000_000,
      source: "app",
      folder: LLM_FOLDER,
    },
    {
      id: `${HF_FOLDER}/models--google--gemma-3-4b-it-GGUF/snapshots/1/gemma-3-4b-it-Q4_K_M.gguf`,
      name: "gemma-3-4b-it-Q4_K_M.gguf",
      sizeBytes: 2_490_000_000,
      source: "huggingFace",
      folder: HF_FOLDER,
    },
  ],
  searched: [LLM_FOLDER, HF_FOLDER],
  available: true,
};

const LLM_REPLY: LlmTestReply = {
  text: "The team will launch the beta on 14 November without offline mode and inform the third pilot school this week.",
  truncated: false,
  outputTruncated: false,
  elapsedMs: 1_400,
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
/** Voices of the scripted lines, in turn. */
const SCRIPT_VOICES = ["A", "B", "A", "C"];

// ---- recording state (in memory: a reload is a restart) -----------------------------------------
let capture: CaptureState = CAPTURE_OFF;
let timer: ReturnType<typeof setInterval> | null = null;
let step = 0;

function seed(fixture: Fixture, dark: boolean) {
  for (const k of [
    CORRUPT_KEY,
    LOCKED_KEY,
    AUDIO_KEY,
    MODELS_KEY,
    SETTINGS_KEY,
    MIC_TEST_KEY,
    SPEAKER_MODELS_KEY,
    LEVEL_KEY,
    LLM_MODELS_KEY,
    API_KEY_KEY,
    LLM_TEST_KEY,
    PHONE_NETWORK_KEY,
  ]) {
    localStorage.removeItem(k);
  }
  const make = SEEDS[fixture];
  const meetings: Stored[] = make ? [make()] : [];
  if (fixture === "speakers") meetings[0]!.speakers = structuredClone(SPEAKER_CHOICES);
  if (fixture === "live-speakers") meetings[0]!.speakers = structuredClone(LIVE_SPEAKER_CHOICES);
  localStorage.setItem(KEY, JSON.stringify(meetings));
  localStorage.setItem(TRANSCRIPTS_KEY, "{}");
  if (fixture === "corrupt") localStorage.setItem(CORRUPT_KEY, "1");
  if (fixture === "locked") localStorage.setItem(LOCKED_KEY, "1");
  if (fixture === "live-no-model" || fixture === "settings-no-model")
    localStorage.setItem(MODELS_KEY, "none");
  if (fixture.startsWith("settings") || fixture === "live-mic-missing" || fixture === "live-switched") {
    // "Jabra Speak 710" is chosen but not connected.
    const missing = fixture === "settings-missing" || fixture === "live-mic-missing";
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      locale: (localStorage.getItem("meeting-companion.locale") as Settings["locale"]) ?? "en",
      inputDevice: missing ? "Jabra Speak 710" : "Jabra Speak 510",
      theme: fixture === "settings-dark" || dark ? "dark" : "light",
      languageModel:
        fixture === "settings-llm-local" || fixture === "settings-llm-local-failed"
          ? { local: LLM_MODELS.models[0]!.id }
          : fixture === "settings-llm-claude" ||
              fixture === "settings-llm-claude-nokey" ||
              fixture === "settings-llm-error"
            ? "claude"
            : "none",
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    localStorage.setItem("meeting-companion.theme", settings.theme);
  }
  if (fixture === "settings-mic-test") localStorage.setItem(MIC_TEST_KEY, "fixed");
  if (fixture === "settings-llm-none-found") localStorage.setItem(LLM_MODELS_KEY, "none");
  if (fixture === "settings-llm-claude" || fixture === "settings-llm-error")
    localStorage.setItem(API_KEY_KEY, "set");
  if (fixture === "settings-llm-error") localStorage.setItem(LLM_TEST_KEY, "unauthorized");
  if (fixture === "settings-llm-local") localStorage.setItem(LLM_TEST_KEY, "slow");
  // The chosen GGUF file cannot be loaded by llama.cpp: the core answers `failed`.
  if (fixture === "settings-llm-local-failed") localStorage.setItem(LLM_TEST_KEY, "failed");

  const id = meetings[0]?.id ?? null;
  if (fixture === "live-switched") {
    pendingSwitch = { meetingId: id!, at: LIVE_TRANSCRIPT.at(-1)!.at, elapsedMs: LIVE_ELAPSED_MS };
  }
  if (fixture === "speakers-no-model") localStorage.setItem(SPEAKER_MODELS_KEY, "none");
  if (fixture === "speakers" || fixture === "live-speakers") setTranscript(id!, SPEAKER_TRANSCRIPT);
  if (fixture === "speakers-no-model") setTranscript(id!, LIVE_TRANSCRIPT);
  if (fixture.startsWith("speakers") || fixture === "live-speakers") {
    capture = { state: "recording", meetingId: id, elapsedMs: LIVE_ELAPSED_MS, level: 0.55, reason: null };
  }
  if (
    fixture === "live-free" ||
    fixture === "live-transcript" ||
    fixture === "live-paused" ||
    fixture === "live-mic-error" ||
    fixture === "settings-recording" ||
    fixture === "live-switched" ||
    fixture === "settings-dark" ||
    fixture.startsWith("live-level") ||
    fixture === "live-no-signal"
  ) {
    setTranscript(id!, LIVE_TRANSCRIPT);
  }
  // Fixed states for screenshots: the script does not run, so nothing moves.
  if (
    fixture === "live-free" ||
    fixture === "live-transcript" ||
    fixture === "settings-recording" ||
    fixture === "settings-dark" ||
    fixture === "live-switched" ||
    fixture === "live-level-speech"
  ) {
    capture = { state: "recording", meetingId: id, elapsedMs: LIVE_ELAPSED_MS, level: 0.55, reason: null };
    pendingPartial = { ...LIVE_PARTIAL, meetingId: id! };
  }
  if (fixture === "live-level-silence" || fixture === "live-no-signal") {
    capture = { state: "recording", meetingId: id, elapsedMs: LIVE_ELAPSED_MS, level: 0.05, reason: null };
  }
  if (fixture === "live-level-silence") localStorage.setItem(LEVEL_KEY, "silence");
  if (fixture === "live-no-signal") localStorage.setItem(LEVEL_KEY, "none");
  if (capture.state === "recording") startLevels(capture.meetingId);
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
/** A microphone switch a fixture shows once the view listens. */
let pendingSwitch: SwitchedEvent | null = null;

/** A meeting as the core stores it: with the speaker choices and guests the UI does not send. */
type Stored = Meeting & {
  participants: SpeakerParticipant[];
  speakers?: { voices: VoiceChoice[]; lines: LineChoice[] };
};

function all(): Stored[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Stored[];
  } catch {
    return [];
  }
}

function put(m: Stored) {
  localStorage.setItem(KEY, JSON.stringify([...all().filter((x) => x.id !== m.id), m]));
}

// ---- speakers (a simplified stand-in for the core's name round) -------------------------------------
const words = (s: string) =>
  s
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
const has = (hay: string[], needle: string[]) =>
  needle.length > 0 && hay.some((_, i) => needle.every((w, j) => hay[i + j] === w));

function suggestions(m: Stored, lines: TranscriptSegment[]): Suggestion[] {
  const invited = m.participants.filter((p) => !p.guest);
  const named = new Map<string, Set<string>>();
  for (const l of lines) {
    if (!l.voice || l.startMs >= 120_000) continue;
    const said = words(l.text);
    for (const p of invited) {
      if (has(said, words(p.name)) || has(said, words(p.name.split(/\s+/)[0] ?? ""))) {
        named.set(l.voice, (named.get(l.voice) ?? new Set()).add(p.id));
      }
    }
  }
  const count = new Map<string, number>();
  for (const ps of named.values()) for (const p of ps) count.set(p, (count.get(p) ?? 0) + 1);
  return [...named.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([voice, ps]) => ({
      voice,
      candidates: invited.filter((p) => ps.has(p.id)).map((p) => p.id),
      unsure: ps.size > 1 || [...ps].some((p) => (count.get(p) ?? 0) > 1),
    }));
}

function speakerState(m: Stored): SpeakerState {
  const voices = m.speakers?.voices ?? [];
  return {
    participants: m.participants,
    voices,
    lines: m.speakers?.lines ?? [],
    suggestions: suggestions(m, transcripts()[m.id] ?? []).filter(
      (s) => !voices.some((v) => v.voice === s.voice),
    ),
  };
}

function speakerMeeting(id: string): Stored {
  const m = all().find((x) => x.id === id);
  if (!m) throw { kind: "noMeeting" };
  return m;
}

function withSpeakers(
  m: Stored,
  edit: (s: { voices: VoiceChoice[]; lines: LineChoice[] }) => void,
): SpeakerState {
  const speakers = structuredClone(m.speakers ?? { voices: [], lines: [] });
  edit(speakers);
  speakers.voices.sort((a, b) => a.voice.localeCompare(b.voice));
  speakers.lines.sort((a, b) => a.seq - b.seq);
  const next = { ...m, speakers };
  put(next);
  return speakerState(next);
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

// ---- the phone view (job 012): open only while its meeting records or is paused -------------------
let phoneMeeting: string | null = null;

function closePhone(reason: PhoneViewCloseReason) {
  if (phoneMeeting === null) return;
  const meetingId = phoneMeeting;
  phoneMeeting = null;
  void emit(EVENT_PHONE_VIEW, { state: "closed", meetingId, reason } satisfies PhoneViewState);
}

function openPhone(meetingId: string): PhoneViewOpened {
  if (capture.state !== "recording" || capture.meetingId !== meetingId) {
    throw { key: "phoneView.error.notRecording" };
  }
  if (localStorage.getItem(PHONE_NETWORK_KEY) === "none") throw { key: "phoneView.error.noLocalNetwork" };
  if (phoneMeeting === meetingId) return MOCK_PHONE_VIEW;
  closePhone("recordingStopped");
  phoneMeeting = meetingId;
  void emit(EVENT_PHONE_VIEW, { state: "open", meetingId, reason: null } satisfies PhoneViewState);
  return MOCK_PHONE_VIEW;
}

function setCapture(next: CaptureState) {
  capture = next;
  if (!(next.meetingId === phoneMeeting && (next.state === "recording" || next.state === "paused"))) {
    closePhone("recordingStopped");
  }
  void emit(EVENT_CAPTURE, capture);
  if (next.state === "recording") startLevels(next.meetingId);
  else stopLevels();
}

// ---- the level stream (job 007) -------------------------------------------------------------------
/** Level history of the frame (design/build/soundwave.py), one value per 100 ms, repeating. */
const SPEECH_LEVELS = [
  0.1, 0.32, 0.58, 0.41, 0.83, 0.52, 0.22, 0.47, 0.92, 0.68, 0.36, 0.63, 1.0, 0.74, 0.28, 0.55, 0.88, 0.59,
  0.33, 0.71, 0.45, 0.8, 0.5, 0.26, 0.66, 0.95, 0.6, 0.38, 0.77, 0.54,
];
const SILENCE_LEVELS = [
  0.06, 0.1, 0.04, 0.13, 0.07, 0.03, 0.09, 0.15, 0.05, 0.04, 0.11, 0.07, 0.03, 0.1, 0.06, 0.14, 0.04, 0.08,
  0.12, 0.05, 0.09, 0.04, 0.13, 0.06, 0.03, 0.1, 0.07, 0.12, 0.05, 0.08,
];
/** Like the core: 25 level events a second while audio arrives. */
const LEVEL_EVERY_MS = 40;
let levelTimer: ReturnType<typeof setInterval> | null = null;
let levelSource: string | null | undefined;

/** A fixed sequence by the clock, so screenshots under a fixed clock are stable. */
function levelAt(now: number): number {
  const kind = localStorage.getItem(LEVEL_KEY);
  const list = kind === "silence" ? SILENCE_LEVELS : SPEECH_LEVELS;
  return list[Math.floor(now / 100) % list.length]!;
}

function startLevels(source: string | null) {
  if (levelTimer !== null && levelSource === source) return;
  stopLevels();
  if (localStorage.getItem(LEVEL_KEY) === "none") return;
  levelSource = source;
  levelTimer = setInterval(() => {
    const level = levelAt(Date.now());
    void emit(EVENT_LEVEL, { meetingId: source, level, peak: Math.min(1, level * 0.6) } satisfies LevelEvent);
  }, LEVEL_EVERY_MS);
}

function stopLevels() {
  if (levelTimer === null) return;
  clearInterval(levelTimer);
  levelTimer = null;
  // The last event before capture stops says 0.
  void emit(EVENT_LEVEL, { meetingId: levelSource ?? null, level: 0, peak: 0 } satisfies LevelEvent);
  levelSource = undefined;
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
    const seq = segment.final ? recorded.length : undefined;
    const voice =
      localStorage.getItem(SPEAKER_MODELS_KEY) === "none"
        ? null
        : SCRIPT_VOICES[Math.floor(step / 3) % SCRIPT_VOICES.length]!;
    if (segment.final) setTranscript(meetingId, [...recorded, { ...segment, voice }]);
    setCapture({ ...capture, elapsedMs: capture.elapsedMs + STEP_MS, level: 0.3 + 0.4 * ((step % 4) / 3) });
    void emit(EVENT_SEGMENT, {
      ...segment,
      meetingId,
      ...(seq === undefined ? {} : { seq }),
    } satisfies SegmentEvent);
    // Like the core: the voice follows in its own event, once the line is stored.
    if (seq !== undefined && voice) void emit(EVENT_VOICE, { meetingId, seq, voice } satisfies VoiceEvent);
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
function speakerModelList(): SpeakerModelList {
  return localStorage.getItem(SPEAKER_MODELS_KEY) === "none"
    ? { models: [], searched: SPEAKER_SEARCHED }
    : SPEAKER_MODELS;
}

function llmModelList(): LlmModelList {
  return localStorage.getItem(LLM_MODELS_KEY) === "none" ? { ...LLM_MODELS, models: [] } : LLM_MODELS;
}

/** The running Test of the fake engine, so "Cancel test" can end it. */
let llmCancel: (() => void) | null = null;

function runLlmTest(): Promise<LlmTestReply> {
  const s = storedSettings() ?? current ?? DEFAULT_SETTINGS;
  if (llmCancel) return Promise.reject({ kind: "busy" });
  if (s.languageModel === "none") return Promise.reject({ kind: "notConfigured" });
  if (s.languageModel === "claude" && localStorage.getItem(API_KEY_KEY) !== "set")
    return Promise.reject({ kind: "noApiKey" });
  if (typeof s.languageModel === "object") {
    const id = s.languageModel.local;
    if (!llmModelList().models.some((m) => m.id === id)) return Promise.reject({ kind: "noModel" });
  }
  const mode = localStorage.getItem(LLM_TEST_KEY) ?? "reply";
  return new Promise((resolve, reject) => {
    const timer =
      mode === "slow"
        ? null
        : setTimeout(() => {
            llmCancel = null;
            if (mode === "reply") resolve(LLM_REPLY);
            else reject({ kind: mode });
          }, 300);
    llmCancel = () => {
      if (timer !== null) clearTimeout(timer);
      llmCancel = null;
      reject({ kind: "cancelled" });
    };
  });
}

function valid(change: SettingChange): boolean {
  const { key, value } = change;
  if (key === "languageModel") {
    if (value === "none" || value === "claude") return true;
    return (
      typeof value === "object" && value !== null && llmModelList().models.some((m) => m.id === value.local)
    );
  }
  if (key === "claudeModel") return ["sonnet", "haiku", "opus"].includes(value);
  if (key === "inputDevice") return value === null || DEVICES.includes(value);
  if (key === "speechModel") return value === null || modelList().models.some((m) => m.id === value);
  if (key === "speakerModel") return value === null || speakerModelList().models.some((m) => m.id === value);
  return ENUMS[key]?.includes(value as string) ?? false;
}

function emitTest(state: MicTestState) {
  void emit(EVENT_MIC_TEST, state);
}

function stopTest() {
  if (testTimer !== null) clearInterval(testTimer);
  testTimer = null;
  if (levelSource === null) stopLevels();
}

function startTest(): MicTestState {
  stopTest();
  if (localStorage.getItem(MIC_TEST_KEY) === "fixed") {
    const fixed: MicTestState = { state: "running", remainingMs: 6_400, level: 0.6, reason: null };
    setTimeout(() => emitTest(fixed), 0);
    startLevels(null);
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
    emitTest({ state: "running", remainingMs, level: levelAt(Date.now()), reason: null });
  }, 200);
  startLevels(null);
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
    // `&theme=dark` opens a settings fixture in the dark theme.
    seed(fixture, url.searchParams.get("theme") === "dark");
    url.searchParams.delete("fixture");
    url.searchParams.delete("theme");
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
          // Like the core: consent, speaker choices and guests are kept from the store, never taken
          // from the UI.
          const guests = (previous?.participants ?? []).filter(
            (g) => g.guest && !meeting.participants.some((p) => p.id === g.id),
          );
          list.push({
            ...meeting,
            participants: [...meeting.participants, ...guests],
            updatedAt: now,
            recordingConsentAt: previous?.recordingConsentAt ?? null,
            speakers: previous?.speakers,
          });
          localStorage.setItem(KEY, JSON.stringify(list));
          if (meeting.run?.endedAt && phoneMeeting === meeting.id) closePhone("meetingEnded");
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
        case "stop_recording": {
          // Like the core: the microphone closes at once; the answer may take a while.
          stopScript();
          const delay = Number(localStorage.getItem(STOP_DELAY_KEY) ?? 0);
          if (delay > 0) {
            return new Promise<CaptureState>((done) =>
              setTimeout(() => {
                setCapture(CAPTURE_OFF);
                done(capture);
              }, delay),
            );
          }
          setCapture(CAPTURE_OFF);
          return capture;
        }
        case "recording_status": {
          // A fixture's partial line arrives once the view listens.
          const partial = pendingPartial;
          pendingPartial = null;
          if (partial) setTimeout(() => void emit(EVENT_SEGMENT, partial), 0);
          const switched = pendingSwitch;
          pendingSwitch = null;
          if (switched) setTimeout(() => void emit(EVENT_SWITCHED, switched), 0);
          return capture;
        }
        case "load_transcript":
          return {
            segments: transcripts()[a.meetingId as string] ?? [],
            error: null,
          } satisfies TranscriptLoad;
        case "list_speech_models":
          return modelList();
        case "list_speaker_models":
          return speakerModelList();
        case "load_speakers":
          return speakerState(speakerMeeting(a.meetingId as string));
        case "choose_voice": {
          const m = speakerMeeting(a.meetingId as string);
          const voice = a.voice as string;
          const pid = (a.participantId as string | null) ?? null;
          if (!/^[A-Z]$/.test(voice)) throw { kind: "invalidVoice" };
          if (!(transcripts()[m.id] ?? []).some((l) => l.voice === voice)) throw { kind: "unknownVoice" };
          if (pid && !m.participants.some((p) => p.id === pid)) throw { kind: "unknownParticipant" };
          const suggested = speakerState(m).suggestions.find((s) => s.voice === voice);
          const source =
            suggested && !suggested.unsure && suggested.candidates[0] === pid ? "nameRound" : "manual";
          return withSpeakers(m, (s) => {
            s.voices = s.voices.filter((v) => v.voice !== voice);
            s.voices.push({ voice, participantId: pid, source, confirmed: true });
          });
        }
        case "choose_line": {
          const m = speakerMeeting(a.meetingId as string);
          const seq = a.seq as number;
          const target = a.target as LineTarget;
          if (!(seq >= 0 && seq < (transcripts()[m.id] ?? []).length)) throw { kind: "unknownLine" };
          if (target.kind === "person" && !m.participants.some((p) => p.id === target.participantId)) {
            throw { kind: "unknownParticipant" };
          }
          return withSpeakers(m, (s) => {
            s.lines = s.lines.filter((l) => l.seq !== seq);
            if (target.kind !== "voice") {
              s.lines.push({ seq, participantId: target.kind === "person" ? target.participantId : null });
            }
          });
        }
        case "add_guest": {
          const m = speakerMeeting(a.meetingId as string);
          const name = String(a.name).trim();
          if (!name) throw { kind: "invalidName", code: "empty" };
          if (Array.from(name).length > 80) throw { kind: "invalidName", code: "tooLong" };
          if (m.participants.some((p) => p.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
            throw { kind: "invalidName", code: "duplicate" };
          }
          let n = 1;
          while (m.participants.some((p) => p.id === `guest-${n}`)) n += 1;
          const participantId = `guest-${n}`;
          const next = { ...m, participants: [...m.participants, { id: participantId, name, guest: true }] };
          put(next);
          return { participantId, state: speakerState(next) };
        }
        case "apply_name_round": {
          const m = speakerMeeting(a.meetingId as string);
          const open = speakerState(m).suggestions.filter((x) => !x.unsure && x.candidates.length === 1);
          return withSpeakers(m, (s) => {
            for (const x of open) {
              s.voices.push({
                voice: x.voice,
                participantId: x.candidates[0]!,
                source: "nameRound",
                confirmed: true,
              });
            }
          });
        }
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
        case "list_llm_models":
          return llmModelList();
        case "get_api_key_status":
          return { set: localStorage.getItem(API_KEY_KEY) === "set" };
        case "set_api_key": {
          // Like the core: trimmed, 1–512 printable ASCII characters without spaces. Only "set" is kept.
          const key = String(a.key ?? "").trim();
          if (!/^[\x21-\x7e]{1,512}$/.test(key)) throw { kind: "invalidKey" };
          localStorage.setItem(API_KEY_KEY, "set");
          return { set: true };
        }
        case "delete_api_key":
          localStorage.removeItem(API_KEY_KEY);
          return { set: false };
        case "run_llm_test":
          return runLlmTest();
        case "cancel_llm_test":
          llmCancel?.();
          return null;
        case "phone_view_open":
          return openPhone(a.meetingId as string);
        case "phone_view_close":
          closePhone("requested");
          return null;
        default:
          throw new Error(`mock backend: unknown command ${cmd}`);
      }
    },
    { shouldMockEvents: true },
  );
}
