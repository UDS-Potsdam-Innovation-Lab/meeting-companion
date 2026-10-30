// Timekeeping of a running meeting: pure edits of the run state and the values the live view shows.
// Every value is computed from stored timestamps and a `now` the caller reads from its Clock.
import {
  LIMITS,
  parseTime,
  slotMinutes,
  type AgendaItem,
  type Meeting,
  type Run,
  type RunItem,
} from "../agenda/model";

export const MINUTE = 60_000;
/** What "+5 min" adds to the current item. */
export const EXTEND_MINUTES = 5;
/** Share of the budget at which the nudge appears. */
export const NUDGE_AT = 0.8;
/** Share of the budget from which the timer bar turns amber. */
export const WARN_AT = 0.75;

// ---- state -----------------------------------------------------------------------------------

export const isRunning = (m: Meeting) => !!m.run && m.run.endedAt === null;
export const isEnded = (m: Meeting) => !!m.run && m.run.endedAt !== null;

const currentRecord = (run: Run) => run.items.find((r) => r.endedAt === null) ?? null;

/** The first agenda item that has not started yet. */
function nextItem(m: Meeting, run: Run): AgendaItem | null {
  const started = new Set(run.items.map((r) => r.itemId));
  return m.items.find((it) => !started.has(it.id)) ?? null;
}

const startRecord = (itemId: string, now: number): RunItem => ({
  itemId,
  startedAt: now,
  endedAt: null,
  extraMinutes: 0,
  parked: false,
});

// ---- edits (pure; each returns `m` unchanged when it does not apply) --------------------------------

/** Records the start time and starts the first item. */
export function startRun(m: Meeting, now: number): Meeting {
  const first = m.items[0];
  if (m.run || !first) return m;
  return { ...m, run: { startedAt: now, endedAt: null, items: [startRecord(first.id, now)] } };
}

/** Ends the current item ("Next ›", or "Park it" with `parked`) and starts the next one, if any. */
export function advance(m: Meeting, now: number, parked = false): Meeting {
  const run = m.run;
  if (!run || run.endedAt !== null) return m;
  const current = currentRecord(run);
  if (!current) return m;
  const items = run.items.map((r) =>
    r === current ? { ...r, endedAt: Math.max(now, r.startedAt), parked } : r,
  );
  const closed = { ...run, items };
  const next = nextItem(m, closed);
  if (next) items.push(startRecord(next.id, Math.max(now, current.startedAt)));
  return { ...m, run: closed };
}

/** True while "+5 min" can add to the current item without passing the per-item limit. */
export function canExtend(m: Meeting): boolean {
  const current = m.run && m.run.endedAt === null ? currentRecord(m.run) : null;
  return !!current && current.extraMinutes + EXTEND_MINUTES <= LIMITS.extraMinutes;
}

/** "+5 min": adds to the current item's budget, and so takes it from the buffer. */
export function extend(m: Meeting): Meeting {
  const run = m.run;
  if (!run || !canExtend(m)) return m;
  return {
    ...m,
    run: {
      ...run,
      items: run.items.map((r) =>
        r.endedAt === null ? { ...r, extraMinutes: r.extraMinutes + EXTEND_MINUTES } : r,
      ),
    },
  };
}

/** "End meeting": ends the current item, if any, and records the end time. */
export function endRun(m: Meeting, now: number): Meeting {
  const run = m.run;
  if (!run || run.endedAt !== null) return m;
  const items = run.items.map((r) =>
    r.endedAt === null ? { ...r, endedAt: Math.max(now, r.startedAt) } : r,
  );
  const last = Math.max(run.startedAt, ...items.map((r) => r.endedAt ?? 0));
  return { ...m, run: { ...run, items, endedAt: Math.max(now, last) } };
}

// ---- derived values --------------------------------------------------------------------------------

export type RowState = "done" | "parked" | "now" | "upcoming";

export interface LiveRow {
  item: AgendaItem;
  index: number;
  state: RowState;
  /** Planned minutes including "+5 min" extensions. */
  plannedMinutes: number;
  /** Whole minutes spent so far (rounded down); null for upcoming items. */
  actualMinutes: number | null;
  /** Spent more whole minutes than planned. */
  over: boolean;
}

export interface CurrentItem {
  item: AgendaItem;
  index: number;
  extraMinutes: number;
  budgetMs: number;
  elapsedMs: number;
  /** Negative once the budget is used up. */
  remainingMs: number;
  /** elapsed / budget; above 1 when over. */
  fraction: number;
}

export interface LiveSnapshot {
  rows: LiveRow[];
  current: CurrentItem | null;
  parked: LiveRow[];
  /** Every item has ended; only "End meeting" is left. */
  agendaDone: boolean;
  /** Scheduled end of the meeting (ms). */
  scheduledEnd: number;
  /** now + the current item's remaining time (at least 0) + the planned minutes of upcoming items. */
  projectedEnd: number;
  /** "on track (+minutes)" when the projection is not after the scheduled end, else "minutes behind". */
  schedule: { onTrack: boolean; minutes: number };
  /** Slot minus every item's planned minutes including extensions; negative when over. */
  bufferMinutes: number;
  /**
   * While on track: how much of the planned buffer (slot minus the items' original minutes) the
   * projection has used up, through overruns, "+5 min" or a late start. At most 0 when nothing was
   * used. null when behind (the buffer is gone).
   */
  bufferUsedMinutes: number | null;
}

/** The meeting's end time on the day the meeting was started. */
export function scheduledEnd(m: Pick<Meeting, "end">, run: Pick<Run, "startedAt">): number {
  const end = parseTime(m.end) ?? 0;
  const d = new Date(run.startedAt);
  d.setHours(Math.floor(end / 60), end % 60, 0, 0);
  return d.getTime();
}

export function scheduleStatus(scheduled: number, projected: number): LiveSnapshot["schedule"] {
  const diff = scheduled - projected;
  return diff >= 0
    ? { onTrack: true, minutes: Math.floor(diff / MINUTE) }
    : { onTrack: false, minutes: Math.ceil(-diff / MINUTE) };
}

const spent = (from: number, to: number) => Math.max(0, to - from);

export function liveSnapshot(m: Meeting, run: Run, now: number): LiveSnapshot {
  const records = new Map(run.items.map((r) => [r.itemId, r]));
  let current: CurrentItem | null = null;
  let upcomingMinutes = 0;
  let plannedTotal = 0;
  let originalTotal = 0;

  const rows = m.items.map((item, index): LiveRow => {
    const r = records.get(item.id);
    const plannedMinutes = item.minutes + (r?.extraMinutes ?? 0);
    plannedTotal += plannedMinutes;
    originalTotal += item.minutes;
    if (!r) {
      upcomingMinutes += plannedMinutes;
      return { item, index, state: "upcoming", plannedMinutes, actualMinutes: null, over: false };
    }
    const elapsedMs = spent(r.startedAt, r.endedAt ?? now);
    const actualMinutes = Math.floor(elapsedMs / MINUTE);
    if (r.endedAt === null) {
      const budgetMs = plannedMinutes * MINUTE;
      current = {
        item,
        index,
        extraMinutes: r.extraMinutes,
        budgetMs,
        elapsedMs,
        remainingMs: budgetMs - elapsedMs,
        fraction: elapsedMs / budgetMs,
      };
    }
    const state: RowState = r.endedAt === null ? "now" : r.parked ? "parked" : "done";
    return { item, index, state, plannedMinutes, actualMinutes, over: actualMinutes > plannedMinutes };
  });

  const cur = current as CurrentItem | null;
  const scheduled = scheduledEnd(m, run);
  const projectedEnd = now + Math.max(0, cur?.remainingMs ?? 0) + upcomingMinutes * MINUTE;
  const schedule = scheduleStatus(scheduled, projectedEnd);
  return {
    rows,
    current: cur,
    parked: rows.filter((r) => r.state === "parked"),
    agendaDone: !cur && rows.every((r) => r.state !== "upcoming"),
    scheduledEnd: scheduled,
    projectedEnd,
    schedule,
    bufferMinutes: slotMinutes(m) - plannedTotal,
    bufferUsedMinutes: schedule.onTrack ? slotMinutes(m) - originalTotal - schedule.minutes : null,
  };
}

// ---- formatting --------------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `m:ss` for a duration in whole seconds. */
export function formatSeconds(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}

/** The timer text: time left (rounded up to the second) or, once over, time over. */
export function timerText(remainingMs: number): { over: boolean; text: string } {
  return remainingMs >= 0
    ? { over: false, text: formatSeconds(Math.ceil(remainingMs / 1000)) }
    : { over: true, text: formatSeconds(Math.ceil(-remainingMs / 1000)) };
}

/** Identifies one budget of one item; the nudge shows at most once per key. */
export const nudgeKey = (c: CurrentItem) => `${c.item.id}:${c.budgetMs}`;

export const nudgeDue = (c: CurrentItem) => c.fraction >= NUDGE_AT;
