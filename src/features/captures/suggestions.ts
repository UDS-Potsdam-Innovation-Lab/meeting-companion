// Capture suggestions (job 019): pure helpers for the pinned card, the transcript chips and the status
// line. The core makes and keeps the suggestions; these only shape them for display.
import type {
  Capture,
  CaptureSuggestion,
  CaptureType,
  LanguageModelSetting,
  LlmError,
  LlmErrorKind,
} from "../../lib/ipc";

/** How often the live view reads the waiting suggestions from the core (ms). */
export const SUGGESTIONS_EVERY_MS = 1_000;

/**
 * The suggestions of one tab, the pinned one first: the one a person brought forward (a tap on its
 * transcript chip), else the oldest. The others wait behind it.
 */
export function tabSuggestions(
  pending: readonly CaptureSuggestion[],
  kind: CaptureType,
  front: string | null,
): CaptureSuggestion[] {
  const mine = pending.filter((s) => s.kind === kind).sort((a, b) => a.createdAt - b.createdAt);
  const i = mine.findIndex((s) => s.id === front);
  if (i > 0) mine.unshift(...mine.splice(i, 1));
  return mine;
}

/** Waiting suggestions per kind (the dot on a tab). */
export function pendingKinds(pending: readonly CaptureSuggestion[]): Set<CaptureType> {
  return new Set(pending.map((s) => s.kind));
}

/** What a transcript line shows: "✦ Beschluss erkannt" (waiting) or "✓ Beschluss festgehalten". */
export interface LineMark {
  kind: CaptureType;
  state: "pending" | "captured";
  /** The waiting suggestion (pending only). */
  suggestionId?: string;
}

/**
 * One mark per line, on the first source line of each waiting suggestion and of each confirmed one
 * (a capture with `source: "suggested"`, so the mark survives a reload). A waiting one wins.
 */
export function lineMarks(
  pending: readonly CaptureSuggestion[],
  captures: readonly Capture[],
): Map<number, LineMark> {
  const marks = new Map<number, LineMark>();
  for (const c of captures) {
    const seq = c.source === "suggested" ? c.segments?.[0] : undefined;
    if (seq !== undefined && !marks.has(seq)) marks.set(seq, { kind: c.kind, state: "captured" });
  }
  for (const s of [...pending].sort((a, b) => a.createdAt - b.createdAt)) {
    const seq = s.segments[0];
    if (seq === undefined) continue;
    const had = marks.get(seq);
    if (!had || had.state === "captured") {
      marks.set(seq, { kind: s.kind, state: "pending", suggestionId: s.id });
    }
  }
  return marks;
}

/** Where the transcript text goes, from the `languageModel` setting, or the last run's error. */
export type SuggestStatus =
  { kind: "off" } | { kind: "local" } | { kind: "cloud" } | { kind: "error"; error: SuggestErrorLine };

/** The error lines of frame 21s. `KeychainUnavailable` reuses the `NoApiKey` line. */
export type SuggestErrorLine = "offline" | "noApiKey" | "unauthorized" | "rateLimited" | "noModel" | "failed";

const ERROR_LINES: Partial<Record<LlmErrorKind, SuggestErrorLine>> = {
  offline: "offline",
  noApiKey: "noApiKey",
  keychainUnavailable: "noApiKey",
  unauthorized: "unauthorized",
  rateLimited: "rateLimited",
  noModel: "noModel",
  failed: "failed",
};

export function suggestStatus(setting: LanguageModelSetting, error: LlmError | null): SuggestStatus {
  if (setting === "none") return { kind: "off" };
  const line = error ? ERROR_LINES[error.kind] : undefined;
  if (line) return { kind: "error", error: line };
  return setting === "claude" ? { kind: "cloud" } : { kind: "local" };
}
