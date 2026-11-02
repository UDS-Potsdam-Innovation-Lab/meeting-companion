import { mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { render, screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";
import { App } from "../app/App";
import { I18nProvider } from "../i18n";
import { ClockProvider, FakeClock, systemClock, type Clock } from "../lib/clock";
import type { Meeting } from "../features/agenda/model";
import { fakeCaptureCommand } from "../features/captures/fakeCore";
import {
  CAPTURE_OFF,
  DEFAULT_SETTINGS,
  EVENT_SETTINGS,
  MIC_TEST_OFF,
  type CaptureState,
  type MicTestError,
  type Settings,
  type SettingsLoad,
  type LoadResult,
  type ModelList,
  type RecordError,
  type SpeakerModelList,
  type SpeakerState,
  type TranscriptLoad,
  type Capture,
  type LlmModelList,
  type LlmTestReply,
} from "../lib/ipc";

/** How the fake core answers the recording commands. Events are sent by the test with `emit`. */
export interface FakeRecording {
  status?: CaptureState;
  transcript?: TranscriptLoad;
  models?: ModelList;
  /** `start_recording` fails with this error instead of returning a recording state. */
  startError?: RecordError;
  /** What `load_speakers` returns first; speaker commands return `speakerReply` (or this). */
  speakers?: SpeakerState;
  speakerModels?: SpeakerModelList;
  /** Answers a speaker command (`choose_voice`, `choose_line`, `add_guest`, `apply_name_round`). */
  speakerReply?: (cmd: string, args: Record<string, unknown>) => unknown;
  /** Stored settings (`load_settings`); defaults with status "missing" if not given. */
  settings?: Partial<Settings>;
  settingsStatus?: SettingsLoad["status"];
  devices?: string[];
  micTestError?: MicTestError;
  /** Answers `stop_recording` (default: off at once); may never settle, settle late or reject. */
  stop?: () => Promise<CaptureState>;
  /** The language models found (default: {@link FAKE_LLM_MODELS}). */
  llmModels?: LlmModelList;
  /** Whether an API key is saved at the start. */
  apiKeySet?: boolean;
  /** The keychain is locked: every key command fails with `keychainUnavailable`. */
  keychainUnavailable?: boolean;
  /** Answers `run_llm_test` (default: a reply at once); may reject with `{ kind }` or settle late. */
  llmTest?: () => Promise<LlmTestReply>;
  /** Captures stored at the start (job 018). */
  captures?: Capture[];
  /**
   * Answers a capture command instead of the built-in fake (which mirrors the core's rules); return
   * `undefined` to fall through to it. May return a promise, to hold the answer back.
   */
  captureReply?: (cmd: string, args: Record<string, unknown>) => unknown;
  /** The core's clock for capture times (default: `Date.now`). */
  captureNow?: () => number;
}

export const FAKE_LLM_MODELS: LlmModelList = {
  models: [
    {
      id: "/m/Qwen2.5-3B-Instruct-Q4_K_M.gguf",
      name: "Qwen2.5-3B-Instruct-Q4_K_M.gguf",
      sizeBytes: 1_986_000_000,
      source: "huggingFace",
      folder: "/m",
    },
    {
      id: "/m/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
      name: "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
      sizeBytes: 2_019_000_000,
      source: "app",
      folder: "/m",
    },
  ],
  searched: ["/m", "/home/u/.cache/huggingface/hub"],
  available: true,
};

export const FAKE_LLM_REPLY: LlmTestReply = {
  text: "The team launches the beta on 14 November without offline mode and tells the third pilot school this week.",
  truncated: false,
  outputTruncated: false,
  elapsedMs: 1_400,
};

export const FAKE_SPEAKER_MODELS: SpeakerModelList = {
  models: [
    { id: "/m/campplus.onnx", name: "campplus.onnx", sizeBytes: 28_281_164, source: "app", folder: "/m" },
  ],
  searched: ["/m"],
};

export const FAKE_DEVICES = ["Built-in Audio Analog Stereo", "Jabra Speak 510"];

export const FAKE_MODELS: ModelList = {
  models: [
    {
      id: "/m/ggml-base.bin",
      name: "ggml-base.bin",
      sizeBytes: 147_951_465,
      source: "voxtype",
      multilingual: true,
      folder: "/m",
    },
    {
      id: "/m/ggml-base.en.bin",
      name: "ggml-base.en.bin",
      sizeBytes: 147_964_211,
      source: "voxtype",
      multilingual: false,
      folder: "/m",
    },
  ],
  searched: ["/m"],
};

export interface FakeCore {
  /** The settings the fake core holds now. */
  settings: Settings;
  saved: Meeting[];
  readyViews: string[];
  /** Every command the UI sent, in order, with its arguments. */
  calls: { cmd: string; args: unknown }[];
  /** Every answer the fake core gave (resolved or rejected), in order. */
  responses: unknown[];
  /** Every event the fake core sent. */
  events: { event: string; payload: unknown }[];
  /** Whether a key is in the fake keychain (the key itself is not kept). */
  apiKeySet: boolean;
  /** The last meeting the core accepted. */
  last: () => Meeting | undefined;
  /** The captures the fake core holds now. */
  captures: () => Capture[];
}

/** Mocks the Tauri core: `load_latest_meeting` returns `load`, saves are recorded. */
export function fakeCore(
  load: LoadResult = { meeting: null, error: null },
  rec: FakeRecording = {},
): FakeCore {
  const core: FakeCore = {
    settings: { ...DEFAULT_SETTINGS, ...rec.settings },
    saved: [],
    readyViews: [],
    calls: [],
    responses: [],
    events: [],
    apiKeySet: rec.apiKeySet ?? false,
    last: () => core.saved[core.saved.length - 1],
    captures: () => structuredClone(captured),
  };
  let captured: Capture[] = structuredClone(rec.captures ?? []);
  const send = (event: string, payload: unknown) => {
    core.events.push({ event, payload: structuredClone(payload) });
    void emit(event, payload);
  };
  const answer = (cmd: string, args: unknown): unknown => {
    try {
      const out = handle(cmd, args);
      if (out instanceof Promise)
        return out.then(
          (v) => (core.responses.push(v), v),
          (e) => {
            core.responses.push(e);
            throw e;
          },
        );
      core.responses.push(out);
      return out;
    } catch (e) {
      core.responses.push(e);
      throw e;
    }
  };
  const handle = (cmd: string, args: unknown): unknown => {
    {
      core.calls.push({ cmd, args: structuredClone(args) });
      if (cmd === "load_latest_meeting") return structuredClone(load);
      if (cmd === "save_meeting") {
        core.saved.push(structuredClone((args as { meeting: Meeting }).meeting));
        return Date.now();
      }
      if (cmd === "view_ready") {
        core.readyViews.push((args as { view: string }).view);
        return null;
      }
      const meetingId = (args as { meetingId?: string } | undefined)?.meetingId ?? null;
      if (cmd === "load_captures" || cmd.endsWith("_capture")) {
        const a = (args ?? {}) as Record<string, unknown>;
        const reply = rec.captureReply?.(cmd, a);
        if (reply !== undefined) return reply;
        return fakeCaptureCommand(
          {
            meeting: (id) => {
              const m = core.last() ?? load.meeting ?? undefined;
              return m && m.id === id ? { ...m, captures: captured } : undefined;
            },
            put: (m) => {
              captured = m.captures ?? [];
            },
            now: rec.captureNow ?? Date.now,
          },
          cmd,
          a,
        );
      }
      switch (cmd) {
        case "load_settings": {
          const status = rec.settingsStatus ?? (rec.settings ? "stored" : "missing");
          // Like the core: without a readable file, the UI's cached locale and theme are taken over.
          const cached = ((args as { cached?: Record<string, string | null> }).cached ?? {}) as Record<
            string,
            string | null
          >;
          if (status !== "stored") {
            if (cached.locale === "de" || cached.locale === "en") core.settings.locale = cached.locale;
            if (cached.theme === "light" || cached.theme === "dark" || cached.theme === "system")
              core.settings.theme = cached.theme;
          }
          return {
            settings: core.settings,
            status,
            storageFolder: "/home/u/.local/share/de.udspotsdam.meetingcompanion/meetings",
          } satisfies SettingsLoad;
        }
        case "update_setting": {
          const { key, value } = (args as { change: { key: keyof Settings; value: never } }).change;
          if (key === "languageModel") {
            const v = value as Settings["languageModel"];
            const list = rec.llmModels ?? FAKE_LLM_MODELS;
            const ok =
              v === "none" ||
              v === "claude" ||
              (typeof v === "object" && list.available && list.models.some((m) => m.id === v.local));
            if (!ok) throw { kind: "invalid", key };
          }
          core.settings = { ...core.settings, [key]: value };
          send(EVENT_SETTINGS, core.settings);
          return { settings: core.settings, saved: true };
        }
        case "list_llm_models":
          return rec.llmModels ?? FAKE_LLM_MODELS;
        case "get_api_key_status":
          if (rec.keychainUnavailable) throw { kind: "keychainUnavailable" };
          return { set: core.apiKeySet };
        case "set_api_key": {
          if (rec.keychainUnavailable) throw { kind: "keychainUnavailable" };
          // Like the core: trimmed, 1–512 printable ASCII characters without spaces.
          const key = String((args as { key?: unknown }).key ?? "").trim();
          if (!/^[\x21-\x7e]{1,512}$/.test(key)) throw { kind: "invalidKey" };
          core.apiKeySet = true;
          return { set: true };
        }
        case "delete_api_key":
          if (rec.keychainUnavailable) throw { kind: "keychainUnavailable" };
          core.apiKeySet = false;
          return { set: false };
        case "run_llm_test":
          if (core.settings.languageModel === "none") throw { kind: "notConfigured" };
          if (core.settings.languageModel === "claude" && !core.apiKeySet) throw { kind: "noApiKey" };
          return rec.llmTest ? rec.llmTest() : FAKE_LLM_REPLY;
        case "cancel_llm_test":
          return null;
        case "list_input_devices":
          return rec.devices ?? FAKE_DEVICES;
        case "start_mic_test":
          if (rec.micTestError) throw rec.micTestError;
          return { ...MIC_TEST_OFF, state: "running", remainingMs: 10_000 };
        case "stop_mic_test":
          return null;
        case "recording_status":
          return rec.status ?? CAPTURE_OFF;
        case "load_transcript":
          return rec.transcript ?? { segments: [], error: null };
        case "list_speech_models":
          return rec.models ?? FAKE_MODELS;
        case "confirm_recording_consent":
          return 1_000;
        case "start_recording":
          if (rec.startError) throw rec.startError;
          return {
            state: "recording",
            meetingId,
            elapsedMs: 0,
            level: 0,
            reason: null,
          } satisfies CaptureState;
        case "pause_recording":
          return {
            state: "paused",
            meetingId: load.meeting?.id ?? null,
            elapsedMs: 5_000,
            level: 0,
            reason: null,
          };
        case "stop_recording":
          return rec.stop ? rec.stop() : CAPTURE_OFF;
        case "list_speaker_models":
          return rec.speakerModels ?? FAKE_SPEAKER_MODELS;
        case "load_speakers":
          return (
            rec.speakers ?? {
              participants: load.meeting?.participants ?? [],
              voices: [],
              lines: [],
              suggestions: [],
            }
          );
        case "choose_voice":
        case "choose_line":
        case "add_guest":
        case "apply_name_round":
          if (rec.speakerReply) return rec.speakerReply(cmd, args as Record<string, unknown>);
          throw { kind: "storageFailed" };
      }
      throw new Error(`unexpected command ${cmd}`);
    }
  };
  mockIPC(answer, { shouldMockEvents: true });
  return core;
}

export interface RenderOptions {
  keyMode?: boolean;
  clock?: Clock;
  /** The view to wait for: agenda setup (default) or the live meeting. */
  view?: "setup" | "live";
  recording?: FakeRecording;
}

export async function renderApp(load?: LoadResult, opts: RenderOptions = {}) {
  const core = fakeCore(load, opts.recording);
  const utils = render(
    <ClockProvider clock={opts.clock ?? systemClock}>
      <I18nProvider keyMode={opts.keyMode}>
        <App />
      </I18nProvider>
    </ClockProvider>,
  );
  if (opts.view === "live") {
    await waitFor(() => expect(utils.container.querySelector('main[data-view="live"]')).not.toBeNull());
    // The view subscribes to the clock in an effect; a tick before that would be missed.
    const clock = opts.clock;
    if (clock instanceof FakeClock) await waitFor(() => expect(clock.listening).toBe(true));
  } else {
    // The setup view is ready once the meeting card is there.
    await screen.findByRole("region", { name: opts.keyMode ? "⟦meeting.heading⟧" : /^Meeting$/ });
  }
  return { core, ...utils };
}
