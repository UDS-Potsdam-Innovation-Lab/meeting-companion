// Quick capture (job 018): pure helpers for the captures column. The core stores and checks captures;
// these only shape them for display and read the composer's commands.
import type { Capture, CaptureType } from "../../lib/ipc";
import { itemNumber, localDate, type Meeting, type Participant } from "../agenda/model";
import { currentTopic } from "../live/free";

/** Longest capture text (characters after trimming); the core refuses longer ones. */
export const TEXT_MAX = 500;
/** From this many characters the composer shows a counter. */
export const COUNTER_FROM = 450;
/** How long the Undo notice stays (ms). */
export const UNDO_MS = 8_000;
/** How long a new card says "just saved" (ms). */
export const JUST_SAVED_MS = 2_000;
/** How long the "Restored" notice after an Undo stays (ms). */
export const UNDONE_MS = 3_000;
/** Owner chips shown before "More …". */
export const OWNER_CHIPS = 6;

/** `/d`, `/t`, `/q` at the start of the field, followed by a space. */
const COMMANDS: Record<string, CaptureType> = { d: "decision", t: "todo", q: "question" };

/** A command typed at the start of the field: the kind it picks and the text without it. */
export function readCommand(text: string): { kind: CaptureType; text: string } | null {
  const m = /^\/([dtq])\s/i.exec(text);
  if (!m) return null;
  return { kind: COMMANDS[m[1]!.toLowerCase()]!, text: text.slice(m[0].length) };
}

export const charCount = (s: string) => Array.from(s.trim()).length;

/** What a new capture is attached to: the running item, the running topic, or nothing. */
export interface Target {
  itemId: string | null;
  topicId: string | null;
}

export function currentTarget(m: Meeting): Target {
  const run = m.run;
  if (!run) return { itemId: null, topicId: null };
  if (m.mode === "free") return { itemId: null, topicId: currentTopic(run)?.id ?? null };
  const current = run.items.find((r) => r.endedAt === null);
  return { itemId: current?.itemId ?? null, topicId: null };
}

const targetKey = (t: Target) => (t.itemId ? `i:${t.itemId}` : t.topicId ? `t:${t.topicId}` : "none");

/** A group of cards under one heading: an agenda item, a topic, or "no topic". */
export interface CaptureGroup {
  key: string;
  target: Target;
  /** The running item or topic. */
  current: boolean;
  /** Newest first. */
  captures: Capture[];
}

/**
 * The captures of one kind, grouped by item or topic: the running one first, then the others by their
 * newest capture, "no topic" last. Cards newest first. `withCurrent` keeps an empty running group.
 */
export function groupCaptures(
  captures: readonly Capture[],
  kind: CaptureType,
  current: Target,
  withCurrent = false,
): CaptureGroup[] {
  const currentKey = targetKey(current);
  const groups = new Map<string, CaptureGroup>();
  if (withCurrent && currentKey !== "none") {
    groups.set(currentKey, { key: currentKey, target: current, current: true, captures: [] });
  }
  for (const c of captures) {
    if (c.kind !== kind) continue;
    const target = { itemId: c.itemId, topicId: c.topicId };
    const key = targetKey(target);
    const g = groups.get(key) ?? { key, target, current: key === currentKey && key !== "none", captures: [] };
    g.captures.push(c);
    groups.set(key, g);
  }
  const newest = (g: CaptureGroup) => Math.max(0, ...g.captures.map((c) => c.createdAt));
  const rank = (g: CaptureGroup) => (g.current ? 0 : g.key === "none" ? 2 : 1);
  return [...groups.values()]
    .map((g) => ({ ...g, captures: [...g.captures].sort((a, b) => b.createdAt - a.createdAt) }))
    .sort((a, b) => rank(a) - rank(b) || newest(b) - newest(a));
}

export type KindCounts = Record<CaptureType, number>;
export const NO_COUNTS: KindCounts = { decision: 0, todo: 0, question: 0 };

export function countByKind(captures: readonly Capture[]): KindCounts {
  const out = { ...NO_COUNTS };
  for (const c of captures) out[c.kind] += 1;
  return out;
}

/** Counts per item or topic id (for the left column). */
export function countByTarget(captures: readonly Capture[]): Map<string, KindCounts> {
  const out = new Map<string, KindCounts>();
  for (const c of captures) {
    const id = c.itemId ?? c.topicId;
    if (!id) continue;
    const counts = out.get(id) ?? { ...NO_COUNTS };
    counts[c.kind] += 1;
    out.set(id, counts);
  }
  return out;
}

/** "Item 02" numbering of an agenda item, or null for an unknown id. */
export function itemLabel(m: Meeting, id: string): { number: string; title: string } | null {
  const index = m.items.findIndex((it) => it.id === id);
  return index < 0 ? null : { number: itemNumber(index), title: m.items[index]!.title };
}

export function topicTitle(m: Meeting, id: string): string | null {
  return m.run?.topics?.find((t) => t.id === id)?.title ?? null;
}

// ---- owners and dates -------------------------------------------------------------------------------

/** Short names for the owner chips: the first name, or the full name where first names repeat. */
export function chipNames(people: readonly Participant[]): Map<string, string> {
  const first = (p: Participant) => p.name.trim().split(/\s+/)[0] ?? p.name;
  const seen = new Map<string, number>();
  for (const p of people)
    seen.set(first(p).toLocaleLowerCase(), (seen.get(first(p).toLocaleLowerCase()) ?? 0) + 1);
  return new Map(
    people.map((p) => [p.id, (seen.get(first(p).toLocaleLowerCase()) ?? 0) > 1 ? p.name.trim() : first(p)]),
  );
}

export type DueChoice = "today" | "tomorrow" | "friday";

/** The date chips: today, tomorrow and the coming Friday (next week's when today is Friday or later). */
export function dueDates(now: number): Record<DueChoice, string> {
  const day = (offset: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    return localDate(d);
  };
  const weekday = new Date(now).getDay(); // 0 = Sunday … 5 = Friday
  const toFriday = weekday < 5 ? 5 - weekday : 12 - weekday;
  return { today: day(0), tomorrow: day(1), friday: day(toFriday) };
}

/** `YYYY-MM-DD` as a local date at noon (no time-zone edge). */
export function dateOf(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 12);
}
