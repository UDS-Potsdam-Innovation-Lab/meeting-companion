import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emit } from "@tauri-apps/api/event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "../../lib/clock";
import {
  EVENT_CAPTURE,
  EVENT_SEGMENT,
  EVENT_VOICE,
  type CaptureState,
  type SegmentEvent,
  type SpeakerState,
  type TranscriptSegment,
  type VoiceEvent,
} from "../../lib/ipc";
import { renderApp, type FakeRecording } from "../../test/backend";
import {
  FIXTURE_PARTICIPANTS,
  LIVE_ELAPSED_MS,
  LIVE_TIMES,
  LIVE_TRANSCRIPT,
  liveConsentedMeeting,
  SPEAKER_CHOICES,
  SPEAKER_TRANSCRIPT,
} from "../agenda/fixtures";
import { avatarColor } from "../../ui/Avatar";

beforeEach(() => {
  localStorage.setItem("meeting-companion.locale", "en");
});

const ID = "fixture-live";

const recordingState = (s: Partial<CaptureState> = {}): CaptureState => ({
  state: "recording",
  meetingId: ID,
  elapsedMs: LIVE_ELAPSED_MS,
  level: 0.5,
  reason: null,
  ...s,
});

/** The `speakers` fixture: 5 voices; A and B confirmed, C suggested, D unsure, E unassigned. */
const FILLED: SpeakerState = {
  participants: FIXTURE_PARTICIPANTS,
  voices: SPEAKER_CHOICES.voices,
  lines: [],
  suggestions: [
    { voice: "C", candidates: ["p-ls"], unsure: false },
    { voice: "D", candidates: ["p-ya", "p-jr"], unsure: true },
  ],
};

async function openLive(recording: FakeRecording) {
  const clock = new FakeClock(LIVE_TIMES.running);
  const utils = await renderApp(
    { meeting: liveConsentedMeeting(), error: null },
    { clock, view: "live", recording: { status: recordingState(), ...recording } },
  );
  await waitFor(() => expect(utils.core.calls.some((c) => c.cmd === "load_speakers")).toBe(true));
  return { clock, ...utils };
}

const filled = (extra: FakeRecording = {}) =>
  openLive({
    transcript: { segments: SPEAKER_TRANSCRIPT, error: null },
    speakers: FILLED,
    ...extra,
  });

const footer = () => screen.getByRole("button", { name: /^(Listening|Paused) · \d+ speakers?$/ });
const chip = () => screen.queryByTestId("rec-chip");

async function openSpeakers(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Listening · 5 speakers" }));
  return screen.getByRole("main");
}

describe("AC3 speakers view", () => {
  it("opens from the footer in the same window, not as a modal, and recording goes on", async () => {
    const user = userEvent.setup();
    await filled();
    expect(chip()).toHaveTextContent("REC00:16:48");
    const main = await openSpeakers(user);
    expect(main).toHaveAttribute("data-view", "speakers");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector('main[data-view="live"]')).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
    // The REC chip stays and follows the core while the speakers view is open.
    expect(chip()).toHaveTextContent("REC00:16:48");
    await act(() => emit(EVENT_CAPTURE, recordingState({ elapsedMs: LIVE_ELAPSED_MS + 5_000 })));
    expect(chip()).toHaveTextContent("REC00:16:53");
    await act(() => emit(EVENT_CAPTURE, recordingState({ state: "paused", level: 0 })));
    expect(chip()).toHaveTextContent("Paused00:16:48");
    // Back: the live view, focus on the button that opened the speakers.
    await user.click(screen.getByRole("button", { name: "Back to meeting" }));
    expect(screen.getByRole("main")).toHaveAttribute("data-view", "live");
    expect(footer()).toHaveFocus();
    expect(chip()).toHaveTextContent("Paused00:16:48");
  });

  it("back to the meeting keeps the transcript where the reader scrolled to", async () => {
    const user = userEvent.setup();
    const proto = HTMLOListElement.prototype;
    const sizes = { scrollHeight: 2_000, clientHeight: 300 };
    for (const [k, v] of Object.entries(sizes))
      Object.defineProperty(proto, k, { configurable: true, get: () => v });
    try {
      await filled();
      const feed = () => screen.getByRole("list", { name: "Transcript" });
      await waitFor(() => expect(feed().scrollTop).toBe(2_000));
      feed().scrollTop = 640;
      feed().dispatchEvent(new Event("scroll"));
      await openSpeakers(user);
      await user.click(screen.getByRole("button", { name: "Back to meeting" }));
      expect(feed().scrollTop).toBe(640);
    } finally {
      for (const k of Object.keys(sizes)) delete (proto as unknown as Record<string, unknown>)[k];
    }
  });

  it("filled: counts, rows with talk time and first line, who spoke when, invited voices, how names are found", async () => {
    const user = userEvent.setup();
    await filled();
    await openSpeakers(user);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("5 voices detected · 2 matched");
    const rows = within(screen.getByRole("region", { name: "Voices" })).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    const shares = rows.map((r) => Number(/(\d+)% talk time/.exec(r.textContent ?? "")![1]));
    expect(shares.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(99);
    expect(shares.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(101);
    expect(rows[0]).toHaveTextContent("Voice A");
    expect(rows[0]).toHaveTextContent("“Okay. Let's start with a quick check-in. I'm Mara Klein.”");
    // Picker states: confirmed (source), suggested, unsure (not by colour alone), unassigned.
    expect(rows[0]).toHaveTextContent("Mara KleinName round");
    expect(rows[1]).toHaveTextContent("Tobias BrandtPicked by hand");
    expect(rows[2]).toHaveTextContent("Lena SommerSuggested · Name round");
    expect(rows[3]).toHaveTextContent("Yusuf Aydin?Unsure: Yusuf or Jana?");
    expect(rows[3]).toHaveClass("voice-row--unsure");
    expect(rows[4]).toHaveTextContent("Add guest…Not on the invite");
    expect(screen.getByRole("combobox", { name: "Person for Voice A" })).toHaveValue("p-mk");
    expect(screen.getByRole("combobox", { name: "Person for Voice C" })).toHaveValue("");
    // Who spoke when: one track per voice.
    const timeline = screen.getByRole("region", { name: "Who spoke when" });
    expect(within(timeline).getByText("first 2 min · name round")).toBeInTheDocument();
    expect(within(timeline).getAllByRole("img")).toHaveLength(5);
    expect(within(timeline).getByRole("img", { name: "Voice D: 2 turns" })).toBeInTheDocument();
    // Invited: confirmed chips, amber "Voice D?" for the unsure suggestion, none otherwise.
    const invited = screen.getByRole("region", { name: "Invited · 5" });
    const person = (name: string) => within(invited).getByText(name).closest("li")!;
    expect(person("Mara Klein")).toHaveTextContent("Voice A");
    expect(person("Yusuf Aydin")).toHaveTextContent("Voice D?");
    expect(within(person("Yusuf Aydin")).getByText("Voice D, not confirmed")).toBeInTheDocument();
    expect(person("Jana Roth")).toHaveTextContent("Voice D?");
    const how = screen.getByRole("region", { name: "How names are found" });
    expect(
      within(how)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([
      "Name round at check-in: everyone says their name once",
      "Remote people come with their Teams / Zoom name",
      "Anything unsure waits for a person to confirm",
    ]);
    // No voice-profile toggle and no play button.
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button", { name: /play/i })).toBeNull();
  });

  it("empty: no voices detected yet", async () => {
    const user = userEvent.setup();
    await openLive({});
    await user.click(await screen.findByRole("button", { name: "Listening · 0 speakers" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("No voices detected yet");
    expect(screen.getByText("Voices appear here as people speak.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Who spoke when" })).toBeNull();
  });

  it("no model: says so and lists the folders searched; the line picker still works", async () => {
    const user = userEvent.setup();
    const reply = (cmd: string, args: Record<string, unknown>) => {
      expect(cmd).toBe("choose_line");
      expect(args).toEqual({ meetingId: ID, seq: 1, target: { kind: "person", participantId: "p-ls" } });
      return { ...FILLED, voices: [], suggestions: [], lines: [{ seq: 1, participantId: "p-ls" }] };
    };
    await openLive({
      transcript: { segments: LIVE_TRANSCRIPT, error: null },
      speakerModels: { models: [], searched: ["/data/app/models", "/home/u/.cache/huggingface/hub"] },
      speakers: { ...FILLED, voices: [], suggestions: [] },
      speakerReply: reply,
    });
    await user.click(await screen.findByRole("button", { name: "Listening · 0 speakers" }));
    expect(screen.getByText("No speaker model found on this device")).toBeInTheDocument();
    expect(screen.getByText("/data/app/models")).toBeInTheDocument();
    expect(screen.getByText("/home/u/.cache/huggingface/hub")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back to meeting" }));
    await user.click(screen.getByRole("button", { name: "Speaker of the line at 10:10" }));
    const picker = screen.getByRole("dialog", { name: "Speaker of the line at 10:10" });
    await user.click(within(picker).getByRole("button", { name: /Lena Sommer/ }));
    expect(
      await screen.findByRole("button", { name: "Lena Sommer, speaker of the line at 10:10" }),
    ).toBeInTheDocument();
  });
});

describe("AC4/AC5 names on the transcript", () => {
  it("confirmed names show on every line of the voice, earlier and later; others read Voice X or nothing", async () => {
    await filled();
    const named = await screen.findAllByRole("button", { name: /^Mara Klein, speaker of the line at/ });
    expect(named).toHaveLength(3);
    expect(within(named[0]!).getByText("Mara Klein")).toHaveStyle({ color: avatarColor("Mara Klein") });
    // C is only suggested: still "Voice C", muted.
    expect(screen.getAllByRole("button", { name: /^Voice C, speaker of the line at/ })).toHaveLength(2);
    expect(screen.getAllByText("Voice C")[0]).toHaveClass("line-speaker__voice");
    // The line without a voice shows no speaker, but can still be assigned.
    expect(screen.getByRole("button", { name: "Speaker of the line at 10:12" })).toBeInTheDocument();
  });

  it("transcript text renders literally and a suggestion changes nothing until confirmed", async () => {
    const user = userEvent.setup();
    const xss: TranscriptSegment = {
      ...SPEAKER_TRANSCRIPT[0]!,
      text: "<img src=x onerror=alert(1)> I'm Mara Klein",
      voice: "F",
    };
    await openLive({
      transcript: { segments: [xss], error: null },
      speakers: { ...FILLED, voices: [], suggestions: [{ voice: "F", candidates: ["p-mk"], unsure: false }] },
    });
    expect(await screen.findByText("<img src=x onerror=alert(1)> I'm Mara Klein")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByRole("button", { name: /^Voice F, speaker/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Listening · 1 speaker" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("1 voice detected · 0 matched");
    expect(screen.getByText("“<img src=x onerror=alert(1)> I'm Mara Klein”")).toBeInTheDocument();
  });

  it("a voice that arrives later gets its line its voice", async () => {
    await openLive({ speakers: FILLED });
    await act(() =>
      emit(EVENT_SEGMENT, {
        meetingId: ID,
        seq: 0,
        startMs: 1_000,
        endMs: 3_000,
        at: LIVE_TIMES.running,
        text: "Hello",
        lang: "en",
        final: true,
      } satisfies SegmentEvent),
    );
    expect(await screen.findByRole("button", { name: /^Speaker of the line at/ })).toBeInTheDocument();
    await act(() => emit(EVENT_VOICE, { meetingId: ID, seq: 0, voice: "A" } satisfies VoiceEvent));
    expect(
      await screen.findByRole("button", { name: /^Mara Klein, speaker of the line/ }),
    ).toBeInTheDocument();
  });
});

describe("AC5 choices", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("picking a person for a voice confirms it; Unassigned changes it back", async () => {
    const user = userEvent.setup();
    const sent: unknown[] = [];
    await filled({
      speakerReply: (cmd, args) => {
        sent.push({ cmd, ...args });
        const pid = args.participantId as string | null;
        return {
          ...FILLED,
          voices: [...FILLED.voices, { voice: "E", participantId: pid, source: "manual", confirmed: true }],
        };
      },
    });
    await openSpeakers(user);
    await user.selectOptions(screen.getByRole("combobox", { name: "Person for Voice E" }), "Jana Roth");
    expect(sent).toEqual([{ cmd: "choose_voice", meetingId: ID, voice: "E", participantId: "p-jr" }]);
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      "5 voices detected · 3 matched",
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Person for Voice E" }), "Unassigned");
    expect(sent[1]).toEqual({ cmd: "choose_voice", meetingId: ID, voice: "E", participantId: null });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("5 voices detected · 2 matched");
  });

  it("Add guest… takes a trimmed name of 1–80 characters and assigns the new guest", async () => {
    const user = userEvent.setup();
    const sent: { cmd: string; args: Record<string, unknown> }[] = [];
    const guest = { id: "guest-1", name: "<b>Petra</b> Sand", guest: true };
    await filled({
      speakerReply: (cmd, args) => {
        sent.push({ cmd, args });
        if (cmd === "add_guest") {
          return {
            participantId: "guest-1",
            state: { ...FILLED, participants: [...FILLED.participants, guest] },
          };
        }
        return {
          ...FILLED,
          participants: [...FILLED.participants, guest],
          voices: [
            ...FILLED.voices,
            { voice: "E", participantId: "guest-1", source: "manual", confirmed: true },
          ],
        };
      },
    });
    await openSpeakers(user);
    await user.selectOptions(screen.getByRole("combobox", { name: "Person for Voice E" }), "Add guest…");
    const input = screen.getByRole("textbox", { name: "Name of the guest" });
    expect(input).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a name.");
    await user.type(input, "x".repeat(81));
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert")).toHaveTextContent("at most 80 characters");
    expect(sent).toEqual([]);
    await user.clear(input);
    await user.type(input, "  <b>Petra</b> Sand  ");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(sent.map((s) => s.cmd)).toEqual(["add_guest", "choose_voice"]));
    expect(sent[0]!.args).toEqual({ meetingId: ID, name: "<b>Petra</b> Sand" });
    expect(sent[1]!.args).toEqual({ meetingId: ID, voice: "E", participantId: "guest-1" });
    const row = screen.getAllByRole("listitem").find((li) => li.textContent?.includes("Voice E"))!;
    expect(row.querySelector(".voice-picker__title")).toHaveTextContent("<b>Petra</b> Sand");
    expect(document.querySelector("b")).toBeNull();
  });

  it("Apply names to transcript confirms unique suggestions; unsure rows stay open", async () => {
    const user = userEvent.setup();
    const sent: string[] = [];
    await filled({
      speakerReply: (cmd) => {
        sent.push(cmd);
        return {
          ...FILLED,
          voices: [
            ...FILLED.voices,
            { voice: "C", participantId: "p-ls", source: "nameRound", confirmed: true },
          ],
          suggestions: [FILLED.suggestions[1]!],
        };
      },
    });
    await openSpeakers(user);
    await user.click(screen.getByRole("button", { name: "Apply names to transcript" }));
    expect(sent).toEqual(["apply_name_round"]);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("5 voices detected · 3 matched");
    expect(screen.getByRole("combobox", { name: "Person for Voice D" })).toHaveValue("");
    // Nothing unique is left: the button says so instead of doing nothing silently.
    expect(screen.getByRole("button", { name: "Apply names to transcript" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("Who said this? is non-modal, overrides one line, closes on Escape and outside clicks, and can go back", async () => {
    const user = userEvent.setup();
    const sent: unknown[] = [];
    let lines: SpeakerState["lines"] = [];
    await filled({
      speakerReply: (_cmd, args) => {
        sent.push(args.target);
        const t = args.target as { kind: string; participantId?: string };
        lines =
          t.kind === "voice" ? [] : [{ seq: args.seq as number, participantId: t.participantId ?? null }];
        return { ...FILLED, lines };
      },
    });
    // Line 8 ("Fine with me…", 10:11) is voice D.
    await user.click(screen.getByRole("button", { name: "Voice D, speaker of the line at 10:11" }));
    const picker = screen.getByRole("dialog", { name: "Speaker of the line at 10:11" });
    expect(picker).not.toHaveAttribute("aria-modal", "true");
    expect(within(picker).getByText("Who said this?")).toBeInTheDocument();
    expect(within(picker).getByRole("button", { name: "Use voice (Voice D)" })).toHaveFocus();
    // The rest of the view stays usable.
    expect(screen.getByRole("button", { name: "+5 min" })).toBeEnabled();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Voice D, speaker of the line at 10:11" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Voice D, speaker of the line at 10:11" }));
    await user.click(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Voice D, speaker of the line at 10:11" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Yusuf Aydin/ }));
    expect(sent).toEqual([{ kind: "person", participantId: "p-ya" }]);
    expect(
      await screen.findByRole("button", { name: "Yusuf Aydin, speaker of the line at 10:11" }),
    ).toHaveFocus();
    // The other line of voice D still reads "Voice D".
    expect(screen.getByRole("button", { name: "Voice D, speaker of the line at 10:01" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Yusuf Aydin, speaker of the line at 10:11" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Unassigned" }));
    expect(sent[1]).toEqual({ kind: "nobody" });
    await user.click(await screen.findByRole("button", { name: "Speaker of the line at 10:11" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Use voice (Voice D)" }));
    expect(sent[2]).toEqual({ kind: "voice" });
    expect(
      await screen.findByRole("button", { name: "Voice D, speaker of the line at 10:11" }),
    ).toBeInTheDocument();
  });
});
