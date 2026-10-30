import type { I18n, MessageKey } from "../../i18n";
import { LIMITS, type ErrorCode } from "./model";

export type ErrorScope =
  "title" | "date" | "time" | "end" | "participant" | "itemTitle" | "outcome" | "minutes";

/** The translated message for a validation error, or null for no error. */
export function errorText(
  t: I18n["t"],
  scope: ErrorScope,
  code: ErrorCode | null | undefined,
): string | null {
  if (!code) return null;
  const key = `error.${scope}.${code}` as MessageKey;
  return t(key, {
    max: scope === "participant" ? LIMITS.name : scope === "outcome" ? LIMITS.outcome : LIMITS.title,
    min: LIMITS.minutesMin,
    maxMinutes: LIMITS.minutesMax,
    maxParticipants: LIMITS.participants,
  });
}
