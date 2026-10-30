import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "../../lib/clock";
import { renderApp } from "../../test/backend";
import { filledMeeting, LIVE_TIMES, liveDoneMeeting, liveMeeting } from "../agenda/fixtures";
import { createMeeting, type Meeting } from "../agenda/model";
import { MINUTE } from "./run";

beforeEach(() => {
  localStorage.setItem("meeting-companion.locale", "en");
});

async function openLive(meeting: Meeting, time: number) {
  const clock = new FakeClock(time);
  const utils = await renderApp({ meeting, error: null }, { clock, view: "live" });
  return { clock, ...utils };
}

const timer = () => screen.getByRole("region", { name: "Current item" });
const bar = () => screen.getByRole("progressbar", { name: "Time used" });
const rows = () => within(screen.getByRole("region", { name: "Agenda" })).getAllByRole("listitem");
const overall = () => document.querySelector(".overall")!;
const nudge = () => screen.queryByRole("group", { name: /left for item|Time is up/ });
const tick = (clock: FakeClock, time: number) => act(() => clock.set(time));

describe("AC1 Start meeting and the timer card", () => {
  it("is disabled with a visible reason while the meeting has no items", async () => {
    const user = userEvent.setup();
    const { core } = await renderApp({ meeting: createMeeting("Sync"), error: null });
    const start = screen.getByRole("button", { name: "Start meeting" });
    expect(start).toHaveAttribute("aria-disabled", "true");
    expect(start).toHaveAccessibleDescription("Add at least one topic to start the meeting.");
    expect(screen.getByText("Add at least one topic to start the meeting.")).toBeVisible();
    await user.click(start);
    expect(core.saved).toHaveLength(0);
    expect(document.querySelector('main[data-view="agenda-setup"]')).not.toBeNull();
  });

  it("is disabled with a visible reason while a field has a validation error", async () => {
    const user = userEvent.setup();
    const { core } = await renderApp({ meeting: filledMeeting(), error: null });
    const start = screen.getByRole("button", { name: "Start meeting" });
    expect(start).toHaveAttribute("aria-disabled", "false");
    await user.clear(screen.getByLabelText("Title"));
    expect(start).toHaveAttribute("aria-disabled", "true");
    expect(start).toHaveAccessibleDescription("Correct the marked fields to start the meeting.");
    await user.click(start);
    expect(core.saved.some((m) => m.run)).toBe(false);
    // An invalid topic in the open editor blocks as well.
    await user.type(screen.getByLabelText("Title"), "Sync");
    expect(start).toHaveAttribute("aria-disabled", "false");
    await user.click(screen.getByRole("button", { name: /^Budget for Q1/ }));
    await user.clear(screen.getByLabelText("Minutes"));
    expect(start).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(start).toHaveAttribute("aria-disabled", "false");
  });

  it("records the start time, starts item 01 and switches to the live view", async () => {
    const user = userEvent.setup();
    const clock = new FakeClock(LIVE_TIMES.start);
    const { core } = await renderApp({ meeting: filledMeeting(), error: null }, { clock });
    await user.click(screen.getByRole("button", { name: "Start meeting" }));
    expect(document.querySelector('main[data-view="live"]')).not.toBeNull();
    await waitFor(() => expect(core.last()?.run).toBeTruthy());
    expect(core.last()!.run).toEqual({
      startedAt: LIVE_TIMES.start,
      endedAt: null,
      items: [{ itemId: "i-1", startedAt: LIVE_TIMES.start, endedAt: null, extraMinutes: 0, parked: false }],
    });
    expect(timer()).toHaveTextContent("Now · Item 01");
    expect(timer()).toHaveTextContent("Check-in & goals");
    expect(timer()).toHaveTextContent("5:00left of 5:00");
    expect(screen.getByRole("banner")).toHaveTextContent("Product sync · Beta launch");
    expect(screen.getByRole("button", { name: "End meeting" })).toBeInTheDocument();
    // The setup's "New meeting" is not offered while the meeting runs.
    expect(screen.queryByRole("button", { name: "New meeting" })).toBeNull();
  });

  it("shows 0 %, 79 %, 100 % and the overrun as text, from stored timestamps and the clock", async () => {
    const { clock } = await openLive(liveMeeting(), LIVE_TIMES.item2Start);
    expect(timer()).toHaveTextContent("Now · Item 02");
    expect(timer()).toHaveTextContent("Beta launch: scope and date");
    expect(timer()).toHaveTextContent("15:00left of 15:00");
    expect(bar()).toHaveAttribute("aria-valuenow", "0");
    expect(timer()).toHaveClass("timer-card--early");

    // One jump of almost 12 minutes, as after the machine slept: no ticks are needed.
    tick(clock, LIVE_TIMES.running);
    expect(timer()).toHaveTextContent("3:12left of 15:00");
    expect(bar()).toHaveAttribute("aria-valuenow", "79");
    expect(timer()).toHaveClass("timer-card--warn");

    tick(clock, LIVE_TIMES.item2Start + 15 * MINUTE);
    expect(timer()).toHaveTextContent("0:00left of 15:00");
    expect(bar()).toHaveAttribute("aria-valuenow", "100");
    expect(timer().querySelector(".timer-card__time")).toHaveAttribute("data-over", "false");

    tick(clock, LIVE_TIMES.over);
    expect(timer()).toHaveTextContent("2:10over · planned 15:00");
    expect(timer().querySelector(".timer-card__time")).toHaveAttribute("data-over", "true");
    expect(timer()).toHaveClass("timer-card--over");
    expect(bar()).toHaveAttribute("aria-valuenow", "100");
  });
});

describe("AC2 next, park and the last item", () => {
  it("next ends the item, records its duration, starts the next one and keeps focus", async () => {
    const user = userEvent.setup();
    const { clock, core } = await openLive(liveMeeting(), LIVE_TIMES.running);
    const next = screen.getByRole("button", { name: "Next ›" });
    next.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(core.saved).toHaveLength(1));
    expect(core.last()!.run!.items[1]).toMatchObject({ endedAt: LIVE_TIMES.running, parked: false });
    expect(core.last()!.run!.items[2]).toMatchObject({ itemId: "i-3", startedAt: LIVE_TIMES.running });
    expect(timer()).toHaveTextContent("Now · Item 03");
    expect(rows()[1]).toHaveTextContent("Done: Beta launch: scope and date11 of 15 min");
    expect(next).toHaveFocus();
    tick(clock, LIVE_TIMES.running + 2 * MINUTE);
    expect(timer()).toHaveTextContent("13:00left of 15:00");
  });

  it("park ends the item as parked and lists it in the parking lot with the minutes spent", async () => {
    const user = userEvent.setup();
    const { core } = await openLive(liveMeeting(), LIVE_TIMES.running);
    const lot = screen.getByRole("button", { name: /^Parking lot/ });
    expect(lot).toHaveTextContent("Parking lot0");
    await user.click(screen.getByRole("button", { name: "Park it" }));
    await waitFor(() => expect(core.last()?.run?.items[1]?.parked).toBe(true));
    expect(lot).toHaveTextContent("Parking lot1");
    expect(rows()[1]).toHaveTextContent("Parked: Beta launch: scope and dateParked · 11 min");
    expect(lot).toHaveAttribute("aria-expanded", "false");
    await user.click(lot);
    expect(lot).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByRole("list", { name: "Parking lot" });
    expect(within(list).getByRole("listitem")).toHaveTextContent("Beta launch: scope and date11 min");
  });

  it("on the last item next and park end the agenda; only End meeting is left", async () => {
    for (const action of ["Next ›", "Park it"]) {
      const user = userEvent.setup();
      const { core, unmount } = await openLive(liveMeeting(), LIVE_TIMES.running);
      for (let i = 0; i < 3; i++) await user.click(screen.getByRole("button", { name: "Next ›" }));
      expect(timer()).toHaveTextContent("Now · Item 05");
      await user.click(screen.getByRole("button", { name: action }));
      const done = screen.getByRole("heading", { name: "Agenda done" });
      expect(done).toHaveFocus();
      expect(screen.queryByRole("button", { name: "Next ›" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Park it" })).toBeNull();
      expect(screen.queryByRole("button", { name: "+5 min" })).toBeNull();
      expect(screen.getByRole("button", { name: "End meeting" })).toBeInTheDocument();
      await waitFor(() => expect(core.saved).toHaveLength(4));
      expect(core.last()!.run!.items.every((r) => r.endedAt !== null)).toBe(true);
      expect(core.last()!.run!.endedAt).toBeNull();
      unmount();
    }
  });
});

describe("AC3 agenda states and the overall line", () => {
  it("shows done, now, upcoming and parked with icon or number plus text", async () => {
    const { clock } = await openLive(liveMeeting(), LIVE_TIMES.item2Start + 12 * MINUTE + 30_000);
    const r = rows();
    expect(r[0]).toHaveTextContent("Done: Check-in & goals6 of 5 min");
    expect(r[0]!.querySelector('[data-over="true"]')).not.toBeNull();
    expect(r[1]).toHaveTextContent("Now: Beta launch: scope and date12 of 15 min");
    expect(r[1]).toHaveAttribute("aria-current", "step");
    expect(r[2]).toHaveTextContent("Upcoming: Pilot schools: feedback so far15 min");
    expect(r[2]!.querySelector(".live-row__icon")).toHaveTextContent("3");
    // "now" is live: a minute later it says 13.
    tick(clock, LIVE_TIMES.item2Start + 13 * MINUTE);
    expect(rows()[1]).toHaveTextContent("13 of 15 min");

    const done = await openLive(liveDoneMeeting(), LIVE_TIMES.done);
    const d = within(done.container).getAllByRole("listitem");
    expect(d[0]).toHaveTextContent("Done: Check-in & goals6 of 5 min");
    expect(d[1]).toHaveTextContent("Done: Beta launch: scope and date18 of 20 min");
    expect(d[1]!.querySelector('[data-over="true"]')).toBeNull();
    expect(d[2]).toHaveTextContent("Parked: Pilot schools: feedback so farParked · 4 min");
  });

  it("shows the scheduled end in the active locale and on track or behind", async () => {
    const { clock } = await openLive(liveMeeting(), LIVE_TIMES.running);
    expect(overall()).toHaveTextContent("Meeting ends 11:00 AM");
    // Item 01 ran 1 min over; the buffer absorbs it.
    expect(overall()).toHaveTextContent("On track · 1 min of buffer used");
    expect(overall().querySelector(".overall__status--ok")).not.toBeNull();
    // 10:30: 0 left, then 35 min of upcoming items → 11:05.
    tick(clock, new Date(2026, 9, 30, 10, 30).getTime());
    expect(overall()).toHaveTextContent("5 min behind");
    expect(overall().querySelector(".overall__status--behind")).not.toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Deutsch" }));
    expect(overall()).toHaveTextContent("Meeting endet 11:00");
    expect(overall()).toHaveTextContent("5 Min. im Verzug");
  });

  it("agrees with an item timer that runs over: it shows how much buffer is used", async () => {
    const user = userEvent.setup();
    const { clock } = await openLive(liveMeeting(), LIVE_TIMES.over);
    expect(timer()).toHaveTextContent("2:10over · planned 15:00");
    // 10:23:10 + 35 min of upcoming items = 10:58:10: 1 of the 5 buffer minutes is left.
    expect(overall()).toHaveTextContent("On track · 4 min of buffer used");
    expect(overall()).not.toHaveTextContent("+");
    // The longer the item runs over, the more buffer is used, until the meeting is behind.
    tick(clock, LIVE_TIMES.over + MINUTE);
    expect(overall()).toHaveTextContent("On track · 5 min of buffer used");
    tick(clock, LIVE_TIMES.over + 2 * MINUTE);
    expect(overall()).toHaveTextContent("1 min behind");
    tick(clock, LIVE_TIMES.over);
    await user.click(screen.getByRole("button", { name: "Deutsch" }));
    expect(overall()).toHaveTextContent("Im Plan · 4 Min. Puffer verbraucht");
  });

  it("shows the buffer that is left while nothing has used it", async () => {
    const m = liveMeeting();
    m.run = { ...m.run!, items: [{ ...m.run!.items[0]!, endedAt: null }] };
    const { clock } = await openLive(m, LIVE_TIMES.start);
    expect(overall()).toHaveTextContent("On track · 5 min buffer");
    tick(clock, LIVE_TIMES.start + 3 * MINUTE);
    expect(overall()).toHaveTextContent("On track · 5 min buffer");
  });
});

describe("AC4 +5 min", () => {
  it("a single press extends the budget, the bar, the time left and the overall line at once", async () => {
    const user = userEvent.setup();
    const { core } = await openLive(liveMeeting(), LIVE_TIMES.running);
    expect(bar()).toHaveAttribute("aria-valuenow", "79");
    await user.click(screen.getByRole("button", { name: "+5 min" }));
    expect(timer()).toHaveTextContent("8:12left of 20:00");
    expect(bar()).toHaveAttribute("aria-valuenow", "59");
    expect(rows()[1]).toHaveTextContent("11 of 20 min");
    // The 5 min came out of the buffer: 10:56 + 5 = 11:01.
    expect(overall()).toHaveTextContent("1 min behind");
    await waitFor(() => expect(core.last()?.run?.items[1]?.extraMinutes).toBe(5));
  });

  it("repeated presses add up and keep working with no buffer left", async () => {
    const user = userEvent.setup();
    const { core } = await openLive(liveMeeting(), LIVE_TIMES.item2Start);
    // Item 01 ran 1 min over, so 4 of the 5 buffer minutes are left: 10:06 + 15 + 35 = 10:56.
    expect(overall()).toHaveTextContent("On track · 1 min of buffer used");
    const plus = screen.getByRole("button", { name: "+5 min" });
    await user.click(plus);
    // The planned buffer is used up.
    expect(overall()).toHaveTextContent("1 min behind");
    await user.click(plus);
    await user.click(plus);
    expect(plus).toBeEnabled();
    expect(timer()).toHaveTextContent("left of 30:00");
    expect(overall()).toHaveTextContent("11 min behind");
    await waitFor(() => expect(core.last()?.run?.items[1]?.extraMinutes).toBe(15));
    expect(core.saved).toHaveLength(3);
  });
});

describe("AC5 time nudge", () => {
  it("does not appear at 79 % and appears at 80 % without taking focus, announced once", async () => {
    const { clock } = await openLive(liveMeeting(), LIVE_TIMES.running);
    const lot = screen.getByRole("button", { name: /^Parking lot/ });
    lot.focus();
    expect(nudge()).toBeNull();
    const live = screen.getByTestId("nudge-announcement");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toBeEmptyDOMElement();

    tick(clock, LIVE_TIMES.nudge);
    const n = nudge()!;
    expect(n).toHaveTextContent("3 minutes left for item 02");
    expect(n).toHaveTextContent("Wrap up, or take 5 min from the buffer?");
    expect(n).not.toHaveAttribute("aria-modal");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(lot).toHaveFocus();
    expect(live).toHaveTextContent("3 minutes left for item 02 Wrap up, or take 5 min from the buffer?");

    // The countdown moves on; the announcement does not repeat.
    tick(clock, LIVE_TIMES.nudge + 70_000);
    expect(nudge()).toHaveTextContent("1 minute left for item 02");
    expect(live).toHaveTextContent("3 minutes left for item 02");
    // Everything behind it stays usable.
    await userEvent.setup().click(lot);
    expect(lot).toHaveAttribute("aria-expanded", "true");
  });

  it("Wrap up dismisses it, and it does not come back for the same item and budget", async () => {
    const user = userEvent.setup();
    const { clock } = await openLive(liveMeeting(), LIVE_TIMES.nudge);
    await user.click(within(nudge()!).getByRole("button", { name: "Wrap up" }));
    expect(nudge()).toBeNull();
    expect(screen.getByRole("button", { name: "Next ›" })).toHaveFocus();
    tick(clock, LIVE_TIMES.over);
    expect(nudge()).toBeNull();
    expect(screen.getByTestId("nudge-announcement")).toBeEmptyDOMElement();
  });

  it("+5 min in the nudge extends the item and re-arms it for the new 80 % mark", async () => {
    const user = userEvent.setup();
    const { clock, core } = await openLive(liveMeeting(), LIVE_TIMES.nudge);
    await user.click(within(nudge()!).getByRole("button", { name: "+5 min" }));
    expect(nudge()).toBeNull();
    expect(timer()).toHaveTextContent("left of 20:00");
    await waitFor(() => expect(core.last()?.run?.items[1]?.extraMinutes).toBe(5));
    // New 80 %: 16 of 20 min, at 10:22.
    tick(clock, LIVE_TIMES.item2Start + 16 * MINUTE - 1000);
    expect(nudge()).toBeNull();
    tick(clock, LIVE_TIMES.item2Start + 16 * MINUTE);
    expect(nudge()).toHaveTextContent("4 minutes left for item 02");
    expect(screen.getByTestId("nudge-announcement")).toHaveTextContent("4 minutes left for item 02");
  });

  it("disappears when the item ends", async () => {
    const user = userEvent.setup();
    await openLive(liveMeeting(), LIVE_TIMES.over);
    expect(nudge()).toHaveTextContent("Time is up for item 02");
    await user.click(screen.getByRole("button", { name: "Next ›" }));
    expect(nudge()).toBeNull();
  });
});

describe("AC6 persistence, resume and End meeting", () => {
  it("a running meeting reopens in the live view on the same item, recomputed from the clock", async () => {
    await openLive(liveMeeting(), LIVE_TIMES.over);
    expect(timer()).toHaveTextContent("Now · Item 02");
    expect(timer()).toHaveTextContent("2:10over");
  });

  it("End meeting asks for a second click inline, records the end and opens a new meeting", async () => {
    const user = userEvent.setup();
    const { core } = await openLive(liveMeeting(), LIVE_TIMES.running);
    await user.click(screen.getByRole("button", { name: "End meeting" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const confirm = screen.getByRole("button", { name: "Click again to end" });
    expect(confirm).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Click again to end the meeting");
    // "Keep going" disarms it.
    await user.click(screen.getByRole("button", { name: "Keep going" }));
    expect(screen.getByRole("button", { name: "End meeting" })).toHaveFocus();
    expect(core.saved).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "End meeting" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "End meeting" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "End meeting" }));
    await user.click(screen.getByRole("button", { name: "Click again to end" }));
    await waitFor(() => expect(core.saved).toHaveLength(2));
    const [ended, fresh] = core.saved;
    expect(ended!.id).toBe("fixture-live");
    expect(ended!.run!.endedAt).toBe(LIVE_TIMES.running);
    expect(ended!.run!.items[1]!.endedAt).toBe(LIVE_TIMES.running);
    expect(fresh!.id).not.toBe("fixture-live");
    expect(fresh!.run).toBeUndefined();
    expect(document.querySelector('main[data-view="agenda-setup"]')).not.toBeNull();
    expect(screen.getByLabelText("Title")).toHaveValue("New meeting");
  });

  it("an ended meeting never reopens in the live view", async () => {
    const m = liveMeeting();
    m.run!.items[1]!.endedAt = LIVE_TIMES.running;
    m.run!.endedAt = LIVE_TIMES.running;
    const { core } = await renderApp({ meeting: m, error: null }, { clock: new FakeClock(LIVE_TIMES.over) });
    expect(document.querySelector('main[data-view="live"]')).toBeNull();
    expect(screen.getByLabelText("Title")).toHaveValue("New meeting");
    expect(core.saved).toHaveLength(0);
  });

  it("each timekeeping action is saved at once", async () => {
    const user = userEvent.setup();
    const { core } = await openLive(liveMeeting(), LIVE_TIMES.running);
    await user.click(screen.getByRole("button", { name: "+5 min" }));
    await waitFor(() => expect(core.saved).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Park it" }));
    await waitFor(() => expect(core.saved).toHaveLength(2));
    await user.click(screen.getByRole("button", { name: "Next ›" }));
    await waitFor(() => expect(core.saved).toHaveLength(3));
    expect(core.last()!.run!.items.map((r) => [r.itemId, r.parked, r.extraMinutes])).toEqual([
      ["i-1", false, 0],
      ["i-2", true, 5],
      ["i-3", false, 0],
      ["i-4", false, 0],
    ]);
  });
});
