import { describe, expect, it } from "vitest";
import { FREE_TIMES, freeSetupMeeting, liveFreeEmptyMeeting, liveFreeMeeting } from "../agenda/fixtures";
import { isMeetingValid, LIMITS, setMode, type Meeting } from "../agenda/model";
import { addTopic, canAddTopic, currentTopic, freeSnapshot, tapTopic } from "./free";
import { endRun, MINUTE, startRun } from "./run";

const at = (h: number, m: number, s = 0) => new Date(2026, 9, 30, h, m, s).getTime();
const snap = (m: Meeting, now: number) => freeSnapshot(m, m.run!, now);
const minutes = (m: Meeting, now: number) =>
  Object.fromEntries(snap(m, now).topics.map((r) => [r.topic.title, r.minutes]));

/** A free meeting 10:00–11:00 started at `start` with no topics. */
function started(start: number): Meeting {
  return startRun(freeSetupMeeting(), start);
}

describe("AC1 mode and start without agenda items", () => {
  it("a free meeting starts with no run items and no topics, whatever was typed", () => {
    const m = started(FREE_TIMES.start);
    expect(m.items).toHaveLength(5);
    expect(m.run).toEqual({ startedAt: FREE_TIMES.start, endedAt: null, items: [], topics: [] });
    expect(isMeetingValid(m)).toBe(true);
    const empty = startRun({ ...freeSetupMeeting(), items: [] }, FREE_TIMES.start);
    expect(empty.run).not.toBeUndefined();
    expect(isMeetingValid(empty)).toBe(true);
  });

  it("an agenda meeting without items still does not start; a missing mode is agenda", () => {
    const m: Meeting = { ...freeSetupMeeting(), items: [], mode: undefined };
    expect(startRun(m, 1)).toBe(m);
    expect(isMeetingValid({ ...m, run: { startedAt: 1, endedAt: null, items: [] } })).toBe(false);
  });

  it("switching the mode keeps the typed items and does nothing once the meeting runs", () => {
    const m = freeSetupMeeting();
    const agenda = setMode(m, "agenda");
    expect(agenda.mode).toBe("agenda");
    expect(agenda.items).toBe(m.items);
    expect(setMode(agenda, "free").items).toEqual(freeSetupMeeting().items);
    expect(setMode(m, "free")).toBe(m);
    const running = started(FREE_TIMES.start);
    expect(setMode(running, "agenda")).toBe(running);
  });
});

describe("AC2 whole-meeting timer from stored timestamps", () => {
  const m = started(FREE_TIMES.start);

  it("0 %: 60 min left, ends 11:00, bar empty", () => {
    const s = snap(m, FREE_TIMES.start);
    expect(s).toMatchObject({ slotMinutes: 60, availableMs: 60 * MINUTE, elapsedMs: 0, fraction: 0 });
    expect(s.minutesLeft).toBe(60);
    expect(s.over).toBe(false);
    expect(s.scheduledEnd).toBe(at(11, 0));
  });

  it("49 %, 50 % and 100 %", () => {
    const s49 = snap(m, at(10, 29, 24));
    expect(Math.round(s49.fraction * 100)).toBe(49);
    expect(s49.minutesLeft).toBe(30);
    expect(s49.halfTimeDue).toBe(false);
    const s50 = snap(m, at(10, 30));
    expect(s50.fraction).toBe(0.5);
    expect(s50.minutesLeft).toBe(30);
    expect(s50.halfTimeDue).toBe(true);
    const s100 = snap(m, at(11, 0));
    expect(s100.fraction).toBe(1);
    expect(s100.over).toBe(true);
    expect(s100.minutesOver).toBe(0);
  });

  it("overrun: whole minutes over, the bar stays full", () => {
    const s = snap(m, at(11, 6, 40));
    expect(s.over).toBe(true);
    expect(s.minutesOver).toBe(6);
    expect(s.fraction).toBe(1);
    expect(s.halfTimeDue).toBe(false);
  });

  it("a late start shortens the time available, so half time comes earlier", () => {
    const late = started(at(10, 15));
    const s = snap(late, at(10, 15));
    expect(s.availableMs).toBe(45 * MINUTE);
    expect(s.minutesLeft).toBe(45);
    expect(s.slotMinutes).toBe(60);
    expect(snap(late, at(10, 37, 29)).halfTimeDue).toBe(false);
    expect(snap(late, at(10, 37, 30)).halfTimeDue).toBe(true);
  });

  it("a meeting started at or after its end is over from the first second, with no nudge", () => {
    for (const start of [at(11, 0), at(11, 3)]) {
      const after = started(start);
      const s = snap(after, start);
      expect(s.availableMs).toBeLessThanOrEqual(0);
      expect(s.over).toBe(true);
      expect(s.fraction).toBe(1);
      expect(s.halfTimeDue).toBe(false);
    }
    expect(snap(started(at(11, 3)), at(11, 3)).minutesOver).toBe(3);
  });

  it("recomputes after a restart: the values depend only on the stored run and now", () => {
    const stored = JSON.parse(JSON.stringify(liveFreeMeeting())) as Meeting;
    expect(snap(stored, FREE_TIMES.half)).toEqual(snap(liveFreeMeeting(), FREE_TIMES.half));
    expect(snap(stored, FREE_TIMES.half).minutesLeft).toBe(29);
  });
});

describe("AC4 topics added by hand", () => {
  it("adding: trimmed, appended, and it becomes talking now", () => {
    let m = liveFreeEmptyMeeting();
    m = addTopic(m, "  Offline mode  ", at(10, 2), "t-a");
    expect(m.run!.topics).toEqual([
      {
        id: "t-a",
        title: "Offline mode",
        source: "manual",
        spans: [{ startedAt: at(10, 2), endedAt: null }],
      },
    ]);
    m = addTopic(m, "Onboarding", at(10, 9), "t-b");
    expect(m.run!.topics!.map((t) => t.title)).toEqual(["Offline mode", "Onboarding"]);
    expect(currentTopic(m.run!)?.id).toBe("t-b");
    expect(m.run!.topics![0]!.spans).toEqual([{ startedAt: at(10, 2), endedAt: at(10, 9) }]);
    expect(isMeetingValid(m)).toBe(true);
  });

  it("switching, returning to an earlier topic (minutes add up) and stopping", () => {
    let m = liveFreeEmptyMeeting();
    m = addTopic(m, "A", at(10, 0), "t-a");
    m = addTopic(m, "B", at(10, 5), "t-b");
    m = tapTopic(m, "t-a", at(10, 12));
    expect(currentTopic(m.run!)?.id).toBe("t-a");
    expect(minutes(m, at(10, 15, 30))).toEqual({ A: 8, B: 7 });
    // Tapping the current topic stops it: no topic is current, and nothing counts on.
    m = tapTopic(m, "t-a", at(10, 16));
    expect(currentTopic(m.run!)).toBeNull();
    expect(minutes(m, at(10, 40))).toEqual({ A: 9, B: 7 });
    expect(m.run!.topics![0]!.spans).toHaveLength(2);
    m = tapTopic(m, "t-b", at(10, 20));
    expect(minutes(m, at(10, 22, 59))).toEqual({ A: 9, B: 9 });
    expect(isMeetingValid(m)).toBe(true);
    expect(tapTopic(m, "t-unknown", at(10, 30))).toBe(m);
  });

  it("whole minutes are summed over the spans and rounded down", () => {
    let m = liveFreeEmptyMeeting();
    m = addTopic(m, "A", at(10, 0, 0), "t-a");
    m = tapTopic(m, "t-a", at(10, 0, 50));
    m = tapTopic(m, "t-a", at(10, 1, 0));
    expect(minutes(m, at(10, 1, 9))).toEqual({ A: 0 });
    expect(minutes(m, at(10, 1, 10))).toEqual({ A: 1 });
  });

  it("allows at most 100 topics", () => {
    let m = liveFreeEmptyMeeting();
    for (let i = 0; i < LIMITS.topics; i++) m = addTopic(m, `Topic ${i}`, at(10, 1), `t-${i}`);
    expect(m.run!.topics).toHaveLength(100);
    expect(canAddTopic(m)).toBe(false);
    expect(addTopic(m, "One more", at(10, 2), "t-x")).toBe(m);
    expect(isMeetingValid(m)).toBe(true);
  });

  it("End meeting closes the open span", () => {
    const m = endRun(liveFreeMeeting(), FREE_TIMES.half);
    expect(m.run!.endedAt).toBe(FREE_TIMES.half);
    expect(currentTopic(m.run!)).toBeNull();
    expect(m.run!.topics![3]!.spans[0]!.endedAt).toBe(FREE_TIMES.half);
    expect(isMeetingValid(m)).toBe(true);
    // Nothing changes after the end.
    expect(addTopic(m, "Late", FREE_TIMES.over)).toBe(m);
    expect(tapTopic(m, "t-1", FREE_TIMES.over)).toBe(m);
  });
});

describe("AC5 the run rules the core enforces, mirrored in the UI", () => {
  const base = liveFreeMeeting();
  const withRun = (edit: (m: Meeting) => void) => {
    const m = structuredClone(base);
    edit(m);
    return isMeetingValid(m);
  };

  it("accepts the fixture and rejects each broken rule", () => {
    expect(isMeetingValid(base)).toBe(true);
    expect(withRun((m) => (m.mode = "auto" as never))).toBe(false);
    expect(
      withRun((m) =>
        m.run!.items.push({
          itemId: "i-1",
          startedAt: m.run!.startedAt,
          endedAt: null,
          extraMinutes: 0,
          parked: false,
        }),
      ),
    ).toBe(false);
    expect(withRun((m) => (m.mode = "agenda"))).toBe(false);
    expect(withRun((m) => (m.run!.topics![0]!.title = " "))).toBe(false);
    expect(withRun((m) => (m.run!.topics![0]!.title = "x".repeat(201)))).toBe(false);
    expect(withRun((m) => (m.run!.topics![1]!.id = "t-1"))).toBe(false);
    expect(withRun((m) => (m.run!.topics![0]!.source = "detected" as never))).toBe(false);
    expect(withRun((m) => (m.run!.topics![0]!.spans[0]!.startedAt = m.run!.startedAt - 1))).toBe(false);
    expect(withRun((m) => (m.run!.topics![0]!.spans[0]!.endedAt = m.run!.startedAt - 1))).toBe(false);
    expect(withRun((m) => (m.run!.topics![0]!.spans[0]!.endedAt = null))).toBe(false);
    expect(withRun((m) => (m.run!.endedAt = FREE_TIMES.over))).toBe(false);
  });
});
