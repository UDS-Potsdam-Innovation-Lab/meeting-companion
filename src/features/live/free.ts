// Agenda-free mode: the whole-meeting timer, the half-time nudge and the topics added by hand. Pure
// edits of the run state and the values the free live view shows; every value is computed from stored
// timestamps and a `now` the caller reads from its Clock, never by counting ticks.
import { LIMITS, newId, slotMinutes, type Meeting, type Run, type Span, type Topic } from "../agenda/model";
import { MINUTE, scheduledEnd } from "./run";

/** Share of the time available at which the half-time nudge appears. */
export const HALF_AT = 0.5;

// ---- topics (pure edits; each returns `m` unchanged when it does not apply) -------------------------

const topicsOf = (run: Run) => run.topics ?? [];
const isOpen = (s: Span) => s.endedAt === null;
const closeAt = (s: Span, now: number): Span =>
  isOpen(s) ? { ...s, endedAt: Math.max(now, s.startedAt) } : s;

/** The topic "talking now", if any. */
export const currentTopic = (run: Run): Topic | null =>
  topicsOf(run).find((topic) => topic.spans.some(isOpen)) ?? null;

const runningFree = (m: Meeting): Run | null => (m.run && m.run.endedAt === null ? m.run : null);

/** True while another topic can be added (at most `LIMITS.topics`). */
export const canAddTopic = (m: Meeting) => {
  const run = runningFree(m);
  return !!run && topicsOf(run).length < LIMITS.topics;
};

/** Closes the open span, if any, and opens one for `id` (none for `id` null). */
function talkAbout(run: Run, id: string | null, now: number): Topic[] {
  return topicsOf(run).map((topic) => {
    const spans = topic.spans.map((s) => closeAt(s, now));
    if (topic.id !== id) return spans.some((s, i) => s !== topic.spans[i]) ? { ...topic, spans } : topic;
    if (spans.length >= LIMITS.spans) return { ...topic, spans };
    return { ...topic, spans: [...spans, { startedAt: Math.max(now, run.startedAt), endedAt: null }] };
  });
}

/** "Add topic": appends a topic with the trimmed title, and it becomes "talking now". */
export function addTopic(m: Meeting, title: string, now: number, id: string = newId()): Meeting {
  const run = runningFree(m);
  if (!run || !canAddTopic(m)) return m;
  const topic: Topic = { id, title: title.trim(), source: "manual", spans: [] };
  const withTopic: Run = { ...run, topics: [...topicsOf(run), topic] };
  return { ...m, run: { ...withTopic, topics: talkAbout(withTopic, id, now) } };
}

/**
 * A tap on a topic row: makes it "talking now" (closing the span of the previous one), or, when it
 * already is, stops it so that no topic is current.
 */
export function tapTopic(m: Meeting, id: string, now: number): Meeting {
  const run = runningFree(m);
  const topic = run ? topicsOf(run).find((x) => x.id === id) : undefined;
  if (!run || !topic) return m;
  const stop = topic.spans.some(isOpen);
  return { ...m, run: { ...run, topics: talkAbout(run, stop ? null : id, now) } };
}

// ---- derived values ---------------------------------------------------------------------------------

export interface TopicRow {
  topic: Topic;
  /** Whole minutes over all spans, rounded down. */
  minutes: number;
  current: boolean;
}

export interface FreeSnapshot {
  /** The scheduled length of the meeting (end − start of the meeting card), in minutes. */
  slotMinutes: number;
  /** Scheduled end on the day the meeting started (ms). */
  scheduledEnd: number;
  /** scheduledEnd − run.startedAt; a late start shortens it. Zero or less when started at or after the end. */
  availableMs: number;
  elapsedMs: number;
  /** Negative once the scheduled end has passed. */
  remainingMs: number;
  /** The scheduled end has passed (from the first second when the meeting started at or after it). */
  over: boolean;
  /** Whole minutes left (rounded down) while not over. */
  minutesLeft: number;
  /** Whole minutes past the scheduled end (rounded down) once over. */
  minutesOver: number;
  /** elapsed / available, 0…1; 1 when nothing was available. */
  fraction: number;
  /**
   * Half the time available is gone, there was time available, and the scheduled end has not passed
   * (after it, the timer card says how far over the meeting is).
   */
  halfTimeDue: boolean;
  topics: TopicRow[];
  current: Topic | null;
}

const spentMs = (spans: Span[], now: number) =>
  spans.reduce((sum, s) => sum + Math.max(0, (s.endedAt ?? now) - s.startedAt), 0);

export function freeSnapshot(m: Meeting, run: Run, now: number): FreeSnapshot {
  const end = scheduledEnd(m, run);
  const availableMs = end - run.startedAt;
  const elapsedMs = Math.max(0, now - run.startedAt);
  const remainingMs = end - now;
  const over = now >= end;
  const fraction = availableMs <= 0 ? 1 : Math.min(1, elapsedMs / availableMs);
  const current = currentTopic(run);
  return {
    slotMinutes: slotMinutes(m),
    scheduledEnd: end,
    availableMs,
    elapsedMs,
    remainingMs,
    over,
    minutesLeft: over ? 0 : Math.floor(remainingMs / MINUTE),
    minutesOver: over ? Math.floor((now - end) / MINUTE) : 0,
    fraction,
    halfTimeDue: availableMs > 0 && !over && elapsedMs >= availableMs * HALF_AT,
    topics: topicsOf(run).map((topic) => ({
      topic,
      minutes: Math.floor(spentMs(topic.spans, now) / MINUTE),
      current: topic === current,
    })),
    current,
  };
}

/** Identifies the half-time nudge of one run; it shows at most once per key while the view is open. */
export const halfTimeKey = (run: Pick<Run, "startedAt">) => `half:${run.startedAt}`;
