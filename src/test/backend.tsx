import { mockIPC } from "@tauri-apps/api/mocks";
import { render, screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";
import { App } from "../app/App";
import { I18nProvider } from "../i18n";
import { ClockProvider, FakeClock, systemClock, type Clock } from "../lib/clock";
import type { Meeting } from "../features/agenda/model";
import {
  CAPTURE_OFF,
  type CaptureState,
  type LoadResult,
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
}

export const FAKE_SPEAKER_MODELS: SpeakerModelList = {
  models: [
    { id: "/m/campplus.onnx", name: "campplus.onnx", sizeBytes: 28_281_164, source: "app", folder: "/m" },
  ],
  searched: ["/m"],
};

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
          return CAPTURE_OFF;
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
