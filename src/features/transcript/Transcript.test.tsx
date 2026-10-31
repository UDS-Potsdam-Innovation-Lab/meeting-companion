import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emit } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "../../lib/clock";
import {
  EVENT_CAPTURE,
  EVENT_SEGMENT,
  type CaptureState,
  type RecordReason,
  type SegmentEvent,
} from "../../lib/ipc";
import { renderApp, type FakeRecording } from "../../test/backend";
import {
  LIVE_ELAPSED_MS,
  LIVE_TIMES,
  LIVE_TRANSCRIPT,
  liveConsentedMeeting,
  liveMeeting,
} from "../agenda/fixtures";
import type { Meeting } from "../agenda/model";

beforeEach(() => {
  localStorage.setItem("meeting-companion.locale", "en");
});

const ID = "fixture-live";

async function openLive(meeting: Meeting, recording: FakeRecording = {}, time: number = LIVE_TIMES.running) {
  const clock = new FakeClock(time);
  const utils = await renderApp({ meeting, error: null }, { clock, view: "live", recording });
  // The view has asked the core for its state, transcript and settings.
  await waitFor(() => expect(utils.core.calls.some((c) => c.cmd === "load_transcript")).toBe(true));
  await waitFor(() => expect(utils.core.calls.some((c) => c.cmd === "load_settings")).toBe(true));
  return { clock, ...utils };
}

const state = (s: Partial<CaptureState>): CaptureState => ({
  state: "recording",
  meetingId: ID,
  elapsedMs: 0,
  level: 0.5,
  reason: null,
  ...s,
});

const sendState = (s: Partial<CaptureState>) => act(() => emit(EVENT_CAPTURE, state(s)));
const sendSegment = (s: Partial<SegmentEvent>) =>
  act(() =>
    emit(EVENT_SEGMENT, {
      meetingId: ID,
      startMs: 0,
      endMs: 1_000,
      at: LIVE_TIMES.running,
      text: "",
      lang: "en",
      final: true,
      ...s,
    } satisfies SegmentEvent),
  );

const chip = () => screen.queryByTestId("rec-chip");
const card = () => screen.getByRole("region", { name: "Transcript" });
const startCalls = (core: { calls: { cmd: string; args: unknown }[] }) =>
  core.calls.filter((c) => c.cmd === "start_recording");

describe("AC1 consent before recording", () => {
  it("shows an inline prompt, keeps the left column usable and opens nothing before confirmation", async () => {
    const user = userEvent.setup();
    const { core } = await openLive(liveMeeting());
    expect(screen.queryByRole("dialog")).toBeNull();
    const box = within(card()).getByRole("checkbox", {
      name: "Everyone was informed that this meeting is transcribed",
    });
    const start = within(card()).getByRole("button", { name: "Start recording" });
    expect(start).toBeDisabled();
    expect(within(card()).getByText("Audio stays on this device.")).toBeVisible();
    // The left column works while the prompt is open.
    await user.click(screen.getByRole("button", { name: "+5 min" }));
    expect(core.last()?.run?.items[1]?.extraMinutes).toBe(5);
    expect(startCalls(core)).toHaveLength(0);
    expect(chip()).toBeNull();

    await user.click(box);
    expect(start).toBeEnabled();
    await user.click(start);
    const cmds = core.calls.map((c) => c.cmd).filter((c) => c.includes("recording"));
    expect(cmds.slice(-2)).toEqual(["confirm_recording_consent", "start_recording"]);
    // The core takes microphone, model and language from its own settings store.
    expect(startCalls(core)[0]!.args).toEqual({ meetingId: ID });
    // The confirmation time is kept in the meeting.
    await waitFor(() => expect(core.last()?.recordingConsentAt).toBe(1_000));
    await waitFor(() => expect(chip()).toHaveTextContent("REC00:00:00"));
  });

  it("after a restart a running meeting reopens with recording stopped and one-tap Resume recording", async () => {
    const user = userEvent.setup();
    const { core } = await openLive(liveConsentedMeeting(), {
      transcript: { segments: LIVE_TRANSCRIPT, error: null },
    });
    expect(within(card()).queryByRole("checkbox")).toBeNull();
    expect(within(card()).getByText("Recording is off")).toBeVisible();
    // The stored transcript is shown again in full.
    expect(within(card()).getAllByRole("listitem")).toHaveLength(LIVE_TRANSCRIPT.length);
    // Recording never starts on its own.
    expect(startCalls(core)).toHaveLength(0);
    expect(chip()).toBeNull();
    await user.click(within(card()).getByRole("button", { name: "Resume recording" }));
    expect(startCalls(core)).toHaveLength(1);
    expect(core.calls.some((c) => c.cmd === "confirm_recording_consent")).toBe(false);
  });

  it.each<[RecordReason, string]>([
    ["noMicrophone", "No microphone found. Connect one, then resume recording."],
    ["microphoneBlocked", "The microphone could not be opened."],
    ["noModel", "No speech model installed."],
  ])("shows why recording could not start (%s) and no REC chip", async (reason, text) => {
    const user = userEvent.setup();
    await openLive(liveConsentedMeeting(), { startError: { kind: "failed", reason } });
    await user.click(within(card()).getByRole("button", { name: "Resume recording" }));
    expect(await within(card()).findByRole("alert")).toHaveTextContent(text);
    expect(chip()).toBeNull();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  });
});

describe("job 006 AC5: the speech-model picker moved to the settings", () => {
  it("the transcript column has no model picker; Start sends no model id", async () => {
    const user = userEvent.setup();
    const { core } = await openLive(liveConsentedMeeting(), {
      settings: { speechModel: "/m/ggml-base.en.bin", locale: "en" },
    });
    expect(within(card()).queryByRole("combobox")).toBeNull();
    expect(within(card()).queryByText(/Speech model/)).toBeNull();
    expect(core.calls.some((c) => c.cmd === "list_speech_models")).toBe(false);
    await user.click(within(card()).getByRole("button", { name: "Resume recording" }));
    expect(startCalls(core)[0]!.args).toEqual({ meetingId: ID });
  });
});

describe("AC2 recording indicator and pause", () => {
  it("follows the core's capture states: recording, paused, error and stopped", async () => {
    const user = userEvent.setup();
    const { core, clock } = await openLive(liveConsentedMeeting());
    const timerBefore = screen.getByRole("region", { name: "Current item" }).textContent;

    await sendState({ state: "recording", elapsedMs: 23 * 60_000 + 41_000 });
    expect(chip()).toHaveTextContent("REC00:23:41");
    expect(chip()!.querySelector(".rec-chip__dot")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Listening · 0 speakers" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(core.calls.some((c) => c.cmd === "pause_recording")).toBe(true);
    await sendState({ state: "paused", elapsedMs: LIVE_ELAPSED_MS, level: 0 });
    expect(chip()).toHaveTextContent("Paused00:16:48");
    expect(chip()!.querySelector(".rec-chip__dot")).toBeNull();
    expect(screen.getByRole("button", { name: "Resume" })).toBeVisible();
    expect(within(card()).getByRole("button", { name: "Paused · 0 speakers" })).toBeVisible();
    // The agenda timer is not paused.
    act(() => clock.advance(30_000));
    expect(screen.getByRole("region", { name: "Current item" }).textContent).not.toBe(timerBefore);
    expect(chip()).toHaveTextContent("00:16:48");

    await sendState({ state: "error", reason: "microphoneLost", level: 0 });
    expect(chip()).toBeNull();
    expect(within(card()).getByRole("alert")).toHaveTextContent("The microphone stopped working.");
    expect(within(card()).getByRole("button", { name: "Resume recording" })).toBeVisible();

    await sendState({ state: "off", meetingId: null });
    expect(chip()).toBeNull();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(screen.getByText("On-device · DE/EN")).toBeVisible();
  });

  it("ignores capture states of another meeting", async () => {
    await openLive(liveConsentedMeeting());
    await sendState({ meetingId: "other" });
    expect(chip()).toBeNull();
  });

  it("End meeting stops capture before the meeting ends", async () => {
    const user = userEvent.setup();
    const { core } = await openLive(liveConsentedMeeting(), { status: state({}) });
    await user.click(screen.getByRole("button", { name: "End meeting" }));
    await user.click(screen.getByRole("button", { name: "Click again to end" }));
    await waitFor(() => expect(core.saved.some((m) => m.run?.endedAt)).toBe(true));
    const stopAt = core.calls.findIndex((c) => c.cmd === "stop_recording");
    const endAt = core.calls.findIndex(
      (c) => c.cmd === "save_meeting" && !!(c.args as { meeting: Meeting }).meeting.run?.endedAt,
    );
    expect(stopAt).toBeGreaterThan(-1);
    expect(stopAt).toBeLessThan(endAt);
  });
});

describe("AC4 transcript column", () => {
  it("shows final lines with HH:MM, a muted partial line that its final replaces, and only the Transcript label", async () => {
    await openLive(liveConsentedMeeting(), { status: state({}) });
    expect(within(card()).getByRole("heading", { name: "Transcript" })).toBeVisible();
    for (const other of ["Mind map", "Notes", "Search", "Mark moment"]) {
      expect(screen.queryByText(other)).toBeNull();
    }
    await sendSegment({
      text: "Guten Morgen zusammen.",
      lang: "de",
      at: new Date(2026, 9, 30, 10, 9).getTime(),
    });
    await sendSegment({ text: "Then let's", final: false, startMs: 2_000 });
    const items = within(card()).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("10:09Guten Morgen zusammen.");
    expect(items[0]).toHaveAttribute("lang", "de");
    const partial = screen.getByTestId("partial-line");
    expect(partial).toHaveTextContent("speaking…Then let's");
    expect(partial).toHaveClass("transcript-line--partial");
    await sendSegment({ text: "Then let's cut offline from the beta.", startMs: 2_000 });
    expect(screen.queryByTestId("partial-line")).toBeNull();
    expect(within(card()).getAllByRole("listitem")).toHaveLength(2);
    expect(within(card()).getAllByRole("listitem")[1]).toHaveTextContent(
      "Then let's cut offline from the beta.",
    );
  });

  it("uses the active locale for the time", async () => {
    localStorage.setItem("meeting-companion.locale", "de");
    await openLive(liveConsentedMeeting(), { status: state({}) });
    await sendSegment({ text: "x", at: new Date(2026, 9, 30, 14, 5).getTime() });
    expect(
      within(screen.getByRole("region", { name: "Transkript" })).getByRole("listitem"),
    ).toHaveTextContent("14:05x");
  });

  it("renders transcript text as text only", async () => {
    await openLive(liveConsentedMeeting(), { status: state({}) });
    await sendSegment({ text: "<img src=x onerror=alert(1)>" });
    await sendSegment({ text: "<b>bold</b>", final: false });
    expect(within(card()).getByText("<img src=x onerror=alert(1)>")).toBeVisible();
    expect(within(card()).getByText("<b>bold</b>")).toBeVisible();
    expect(document.querySelector("img")).toBeNull();
    expect(card().querySelector("b")).toBeNull();
  });

  it("shows Listening with the level meter while recording and Paused with flat bars", async () => {
    await openLive(liveConsentedMeeting(), { status: state({}) });
    expect(card().querySelector(".level-meter")).not.toBeNull();
    expect(card().querySelector(".level-meter--flat")).toBeNull();
    expect(within(card()).getByRole("button", { name: "Listening · 0 speakers" })).toBeVisible();
    await sendState({ state: "paused", level: 0 });
    expect(card().querySelector(".level-meter--flat")).not.toBeNull();
    await sendState({ state: "off", meetingId: null });
    expect(card().querySelector(".level-meter")).toBeNull();
  });

  it("announces new lines politely, at most once every 10 s", async () => {
    const { clock } = await openLive(liveConsentedMeeting(), {
      status: state({}),
      transcript: { segments: LIVE_TRANSCRIPT, error: null },
    });
    const live = screen.getByTestId("transcript-announcement");
    expect(live).toHaveAttribute("aria-live", "polite");
    // Stored lines are not announced.
    expect(live).toHaveTextContent("");
    await sendSegment({ text: "one" });
    expect(live).toHaveTextContent("1 new line in the transcript");
    await sendSegment({ text: "two" });
    await sendSegment({ text: "three" });
    act(() => clock.advance(5_000));
    expect(live).toHaveTextContent("1 new line in the transcript");
    act(() => clock.advance(5_000));
    expect(live).toHaveTextContent("2 new lines in the transcript");
  });

  it("follows the newest line, and offers Jump to latest after the reader scrolled up", async () => {
    const user = userEvent.setup();
    await openLive(liveConsentedMeeting(), {
      status: state({}),
      transcript: { segments: LIVE_TRANSCRIPT, error: null },
    });
    const feed = within(card()).getByRole("list", { name: "Transcript" });
    let top = 0;
    Object.defineProperty(feed, "scrollHeight", { configurable: true, get: () => 1_000 });
    Object.defineProperty(feed, "clientHeight", { configurable: true, get: () => 300 });
    Object.defineProperty(feed, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (v: number) => {
        top = Math.min(v, 700);
      },
    });
    await sendSegment({ text: "new line" });
    expect(top).toBe(700);
    expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull();
    // The reader scrolls up: new lines no longer move the list.
    top = 100;
    fireEvent.scroll(feed);
    await sendSegment({ text: "another line" });
    expect(top).toBe(100);
    const jump = screen.getByRole("button", { name: "Jump to latest" });
    await user.click(jump);
    expect(top).toBe(700);
    expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull();
    expect(feed).toHaveFocus();
  });

  it("says when the stored transcript could not be read", async () => {
    await openLive(liveConsentedMeeting(), { transcript: { segments: [], error: "corrupt" } });
    expect(within(card()).getByRole("alert")).toHaveTextContent(
      "The saved transcript of this meeting could not be read.",
    );
  });
});
