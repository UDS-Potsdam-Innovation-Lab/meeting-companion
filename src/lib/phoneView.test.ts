// Job 012: the phone view's IPC (two commands, one event) and the mock core consumers' fixtures use.
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import de from "../i18n/de.json";
import en from "../i18n/en.json";
import { liveConsentedMeeting } from "../features/agenda/fixtures";
import {
  onPhoneViewState,
  pauseRecording,
  phoneViewClose,
  phoneViewOpen,
  saveMeeting,
  startRecording,
  stopRecording,
  type PhoneViewState,
} from "./ipc";
import { installMockBackend, MOCK_PHONE_VIEW, PHONE_NETWORK_KEY } from "./mockBackend";

afterEach(() => {
  clearMocks();
  localStorage.clear();
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("phone view IPC", () => {
  it("opens with the meeting id and returns url and qrSvg", async () => {
    const calls: [string, unknown][] = [];
    mockIPC((cmd, args) => {
      calls.push([cmd, args]);
      return cmd === "phone_view_open" ? { url: "http://10.0.0.2:5000/#t=x", qrSvg: "<svg/>" } : null;
    });
    expect(await phoneViewOpen("m-1")).toEqual({ url: "http://10.0.0.2:5000/#t=x", qrSvg: "<svg/>" });
    await phoneViewClose();
    expect(calls.map(([c]) => c)).toEqual(["phone_view_open", "phone_view_close"]);
    expect(calls[0]![1]).toEqual({ meetingId: "m-1" });
  });

  it("rejects with the core's error key, and an unknown failure as phoneView.error.failed", async () => {
    for (const key of ["phoneView.error.notRecording", "phoneView.error.noLocalNetwork"]) {
      mockIPC(() => {
        throw { key };
      });
      await expect(phoneViewOpen("m-1")).rejects.toEqual({ key });
    }
    mockIPC(() => {
      throw new Error("boom");
    });
    await expect(phoneViewOpen("m-1")).rejects.toEqual({ key: "phoneView.error.failed" });
  });

  it("every error key has a message in de and en", () => {
    for (const key of [
      "phoneView.error.notRecording",
      "phoneView.error.noLocalNetwork",
      "phoneView.error.failed",
    ]) {
      expect(de).toHaveProperty([key]);
      expect(en).toHaveProperty([key]);
    }
  });
});

describe("phone view in the mock core", () => {
  const id = liveConsentedMeeting().id;

  function install() {
    window.history.replaceState(null, "", "/?fixture=live-transcript");
    installMockBackend();
    const events: PhoneViewState[] = [];
    const stop = onPhoneViewState((s) => events.push(s));
    return { events, stop };
  }

  it("returns the fixed URL and the core's QR code while the meeting records", async () => {
    const { events, stop } = install();
    await tick();
    expect(await phoneViewOpen(id)).toEqual(MOCK_PHONE_VIEW);
    expect(MOCK_PHONE_VIEW.url).toBe("http://192.168.178.20:49152/#t=FAKE-TOKEN-for-tests-only");
    expect(MOCK_PHONE_VIEW.qrSvg).toMatch(/^<svg [^>]*viewBox="0 0 \d+ \d+"/);
    expect(MOCK_PHONE_VIEW.qrSvg).not.toMatch(/script|foreignObject|href|on\w+=/i);
    // Again: the same URL, no second event.
    expect(await phoneViewOpen(id)).toEqual(MOCK_PHONE_VIEW);
    await tick();
    expect(events).toEqual([{ state: "open", meetingId: id, reason: null }]);
    await phoneViewClose();
    await tick();
    expect(events.at(-1)).toEqual({ state: "closed", meetingId: id, reason: "requested" });
    await stopRecording();
    stop();
  });

  it("refuses while not recording or without a network, and closes when recording stops or the meeting ends", async () => {
    const { events, stop } = install();
    await tick();
    await expect(phoneViewOpen("m-other")).rejects.toEqual({ key: "phoneView.error.notRecording" });
    localStorage.setItem(PHONE_NETWORK_KEY, "none");
    await expect(phoneViewOpen(id)).rejects.toEqual({ key: "phoneView.error.noLocalNetwork" });
    localStorage.removeItem(PHONE_NETWORK_KEY);

    await phoneViewOpen(id);
    await pauseRecording();
    await tick();
    expect(events.at(-1)?.state).toBe("open");
    await stopRecording();
    await tick();
    expect(events.at(-1)).toEqual({ state: "closed", meetingId: id, reason: "recordingStopped" });
    await expect(phoneViewOpen(id)).rejects.toEqual({ key: "phoneView.error.notRecording" });

    await startRecording(id);
    await phoneViewOpen(id);
    const meeting = liveConsentedMeeting();
    const items = meeting.run!.items.map((i) => ({ ...i, endedAt: i.endedAt ?? i.startedAt + 60_000 }));
    const endedAt = Math.max(...items.map((i) => i.endedAt));
    await saveMeeting({ ...meeting, run: { ...meeting.run!, items, endedAt } });
    await tick();
    const closed = events.filter((e) => e.state === "closed").map((e) => e.reason);
    expect(closed).toEqual(["recordingStopped", "meetingEnded"]);
    stop();
  });
});
