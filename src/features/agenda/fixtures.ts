import type { Meeting } from "./model";

// Sample data from frame 01, used by tests, the e2e build and screenshots.
export const FIXTURE_PARTICIPANTS = [
  { id: "p-mk", name: "Mara Klein" },
  { id: "p-tb", name: "Tobias Brandt" },
  { id: "p-ls", name: "Lena Sommer" },
  { id: "p-ya", name: "Yusuf Aydin" },
  { id: "p-jr", name: "Jana Roth" },
];

export function filledMeeting(): Meeting {
  return {
    version: 1,
    id: "fixture-filled",
    title: "Product sync · Beta launch",
    date: "2026-10-30",
    start: "10:00",
    end: "11:00",
    participants: FIXTURE_PARTICIPANTS.map((p) => ({ ...p })),
    items: [
      { id: "i-1", title: "Check-in & goals", outcome: "", lead: "p-mk", goal: "inform", minutes: 5 },
      {
        id: "i-2",
        title: "Beta launch: scope and date",
        outcome: "a launch date everyone commits to",
        lead: "p-tb",
        goal: "decide",
        minutes: 15,
      },
      {
        id: "i-3",
        title: "Pilot schools: feedback so far",
        outcome: "",
        lead: "p-ls",
        goal: "discuss",
        minutes: 15,
      },
      {
        id: "i-4",
        title: "Budget for Q1 user research",
        outcome: "",
        lead: "p-ya",
        goal: "decide",
        minutes: 10,
      },
      {
        id: "i-5",
        title: "Open questions & next steps",
        outcome: "",
        lead: "p-mk",
        goal: "discuss",
        minutes: 10,
      },
    ],
    updatedAt: 1,
  };
}

export function overBudgetMeeting(): Meeting {
  const m = filledMeeting();
  m.id = "fixture-over";
  m.items = m.items.map((it) => (it.id === "i-3" ? { ...it, minutes: 30 } : it));
  return m;
}

// ---- live meeting (frame 02) --------------------------------------------------------------------

const at = (h: number, m: number, s = 0) => new Date(2026, 9, 30, h, m, s).getTime();

/**
 * Fixed clock times (local time on the fixture date) for the live fixtures. The live meeting
 * started at 10:00; item 01 ran 6 of 5 min, item 02 started at 10:06.
 */
export const LIVE_TIMES = {
  start: at(10, 0),
  item2Start: at(10, 6),
  /** 79 % of item 02's 15 min: 3:12 left, as in the frame. */
  running: at(10, 17, 48),
  /** 80 %: the nudge appears. */
  nudge: at(10, 18, 0),
  /** 2:10 over. */
  over: at(10, 23, 10),
  /** After the last item ended. */
  done: at(10, 58, 0),
} as const;

/** Frame 02: item 01 done (6 of 5 min), item 02 running. */
export function liveMeeting(): Meeting {
  const m = filledMeeting();
  m.id = "fixture-live";
  m.run = {
    startedAt: LIVE_TIMES.start,
    endedAt: null,
    items: [
      {
        itemId: "i-1",
        startedAt: LIVE_TIMES.start,
        endedAt: LIVE_TIMES.item2Start,
        extraMinutes: 0,
        parked: false,
      },
      { itemId: "i-2", startedAt: LIVE_TIMES.item2Start, endedAt: null, extraMinutes: 0, parked: false },
    ],
  };
  return m;
}

/** Every item ended; item 03 was parked after 4 min, item 02 got +5 min. */
export function liveDoneMeeting(): Meeting {
  const m = filledMeeting();
  m.id = "fixture-live-done";
  const t = (h: number, min: number) => at(h, min);
  m.run = {
    startedAt: t(10, 0),
    endedAt: null,
    items: [
      { itemId: "i-1", startedAt: t(10, 0), endedAt: t(10, 6), extraMinutes: 0, parked: false },
      { itemId: "i-2", startedAt: t(10, 6), endedAt: t(10, 24), extraMinutes: 5, parked: false },
      { itemId: "i-3", startedAt: t(10, 24), endedAt: t(10, 28), extraMinutes: 0, parked: true },
      { itemId: "i-4", startedAt: t(10, 28), endedAt: t(10, 39), extraMinutes: 0, parked: false },
      { itemId: "i-5", startedAt: t(10, 39), endedAt: t(10, 48), extraMinutes: 0, parked: false },
    ],
  };
  return m;
}
