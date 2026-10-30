// The meeting as the UI edits it. Mirrors src-tauri/src/model; the Rust side re-checks every save.

export type Goal = "inform" | "discuss" | "decide";
export const GOALS: readonly Goal[] = ["inform", "discuss", "decide"];

export interface Participant {
  id: string;
  name: string;
}

export interface AgendaItem {
  id: string;
  title: string;
  outcome: string;
  /** Id of one of the meeting's participants. */
  lead: string | null;
  goal: Goal;
  minutes: number;
}

export interface Meeting {
  version: 1;
  id: string;
  title: string;
  /** `YYYY-MM-DD` */
  date: string;
  /** `HH:MM` */
  start: string;
  /** `HH:MM`, after `start` on the same day */
  end: string;
  participants: Participant[];
  items: AgendaItem[];
  updatedAt: number;
  /** Timekeeping once the meeting has started; absent before. See `src/features/live/run.ts`. */
  run?: Run | null;
}

/** When the meeting and each agenda item ran. Times are milliseconds since the Unix epoch. */
export interface Run {
  startedAt: number;
  /** Set by "End meeting"; an ended meeting is never resumed. */
  endedAt: number | null;
  /** Started agenda items in the order they started. The one without `endedAt` is the current item. */
  items: RunItem[];
}

export interface RunItem {
  itemId: string;
  startedAt: number;
  endedAt: number | null;
  /** Minutes added with "+5 min". */
  extraMinutes: number;
  /** Ended with "Park it" instead of "Next". */
  parked: boolean;
}

export const LIMITS = {
  title: 200,
  name: 100,
  outcome: 200,
  minutesMin: 1,
  minutesMax: 240,
  participants: 100,
  items: 100,
  extraMinutes: 240,
} as const;

export type ErrorCode =
  "empty" | "tooLong" | "invalid" | "notAfterStart" | "duplicate" | "outOfRange" | "tooMany";

const charLength = (s: string) => Array.from(s).length;

export function newId(): string {
  return crypto.randomUUID();
}

// ---- validation -------------------------------------------------------------------------------

export function validateTitle(title: string, max: number = LIMITS.title): ErrorCode | null {
  if (title.trim() === "") return "empty";
  if (charLength(title) > max) return "tooLong";
  return null;
}

/** Minutes since midnight for `HH:MM`, or null. */
export function parseTime(s: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

export function isValidDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

export interface TimeSlotError {
  field: "start" | "end";
  code: ErrorCode;
}

export function validateTimeSlot(start: string, end: string): TimeSlotError | null {
  const s = parseTime(start);
  const e = parseTime(end);
  if (s === null) return { field: "start", code: "invalid" };
  if (e === null) return { field: "end", code: "invalid" };
  if (e <= s) return { field: "end", code: "notAfterStart" };
  return null;
}

const nameKey = (name: string) => name.trim().toLowerCase();

export function validateParticipantName(name: string, others: readonly Participant[]): ErrorCode | null {
  if (name.trim() === "") return "empty";
  if (charLength(name) > LIMITS.name) return "tooLong";
  if (others.some((p) => nameKey(p.name) === nameKey(name))) return "duplicate";
  if (others.length >= LIMITS.participants) return "tooMany";
  return null;
}

export type ItemErrors = Partial<Record<"title" | "outcome" | "minutes", ErrorCode>>;

export function validateItem(item: AgendaItem): ItemErrors {
  const errors: ItemErrors = {};
  const title = validateTitle(item.title);
  if (title) errors.title = title;
  if (charLength(item.outcome) > LIMITS.outcome) errors.outcome = "tooLong";
  if (
    !Number.isInteger(item.minutes) ||
    item.minutes < LIMITS.minutesMin ||
    item.minutes > LIMITS.minutesMax
  ) {
    errors.minutes = "outOfRange";
  }
  return errors;
}

export const hasErrors = (errors: object) => Object.keys(errors).length > 0;

/** The same rules the store enforces. Only meetings that pass are saved. */
export function isMeetingValid(m: Meeting): boolean {
  if (validateTitle(m.title) || !isValidDate(m.date) || validateTimeSlot(m.start, m.end)) return false;
  if (m.participants.length > LIMITS.participants || m.items.length > LIMITS.items) return false;
  const ok = m.participants.every(
    (p, i) => validateParticipantName(p.name, m.participants.slice(0, i)) === null,
  );
  if (!ok) return false;
  const ids = new Set(m.participants.map((p) => p.id));
  const itemsOk = m.items.every(
    (it) => !hasErrors(validateItem(it)) && (it.lead === null || ids.has(it.lead)),
  );
  return itemsOk && (!m.run || isRunValid(m, m.run));
}

/** The run rules the core enforces (src-tauri/src/model `validate_run`). */
export function isRunValid(m: Pick<Meeting, "items">, run: Run): boolean {
  if (m.items.length === 0) return false;
  if (run.endedAt !== null && run.endedAt < run.startedAt) return false;
  const known = new Set(m.items.map((it) => it.id));
  const seen = new Set<string>();
  let current = 0;
  for (const r of run.items) {
    if (!known.has(r.itemId) || seen.has(r.itemId)) return false;
    seen.add(r.itemId);
    if (r.startedAt < run.startedAt) return false;
    if (r.endedAt === null) {
      current += 1;
      if (r.parked || run.endedAt !== null) return false;
    } else if (r.endedAt < r.startedAt) {
      return false;
    }
    if (!Number.isInteger(r.extraMinutes) || r.extraMinutes < 0 || r.extraMinutes > LIMITS.extraMinutes) {
      return false;
    }
  }
  return current <= 1;
}

// ---- derived values ---------------------------------------------------------------------------

export function slotMinutes(m: Pick<Meeting, "start" | "end">): number {
  const s = parseTime(m.start);
  const e = parseTime(m.end);
  return s === null || e === null ? 0 : Math.max(0, e - s);
}

export interface Budget {
  planned: number;
  slot: number;
  /** Minutes left in the slot; 0 when the plan fills or exceeds it. */
  buffer: number;
  /** Minutes beyond the slot; 0 when the plan fits. */
  over: number;
}

export function budget(m: Pick<Meeting, "start" | "end" | "items">): Budget {
  const planned = m.items.reduce((sum, it) => sum + it.minutes, 0);
  const slot = slotMinutes(m);
  return { planned, slot, buffer: Math.max(0, slot - planned), over: Math.max(0, planned - slot) };
}

/** `01`, `02`, … for the item at this list index. */
export const itemNumber = (index: number) => String(index + 1).padStart(2, "0");

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const first = Array.from(words[0]!);
  if (words.length === 1) return first.slice(0, 2).join("").toLocaleUpperCase();
  const last = Array.from(words[words.length - 1]!);
  return (first[0]! + last[0]!).toLocaleUpperCase();
}

// ---- edits (pure) -----------------------------------------------------------------------------

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** An empty meeting for today, starting at the next full hour and lasting 60 minutes. */
export function createMeeting(title: string, now: Date = new Date(), id: string = newId()): Meeting {
  let hour = now.getHours() + 1;
  if (hour > 22) hour = 9;
  return {
    version: 1,
    id,
    title,
    date: localDate(now),
    start: `${pad2(hour)}:00`,
    end: `${pad2(hour + 1)}:00`,
    participants: [],
    items: [],
    updatedAt: 0,
  };
}

export function addParticipant(m: Meeting, name: string, id: string = newId()): Meeting {
  return { ...m, participants: [...m.participants, { id, name: name.trim() }] };
}

/** Removes the participant and clears them as lead on every item. */
export function removeParticipant(m: Meeting, id: string): Meeting {
  return {
    ...m,
    participants: m.participants.filter((p) => p.id !== id),
    items: m.items.map((it) => (it.lead === id ? { ...it, lead: null } : it)),
  };
}

export function emptyItem(id: string = newId()): AgendaItem {
  return { id, title: "", outcome: "", lead: null, goal: "discuss", minutes: 10 };
}

export function upsertItem(m: Meeting, item: AgendaItem): Meeting {
  const exists = m.items.some((it) => it.id === item.id);
  return {
    ...m,
    items: exists ? m.items.map((it) => (it.id === item.id ? item : it)) : [...m.items, item],
  };
}

export function removeItem(m: Meeting, id: string): Meeting {
  return { ...m, items: m.items.filter((it) => it.id !== id) };
}

/** Moves the item by `delta` places (-1 up, +1 down); a move past either end changes nothing. */
export function moveItem(m: Meeting, id: string, delta: -1 | 1): Meeting {
  const from = m.items.findIndex((it) => it.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= m.items.length) return m;
  const items = [...m.items];
  const [moved] = items.splice(from, 1);
  items.splice(to, 0, moved!);
  return { ...m, items };
}
