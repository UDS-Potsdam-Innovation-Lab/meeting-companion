import { mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { render, screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";
import { App } from "../app/App";
import { I18nProvider } from "../i18n";
import { ClockProvider, FakeClock, systemClock, type Clock } from "../lib/clock";
import type { Meeting } from "../features/agenda/model";
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
  type OrganisationLoad,
  type ModelList,
  type RecordError,
  type SpeakerModelList,
  type SpeakerState,
  type TranscriptLoad,
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
  /** What `load_organisation` returns (default: no file). */
  organisation?: OrganisationLoad;
  /** Answers `stop_recording` (default: off at once); may never settle, settle late or reject. */
  stop?: () => Promise<CaptureState>;
}

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
  /** The last meeting the core accepted. */
  last: () => Meeting | undefined;
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
    last: () => core.saved[core.saved.length - 1],
  };
  mockIPC(
    (cmd, args) => {
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
          core.settings = { ...core.settings, [key]: value };
          void emit(EVENT_SETTINGS, core.settings);
          return { settings: core.settings, saved: true };
        }
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
        case "load_organisation":
          return (
            rec.organisation ?? {
              status: "missing",
              organisation: null,
              path: "/home/u/.local/share/de.udspotsdam.meetingcompanion/organisation.json",
            }
          );
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
    },
    { shouldMockEvents: true },
  );
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
