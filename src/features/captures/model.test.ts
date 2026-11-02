import { describe, expect, it } from "vitest";
import type { Capture } from "../../lib/ipc";
import { LIVE_TIMES, liveFreeMeeting, liveMeeting } from "../agenda/fixtures";
import {
  chipNames,
  countByKind,
  countByTarget,
  currentTarget,
  dueDates,
  groupCaptures,
  readCommand,
} from "./model";

const c = (
  id: string,
  kind: Capture["kind"],
  at: number,
  itemId: string | null,
  topicId: string | null = null,
): Capture => ({
  id,
  kind,
  text: id,
  owner: null,
  due: null,
  itemId,
  topicId,
  source: "typed",
  createdAt: at,
});

describe("composer commands", () => {
  it("/d, /t and /q followed by a space pick the kind and leave the rest", () => {
    expect(readCommand("/d Beta on the 14th")).toEqual({ kind: "decision", text: "Beta on the 14th" });
    expect(readCommand("/t ")).toEqual({ kind: "todo", text: "" });
    expect(readCommand("/Q who decides?")).toEqual({ kind: "question", text: "who decides?" });
    for (const text of ["/d", "/today", "x /t y", "/x z", " /d z"]) expect(readCommand(text)).toBeNull();
  });
});

describe("grouping", () => {
  it("puts the running item first, then by newest capture, no item last; cards newest first", () => {
    const list = [
      c("a", "todo", 1, "i-1"),
      c("b", "todo", 5, "i-1"),
      c("c", "todo", 3, "i-2"),
      c("d", "todo", 9, null),
      c("e", "decision", 10, "i-3"),
      c("f", "todo", 7, "i-3"),
    ];
    const groups = groupCaptures(list, "todo", { itemId: "i-2", topicId: null });
    expect(groups.map((g) => [g.key, g.current, g.captures.map((x) => x.id)])).toEqual([
      ["i:i-2", true, ["c"]],
      ["i:i-3", false, ["f"]],
      ["i:i-1", false, ["b", "a"]],
      ["none", false, ["d"]],
    ]);
    // In free mode the running topic shows even while empty.
    expect(groupCaptures([], "todo", { itemId: null, topicId: "t-4" }, true)).toEqual([
      { key: "t:t-4", target: { itemId: null, topicId: "t-4" }, current: true, captures: [] },
    ]);
  });

  it("counts per kind and per item or topic", () => {
    const list = [c("a", "todo", 1, "i-1"), c("b", "decision", 2, "i-1"), c("c", "todo", 3, null, "t-1")];
    expect(countByKind(list)).toEqual({ decision: 1, todo: 2, question: 0 });
    expect(countByTarget(list).get("i-1")).toEqual({ decision: 1, todo: 1, question: 0 });
    expect(countByTarget(list).get("t-1")).toEqual({ decision: 0, todo: 1, question: 0 });
  });

  it("the target is the running item, the running topic, or none", () => {
    expect(currentTarget(liveMeeting())).toEqual({ itemId: "i-2", topicId: null });
    expect(currentTarget(liveFreeMeeting())).toEqual({ itemId: null, topicId: "t-4" });
    const stopped = liveFreeMeeting();
    stopped.run!.topics![3]!.spans[0]!.endedAt = LIVE_TIMES.running;
    expect(currentTarget(stopped)).toEqual({ itemId: null, topicId: null });
  });
});

describe("owners and dates", () => {
  it("chips show first names, full names where first names repeat", () => {
    const names = chipNames([
      { id: "a", name: "Mara Klein" },
      { id: "b", name: "Jana Roth" },
      { id: "c", name: "Jana Berg" },
    ]);
    expect([...names.values()]).toEqual(["Mara", "Jana Roth", "Jana Berg"]);
  });

  it("today, tomorrow and the coming Friday (next week's from Friday on)", () => {
    const friday = new Date(2026, 9, 30, 10).getTime();
    expect(dueDates(friday)).toEqual({ today: "2026-10-30", tomorrow: "2026-10-31", friday: "2026-11-06" });
    const monday = new Date(2026, 10, 2, 10).getTime();
    expect(dueDates(monday).friday).toBe("2026-11-06");
    const sunday = new Date(2026, 10, 1, 10).getTime();
    expect(dueDates(sunday).friday).toBe("2026-11-06");
    const saturday = new Date(2026, 9, 31, 10).getTime();
    expect(dueDates(saturday).friday).toBe("2026-11-06");
  });
});
