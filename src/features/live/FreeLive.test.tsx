import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "../../lib/clock";
import { renderApp } from "../../test/backend";
import {
  filledMeeting,
  FREE_TIMES,
  freeSetupMeeting,
  liveFreeEmptyMeeting,
  liveFreeMeeting,
} from "../agenda/fixtures";
import { createMeeting, type Meeting } from "../agenda/model";
import { addTopic } from "./free";
import { MINUTE } from "./run";

beforeEach(() => {
  localStorage.setItem("meeting-companion.locale", "en");
});

const at = (h: number, m: number, s = 0) => new Date(2026, 9, 30, h, m, s).getTime();

async function openLive(meeting: Meeting, time: number) {
  const clock = new FakeClock(time);
  const utils = await renderApp({ meeting, error: null }, { clock, view: "live" });
  return { clock, ...utils };
}

const modeButton = (name: "With agenda" | "Agenda-free") =>
  within(screen.getByRole("group", { name: "Kind of meeting" })).getByRole("button", { name });
const startButton = () => screen.getByRole("button", { name: "Start meeting" });
const timer = () => screen.getByRole("region", { name: "Whole meeting" });
const bar = () => within(timer()).getByRole("progressbar");
const topicsCard = () => screen.getByRole("region", { name: "Topics so far" });
const topicRow = (title: RegExp | string) => within(topicsCard()).getByRole("button", { name: title });
const nudge = () => screen.queryByRole("group", { name: "Half the time is gone" });
const announcement = () => screen.getByTestId("nudge-announcement");
const tick = (clock: FakeClock, time: number) => act(() => clock.set(time));

describe("AC1 the With agenda / Agenda-free switch in frame 01", () => {
  it("is a group of two toggle buttons with a pressed state, reachable by keyboard", async () => {
    const user = userEvent.setup();
    await renderApp({ meeting: filledMeeting(), error: null });
    expect(modeButton("With agenda")).toHaveAttribute("aria-pressed", "true");
    expect(modeButton("Agenda-free")).toHaveAttribute("aria-pressed", "false");
    // The pressed option carries a tick as well, not only a colour.
    expect(modeButton("With agenda").querySelector("svg")).not.toBeNull();
    expect(modeButton("Agenda-free").querySelector("svg")).toBeNull();
    modeButton("With agenda").focus();
    await user.tab();
    expect(modeButton("Agenda-free")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(modeButton("Agenda-free")).toHaveAttribute("aria-pressed", "true");
  });

  it("round trip: free hides the agenda list, budget line and prompt and keeps the items; agenda shows them again", async () => {
    const user = userEvent.setup();
    const original = filledMeeting();
    const { core } = await renderApp({ meeting: original, error: null });
    expect(screen.getByRole("region", { name: "Agenda" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "What's on the agenda?" })).toBeVisible();

    await user.click(modeButton("Agenda-free"));
    expect(core.last()?.mode).toBe("free");
    expect(core.last()?.items).toEqual(original.items);
    expect(screen.queryByRole("region", { name: "Agenda" })).toBeNull();
    expect(document.querySelector(".budget-line")).toBeNull();
    expect(
      screen.queryByText("Add the topics and give each one a lead, a goal and a time budget."),
    ).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "A meeting without an agenda" })).toBeVisible();
    expect(screen.getByTestId("free-kept")).toHaveTextContent(
      "The 5 agenda items you typed are kept. Switch back to “With agenda” to see them.",
    );
    expect(screen.getByText(/60 min slot, 10:00 – 11:00/)).toBeVisible();

    await user.click(modeButton("With agenda"));
    expect(core.last()?.mode).toBe("agenda");
    expect(core.last()?.items).toEqual(original.items);
    const agenda = screen.getByRole("region", { name: "Agenda" });
    expect(within(agenda).getAllByRole("listitem")).toHaveLength(5);
    expect(within(agenda).getByText("Beta launch: scope and date")).toBeVisible();
    expect(document.querySelector(".budget-line")).not.toBeNull();
  });

  it("starts a meeting with no items in free mode and opens the free live view", async () => {
    const user = userEvent.setup();
    const clock = new FakeClock(at(10, 2));
    const { core } = await renderApp(
      { meeting: createMeeting("Quick sync", new Date(at(9, 30))), error: null },
      { clock },
    );
    expect(startButton()).toHaveAttribute("aria-disabled", "true");
    await user.click(modeButton("Agenda-free"));
    expect(startButton()).toHaveAttribute("aria-disabled", "false");
    expect(startButton()).not.toHaveAccessibleDescription();
    await user.click(startButton());
    await waitFor(() =>
      expect(document.querySelector('main[data-view="live"][data-mode="free"]')).not.toBeNull(),
    );
    expect(core.last()?.run).toEqual({ startedAt: at(10, 2), endedAt: null, items: [], topics: [] });
    expect(timer()).toBeVisible();
    expect(screen.getByText("Free mode")).toBeVisible();
    expect(screen.getByText("Quick sync · no agenda")).toBeVisible();
  });

  it("in agenda mode the noItems reason still blocks the start", async () => {
    const user = userEvent.setup();
    const { core } = await renderApp({ meeting: { ...freeSetupMeeting(), items: [] }, error: null });
    expect(startButton()).toHaveAttribute("aria-disabled", "false");
    await user.click(modeButton("With agenda"));
    expect(startButton()).toHaveAttribute("aria-disabled", "true");
    expect(startButton()).toHaveAccessibleDescription("Add at least one topic to start the meeting.");
    await user.click(startButton());
    expect(core.saved.some((m) => m.run)).toBe(false);
  });

  it("a stored meeting without mode opens as an agenda meeting", async () => {
    const m = filledMeeting();
    expect("mode" in m).toBe(false);
    await renderApp({ meeting: m, error: null });
    expect(modeButton("With agenda")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "Agenda" })).toBeInTheDocument();
  });
});

describe("AC2 the whole-meeting timer card", () => {
  it("shows the slot, whole minutes left, the end time and a progress bar: 0 %, 49 %, 50 %, 100 %", async () => {
    const { clock } = await openLive(liveFreeEmptyMeeting(), FREE_TIMES.start);
    expect(timer()).toHaveTextContent("No agenda · 60 min slot");
    expect(timer()).toHaveTextContent("60min left · ends 11:00 AM");
    expect(bar()).toHaveAttribute("aria-valuenow", "0");
    await tick(clock, at(10, 29, 24));
    expect(timer()).toHaveTextContent("30min left");
    expect(bar()).toHaveAttribute("aria-valuenow", "49");
    await tick(clock, at(10, 30));
    expect(bar()).toHaveAttribute("aria-valuenow", "50");
    expect(bar()).toHaveAttribute("aria-valuetext", "50 % of the time available");
    await tick(clock, at(11, 0));
    expect(bar()).toHaveAttribute("aria-valuenow", "100");
  });

  it("once over, says so in words and in the overrun colour", async () => {
    const { clock } = await openLive(liveFreeEmptyMeeting(), at(10, 59));
    expect(timer().querySelector('[data-over="false"]')).not.toBeNull();
    await tick(clock, at(11, 6, 30));
    expect(timer()).toHaveTextContent("6min over · slot ended 11:00 AM");
    expect(timer().querySelector('[data-over="true"]')).not.toBeNull();
    expect(timer()).toHaveClass("timer-card--over");
  });

  it("a late start shortens the time available; German shows the 24-hour end", async () => {
    localStorage.setItem("meeting-companion.locale", "de");
    const m = liveFreeEmptyMeeting();
    m.run!.startedAt = at(10, 15);
    await openLive(m, at(10, 15));
    const card = screen.getByRole("region", { name: "Ganzes Meeting" });
    expect(card).toHaveTextContent("Ohne Agenda · 60-Min.-Termin");
    expect(card).toHaveTextContent("45Min. übrig · endet 11:00");
  });

  it("a meeting started after its end is over from the first second", async () => {
    const m = liveFreeEmptyMeeting();
    m.run!.startedAt = at(11, 3);
    await openLive(m, at(11, 3));
    expect(timer()).toHaveTextContent("3min over");
    expect(bar()).toHaveAttribute("aria-valuenow", "100");
  });
});

describe("AC3 the half-time nudge", () => {
  it("none at 49 %, appears at 50 % without focus, announced once, gone for good after Dismiss", async () => {
    const user = userEvent.setup();
    const { clock } = await openLive(liveFreeMeeting(), at(10, 29, 24));
    expect(nudge()).toBeNull();
    expect(announcement()).toHaveTextContent("");
    const focused = document.activeElement;
    await tick(clock, at(10, 30));
    expect(nudge()).toBeVisible();
    expect(nudge()).toHaveTextContent("Half the time is gone");
    expect(nudge()).toHaveTextContent("30 min left, ends 11:00 AM");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(focused);
    expect(within(nudge()!).getAllByRole("button")).toHaveLength(1);
    expect(announcement()).toHaveTextContent("Half the time is gone. 30 min left, ends 11:00 AM.");
    // The countdown in the nudge moves on; the announcement does not repeat.
    await tick(clock, at(10, 31, 30));
    expect(nudge()).toHaveTextContent("28 min left");
    expect(announcement()).toHaveTextContent("Half the time is gone. 30 min left, ends 11:00 AM.");
    // The rest of the view keeps working with the nudge open.
    await user.click(topicRow(/^Teacher onboarding/));
    expect(topicRow(/^Teacher onboarding/)).toHaveAttribute("aria-pressed", "true");

    await user.click(within(nudge()!).getByRole("button", { name: "Dismiss" }));
    expect(nudge()).toBeNull();
    for (const t of [at(10, 40), at(10, 50), at(10, 59)]) {
      await tick(clock, t);
      expect(nudge()).toBeNull();
    }
  });

  it("Dismiss by keyboard moves focus to Add topic instead of losing it", async () => {
    const user = userEvent.setup();
    await openLive(liveFreeMeeting(), FREE_TIMES.half);
    within(nudge()!).getByRole("button", { name: "Dismiss" }).focus();
    await user.keyboard("{Enter}");
    expect(nudge()).toBeNull();
    expect(screen.getByRole("button", { name: "Add topic" })).toHaveFocus();
  });

  it("none for a meeting that started after its end, and none once the meeting is over", async () => {
    const m = liveFreeEmptyMeeting();
    m.run!.startedAt = at(11, 3);
    const { clock, unmount } = await openLive(m, at(11, 3));
    expect(nudge()).toBeNull();
    await tick(clock, at(11, 30));
    expect(nudge()).toBeNull();
    unmount();
    await openLive(liveFreeMeeting(), FREE_TIMES.over);
    expect(nudge()).toBeNull();
  });
});

describe("AC4 + AC5 Topics so far: add, switch, stop; every change saved at once", () => {
  it("starts empty with a hint; Add topic adds at the end, makes it talking now and saves", async () => {
    const user = userEvent.setup();
    const { core, clock } = await openLive(liveFreeEmptyMeeting(), at(10, 2));
    expect(within(topicsCard()).getByText("No topics yet")).toBeVisible();
    expect(within(topicsCard()).queryByRole("list")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Add topic" }));
    const field = screen.getByRole("textbox", { name: "New topic" });
    expect(field).toHaveFocus();
    await user.type(field, "  Offline mode for the beta {Enter}");
    const row = topicRow(/^Offline mode for the beta/);
    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(row).toHaveTextContent("talking now");
    expect(row).toHaveTextContent("0 min");
    expect(screen.getByRole("button", { name: "Add topic" })).toHaveFocus();
    const saved = core.last()!.run!.topics!;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ title: "Offline mode for the beta", source: "manual" });
    expect(saved[0]!.spans).toEqual([{ startedAt: at(10, 2), endedAt: null }]);

    await act(() => clock.advance(3 * MINUTE));
    await user.click(screen.getByRole("button", { name: "Add topic" }));
    await user.type(screen.getByRole("textbox", { name: "New topic" }), "Teacher onboarding");
    await user.click(screen.getByRole("button", { name: "Add" }));
    const rows = within(topicsCard()).getAllByRole("button", { pressed: false });
    expect(rows[0]).toHaveTextContent("Offline mode for the beta3 min");
    expect(topicRow(/^Teacher onboarding/)).toHaveAttribute("aria-pressed", "true");
    expect(within(topicsCard()).getByText("2 topics")).toBeVisible();
    expect(core.last()!.run!.topics!.map((t) => t.title)).toEqual([
      "Offline mode for the beta",
      "Teacher onboarding",
    ]);
  });

  it("an empty or too long title shows an inline error by key and adds nothing; Esc cancels", async () => {
    const user = userEvent.setup();
    const { core } = await openLive(liveFreeEmptyMeeting(), at(10, 2));
    const saves = core.saved.length;
    await user.click(screen.getByRole("button", { name: "Add topic" }));
    await user.type(screen.getByRole("textbox", { name: "New topic" }), "   {Enter}");
    const field = screen.getByRole("textbox", { name: "New topic" });
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(/Enter a title for the topic\./);
    await user.clear(field);
    await user.click(field);
    await user.paste("x".repeat(214));
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(field).toHaveAccessibleDescription(/Keep the title to 200 characters or fewer \(now 214\)\./);
    expect(core.saved.length).toBe(saves);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "New topic" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add topic" })).toHaveFocus();
    expect(within(topicsCard()).getByText("No topics yet")).toBeVisible();
  });

  it("tap switches (closing the previous span), tap again stops, Enter works, minutes add up", async () => {
    const user = userEvent.setup();
    const { core, clock } = await openLive(liveFreeMeeting(), at(10, 29));
    expect(topicRow(/^Interview recruiting/)).toHaveTextContent("2 min");
    // Back to an earlier topic: its minutes continue from 14.
    await user.click(topicRow(/^Offline mode/));
    expect(topicRow(/^Offline mode/)).toHaveAttribute("aria-pressed", "true");
    expect(topicRow(/^Interview recruiting/)).toHaveAttribute("aria-pressed", "false");
    expect(topicRow(/^Interview recruiting/)).not.toHaveTextContent("talking now");
    const after = core.last()!.run!.topics!;
    expect(after[3]!.spans).toEqual([{ startedAt: at(10, 27), endedAt: at(10, 29) }]);
    expect(after[0]!.spans.at(-1)).toEqual({ startedAt: at(10, 29), endedAt: null });
    await tick(clock, at(10, 33));
    expect(topicRow(/^Offline mode/)).toHaveTextContent("18 min");
    // Tap again: no topic is current, and the hint says so.
    await user.click(topicRow(/^Offline mode/));
    expect(within(topicsCard()).queryAllByRole("button", { pressed: true })).toHaveLength(0);
    expect(
      within(topicsCard()).getByText("No topic is current. Tap one when the talk turns to it."),
    ).toBeVisible();
    expect(core.last()!.run!.topics!.every((t) => t.spans.every((s) => s.endedAt !== null))).toBe(true);
    await tick(clock, at(10, 45));
    expect(topicRow(/^Offline mode/)).toHaveTextContent("18 min");
    // Enter on a row works like a tap.
    topicRow(/^Teacher onboarding/).focus();
    await user.keyboard("{Enter}");
    expect(topicRow(/^Teacher onboarding/)).toHaveAttribute("aria-pressed", "true");
  });

  it("at 100 topics Add topic is disabled and says why", async () => {
    let m = liveFreeEmptyMeeting();
    for (let i = 0; i < 100; i++) m = addTopic(m, `Topic ${i}`, at(10, 1), `t-${i}`);
    await openLive(m, at(10, 5));
    expect(screen.getByRole("button", { name: "Add topic" })).toBeDisabled();
    expect(within(topicsCard()).getByText("A meeting can have up to 100 topics.")).toBeVisible();
    expect(within(topicsCard()).getByText("100 topics")).toBeVisible();
  });

  it("topic titles are rendered as text only", async () => {
    const m = liveFreeMeeting();
    m.run!.topics![0]!.title = '<img src=x onerror="alert(1)">';
    await openLive(m, FREE_TIMES.running);
    expect(topicRow(/^<img src=x/)).toBeVisible();
    expect(topicsCard().querySelector("img")).toBeNull();
  });

  it("End meeting closes the open span and saves the end", async () => {
    const user = userEvent.setup();
    const { core } = await openLive(liveFreeMeeting(), FREE_TIMES.running);
    await user.click(screen.getByRole("button", { name: "End meeting" }));
    await user.click(screen.getByRole("button", { name: "Click again to end" }));
    await waitFor(() => expect(core.saved.some((m) => m.run?.endedAt)).toBe(true));
    const ended = core.saved.find((m) => m.run?.endedAt)!;
    expect(ended.run!.endedAt).toBe(FREE_TIMES.running);
    expect(ended.run!.topics![3]!.spans[0]!.endedAt).toBe(FREE_TIMES.running);
  });
});

describe("AC6 recording in a free meeting", () => {
  it("shows the consent gate before recording, and starts only after confirmation", async () => {
    const user = userEvent.setup();
    const { core } = await openLive(liveFreeEmptyMeeting(), at(10, 2));
    const card = screen.getByRole("region", { name: "Transcript" });
    const box = within(card).getByRole("checkbox", {
      name: "Everyone was informed that this meeting is transcribed",
    });
    const start = within(card).getByRole("button", { name: "Start recording" });
    expect(start).toBeDisabled();
    expect(screen.queryByTestId("rec-chip")).toBeNull();
    expect(core.calls.some((c) => c.cmd === "start_recording")).toBe(false);
    await user.click(box);
    await user.click(start);
    const cmds = core.calls.map((c) => c.cmd).filter((c) => c.includes("recording"));
    expect(cmds.slice(-2)).toEqual(["confirm_recording_consent", "start_recording"]);
    await waitFor(() => expect(screen.getByTestId("rec-chip")).toHaveTextContent("REC"));
    // The speakers view opens from the free live view as from frame 02.
    expect(screen.getByRole("button", { name: /speakers/i })).toBeInTheDocument();
  });
});
