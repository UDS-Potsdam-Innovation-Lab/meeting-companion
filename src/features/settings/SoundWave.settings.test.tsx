// Job 007 AC6: the Audio section's meter is the SoundWave, fed by the same capture-side level.
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emit } from "@tauri-apps/api/event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeClock } from "../../lib/clock";
import {
  EVENT_CAPTURE,
  EVENT_LEVEL,
  EVENT_MIC_TEST,
  type CaptureState,
  type LevelEvent,
} from "../../lib/ipc";
import { renderApp, type FakeRecording } from "../../test/backend";
import { NO_SIGNAL_MS } from "../../ui/SoundWave";
import { filledMeeting, LIVE_TIMES, LIVE_TRANSCRIPT, liveConsentedMeeting } from "../agenda/fixtures";

const ID = "fixture-live";
let reduced = false;

beforeEach(() => {
  localStorage.setItem("meeting-companion.locale", "en");
  reduced = false;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)" && reduced,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => vi.unstubAllGlobals());

const settingsButton = () =>
  screen.getAllByRole("button", { name: "Settings" }).find((b) => !b.closest("[hidden]"))!;
const meter = () => screen.getByTestId("settings-meter");
const wave = () => meter().querySelector(".sound-wave");
const level = (l: number, meetingId: string | null) =>
  act(() => emit(EVENT_LEVEL, { meetingId, level: l, peak: l } satisfies LevelEvent));
const sleep = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

async function openTest(rec: FakeRecording = {}) {
  const user = userEvent.setup();
  const utils = await renderApp(
    { meeting: filledMeeting(), error: null },
    { recording: { ...rec, settings: { locale: "en" } } },
  );
  await user.click(settingsButton());
  await user.click(screen.getByRole("button", { name: "Test microphone" }));
  await screen.findByTestId("mic-test-running");
  return { user, ...utils };
}

describe("AC6 the microphone test meter", () => {
  it("is the SoundWave at the settings size, fed by the test's level events (no meeting id)", async () => {
    await openTest();
    expect(wave()).toHaveClass("sound-wave--settings");
    expect(wave()).toHaveAttribute("data-state", "listening");
    expect(wave()).toHaveAttribute("aria-hidden", "true");
    await level(0.7, null);
    expect(wave()).toHaveAttribute("data-state", "listening");
    // Without level events for 500 ms: "No signal" in text next to the flat, dashed line.
    await sleep(NO_SIGNAL_MS + 250);
    await waitFor(() => expect(wave()).toHaveAttribute("data-state", "noSignal"));
    expect(meter()).toHaveTextContent("No signal");
    await level(0.7, null);
    expect(wave()).toHaveAttribute("data-state", "listening");
  });

  it("a test that loses the device shows Microphone lost", async () => {
    await openTest();
    await act(() =>
      emit(EVENT_MIC_TEST, { state: "error", remainingMs: 0, level: 0, reason: "microphoneLost" }),
    );
    expect(wave()).toHaveAttribute("data-state", "lost");
    expect(meter()).toHaveTextContent("Microphone lost");
  });

  it("under reduced motion shows the static level bar", async () => {
    reduced = true;
    await openTest();
    expect(wave()).toHaveClass("sound-wave--reduced");
    expect(meter().querySelector(".sound-wave__bar")).toBeNull();
  });
});

describe("AC6 the meter while a meeting records", () => {
  const recording = (s: Partial<CaptureState> = {}): CaptureState => ({
    state: "recording",
    meetingId: ID,
    elapsedMs: 0,
    level: 0,
    reason: null,
    ...s,
  });

  it("follows the recording's level stream, and is flat while paused", async () => {
    const user = userEvent.setup();
    await renderApp(
      { meeting: liveConsentedMeeting(), error: null },
      {
        clock: new FakeClock(LIVE_TIMES.running),
        view: "live",
        recording: {
          status: recording(),
          transcript: { segments: LIVE_TRANSCRIPT, error: null },
          settings: { locale: "en" },
        },
      },
    );
    await user.click(settingsButton());
    await screen.findByTestId("settings-meter");
    for (let i = 0; i < 5; i++) await level(0.6, ID);
    expect(wave()).toHaveAttribute("data-state", "listening");
    expect(meter()).toHaveTextContent("Recording · System default");
    await act(() => emit(EVENT_CAPTURE, recording({ state: "paused" })));
    expect(wave()).toHaveAttribute("data-state", "paused");
    expect(meter().querySelector(".sound-wave__bar")).toBeNull();
  });
});
