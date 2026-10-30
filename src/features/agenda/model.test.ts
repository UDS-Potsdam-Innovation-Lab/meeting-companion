import { describe, expect, it } from "vitest";
import { filledMeeting, overBudgetMeeting } from "./fixtures";
import {
  addParticipant,
  budget,
  createMeeting,
  initials,
  isMeetingValid,
  itemNumber,
  moveItem,
  removeItem,
  removeParticipant,
  upsertItem,
  validateItem,
  validateParticipantName,
  validateTimeSlot,
  validateTitle,
} from "./model";

describe("AC2 meeting validation", () => {
  it("rejects an empty title", () => {
    expect(validateTitle("")).toBe("empty");
    expect(validateTitle("   ")).toBe("empty");
  });

  it("rejects a title longer than 200 characters", () => {
    expect(validateTitle("a".repeat(200))).toBeNull();
    expect(validateTitle("a".repeat(201))).toBe("tooLong");
    expect(validateTitle("ä".repeat(200))).toBeNull();
  });

  it("rejects an end time that is not after the start time", () => {
    expect(validateTimeSlot("10:00", "11:00")).toBeNull();
    expect(validateTimeSlot("10:00", "10:00")).toEqual({ field: "end", code: "notAfterStart" });
    expect(validateTimeSlot("10:00", "09:59")).toEqual({ field: "end", code: "notAfterStart" });
    expect(validateTimeSlot("", "09:59")).toEqual({ field: "start", code: "invalid" });
    expect(validateTimeSlot("10:00", "")).toEqual({ field: "end", code: "invalid" });
  });

  it("rejects an empty or duplicate participant name", () => {
    const others = [{ id: "p1", name: "Mara Klein" }];
    expect(validateParticipantName("", others)).toBe("empty");
    expect(validateParticipantName("  ", others)).toBe("empty");
    expect(validateParticipantName("Mara Klein", others)).toBe("duplicate");
    expect(validateParticipantName(" mara KLEIN ", others)).toBe("duplicate");
    expect(validateParticipantName("Tobias Brandt", others)).toBeNull();
  });

  it("derives initials from the name", () => {
    expect(initials("Mara Klein")).toBe("MK");
    expect(initials("  anna maria von Berg ")).toBe("AB");
    expect(initials("Jana")).toBe("JA");
    expect(initials("Özlem Şahin")).toBe("ÖŞ");
    expect(initials("<img src=x onerror=alert(1)>")).toBe("<O");
  });

  it("never accepts an invalid meeting as a whole", () => {
    expect(isMeetingValid(filledMeeting())).toBe(true);
    expect(isMeetingValid({ ...filledMeeting(), title: "" })).toBe(false);
    expect(isMeetingValid({ ...filledMeeting(), end: "09:00" })).toBe(false);
    const dup = addParticipant(filledMeeting(), "mara klein");
    expect(isMeetingValid(dup)).toBe(false);
  });
});

describe("AC3 agenda items", () => {
  it("accepts minutes 1–240 only, whole numbers", () => {
    const item = filledMeeting().items[0]!;
    expect(validateItem({ ...item, minutes: 1 })).toEqual({});
    expect(validateItem({ ...item, minutes: 240 })).toEqual({});
    expect(validateItem({ ...item, minutes: 0 }).minutes).toBe("outOfRange");
    expect(validateItem({ ...item, minutes: 241 }).minutes).toBe("outOfRange");
    expect(validateItem({ ...item, minutes: 2.5 }).minutes).toBe("outOfRange");
    expect(validateItem({ ...item, minutes: Number.NaN }).minutes).toBe("outOfRange");
  });

  it("needs a title and limits the outcome", () => {
    const item = filledMeeting().items[0]!;
    expect(validateItem({ ...item, title: "" }).title).toBe("empty");
    expect(validateItem({ ...item, outcome: "x".repeat(201) }).outcome).toBe("tooLong");
  });

  it("adds, edits, removes and moves items", () => {
    let m = filledMeeting();
    m = upsertItem(m, { id: "new", title: "Wrap-up", outcome: "", lead: null, goal: "inform", minutes: 3 });
    expect(m.items.map((i) => i.id)).toEqual(["i-1", "i-2", "i-3", "i-4", "i-5", "new"]);
    m = upsertItem(m, { ...m.items[0]!, title: "Hello" });
    expect(m.items[0]!.title).toBe("Hello");
    m = moveItem(m, "new", -1);
    expect(m.items.map((i) => i.id)).toEqual(["i-1", "i-2", "i-3", "i-4", "new", "i-5"]);
    m = moveItem(m, "i-1", 1);
    expect(m.items.map((i) => i.id)).toEqual(["i-2", "i-1", "i-3", "i-4", "new", "i-5"]);
    expect(moveItem(m, "i-2", -1)).toBe(m);
    expect(moveItem(m, "i-5", 1)).toBe(m);
    m = removeItem(m, "i-3");
    expect(m.items.map((i) => i.id)).toEqual(["i-2", "i-1", "i-4", "new", "i-5"]);
  });

  it("removing a participant clears them as lead", () => {
    const m = removeParticipant(filledMeeting(), "p-mk");
    expect(m.participants.map((p) => p.id)).not.toContain("p-mk");
    expect(m.items.filter((i) => i.lead === null).map((i) => i.id)).toEqual(["i-1", "i-5"]);
    expect(isMeetingValid(m)).toBe(true);
  });

  it("a lead must be one of the participants", () => {
    const m = filledMeeting();
    m.items[0]!.lead = "p-unknown";
    expect(isMeetingValid(m)).toBe(false);
  });

  it("numbers items 01, 02, …", () => {
    expect([0, 1, 8, 9, 99].map(itemNumber)).toEqual(["01", "02", "09", "10", "100"]);
  });
});

describe("AC4 planned and buffer", () => {
  it("under the slot: buffer is the rest", () => {
    expect(budget(filledMeeting())).toEqual({ planned: 55, slot: 60, buffer: 5, over: 0 });
  });

  it("exactly the slot: no buffer, not over", () => {
    const m = filledMeeting();
    m.items[0]!.minutes = 10;
    expect(budget(m)).toEqual({ planned: 60, slot: 60, buffer: 0, over: 0 });
  });

  it("over the slot: minutes over", () => {
    expect(budget(overBudgetMeeting())).toEqual({ planned: 70, slot: 60, buffer: 0, over: 10 });
  });

  it("an empty meeting plans 0 of M", () => {
    const m = createMeeting("x", new Date(2026, 9, 30, 9, 15));
    expect(m.start).toBe("10:00");
    expect(m.end).toBe("11:00");
    expect(budget(m)).toEqual({ planned: 0, slot: 60, buffer: 60, over: 0 });
  });

  it("a late new meeting still has a valid slot", () => {
    const m = createMeeting("x", new Date(2026, 9, 30, 22, 30));
    expect(validateTimeSlot(m.start, m.end)).toBeNull();
    expect(isMeetingValid(m)).toBe(true);
  });
});
