import { describe, expect, it } from "vitest";
import { filledMeeting, LIVE_TIMES, liveMeeting } from "../agenda/fixtures";
import { createMeeting, isMeetingValid, type Meeting } from "../agenda/model";
import {
  MINUTE,
  advance,
  canExtend,
  endRun,
  extend,
  isEnded,
  isRunning,
  liveSnapshot,
  nudgeDue,
  scheduleStatus,
  startRun,
  timerText,
} from "./run";

const T0 = LIVE_TIMES.start;
const snap = (m: Meeting, now: number) => liveSnapshot(m, m.run!, now);

describe("AC1 start and timer", () => {
  it("start records the start time and starts item 01", () => {
    const m = startRun(filledMeeting(), T0);
    expect(m.run).toEqual({
      startedAt: T0,
      endedAt: null,
      items: [{ itemId: "i-1", startedAt: T0, endedAt: null, extraMinutes: 0, parked: false }],
    });
    expect(isRunning(m)).toBe(true);
    expect(isMeetingValid(m)).toBe(true);
  });

  it("a meeting without items cannot start", () => {
    const m = createMeeting("x");
    expect(startRun(m, T0)).toBe(m);
  });

  it("remaining time comes from the stored start and the clock, not from ticks", () => {
    const m = startRun(filledMeeting(), T0);
    // Four minutes later in one jump (the machine slept): all four minutes count.
    const c = snap(m, T0 + 4 * MINUTE + 1000).current!;
    expect(c.remainingMs).toBe(MINUTE - 1000);
    expect(timerText(c.remainingMs)).toEqual({ over: false, text: "0:59" });
  });

  it("formats the timer as m:ss, rounding time left up and showing the overrun as text", () => {
    expect(timerText(15 * MINUTE)).toEqual({ over: false, text: "15:00" });
    expect(timerText(192_000)).toEqual({ over: false, text: "3:12" });
    expect(timerText(191_001)).toEqual({ over: false, text: "3:12" });
    expect(timerText(0)).toEqual({ over: false, text: "0:00" });
    expect(timerText(-130_000)).toEqual({ over: true, text: "2:10" });
  });

  it("a clock that went backwards counts as no time spent", () => {
    const m = startRun(filledMeeting(), T0);
    expect(snap(m, T0 - 5000).current!.elapsedMs).toBe(0);
  });
});

describe("AC2 next, park and the last item", () => {
  it("next ends the current item, records its duration and starts the next one", () => {
    let m = startRun(filledMeeting(), T0);
    m = advance(m, T0 + 6 * MINUTE);
    expect(m.run!.items).toEqual([
      { itemId: "i-1", startedAt: T0, endedAt: T0 + 6 * MINUTE, extraMinutes: 0, parked: false },
      { itemId: "i-2", startedAt: T0 + 6 * MINUTE, endedAt: null, extraMinutes: 0, parked: false },
    ]);
    const s = snap(m, T0 + 6 * MINUTE);
    expect(s.rows[0]).toMatchObject({ state: "done", actualMinutes: 6, plannedMinutes: 5, over: true });
    expect(s.current!.item.id).toBe("i-2");
    expect(isMeetingValid(m)).toBe(true);
  });

  it("park ends the item as parked and lists it in the parking lot", () => {
    let m = startRun(filledMeeting(), T0);
    m = advance(m, T0 + 3 * MINUTE + 30_000, true);
    const s = snap(m, T0 + 4 * MINUTE);
    expect(s.rows[0]).toMatchObject({ state: "parked", actualMinutes: 3 });
    expect(s.parked.map((r) => r.item.id)).toEqual(["i-1"]);
    expect(s.current!.item.id).toBe("i-2");
  });

  it("next or park on the last item ends the agenda", () => {
    for (const parked of [false, true]) {
      let m = startRun(filledMeeting(), T0);
      for (let i = 1; i <= 5; i++) m = advance(m, T0 + i * 10 * MINUTE, parked && i === 5);
      const s = snap(m, T0 + 60 * MINUTE);
      expect(s.current).toBeNull();
      expect(s.agendaDone).toBe(true);
      expect(isRunning(m)).toBe(true);
      expect(isMeetingValid(m)).toBe(true);
      // Nothing more to advance.
      expect(advance(m, T0 + 61 * MINUTE)).toBe(m);
    }
  });

  it("end meeting closes the current item and records the end time", () => {
    let m = startRun(filledMeeting(), T0);
    m = endRun(m, T0 + 2 * MINUTE);
    expect(m.run!.endedAt).toBe(T0 + 2 * MINUTE);
    expect(m.run!.items[0]!.endedAt).toBe(T0 + 2 * MINUTE);
    expect(isEnded(m)).toBe(true);
    expect(isRunning(m)).toBe(false);
    expect(isMeetingValid(m)).toBe(true);
  });
});

describe("AC3 planned vs actual and the overall line", () => {
  it("shows done, now and upcoming with minutes rounded down", () => {
    const s = snap(liveMeeting(), LIVE_TIMES.item2Start + 12 * MINUTE + 59_000);
    expect(s.rows.map((r) => [r.state, r.actualMinutes, r.plannedMinutes])).toEqual([
      ["done", 6, 5],
      ["now", 12, 15],
      ["upcoming", null, 15],
      ["upcoming", null, 10],
      ["upcoming", null, 10],
    ]);
  });

  it("schedule status: ahead, exactly on time and behind", () => {
    const end = T0 + 60 * MINUTE;
    expect(scheduleStatus(end, end - 90_000)).toEqual({ onTrack: true, minutes: 1 });
    expect(scheduleStatus(end, end)).toEqual({ onTrack: true, minutes: 0 });
    expect(scheduleStatus(end, end + 1000)).toEqual({ onTrack: false, minutes: 1 });
    expect(scheduleStatus(end, end + 7 * MINUTE)).toEqual({ onTrack: false, minutes: 7 });
  });

  it("projects now + remaining time + upcoming items against the scheduled end", () => {
    const m = liveMeeting();
    // 10:17:48, 3:12 left; then 15 + 10 + 10 min → 10:56:00, 4 min before 11:00.
    const s = snap(m, LIVE_TIMES.running);
    expect(s.scheduledEnd).toBe(new Date(2026, 9, 30, 11, 0).getTime());
    expect(s.projectedEnd).toBe(new Date(2026, 9, 30, 10, 56).getTime());
    expect(s.schedule).toEqual({ onTrack: true, minutes: 4 });
    // Over time the remaining part counts as 0: 10:30 + 35 min = 11:05.
    const late = snap(m, new Date(2026, 9, 30, 10, 30).getTime());
    expect(late.schedule).toEqual({ onTrack: false, minutes: 5 });
  });
});

describe("AC4 +5 min", () => {
  it("a single press adds 5 min to the current item and takes it from the buffer", () => {
    const m = liveMeeting();
    const before = snap(m, LIVE_TIMES.running);
    const after = snap(extend(m), LIVE_TIMES.running);
    expect(after.current!.budgetMs - before.current!.budgetMs).toBe(5 * MINUTE);
    expect(after.current!.remainingMs - before.current!.remainingMs).toBe(5 * MINUTE);
    expect(after.rows[1]!.plannedMinutes).toBe(20);
    expect(before.bufferMinutes).toBe(5);
    expect(after.bufferMinutes).toBe(0);
    expect(after.projectedEnd - before.projectedEnd).toBe(5 * MINUTE);
  });

  it("repeated presses add up", () => {
    let m = liveMeeting();
    for (let i = 0; i < 3; i++) m = extend(m);
    expect(m.run!.items[1]!.extraMinutes).toBe(15);
    expect(snap(m, LIVE_TIMES.running).rows[1]!.plannedMinutes).toBe(30);
    expect(isMeetingValid(m)).toBe(true);
  });

  it("still works with no buffer left, and the meeting then shows as behind", () => {
    let m = extend(liveMeeting()); // buffer 0
    const zero = snap(m, LIVE_TIMES.item2Start);
    expect(zero.bufferMinutes).toBe(0);
    m = extend(m);
    const s = snap(m, LIVE_TIMES.item2Start);
    expect(s.bufferMinutes).toBe(-5);
    // Started item 02 at 10:06 with 25 min, then 35 min: 11:06.
    expect(s.schedule).toEqual({ onTrack: false, minutes: 6 });
  });

  it("stops at the 240 min limit the core enforces", () => {
    let m = liveMeeting();
    for (let i = 0; i < 48; i++) m = extend(m);
    expect(m.run!.items[1]!.extraMinutes).toBe(240);
    expect(canExtend(m)).toBe(false);
    expect(extend(m)).toBe(m);
  });
});

describe("AC5 nudge threshold", () => {
  it("is due from 80 % of the (extended) budget", () => {
    const m = liveMeeting();
    expect(nudgeDue(snap(m, LIVE_TIMES.running).current!)).toBe(false);
    expect(nudgeDue(snap(m, LIVE_TIMES.nudge).current!)).toBe(true);
    expect(nudgeDue(snap(extend(m), LIVE_TIMES.nudge).current!)).toBe(false);
  });
});

describe("AC6 run state validation in the UI", () => {
  it("rejects what the core rejects", () => {
    const bad = (edit: (m: Meeting) => void) => {
      const m = liveMeeting();
      edit(m);
      return isMeetingValid(m);
    };
    expect(bad(() => {})).toBe(true);
    expect(bad((m) => (m.run!.items[1]!.itemId = "nope"))).toBe(false);
    expect(bad((m) => (m.run!.items[0]!.endedAt = m.run!.items[0]!.startedAt - 1))).toBe(false);
    expect(bad((m) => (m.run!.items[0]!.endedAt = null))).toBe(false);
    expect(bad((m) => (m.run!.items[1]!.extraMinutes = -5))).toBe(false);
    expect(bad((m) => (m.run!.items[1]!.extraMinutes = 245))).toBe(false);
    expect(bad((m) => (m.items = []))).toBe(false);
  });
});
