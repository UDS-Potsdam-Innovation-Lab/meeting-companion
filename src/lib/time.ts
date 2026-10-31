/** `HH:MM` of a timestamp in the locale's style (11:00, 11:00 AM in some locales). */
export function formatClock(locale: string, ms: number): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
}
