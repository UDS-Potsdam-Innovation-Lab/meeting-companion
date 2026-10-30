import type { Page } from "@playwright/test";

export type Fixture =
  | "empty"
  | "filled"
  | "over"
  | "corrupt"
  | "locked"
  | "live"
  | "live-done"
  | "live-transcript"
  | "live-paused"
  | "live-mic-error"
  | "live-no-model"
  | "speakers"
  | "speakers-empty"
  | "speakers-no-model"
  | "live-speakers";

/**
 * Opens the app with a seeded fake store and a chosen language; waits until the view is ready. Live
 * fixtures open in the live view; give them a fixed clock first (`page.clock`), see `LIVE_TIMES`.
 */
export async function openApp(page: Page, fixture: Fixture, locale: "de" | "en" = "en") {
  await page.addInitScript((l) => {
    if (!localStorage.getItem("meeting-companion.locale"))
      localStorage.setItem("meeting-companion.locale", l);
  }, locale);
  await page.goto(`/?fixture=${fixture}`);
  const view =
    fixture.startsWith("live") || fixture.startsWith("speakers")
      ? 'main[data-view="live"]'
      : 'main[data-view="agenda-setup"][aria-busy="false"]';
  await page.locator(view).waitFor();
  await page.evaluate(() => document.fonts.ready);
}
