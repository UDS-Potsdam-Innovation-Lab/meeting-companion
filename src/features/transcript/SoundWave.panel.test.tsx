// Job 007: the sound wave in the frame 02 transcript footer (AC2, AC3, AC5) with the mocked core.
import { act, screen, waitFor, within } from "@testing-library/react";
import { emit } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeClock } from "../../lib/clock";
import { EVENT_CAPTURE, EVENT_LEVEL, type CaptureState, type LevelEvent } from "../../lib/ipc";
import { renderApp, type FakeRecording } from "../../test/backend";
import { NO_SIGNAL_MS } from "../../ui/SoundWave";
import { LIVE_TIMES, LIVE_TRANSCRIPT, liveConsentedMeeting } from "../agenda/fixtures";

// Render counters around the live view and the transcript column.
const renders = vi.hoisted(() => ({ panel: 0, live: 0 }));
vi.mock("./TranscriptPanel", async (original) => {
  const mod = await original<typeof import("./TranscriptPanel")>();
  return {
    ...mod,
    TranscriptPanel: (props: Parameters<typeof mod.TranscriptPanel>[0]) => {
      renders.panel += 1;
      return mod.TranscriptPanel(props);
    },
  };
});
vi.mock("../live/LiveView", async (original) => {
  const mod = await original<typeof import("../live/LiveView")>();
  return {
    ...mod,
    LiveView: (props: Parameters<typeof mod.LiveView>[0]) => {
      renders.live += 1;
      return mod.LiveView(props);
    },
  };
});

const ID = "fixture-live";

beforeEach(() => {
  localStorage.setItem("meeting-companion.locale", "en");
});

const recording = (s: Partial<CaptureState> = {}): CaptureState => ({
  state: "recording",
  meetingId: ID,
  elapsedMs: 0,
  level: 0,
  reason: null,
  ...s,
});

async function openLive(rec: FakeRecording = {}) {
  const clock = new FakeClock(LIVE_TIMES.running);
  const utils = await renderApp(
    { meeting: liveConsentedMeeting(), error: null },
    { clock, view: "live", recording: { transcript: { segments: LIVE_TRANSCRIPT, error: null }, ...rec } },
  );
  await waitFor(() => expect(utils.core.calls.some((c) => c.cmd === "load_transcript")).toBe(true));
  return utils;
}

const card = () => screen.getByRole("region", { name: /^(Transcript|Transkript)$/ });
const wave = () => card().querySelector(".transcript-card__footer .sound-wave");
const level = (l: number) =>
  act(() => emit(EVENT_LEVEL, { meetingId: ID, level: l, peak: l } satisfies LevelEvent));
const sendState = (s: Partial<CaptureState>) => act(() => emit(EVENT_CAPTURE, recording(s)));
const sleep = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

describe("AC2 the footer states", () => {
  it("recording with level events shows the moving wave and Listening", async () => {
    await openLive({ status: recording() });
    for (let i = 0; i < 5; i++) await level(0.5);
    expect(wave()).toHaveAttribute("data-state", "listening");
    expect(wave()).toHaveAttribute("aria-hidden", "true");
    expect(within(card()).getByRole("button", { name: "Listening · 0 speakers" })).toBeVisible();
    expect(screen.getByTestId("wave-status")).toHaveTextContent("Listening");
  });

  it("paused shows the flat wave", async () => {
    await openLive({ status: recording({ state: "paused" }) });
    expect(wave()).toHaveAttribute("data-state", "paused");
    expect(card().querySelector(".sound-wave__bar")).toBeNull();
    expect(within(card()).getByRole("button", { name: "Paused · 0 speakers" })).toBeVisible();
  });

  it("recording without a level event for 500 ms shows No signal in text, in German too", async () => {
    await openLive({ status: recording() });
    await level(0.5);
    await sleep(NO_SIGNAL_MS + 250);
    await waitFor(() => expect(wave()).toHaveAttribute("data-state", "noSignal"));
    expect(within(card()).getByRole("button", { name: "No signal · 0 speakers" })).toBeVisible();
    expect(screen.getByTestId("wave-status")).toHaveTextContent("No signal");
    expect(card().querySelector(".sound-wave__bar")).toBeNull();
    // A level event brings the wave back.
    await level(0.5);
    expect(wave()).toHaveAttribute("data-state", "listening");

    await act(() => screen.getByRole("button", { name: "Deutsch" }).click());
    await sleep(NO_SIGNAL_MS + 250);
    await waitFor(() =>
      expect(within(card()).getByRole("button", { name: "Kein Signal · 0 Stimmen" })).toBeVisible(),
    );
    expect(screen.getByTestId("wave-status")).toHaveTextContent("Kein Signal");
  });

  it("MicrophoneLost shows Microphone lost with the error notice and a flat line", async () => {
    await openLive({ status: recording() });
    await level(0.9);
    await sendState({ state: "error", reason: "microphoneLost" });
    expect(wave()).toHaveAttribute("data-state", "lost");
    expect(card().querySelector(".sound-wave__bar")).toBeNull();
    expect(within(card()).getByRole("button", { name: "Microphone lost · 0 speakers" })).toBeVisible();
    expect(within(card()).getByRole("alert")).toHaveTextContent("The microphone stopped working.");
    // Not said twice: the alert carries it.
    expect(screen.getByTestId("wave-status")).toHaveTextContent("");
  });

  it("the speakers button stays its own target next to the wave", async () => {
    await openLive({ status: recording() });
    const button = within(card()).getByRole("button", { name: "Listening · 0 speakers" });
    expect(button.contains(wave())).toBe(false);
    expect(button).toHaveAttribute("data-speakers-button");
  });
});

describe("AC3 level events do not re-render the view", () => {
  it("25 level events a second re-render neither TranscriptPanel nor LiveView", async () => {
    await openLive({ status: recording() });
    await level(0.3);
    await sleep(50);
    const before = { ...renders };
    expect(before.panel).toBeGreaterThan(0);
    expect(before.live).toBeGreaterThan(0);
    for (let i = 0; i < 25; i++) {
      await level(0.2 + (i % 5) * 0.15);
      await sleep(40);
    }
    expect(renders.panel - before.panel).toBe(0);
    expect(renders.live - before.live).toBe(0);
    // A state change re-renders once.
    await sendState({ state: "paused" });
    expect(renders.panel - before.panel).toBe(1);
    expect(renders.live - before.live).toBe(1);
  });
});
