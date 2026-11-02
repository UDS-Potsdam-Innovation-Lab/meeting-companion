// Job 019: capture suggestions in the live view (AC1, AC3–AC6, component level, on the fake clock).
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeClock } from "../../lib/clock";
import type { CaptureState, CaptureSuggestion, LlmErrorKind, Settings } from "../../lib/ipc";
import { renderApp, type FakeRecording } from "../../test/backend";
import { LIVE_ELAPSED_MS, LIVE_TIMES, LIVE_TRANSCRIPT, liveMeeting } from "../agenda/fixtures";
import { fakeCaptureCommand, fakeMemory } from "./fakeCore";
import {
  CONFIRMED_DECISION,
  SUGGEST_DECISION,
  SUGGEST_DECISION_2,
  SUGGEST_SPEAKERS,
  SUGGEST_TODO,
  SUGGEST_VOICES,
} from "./fixtures";
import { UNDO_MS } from "./model";
import { SUGGESTIONS_EVERY_MS } from "./suggestions";

beforeEach(() => {
  localStorage.setItem("meeting-companion.locale", "en");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const RECORDING = (meetingId: string): CaptureState => ({
  state: "recording",
  meetingId,
  elapsedMs: LIVE_ELAPSED_MS,
  level: 0.5,
  reason: null,
});

async function openLive(rec: FakeRecording = {}, settings: Partial<Settings> = { languageModel: "claude" }) {
  const meeting = liveMeeting();
  const clock = new FakeClock(LIVE_TIMES.running);
  const utils = await renderApp(
    { meeting, error: null },
    {
      clock,
      view: "live",
      recording: {
        captureNow: () => clock.now(),
        status: RECORDING(meeting.id),
        settings: { locale: "en", ...settings },
        transcript: {
          segments: LIVE_TRANSCRIPT.map((l, i) => ({ ...l, voice: SUGGEST_VOICES[i] ?? null })),
          error: null,
        },
        speakers: {
          participants: meeting.participants,
          voices: SUGGEST_SPEAKERS.voices,
          lines: [],
          suggestions: [],
        },
        ...rec,
      },
    },
  );
  // The first read of the suggestions.
  await waitFor(() => expect(utils.core.calls.some((c) => c.cmd === "load_suggestions")).toBe(true));
  return { clock, meeting, ...utils };
}

const column = () => screen.getByRole("region", { name: "Captured" });
const tab = (name: RegExp) => within(column()).getByRole("button", { name });
const pin = () => screen.queryByTestId("suggestion-pin");
const card = () => pin()!.querySelector<HTMLElement>(".suggest-card")!;
const button = (name: string) => within(card()).getByRole("button", { name });
const notice = () => screen.queryByTestId("undo-notice");
const feed = () => document.querySelector<HTMLElement>(".transcript-feed")!;
const lineOf = (seq: number) => feed().querySelector<HTMLElement>(`[data-seq="${seq}"]`)!;
const status = () => screen.getByTestId("suggest-status");

/** Lets the view read the core's suggestions (it does so every second by the clock). */
async function poll(clock: FakeClock) {
  await act(async () => {
    clock.advance(SUGGESTIONS_EVERY_MS);
  });
}

// ---- AC1 ---------------------------------------------------------------------------------------------

describe("AC1 Undo restores only what the core removed", () => {
  it("the restore request has no capture body, and one with capture fields is refused", () => {
    const m = { ...liveMeeting(), captures: [] };
    const memory = fakeMemory();
    const store = { meeting: () => m, put: () => {}, now: () => 1, memory };
    memory.kept[m.id] = CONFIRMED_DECISION;
    expect(() =>
      fakeCaptureCommand(store, "restore_capture", {
        restore: { meetingId: m.id, captureId: CONFIRMED_DECISION.id, capture: CONFIRMED_DECISION },
      }),
    ).toThrow();
    expect(() =>
      fakeCaptureCommand(store, "restore_capture", {
        restore: { meetingId: m.id, captureId: CONFIRMED_DECISION.id },
        capture: CONFIRMED_DECISION,
      }),
    ).toThrow();
    // Never removed: nothing to restore.
    expect(() =>
      fakeCaptureCommand(store, "restore_capture", { restore: { meetingId: m.id, captureId: "c-other" } }),
    ).toThrow();
  });

  it("Undo of a confirm removes the capture and the suggestion waits again; Undo of a delete restores by id", async () => {
    const user = userEvent.setup();
    const { core, clock } = await openLive({ suggestions: [SUGGEST_DECISION] });
    await user.click(button("Confirm"));
    await waitFor(() => expect(core.captures()).toHaveLength(1));
    expect(pin()).toBeNull();
    act(() => clock.advance(UNDO_MS - 100));
    await user.click(within(notice()!).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(core.captures()).toEqual([]));
    expect(core.calls.some((c) => c.cmd === "unconfirm_suggestion")).toBe(true);
    expect(await screen.findByTestId("suggestion-pin")).toBeVisible();
    expect(within(card()).getByText(SUGGEST_DECISION.text)).toBeVisible();

    // A delete of the confirmed capture, then Undo: only the ids go to the core.
    await user.click(button("Confirm"));
    await waitFor(() => expect(core.captures()).toHaveLength(1));
    const id = core.captures()[0]!.id;
    await user.click(within(column()).getByRole("button", { name: /^Edit:/ }));
    await user.click(within(column()).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(core.captures()).toEqual([]));
    await user.click(within(notice()!).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(core.captures()).toHaveLength(1));
    const restore = core.calls.find((c) => c.cmd === "restore_capture");
    expect(restore?.args).toEqual({ restore: { meetingId: "fixture-live", captureId: id } });
    expect(core.captures()[0]).toMatchObject({ id, source: "suggested", segments: [2] });
  });
});

// ---- AC3 ---------------------------------------------------------------------------------------------

describe("AC3 suggestion text is untrusted", () => {
  it("markup in a suggestion is shown literally", async () => {
    const text = '<img src=x onerror="alert(1)"><b>bold</b><script>alert(2)</script>';
    const { container } = await openLive({ suggestions: [{ ...SUGGEST_DECISION, text }] });
    expect(within(card()).getByText(text)).toBeVisible();
    expect(container.querySelector(".suggest-card img, .suggest-card b, .suggest-card script")).toBeNull();
  });
});

// ---- AC4 ---------------------------------------------------------------------------------------------

describe("AC4 nothing becomes a capture without a person's tap", () => {
  it("the card shows the badge, kind, text, owner and source line", async () => {
    const user = userEvent.setup();
    await openLive({ suggestions: [SUGGEST_DECISION, SUGGEST_TODO] });
    expect(within(pin()!).getByRole("heading", { name: /Suggestions · 1/ })).toBeVisible();
    expect(card()).toHaveTextContent("Suggestion · 10:11");
    expect(card()).toHaveTextContent("Decision");
    expect(card()).toHaveTextContent("Beta launches on 14 Nov without offline mode");
    expect(card()).toHaveTextContent("From the transcript:Mara Klein, 10:11 ›");
    await user.click(tab(/^To-dos/));
    expect(card()).toHaveTextContent("Suggested:");
    expect(card()).toHaveTextContent("Yusuf Aydin");
    expect(card()).toHaveTextContent("Mara Klein, 10:12 ›");
  });

  it("Bestätigen by pointer writes a suggested capture with its segments and the Undo notice", async () => {
    const user = userEvent.setup();
    const { core } = await openLive({ suggestions: [SUGGEST_DECISION] });
    await user.click(button("Confirm"));
    await waitFor(() => expect(core.captures()).toHaveLength(1));
    expect(core.calls.find((c) => c.cmd === "confirm_suggestion")?.args).toEqual({
      meetingId: "fixture-live",
      confirm: { suggestionId: SUGGEST_DECISION.id, itemId: "i-2", topicId: null },
    });
    expect(core.captures()[0]).toMatchObject({
      kind: "decision",
      text: SUGGEST_DECISION.text,
      source: "suggested",
      segments: [2],
      itemId: "i-2",
    });
    expect(notice()).toHaveTextContent("Decision saved · Item 02");
    expect(notice()).toHaveTextContent("from a suggestion");
    expect(within(column()).getByTestId("from-suggestion")).toHaveTextContent("✦");
    expect(pin()).toBeNull();
  });

  it("Bestätigen by keyboard: focus on the card's button and Enter", async () => {
    const user = userEvent.setup();
    const { core } = await openLive({ suggestions: [SUGGEST_DECISION, SUGGEST_DECISION_2] });
    button("Confirm").focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(core.captures()).toHaveLength(1));
    // The next one is pinned and its Bestätigen takes focus: focus is never lost.
    await waitFor(() => expect(button("Confirm")).toHaveFocus());
    expect(card()).toHaveTextContent(SUGGEST_DECISION_2.text);
  });

  it("Bearbeiten opens the fields inline; Esc returns to the card; Bestätigen saves the edited version", async () => {
    const user = userEvent.setup();
    const { core } = await openLive({ suggestions: [SUGGEST_TODO] });
    await user.click(tab(/^To-dos/));
    await user.click(button("Edit"));
    const editor = () => pin()!.querySelector<HTMLElement>(".suggest-card--editing")!;
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(editor()).toHaveTextContent("editing");
    const text = within(editor()).getByRole("textbox");
    expect(text).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(pin()!.querySelector(".suggest-card--editing")).toBeNull();
    await waitFor(() => expect(button("Edit")).toHaveFocus());

    await user.keyboard("{Enter}");
    await user.clear(within(editor()).getByRole("textbox"));
    await user.type(within(editor()).getByRole("textbox"), "Write to the third pilot school by Friday");
    await user.click(
      within(within(editor()).getByRole("group", { name: "Who" })).getByRole("button", { name: "Lena" }),
    );
    await user.click(within(editor()).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(core.captures()).toHaveLength(1));
    expect(core.captures()[0]).toMatchObject({
      kind: "todo",
      text: "Write to the third pilot school by Friday",
      owner: "p-ls",
      source: "suggested",
      segments: [4],
    });
  });

  it("Verwerfen by pointer and by keyboard drops the suggestion and stores nothing", async () => {
    const user = userEvent.setup();
    const { core } = await openLive({ suggestions: [SUGGEST_DECISION, SUGGEST_DECISION_2] });
    await user.click(button("Dismiss"));
    await waitFor(() => expect(card()).toHaveTextContent(SUGGEST_DECISION_2.text));
    button("Dismiss").focus();
    await user.keyboard(" ");
    await waitFor(() => expect(pin()).toBeNull());
    expect(core.captures()).toEqual([]);
    expect(core.calls.filter((c) => c.cmd === "dismiss_suggestion")).toHaveLength(2);
    // Focus goes to the composer once no card is left.
    expect(screen.getByRole("textbox", { name: "Note a decision …" })).toHaveFocus();
  });

  it("one card per tab; further ones wait behind with “1 more suggestion”", async () => {
    const user = userEvent.setup();
    await openLive({ suggestions: [SUGGEST_DECISION, SUGGEST_DECISION_2, SUGGEST_TODO] });
    expect(pin()!.querySelectorAll(".suggest-card")).toHaveLength(1);
    expect(screen.getByTestId("suggestion-waiting")).toHaveTextContent("1 more suggestion");
    expect(within(pin()!).getByRole("heading")).toHaveTextContent("Suggestions · 2");
    expect(screen.getByTestId("suggest-dot-todo")).toHaveTextContent("suggestion waiting");
    await user.click(tab(/^To-dos/));
    expect(pin()!.querySelectorAll(".suggest-card")).toHaveLength(1);
    expect(screen.queryByTestId("suggestion-waiting")).toBeNull();
    await user.click(tab(/^Questions/));
    expect(pin()).toBeNull();
  });

  it("no timer confirms: a minute passes and nothing is written", async () => {
    const { core, clock } = await openLive({ suggestions: [SUGGEST_DECISION] });
    for (let i = 0; i < 60; i++) await poll(clock);
    expect(core.calls.some((c) => c.cmd === "confirm_suggestion")).toBe(false);
    expect(core.captures()).toEqual([]);
    expect(pin()).not.toBeNull();
  });
});

// ---- AC5 ---------------------------------------------------------------------------------------------

describe("AC5 where the transcript goes is always visible", () => {
  const cases: [string, Partial<Settings>, LlmErrorKind | null, string, string][] = [
    [
      "off",
      { languageModel: "none" },
      null,
      "Suggestions off · Choose a language model",
      "Vorschläge aus · Sprachmodell wählen",
    ],
    [
      "local",
      { languageModel: { local: "/m/Qwen2.5-3B-Instruct-Q4_K_M.gguf" } },
      null,
      "Suggestions on this device",
      "Vorschläge auf diesem Gerät",
    ],
    [
      "cloud",
      { languageModel: "claude" },
      null,
      "CloudSuggestions via Anthropic · transcript text leaves this device",
      "CloudVorschläge über Anthropic · Transkripttext verlässt dieses Gerät",
    ],
    [
      "offline",
      { languageModel: "claude" },
      "offline",
      "!Suggestions paused: no internet connection.",
      "!Vorschläge pausiert: keine Internetverbindung.",
    ],
    [
      "noApiKey",
      { languageModel: "claude" },
      "noApiKey",
      "!Suggestions paused: no Claude API key saved.",
      "!Vorschläge pausiert: Kein Claude-API-Schlüssel gespeichert.",
    ],
    [
      "keychain",
      { languageModel: "claude" },
      "keychainUnavailable",
      "!Suggestions paused: no Claude API key saved.",
      "!Vorschläge pausiert: Kein Claude-API-Schlüssel gespeichert.",
    ],
    [
      "unauthorized",
      { languageModel: "claude" },
      "unauthorized",
      "!Suggestions paused: Anthropic refuses the API key.",
      "!Vorschläge pausiert: Anthropic lehnt den API-Schlüssel ab.",
    ],
    [
      "rateLimited",
      { languageModel: "claude" },
      "rateLimited",
      "!Suggestions paused: Anthropic is limiting requests right now.",
      "!Vorschläge pausiert: Anthropic bremst gerade (Limit erreicht).",
    ],
    [
      "noModel",
      { languageModel: { local: "/m/Qwen2.5-3B-Instruct-Q4_K_M.gguf" } },
      "noModel",
      "!Suggestions paused: the model on this device is missing.",
      "!Vorschläge pausiert: Das Modell auf diesem Gerät fehlt.",
    ],
    [
      "failed",
      { languageModel: { local: "/m/Qwen2.5-3B-Instruct-Q4_K_M.gguf" } },
      "failed",
      "!Suggestions paused: the language model did not answer.",
      "!Vorschläge pausiert: Das Sprachmodell hat nicht geantwortet.",
    ],
  ];
  for (const [name, settings, error, en, de] of cases) {
    for (const locale of ["en", "de"] as const) {
      it(`${name} (${locale})`, async () => {
        localStorage.setItem("meeting-companion.locale", locale);
        await openLive({ suggestionError: error ? { kind: error } : null }, { ...settings, locale });
        await waitFor(() => expect(status()).toHaveTextContent(locale === "en" ? en : de));
        // Never modal; quick capture goes on.
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.queryByRole("alertdialog")).toBeNull();
        expect(screen.getByRole("form")).toBeVisible();
      });
    }
  }

  it("the top-bar chip shows while Claude is chosen and the meeting records", async () => {
    const { core } = await openLive();
    expect(screen.getByTestId("suggest-cloud-chip")).toHaveTextContent("Suggestions: Anthropic (cloud)");
    await userEvent.setup().click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(screen.queryByTestId("suggest-cloud-chip")).toBeNull());
    expect(core.calls.some((c) => c.cmd === "pause_recording")).toBe(true);
  });

  it("no chip without Claude", async () => {
    await openLive({}, { languageModel: { local: "/m/Qwen2.5-3B-Instruct-Q4_K_M.gguf" } });
    expect(screen.queryByTestId("suggest-cloud-chip")).toBeNull();
  });

  it("“Choose a language model” opens the settings at the language model section", async () => {
    const user = userEvent.setup();
    await openLive({}, { languageModel: "none" });
    await user.click(within(status()).getByRole("button", { name: "Choose a language model" }));
    const llmTab = await screen.findByRole("tab", { name: /Language model/ });
    expect(llmTab).toHaveAttribute("aria-selected", "true");
  });
});

// ---- AC6 ---------------------------------------------------------------------------------------------

describe("AC6 usable while talking", () => {
  it("a chip moves focus to its card; it turns into “captured” after Bestätigen", async () => {
    const user = userEvent.setup();
    const { core } = await openLive({ suggestions: [SUGGEST_DECISION, SUGGEST_TODO] });
    const chip = within(lineOf(4)).getByRole("button", { name: "To-do spotted: go to the suggestion" });
    expect(within(lineOf(2)).getByTestId("line-chip")).toHaveTextContent("Decision spotted");
    // The pinned card's source line is marked.
    expect(lineOf(2)).toHaveClass("transcript-line--source");
    await user.click(chip);
    expect(tab(/^To-dos/)).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(card()).toHaveFocus());
    expect(card()).toHaveTextContent(SUGGEST_TODO.text);
    await user.click(button("Confirm"));
    await waitFor(() => expect(core.captures()).toHaveLength(1));
    expect(within(lineOf(4)).getByTestId("line-chip")).toHaveTextContent("To-do captured");
    expect(within(lineOf(4)).queryByRole("button", { name: /spotted/ })).toBeNull();
  });

  it("a chip goes after Verwerfen", async () => {
    const user = userEvent.setup();
    await openLive({ suggestions: [SUGGEST_DECISION] });
    expect(within(lineOf(2)).getByTestId("line-chip")).toBeVisible();
    await user.click(button("Dismiss"));
    await waitFor(() => expect(within(lineOf(2)).queryByTestId("line-chip")).toBeNull());
  });

  it("a confirmed capture keeps its “captured” chip after a reload", async () => {
    await openLive({ captures: [CONFIRMED_DECISION] });
    expect(within(lineOf(2)).getByTestId("line-chip")).toHaveTextContent("Decision captured");
  });

  it("a new suggestion is announced once through the polite region and never takes focus", async () => {
    const user = userEvent.setup();
    const { core, clock } = await openLive();
    const field = screen.getByRole("textbox", { name: "Note a decision …" });
    await user.click(field);
    const live = screen.getByTestId("nudge-announcement");
    expect(live).toHaveAttribute("aria-live", "polite");
    core.suggest([SUGGEST_DECISION]);
    await poll(clock);
    expect(await screen.findByTestId("suggestion-pin")).toBeVisible();
    expect(live.textContent?.trim()).toBe("New suggestion: Decision. Confirm or dismiss it under Captured.");
    expect(field).toHaveFocus();
    // Read again: not said again.
    await poll(clock);
    await poll(clock);
    expect(live.textContent?.trim()).toBe("New suggestion: Decision. Confirm or dismiss it under Captured.");
    await user.type(field, "Go{Enter}");
    await waitFor(() => expect(live.textContent?.trim()).toBe("Decision saved · Item 02"));
  });

  it("Tab reaches the card's controls in order", async () => {
    const user = userEvent.setup();
    await openLive({ suggestions: [SUGGEST_DECISION] });
    const order = [
      within(card()).getByRole("button", { name: /^Go to the transcript line/ }),
      button("Confirm"),
      button("Edit"),
      button("Dismiss"),
    ];
    order[0]!.focus();
    for (const el of order.slice(1)) {
      await user.tab();
      expect(el).toHaveFocus();
    }
  });

  it("“›” shows the source line in the transcript", async () => {
    const user = userEvent.setup();
    await openLive({ suggestions: [SUGGEST_DECISION] });
    await user.click(
      within(card()).getByRole("button", { name: /^Go to the transcript line: Mara Klein, 10:11/ }),
    );
    await waitFor(() => expect(lineOf(2).querySelector(".line-speaker")).toHaveFocus());
  });

  it("is German by default and uses du", async () => {
    localStorage.removeItem("meeting-companion.locale");
    await openLive(
      { suggestions: [SUGGEST_DECISION, SUGGEST_DECISION_2] },
      { languageModel: "claude", locale: "de" },
    );
    expect(card()).toHaveTextContent("Vorschlag · 10:11");
    expect(button("Bestätigen")).toBeVisible();
    expect(button("Bearbeiten")).toBeVisible();
    expect(button("Verwerfen")).toBeVisible();
    expect(screen.getByTestId("suggestion-waiting")).toHaveTextContent("1 weiterer Vorschlag");
    expect(card()).toHaveTextContent("Aus dem Transkript:");
    expect(within(lineOf(2)).getByTestId("line-chip")).toHaveTextContent("Beschluss erkannt");
    expect(screen.getByTestId("suggest-cloud-chip")).toHaveTextContent("Vorschläge: Anthropic (Cloud)");
  });

  it("below 1200 px the card sits in the “Captured” tab, and a chip opens it", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-width: 1199px"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const user = userEvent.setup();
    await openLive({ suggestions: [SUGGEST_DECISION] });
    expect(pin()).toBeNull();
    await user.click(within(lineOf(2)).getByRole("button", { name: /Decision spotted/ }));
    const panel = screen.getByTestId("captures-column");
    expect(within(panel).getByTestId("suggestion-pin")).toBeVisible();
    await waitFor(() => expect(card()).toHaveFocus());
    // The status line sits under the composer here too.
    expect(status()).toHaveTextContent("Suggestions via Anthropic");
  });

  it("every new string comes from a key", async () => {
    const meeting = liveMeeting();
    const clock = new FakeClock(LIVE_TIMES.running);
    const suggestion: CaptureSuggestion = SUGGEST_TODO;
    await renderApp(
      { meeting, error: null },
      {
        clock,
        view: "live",
        keyMode: true,
        recording: {
          captureNow: () => clock.now(),
          status: RECORDING(meeting.id),
          settings: { languageModel: "claude", locale: "en" },
          suggestions: [suggestion, { ...SUGGEST_TODO, id: "s-2", createdAt: SUGGEST_TODO.createdAt + 1 }],
          transcript: {
            segments: LIVE_TRANSCRIPT.map((l) => ({ ...l, voice: null })),
            error: null,
          },
        },
      },
    );
    const user = userEvent.setup();
    await user.click(within(screen.getByTestId("captures-column")).getAllByRole("button")[1]!);
    await waitFor(() => expect(screen.queryByTestId("suggestion-pin")).not.toBeNull());
    const allowed = new Set([suggestion.text, "Yusuf Aydin", "YA", "✦", "›", "!"]);
    const check = (root: Element) => {
      const out: string[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = (n.textContent ?? "").trim();
        if (!text || /^(⟦[\w.]+⟧\s*)+$/.test(text) || /^[\d\s:.,\-–·/]+$/.test(text) || allowed.has(text))
          continue;
        out.push(text);
      }
      return out;
    };
    expect(check(screen.getByTestId("suggestion-pin"))).toEqual([]);
    expect(check(screen.getByTestId("suggest-status"))).toEqual([]);
    expect(check(screen.getByTestId("suggest-cloud-chip"))).toEqual([]);
    for (const chip of screen.getAllByTestId("line-chip")) expect(check(chip)).toEqual([]);
  });
});
