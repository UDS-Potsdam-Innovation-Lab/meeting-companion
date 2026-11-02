import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import de from "./de.json";
import en from "./en.json";
import { FAKE_LLM_MODELS, FAKE_SPEAKER_MODELS, renderApp } from "../test/backend";
import {
  filledMeeting,
  FIXTURE_PARTICIPANTS,
  liveConsentedMeeting,
  SPEAKER_CHOICES,
  SPEAKER_TRANSCRIPT,
  LIVE_PARTIAL,
  LIVE_TIMES,
  LIVE_TRANSCRIPT,
  liveDoneMeeting,
  liveMeeting,
  FREE_TIMES,
  freeSetupMeeting,
  liveFreeEmptyMeeting,
  liveFreeMeeting,
} from "../features/agenda/fixtures";
import { emit } from "@tauri-apps/api/event";
import { EVENT_CAPTURE, EVENT_SEGMENT, type CaptureState, type SegmentEvent } from "../lib/ipc";
import { initials, type Meeting } from "../features/agenda/model";
import { FakeClock } from "../lib/clock";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("AC6 catalogues", () => {
  it("every key exists in both locales", () => {
    const deKeys = Object.keys(de).sort();
    const enKeys = Object.keys(en).sort();
    expect(deKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
    expect(enKeys.filter((k) => !deKeys.includes(k))).toEqual([]);
  });

  it("no message is empty and both locales use the same placeholders", () => {
    for (const [key, text] of Object.entries(de)) {
      const other = (en as Record<string, string>)[key]!;
      expect(text.trim(), key).not.toBe("");
      expect(other.trim(), key).not.toBe("");
      expect(placeholders(other), key).toEqual(placeholders(text));
    }
  });
});

function literalOffenders(container: HTMLElement, meeting: Meeting, extra: string[] = []): string[] {
  const userData = new Set<string>([
    ...extra,
    meeting.title,
    ...meeting.participants.flatMap((p) => [p.name, initials(p.name)]),
    ...meeting.items.flatMap((i) => [i.title, i.outcome]),
  ]);
  const allowed = (s: string) => {
    const text = s.trim();
    if (text === "") return true;
    if (/^(⟦[\w.]+⟧\s*)+$/.test(text)) return true;
    if (/^[\d\s:.\-–·]+$/.test(text)) return true;
    return userData.has(text);
  };
  const offenders: string[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!allowed(n.textContent ?? "")) offenders.push(`text: ${n.textContent}`);
  }
  for (const el of container.querySelectorAll("*")) {
    for (const attr of ["aria-label", "aria-valuetext", "title", "placeholder", "alt"]) {
      const v = el.getAttribute(attr);
      if (v !== null && !allowed(v)) offenders.push(`${attr}: ${v}`);
    }
  }
  return offenders;
}

describe("AC7 (job 002) no literal strings in the live view", () => {
  it("timer, agenda, parking lot, overall line, nudge and End meeting come from keys", async () => {
    const user = userEvent.setup();
    const meeting = liveMeeting();
    const clock = new FakeClock(LIVE_TIMES.nudge);
    const { container, unmount } = await renderApp(
      { meeting, error: null },
      { keyMode: true, clock, view: "live" },
    );
    await user.click(screen.getByRole("button", { name: "⟦live.park⟧" }));
    await user.click(screen.getByRole("button", { name: /⟦live.parking.title⟧/ }));
    await user.click(screen.getByRole("button", { name: "⟦live.end⟧" }));
    expect(container.querySelector(".nudge")).toBeNull();
    act(() => clock.set(LIVE_TIMES.over + 30 * 60_000));
    expect(screen.getByRole("group", { name: /⟦nudge/ })).toBeInTheDocument();
    expect(literalOffenders(container, meeting)).toEqual([]);
    unmount();

    const done = liveDoneMeeting();
    const r = await renderApp({ meeting: done, error: null }, { keyMode: true, clock, view: "live" });
    expect(screen.getByRole("heading", { name: "⟦live.done.title⟧" })).toBeInTheDocument();
    expect(literalOffenders(r.container, done)).toEqual([]);
  });

  it("the Start meeting button and its reason come from keys", async () => {
    const meeting = { ...filledMeeting(), items: [] };
    const { container } = await renderApp({ meeting, error: null }, { keyMode: true });
    expect(screen.getByRole("button", { name: "⟦start.button⟧" })).toBeInTheDocument();
    expect(screen.getByText("⟦start.reason.noItems⟧")).toBeInTheDocument();
    expect(literalOffenders(container, meeting)).toEqual([]);
  });
});

describe("AC7 (job 003) no literal strings in the transcript column and recording controls", () => {
  const sendState = (s: Partial<CaptureState>) =>
    act(() =>
      emit(EVENT_CAPTURE, {
        state: "recording",
        meetingId: "fixture-live",
        elapsedMs: 1_000,
        level: 0.5,
        reason: null,
        ...s,
      } satisfies CaptureState),
    );

  it("consent, recording, paused and error states come from keys", async () => {
    const meeting = liveMeeting();
    const clock = new FakeClock(LIVE_TIMES.running);
    const texts = LIVE_TRANSCRIPT.map((l) => l.text);
    const { container, unmount } = await renderApp(
      { meeting, error: null },
      {
        keyMode: true,
        clock,
        view: "live",
        recording: { transcript: { segments: LIVE_TRANSCRIPT, error: null } },
      },
    );
    expect(await screen.findByRole("button", { name: "⟦consent.start⟧" })).toBeInTheDocument();
    expect(literalOffenders(container, meeting, texts)).toEqual([]);
    await sendState({});
    await act(() =>
      emit(EVENT_SEGMENT, { ...LIVE_PARTIAL, meetingId: "fixture-live" } satisfies SegmentEvent),
    );
    expect(screen.getByText("⟦transcript.speaking⟧")).toBeInTheDocument();
    expect(literalOffenders(container, meeting, [...texts, LIVE_PARTIAL.text])).toEqual([]);
    await sendState({ state: "paused" });
    expect(literalOffenders(container, meeting, texts)).toEqual([]);
    await sendState({ state: "error", reason: "noMicrophone" });
    expect(literalOffenders(container, meeting, texts)).toEqual([]);
    unmount();
  });
});

describe("AC7 (job 006) no literal strings in the settings view and its frame 02 additions", () => {
  const STORAGE = "/home/u/.local/share/de.udspotsdam.meetingcompanion/meetings";
  const DEVICES = ["Built-in Audio Analog Stereo", "Jabra Speak 510"];
  const MODELS = ["ggml-base.bin", "ggml-base.en.bin", "/m"];
  const sendState = (s: Partial<CaptureState>) =>
    act(() =>
      emit(EVENT_CAPTURE, {
        state: "recording",
        meetingId: "fixture-live",
        elapsedMs: 1_000,
        level: 0.5,
        reason: null,
        ...s,
      } satisfies CaptureState),
    );

  it("every section, the device-missing, test and recording states come from keys", async () => {
    const user = userEvent.setup();
    const meeting = liveMeeting();
    const clock = new FakeClock(LIVE_TIMES.running);
    const { container, unmount } = await renderApp(
      { meeting, error: null },
      { keyMode: true, clock, view: "live", recording: { settings: { inputDevice: "Gone Mic" } } },
    );
    await user.click(screen.getByRole("button", { name: "⟦settings.open⟧" }));
    // Audio, with the chosen device missing.
    await screen.findByText("⟦settings.audio.missing.title⟧");
    const data = [
      ...DEVICES,
      ...MODELS,
      ...FAKE_SPEAKER_MODELS.models.map((m) => m.name),
      STORAGE,
      "Gone Mic",
    ];
    expect(literalOffenders(container, meeting, data)).toEqual([]);
    // Recording: the meter shows the meeting.
    await sendState({});
    await screen.findByText("⟦settings.test.disabledRecording⟧");
    expect(literalOffenders(container, meeting, data)).toEqual([]);
    await sendState({ state: "off", meetingId: null });
    for (const s of ["device", "general"]) {
      await user.click(screen.getByRole("tab", { name: new RegExp(`settings.section.${s}⟧`) }));
      if (s === "device") await screen.findByText("ggml-base.en.bin");
      expect(literalOffenders(container, meeting, data)).toEqual([]);
    }
    unmount();

    // No model found; the start failure of frame 02.
    const r = await renderApp(
      { meeting: { ...meeting, recordingConsentAt: 1 }, error: null },
      {
        keyMode: true,
        clock,
        view: "live",
        recording: {
          models: { models: [], searched: ["/x/models"] },
          settings: { inputDevice: "Gone Mic" },
          startError: { kind: "failed", reason: "chosenMicrophoneMissing" },
        },
      },
    );
    await user.click(screen.getByRole("button", { name: "⟦recording.resumeRecording⟧" }));
    await screen.findByText("⟦recording.missing.title⟧");
    expect(literalOffenders(r.container, meeting, data)).toEqual([]);
    await user.click(screen.getAllByRole("button", { name: "⟦settings.open⟧" })[1]!);
    await user.click(screen.getByRole("tab", { name: /settings.section.device⟧/ }));
    await screen.findByText("⟦model.none.title⟧");
    expect(literalOffenders(r.container, meeting, [...data, "/x/models"])).toEqual([]);
  });
});

describe("AC7 (job 004) no literal strings in the speakers view and the line picker", () => {
  it("filled, guest input, line picker, empty and no-model states come from keys", async () => {
    const user = userEvent.setup();
    const meeting = liveConsentedMeeting();
    const clock = new FakeClock(LIVE_TIMES.running);
    const speakers = {
      participants: FIXTURE_PARTICIPANTS,
      voices: SPEAKER_CHOICES.voices,
      lines: [{ seq: 9, participantId: "p-jr" }],
      suggestions: [
        { voice: "C", candidates: ["p-ls"], unsure: false },
        { voice: "D", candidates: ["p-ya", "p-jr"], unsure: true },
      ],
    };
    // Transcript text and voice labels are data, like names.
    const data = [...SPEAKER_TRANSCRIPT.map((l) => l.text), "A", "B", "C", "D", "E"];
    const { container, unmount } = await renderApp(
      { meeting, error: null },
      {
        keyMode: true,
        clock,
        view: "live",
        recording: {
          status: { state: "recording", meetingId: meeting.id, elapsedMs: 1_000, level: 0.5, reason: null },
          transcript: { segments: SPEAKER_TRANSCRIPT, error: null },
          speakers,
        },
      },
    );
    const lineButtons = await screen.findAllByRole("button", { name: /⟦speakers.line.suffix⟧$/ });
    await user.click(lineButtons[0]!);
    await user.click(screen.getByRole("button", { name: "⟦speakers.addGuest⟧" }));
    await user.click(screen.getByRole("button", { name: "⟦speakers.guest.add⟧" }));
    expect(screen.getByRole("alert")).toHaveTextContent("⟦speakers.guest.error.empty⟧");
    expect(literalOffenders(container, meeting, data)).toEqual([]);
    await user.keyboard("{Escape}");
    await user.keyboard("{Escape}");
    // "No signal" follows after 500 ms of real time without a level event; either footer word opens it.
    await user.click(screen.getByRole("button", { name: /⟦speakers.footer.(listening|noSignal)/ }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("⟦speakers.title.other⟧");
    await user.selectOptions(screen.getAllByRole("combobox")[4]!, "⟦speakers.addGuest⟧");
    expect(literalOffenders(container, meeting, data)).toEqual([]);
    unmount();

    const none = await renderApp(
      { meeting, error: null },
      {
        keyMode: true,
        clock,
        view: "live",
        recording: {
          status: { state: "paused", meetingId: meeting.id, elapsedMs: 1_000, level: 0, reason: null },
          speakerModels: { models: [], searched: ["/x/models"] },
        },
      },
    );
    await user.click(await screen.findByRole("button", { name: /⟦speakers.footer.paused/ }));
    expect(screen.getByText("⟦speakers.noModel.title⟧")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("⟦speakers.title.empty⟧");
    expect(literalOffenders(none.container, meeting, ["/x/models"])).toEqual([]);
  });
});

describe("AC6 no literal user-facing strings", () => {
  // With keyMode every catalogue string renders as ⟦key⟧. Anything else that is visible text must be
  // user data from the meeting, initials derived from it, or numbers.
  it("every visible text and accessible label comes from a key", async () => {
    const user = userEvent.setup();
    const meeting = filledMeeting();
    const { container } = await renderApp({ meeting, error: "corrupt" }, { keyMode: true });
    // Open an editor and trigger validation messages so those strings are covered as well.
    await user.click(screen.getByRole("button", { name: /Check-in & goals/ }));
    await user.clear(screen.getByLabelText("⟦editor.title⟧"));
    await user.clear(screen.getByLabelText("⟦meeting.title⟧"));
    await user.click(screen.getByRole("button", { name: "⟦meeting.participants.add⟧" }));

    const userData = new Set<string>([
      meeting.title,
      ...meeting.participants.flatMap((p) => [p.name, initials(p.name)]),
      ...meeting.items.flatMap((i) => [i.title, i.outcome]),
    ]);
    const allowed = (s: string) => {
      const text = s.trim();
      if (text === "") return true;
      if (/^(⟦[\w.]+⟧\s*)+$/.test(text)) return true;
      if (/^[\d\s:.\-–·]+$/.test(text)) return true;
      return userData.has(text);
    };

    const offenders: string[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!allowed(n.textContent ?? "")) offenders.push(`text: ${n.textContent}`);
    }
    for (const el of container.querySelectorAll("*")) {
      for (const attr of ["aria-label", "title", "placeholder", "alt"]) {
        const v = el.getAttribute(attr);
        if (v !== null && !allowed(v)) offenders.push(`${attr}: ${v}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("AC7 (job 009) no literal strings in agenda-free mode", () => {
  it("the mode switch and the free setup come from keys", async () => {
    const meeting = freeSetupMeeting();
    const { container } = await renderApp({ meeting, error: null }, { keyMode: true });
    expect(screen.getByRole("group", { name: "⟦setup.mode.label⟧" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "⟦setup.free.title⟧" })).toBeInTheDocument();
    expect(literalOffenders(container, meeting)).toEqual([]);
  });

  it("timer card, topics, add field with an error, the half-time nudge and the over state come from keys", async () => {
    const user = userEvent.setup();
    const meeting = liveFreeMeeting();
    const clock = new FakeClock(FREE_TIMES.half);
    const { container, unmount } = await renderApp(
      { meeting, error: null },
      { keyMode: true, clock, view: "live", recording: { transcript: { segments: [], error: null } } },
    );
    const topics = meeting.run!.topics!.map((t) => t.title);
    expect(screen.getByRole("group", { name: "⟦half.title⟧" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "⟦free.topics.add⟧" }));
    await user.click(screen.getByRole("button", { name: "⟦free.topics.confirm⟧" }));
    expect(screen.getByText("⟦error.topicTitle.empty⟧")).toBeInTheDocument();
    expect(literalOffenders(container, meeting, topics)).toEqual([]);
    await act(() => clock.set(FREE_TIMES.over));
    expect(literalOffenders(container, meeting, topics)).toEqual([]);
    unmount();

    const empty = liveFreeEmptyMeeting();
    const r = await renderApp(
      { meeting: empty, error: null },
      { keyMode: true, clock: new FakeClock(FREE_TIMES.early), view: "live" },
    );
    expect(screen.getByText("⟦free.topics.empty.title⟧")).toBeInTheDocument();
    expect(literalOffenders(r.container, empty)).toEqual([]);
  });
});

describe("AC5 (job 011) no literal strings in the language model section", () => {
  it("engine choice, confirmation, local list, gone, key states and test results come from keys", async () => {
    const user = userEvent.setup();
    const meeting = filledMeeting();
    const data = [
      ...FAKE_LLM_MODELS.models.map((m) => m.name),
      ...FAKE_LLM_MODELS.searched,
      "x.gguf",
      "⟦model.foundIn⟧",
    ];
    const open = async () => {
      await user.click(screen.getByRole("button", { name: "⟦settings.open⟧" }));
      await user.click(screen.getByRole("tab", { name: /settings.section.llm⟧/ }));
    };
    const first = await renderApp(
      { meeting, error: null },
      { keyMode: true, recording: { llmTest: () => Promise.reject({ kind: "rateLimited" }) } },
    );
    await open();
    await user.click(screen.getByRole("radio", { name: /settings.llm.claude⟧/ }));
    await screen.findByText("⟦settings.llm.confirm.title⟧");
    expect(literalOffenders(first.container, meeting, data)).toEqual([]);
    await user.click(screen.getByRole("button", { name: "⟦settings.llm.confirm.use⟧" }));
    await screen.findByText("⟦settings.llm.key.none⟧");
    await user.type(screen.getByLabelText("⟦settings.llm.key.field⟧"), "bad key");
    await user.click(screen.getByRole("button", { name: "⟦settings.llm.key.save⟧" }));
    await screen.findByText("⟦settings.llm.key.invalid⟧");
    expect(literalOffenders(first.container, meeting, data)).toEqual([]);
    await user.click(screen.getByRole("radio", { name: /settings.llm.local⟧/ }));
    await screen.findByText("⟦settings.llm.local.title⟧");
    await user.click(screen.getByRole("button", { name: "⟦settings.llm.test.run⟧" }));
    await screen.findByText("⟦settings.llm.error.rateLimited.title⟧");
    expect(literalOffenders(first.container, meeting, data)).toEqual([]);
    first.unmount();

    // A chosen model that is gone, nothing found, a saved key and a reply.
    const second = await renderApp(
      { meeting, error: null },
      {
        keyMode: true,
        recording: {
          settings: { languageModel: { local: "/gone/x.gguf" } },
          llmModels: { models: [], searched: ["/m"], available: true },
        },
      },
    );
    await open();
    await screen.findByText("⟦settings.llm.local.gone.title⟧");
    expect(literalOffenders(second.container, meeting, data)).toEqual([]);
    second.unmount();
    const third = await renderApp(
      { meeting, error: null },
      { keyMode: true, recording: { settings: { languageModel: "claude" }, apiKeySet: true } },
    );
    await open();
    await screen.findByText("⟦settings.llm.key.saved⟧");
    await user.click(screen.getByRole("button", { name: "⟦settings.llm.key.remove⟧" }));
    await screen.findByText("⟦settings.llm.key.removeConfirm.title⟧");
    await user.click(screen.getByRole("button", { name: "⟦settings.llm.test.run⟧" }));
    const reply = await screen.findByTestId("llm-reply-text");
    expect(literalOffenders(third.container, meeting, [...data, reply.textContent ?? ""])).toEqual([]);
  });

  it("the sample text shown is the text the core sends, in both languages", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const core = readFileSync(join(__dirname, "../../src-tauri/src/language_model.rs"), "utf8");
    for (const dict of [de, en]) {
      const shown = dict["settings.llm.test.sample"];
      const sent = shown.slice(shown.indexOf(": ") + 2, -1);
      expect(sent.length).toBeGreaterThan(40);
      expect(core).toContain(`"${sent}"`);
    }
  });
});
