import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emit } from "@tauri-apps/api/event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { FakeClock } from "../../lib/clock";
import {
  EVENT_CAPTURE,
  EVENT_MIC_TEST,
  EVENT_SEGMENT,
  EVENT_SWITCHED,
  type CaptureState,
  type SwitchedEvent,
  type MicTestState,
  type SegmentEvent,
} from "../../lib/ipc";
import { FAKE_DEVICES, renderApp, type FakeCore, type FakeRecording } from "../../test/backend";
import { filledMeeting, LIVE_TIMES, LIVE_TRANSCRIPT, liveConsentedMeeting } from "../agenda/fixtures";
import { THEME_STORAGE_KEY } from "./theme";
import { LEGACY_MODEL_STORAGE_KEY, SettingsProvider, useSettings } from "./useSettings";

const ID = "fixture-live";
const MODEL = "/m/ggml-base.en.bin";

beforeEach(() => {
  localStorage.setItem("meeting-companion.locale", "en");
});

const calls = (core: FakeCore, cmd: string) => core.calls.filter((c) => c.cmd === cmd);
const changes = (core: FakeCore) =>
  calls(core, "update_setting").map((c) => (c.args as { change: unknown }).change);
const view = () => document.querySelector('main[data-view="settings"]');
const settingsButton = () =>
  screen.getAllByRole("button", { name: "Settings" }).find((b) => !b.closest("[hidden]"))!;

async function setup(rec: FakeRecording = {}) {
  return renderApp(
    { meeting: filledMeeting(), error: null },
    { recording: { ...rec, settings: { locale: "en", ...rec.settings } } },
  );
}

async function live(rec: FakeRecording = {}) {
  const clock = new FakeClock(LIVE_TIMES.running);
  return renderApp(
    { meeting: liveConsentedMeeting(), error: null },
    {
      clock,
      view: "live",
      // The same object, so a test can change how the fake core answers later.
      recording: Object.assign(rec, {
        transcript: rec.transcript ?? { segments: LIVE_TRANSCRIPT, error: null },
        settings: { locale: "en" as const, ...rec.settings },
      }),
    },
  );
}

const recordingState = (s: Partial<CaptureState> = {}): CaptureState => ({
  state: "recording",
  meetingId: ID,
  elapsedMs: 83_000,
  level: 0.6,
  reason: null,
  ...s,
});

describe("AC2 reachable, non-modal, applies at once", () => {
  it("the top-bar button opens the settings from setup, Back and Escape return with focus on the button", async () => {
    const user = userEvent.setup();
    await setup();
    expect(view()).toBeNull();
    await user.click(settingsButton());
    expect(view()).not.toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    // The setup view is kept underneath, hidden, with its edits.
    expect(screen.queryByRole("region", { name: /^Meeting$/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Back to setup" }));
    expect(view()).toBeNull();
    expect(settingsButton()).toHaveFocus();
    expect(screen.getByRole("region", { name: /^Meeting$/ })).toBeVisible();

    await user.click(settingsButton());
    await user.keyboard("{Escape}");
    expect(view()).toBeNull();
    expect(settingsButton()).toHaveFocus();
  });

  it("opens with Ctrl+, and Cmd+, and with the button by keyboard", async () => {
    const user = userEvent.setup();
    await setup();
    await user.keyboard("{Control>},{/Control}");
    expect(view()).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(view()).toBeNull();
    await user.keyboard("{Meta>},{/Meta}");
    expect(view()).not.toBeNull();
    await user.keyboard("{Escape}");

    settingsButton().focus();
    await user.keyboard("{Enter}");
    expect(view()).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Back to setup" }));
    settingsButton().focus();
    await user.keyboard(" ");
    expect(view()).not.toBeNull();
  });

  it("in the live view recording carries on: the REC chip stays, no capture command is sent, scroll is kept", async () => {
    const user = userEvent.setup();
    const { core } = await live({ status: recordingState() });
    await act(() => emit(EVENT_CAPTURE, recordingState()));
    const feed = await screen.findByRole("list", { name: "Transcript" });
    // The stored transcript has loaded, so no later line moves the feed.
    await waitFor(() =>
      expect(within(feed).getAllByRole("listitem").length).toBeGreaterThanOrEqual(LIVE_TRANSCRIPT.length),
    );
    // jsdom has no layout: a feed of 400 px in a 200 px window, read up to 40 px from the top.
    Object.defineProperty(feed, "scrollHeight", { value: 400, configurable: true });
    Object.defineProperty(feed, "clientHeight", { value: 200, configurable: true });
    feed.scrollTop = 40;
    fireEvent.scroll(feed);
    const before = core.calls.length;

    await user.click(settingsButton());
    expect(view()).not.toBeNull();
    // The settings view has its own REC chip, from the core's capture state.
    const chips = screen.getAllByTestId("rec-chip").filter((c) => !c.closest("[hidden]"));
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent("REC00:01:23");
    // Segments still reach the live view underneath.
    await act(() =>
      emit(EVENT_SEGMENT, {
        meetingId: ID,
        startMs: 90_000,
        endMs: 91_000,
        at: LIVE_TIMES.running,
        text: "Noch eine Zeile.",
        lang: "de",
        final: true,
      } satisfies SegmentEvent),
    );
    await user.keyboard("{Control>},{/Control}");
    await user.click(screen.getByRole("button", { name: "Back to meeting" }));
    expect(view()).toBeNull();
    expect(settingsButton()).toHaveFocus();
    expect(screen.getByRole("list", { name: "Transcript" })).toBe(feed);
    expect(feed.scrollTop).toBe(40);
    expect(within(feed).getByText("Noch eine Zeile.")).toBeInTheDocument();

    const sent = core.calls.slice(before).map((c) => c.cmd);
    for (const cmd of ["start_recording", "pause_recording", "stop_recording", "save_meeting"]) {
      expect(sent).not.toContain(cmd);
    }
    expect(screen.getByTestId("rec-chip")).toHaveTextContent("REC");
  });

  it("every change goes to the core at once (no Save button) and a second view applies it from the event", async () => {
    const user = userEvent.setup();
    const { core } = await setup();
    function Probe() {
      const { settings } = useSettings();
      return <output data-testid="probe">{`${settings.theme} ${settings.meetingLanguage}`}</output>;
    }
    render(
      <I18nProvider>
        <SettingsProvider>
          <Probe />
        </SettingsProvider>
      </I18nProvider>,
    );
    await user.click(settingsButton());
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    await user.click(screen.getByRole("tab", { name: /General/ }));
    await user.click(screen.getByRole("radio", { name: /Dark/ }));
    await user.click(screen.getByRole("tab", { name: /On this device/ }));
    await user.click(await screen.findByRole("radio", { name: "German" }));
    expect(changes(core)).toEqual([
      { key: "theme", value: "dark" },
      { key: "meetingLanguage", value: "de" },
    ]);
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("dark de"));
  });
});

describe("AC1 the UI keeps no device or model in localStorage", () => {
  it("moves job 003's model key into the store once, then removes it; device and model are never cached", async () => {
    const user = userEvent.setup();
    localStorage.setItem(LEGACY_MODEL_STORAGE_KEY, MODEL);
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const { core } = await renderApp({ meeting: filledMeeting(), error: null });
    await waitFor(() => expect(calls(core, "load_settings")).toHaveLength(1));
    expect((calls(core, "load_settings")[0]!.args as { cached: unknown }).cached).toEqual({
      locale: "en",
      theme: "dark",
      speechModel: MODEL,
    });
    await waitFor(() => expect(localStorage.getItem(LEGACY_MODEL_STORAGE_KEY)).toBeNull());

    await user.click(settingsButton());
    await user.selectOptions(screen.getByRole("combobox", { name: "Input device" }), "Jabra Speak 510");
    await user.click(screen.getByRole("tab", { name: /On this device/ }));
    await user.click(await screen.findByRole("radio", { name: /ggml-base\.en\.bin/ }));
    expect(changes(core)).toEqual([
      { key: "inputDevice", value: "Jabra Speak 510" },
      { key: "speechModel", value: MODEL },
    ]);
    const stored = Object.keys(localStorage)
      .map((k) => `${k}=${localStorage.getItem(k)}`)
      .join("\n");
    expect(stored).not.toContain("Jabra");
    expect(stored).not.toContain("ggml");
    expect(Object.keys(localStorage).sort()).toEqual(["meeting-companion.locale", THEME_STORAGE_KEY]);
  });
});

describe("AC3 microphone choice", () => {
  it("lists System default first, then the connected devices", async () => {
    const user = userEvent.setup();
    await setup();
    await user.click(settingsButton());
    const select = screen.getByRole("combobox", { name: "Input device" });
    await waitFor(() =>
      expect(
        within(select)
          .getAllByRole("option")
          .map((o) => o.textContent),
      ).toEqual(["System default", ...FAKE_DEVICES]),
    );
    expect(select).toHaveValue("");
    expect(screen.getByText("Connected")).toBeVisible();
  });

  it("a chosen device that is gone is shown as not connected, with one tap back to the system default", async () => {
    const user = userEvent.setup();
    const { core } = await setup({ settings: { inputDevice: "Gone Mic" } });
    await user.click(settingsButton());
    expect(await screen.findByText("Gone Mic is not connected")).toBeVisible();
    expect(screen.getByText("Not connected")).toBeVisible();
    expect(screen.getByRole("button", { name: "Test microphone" })).toBeDisabled();
    expect(screen.getByText("Connect Gone Mic or choose another device to test.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Use system default" }));
    expect(changes(core)).toEqual([{ key: "inputDevice", value: null }]);
    await waitFor(() => expect(screen.queryByText("Gone Mic is not connected")).toBeNull());
  });

  it("chosenMicrophoneMissing in the live view offers Use system default (then starts) and Settings", async () => {
    const user = userEvent.setup();
    const rec: FakeRecording = {
      settings: { inputDevice: "Jabra Speak 510" },
      startError: { kind: "failed", reason: "chosenMicrophoneMissing" },
    };
    const { core } = await live(rec);
    await user.click(screen.getByRole("button", { name: "Resume recording" }));
    const notice = await screen.findByTestId("mic-missing");
    expect(within(notice).getByRole("heading", { name: "Jabra Speak 510 is not connected" })).toBeVisible();
    expect(screen.queryByTestId("rec-chip")).toBeNull();
    // "Settings" opens the settings view.
    await user.click(within(notice).getByRole("button", { name: "Settings" }));
    expect(view()).not.toBeNull();
    await user.keyboard("{Escape}");
    // "Use system default": the setting changes, then recording starts.
    delete rec.startError;
    await user.click(
      within(screen.getByTestId("mic-missing")).getByRole("button", { name: "Use system default" }),
    );
    await waitFor(() => expect(calls(core, "start_recording")).toHaveLength(2));
    const order = core.calls
      .map((c) => c.cmd)
      .filter((c) => c === "update_setting" || c === "start_recording");
    expect(order.slice(-2)).toEqual(["update_setting", "start_recording"]);
    expect(changes(core)).toEqual([{ key: "inputDevice", value: null }]);
    await waitFor(() => expect(screen.getByTestId("rec-chip")).toBeInTheDocument());
  });

  it("while recording, the panel says a different device applies at the next Start or Resume", async () => {
    const user = userEvent.setup();
    await live({ status: recordingState() });
    await user.click(settingsButton());
    expect(await screen.findByText("A different device applies at the next Start or Resume.")).toBeVisible();
    expect(screen.getByText("In use by this recording")).toBeVisible();
  });

  it("offers the device-lost policy as a labelled radio group, default Stop", async () => {
    const user = userEvent.setup();
    const { core } = await setup();
    await user.click(settingsButton());
    const group = screen.getByRole("group", { name: "When the microphone disappears" });
    expect(within(group).getByRole("radio", { name: /Stop recording and tell me/ })).toBeChecked();
    await user.click(within(group).getByRole("radio", { name: /Switch to the system default/ }));
    expect(changes(core)).toEqual([{ key: "deviceLost", value: "switchToDefault" }]);
  });
});

describe("AC3 switched to the system default (frame 02 addition)", () => {
  it("shows a non-blocking notice with icon and text; Dismiss hides it; recording state is untouched", async () => {
    const user = userEvent.setup();
    const { core } = await live({ status: recordingState(), settings: { inputDevice: "Jabra Speak 510" } });
    await act(() => emit(EVENT_CAPTURE, recordingState()));
    const before = core.calls.length;
    await act(() =>
      emit(EVENT_SWITCHED, {
        meetingId: ID,
        at: LIVE_TIMES.running,
        elapsedMs: 83_000,
      } satisfies SwitchedEvent),
    );
    const notice = await screen.findByTestId("mic-switched");
    expect(notice).toHaveAttribute("role", "status");
    expect(notice).toHaveTextContent("Switched to the system microphone");
    expect(notice).toHaveTextContent(/Jabra Speak 510 stopped at \d\d:\d\d\. Recording carries on/);
    expect(notice.querySelector("svg")).not.toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("rec-chip")).toHaveTextContent("REC00:01:23");
    // A switch for another meeting is ignored.
    await user.click(within(notice).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("mic-switched")).toBeNull();
    await act(() =>
      emit(EVENT_SWITCHED, { meetingId: "other", at: 1, elapsedMs: 0 } satisfies SwitchedEvent),
    );
    expect(screen.queryByTestId("mic-switched")).toBeNull();
    const sent = core.calls.slice(before).map((c) => c.cmd);
    expect(sent.filter((c) => c.includes("recording"))).toEqual([]);
  });
});

describe("AC4 microphone test", () => {
  const sendTest = (s: Partial<MicTestState>) =>
    act(() => emit(EVENT_MIC_TEST, { state: "running", remainingMs: 7_000, level: 0.5, reason: null, ...s }));

  it("runs with a visible label, countdown and moving meter; Stop test and leaving the view stop it", async () => {
    const user = userEvent.setup();
    const { core } = await setup();
    await user.click(settingsButton());
    await user.click(screen.getByRole("button", { name: "Test microphone" }));
    expect(calls(core, "start_mic_test")).toHaveLength(1);
    expect(await screen.findByTestId("mic-test-running")).toHaveTextContent("Microphone test running");
    await sendTest({ remainingMs: 6_400, level: 0.7 });
    expect(screen.getByText("0:07 left")).toBeVisible();
    const wave = screen.getByTestId("settings-meter").querySelector(".sound-wave--settings");
    expect(wave).toHaveAttribute("data-state", "listening");
    expect(wave!.querySelectorAll(".sound-wave__bar")).toHaveLength(31);
    await user.click(screen.getByRole("button", { name: "Stop test" }));
    expect(calls(core, "stop_mic_test")).toHaveLength(1);
    expect(screen.queryByTestId("mic-test-running")).toBeNull();

    // Leaving the view while a test runs stops it.
    await user.click(screen.getByRole("button", { name: "Test microphone" }));
    await sendTest({});
    await user.click(screen.getByRole("button", { name: "Back to setup" }));
    await waitFor(() => expect(calls(core, "stop_mic_test")).toHaveLength(2));
    // And leaving the Audio section.
    await user.click(settingsButton());
    await user.click(screen.getByRole("button", { name: "Test microphone" }));
    await sendTest({});
    await user.click(screen.getByRole("tab", { name: /General/ }));
    await waitFor(() => expect(calls(core, "stop_mic_test")).toHaveLength(3));
  });

  it("the core ending the test after 10 s clears the label", async () => {
    const user = userEvent.setup();
    await setup();
    await user.click(settingsButton());
    await user.click(screen.getByRole("button", { name: "Test microphone" }));
    await screen.findByTestId("mic-test-running");
    await sendTest({ state: "off", remainingMs: 0, level: 0 });
    expect(screen.queryByTestId("mic-test-running")).toBeNull();
    expect(screen.getByText("No test running")).toBeVisible();
  });

  it("is disabled with the reason in text while a meeting records, and the meter shows the recording", async () => {
    const user = userEvent.setup();
    const { core } = await live({ status: recordingState() });
    await user.click(settingsButton());
    const button = await screen.findByRole("button", { name: "Test microphone" });
    await waitFor(() => expect(button).toBeDisabled());
    expect(screen.getByText("Not available while the meeting records or is paused.")).toBeVisible();
    expect(button).toHaveAccessibleDescription("Not available while the meeting records or is paused.");
    expect(screen.getByText("Recording · System default")).toBeVisible();
    expect(screen.getByTestId("settings-meter").querySelector(".sound-wave")).toHaveAttribute(
      "data-state",
      "listening",
    );
    await act(() => emit(EVENT_CAPTURE, recordingState({ state: "paused", level: 0 })));
    expect(screen.getByTestId("settings-meter").querySelector(".sound-wave")).toHaveAttribute(
      "data-state",
      "paused",
    );
    expect(screen.getByText("Recording paused · System default")).toBeVisible();
    expect(button).toBeDisabled();
    expect(calls(core, "start_mic_test")).toHaveLength(0);
  });

  it("a device that fails during the test shows its reason in the section", async () => {
    const user = userEvent.setup();
    await setup({ micTestError: { kind: "failed", reason: "microphoneBlocked" } });
    await user.click(settingsButton());
    await user.click(screen.getByRole("button", { name: "Test microphone" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The microphone could not be opened.");
  });
});

describe("AC5 On this device", () => {
  it("lists the speech models with name, size, language, source, folder and the English-only hint", async () => {
    const user = userEvent.setup();
    await setup();
    await user.click(settingsButton());
    await user.click(screen.getByRole("tab", { name: /On this device/ }));
    const group = await screen.findByRole("group", { name: "Transcribe with" });
    const base = within(group).getByRole("radio", { name: /ggml-base\.bin/ });
    expect(base).toBeChecked();
    expect(within(group).getByText("148 MB · German and English · Voxtype")).toBeVisible();
    expect(within(group).getAllByText("Found in /m")).toHaveLength(2);
    expect(within(group).getByText(/only understands English/)).toBeVisible();
  });

  it("shows the searched folders when no model is found", async () => {
    const user = userEvent.setup();
    await setup({
      models: { models: [], searched: ["/home/u/.local/share/voxtype/models", "/home/u/.cache/hf"] },
    });
    await user.click(settingsButton());
    await user.click(screen.getByRole("tab", { name: /On this device/ }));
    expect(await screen.findByText("No speech model installed")).toBeVisible();
    expect(screen.getByText("/home/u/.cache/hf")).toBeVisible();
  });

  it("a chosen model that has disappeared is shown as not found any more, with the one used instead", async () => {
    const user = userEvent.setup();
    await setup({ settings: { speechModel: "/gone/ggml-large.bin" } });
    await user.click(settingsButton());
    await user.click(screen.getByRole("tab", { name: /On this device/ }));
    expect(await screen.findByText("ggml-large.bin: not found any more")).toBeVisible();
    expect(screen.getByText(/the app uses ggml-base\.bin/)).toBeVisible();
  });

  it("the default meeting language sets the on-device chip; the storage folder is read-only text", async () => {
    const user = userEvent.setup();
    const { core } = await live();
    expect(screen.getByTestId("device-chip")).toHaveTextContent("On-device · DE/EN");
    await user.click(settingsButton());
    await user.click(screen.getByRole("tab", { name: /On this device/ }));
    const group = await screen.findByRole("group", { name: "Default meeting language" });
    const auto = within(group).getByRole("radio", { name: "German + English" });
    expect(auto).toBeChecked();
    expect(auto).toHaveAccessibleDescription("Detect per line");
    await user.click(within(group).getByRole("radio", { name: "English" }));
    expect(changes(core)).toEqual([{ key: "meetingLanguage", value: "en" }]);
    await waitFor(() =>
      expect(screen.getAllByTestId("device-chip").every((c) => c.textContent === "On-device · EN")).toBe(
        true,
      ),
    );
    await user.click(within(group).getByRole("radio", { name: "German" }));
    await waitFor(() => expect(screen.getAllByTestId("device-chip")[0]).toHaveTextContent("On-device · DE"));
    const path = screen.getByRole("textbox", { name: "Meetings and transcripts" });
    expect(path).toHaveAttribute("readonly");
    expect(path).toHaveValue("/home/u/.local/share/de.udspotsdam.meetingcompanion/meetings");
  });
});

describe("AC6 General", () => {
  let listeners: ((e: { matches: boolean }) => void)[] = [];
  let dark = false;
  beforeEach(() => {
    listeners = [];
    dark = false;
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        get matches() {
          return dark;
        },
        addEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.push(l),
        removeEventListener: (_: string, l: (e: { matches: boolean }) => void) => {
          listeners = listeners.filter((x) => x !== l);
        },
      })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.theme;
  });

  it("app language here and in the top bar is the same setting, and <html lang> follows", async () => {
    const user = userEvent.setup();
    const { core } = await setup();
    await user.click(settingsButton());
    await user.click(screen.getByRole("tab", { name: /General/ }));
    await user.click(screen.getByRole("radio", { name: /Deutsch/ }));
    await waitFor(() => expect(document.documentElement.lang).toBe("de"));
    expect(screen.getByRole("heading", { level: 1, name: "Einstellungen" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() => expect(document.documentElement.lang).toBe("en"));
    expect(screen.getByRole("radio", { name: /English/ })).toBeChecked();
    expect(changes(core)).toEqual([
      { key: "locale", value: "de" },
      { key: "locale", value: "en" },
    ]);
  });

  it("sets data-theme, and System follows a prefers-color-scheme change without a reload", async () => {
    const user = userEvent.setup();
    await setup();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    await user.click(settingsButton());
    await user.click(screen.getByRole("tab", { name: /General/ }));
    expect(screen.getByRole("radio", { name: /System/ })).toBeChecked();
    expect(screen.getByText("Follows the system · now light")).toBeVisible();
    act(() => {
      dark = true;
      listeners.forEach((l) => l({ matches: true }));
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByText("Follows the system · now dark")).toBeVisible();
    await user.click(screen.getByRole("radio", { name: /Light/ }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    await user.click(screen.getByRole("radio", { name: /Dark/ }));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("Job 004: the speaker model in On this device (frame 14d)", () => {
  const TWO = {
    models: [
      {
        id: "/m/campplus.onnx",
        name: "campplus.onnx",
        sizeBytes: 28_281_164,
        source: "app" as const,
        folder: "/m",
      },
      {
        id: "/hf/resnet34.onnx",
        name: "wespeaker_en_voxceleb_resnet34.onnx",
        sizeBytes: 26_500_000,
        source: "huggingFace" as const,
        folder: "/hf",
      },
    ],
    searched: ["/m", "/hf"],
  };

  async function open(rec: FakeRecording) {
    const user = userEvent.setup();
    const utils = await setup(rec);
    await user.click(settingsButton());
    await user.click(screen.getByRole("tab", { name: /On this device/ }));
    return { user, ...utils };
  }

  it("lists the models found, uses the preferred one and stores a choice", async () => {
    const { user, core } = await open({ speakerModels: TWO });
    const select = await screen.findByRole("combobox", { name: "Tell voices apart with" });
    expect(select).toHaveValue("/m/campplus.onnx");
    expect(select).toHaveAccessibleDescription("28 MB · Meeting Companion");
    await user.selectOptions(select, "/hf/resnet34.onnx");
    expect(changes(core)).toEqual([{ key: "speakerModel", value: "/hf/resnet34.onnx" }]);
    await waitFor(() => expect(select).toHaveValue("/hf/resnet34.onnx"));
  });

  it("says None found and lists the folders searched", async () => {
    await open({ speakerModels: { models: [], searched: ["/data/app/models", "/home/u/.cache/hf"] } });
    expect(await screen.findByText("None found")).toBeVisible();
    expect(screen.getByText("/home/u/.cache/hf")).toBeVisible();
  });

  it("a chosen model that has disappeared reads Not found any more, with the one used instead", async () => {
    await open({
      speakerModels: TWO,
      settings: { speakerModel: "/gone/wespeaker_en_voxceleb_resnet34.onnx" },
    });
    const select = await screen.findByRole("combobox", { name: "Tell voices apart with" });
    expect(select).toHaveAccessibleDescription("Not found any more");
    expect(screen.getByText("The chosen model was moved or deleted.")).toBeVisible();
    expect(screen.getByText(/the app uses campplus\.onnx \(28 MB · Meeting Companion\)/)).toBeVisible();
  });
});
