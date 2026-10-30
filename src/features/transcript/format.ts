import type { Locale } from "../../i18n";

const pad = (n: number) => String(n).padStart(2, "0");

/** Recorded time as `hh:mm:ss`. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/** Wall-clock time of a line, `HH:MM` in the active locale. */
export function formatClock(at: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

/** File size in whole megabytes, in the active locale. */
export function formatMegabytes(bytes: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(bytes / 1_000_000);
}
