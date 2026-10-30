import type { Page } from "@playwright/test";

export type Fixture = "empty" | "filled" | "over" | "corrupt" | "locked";

/** Opens the app with a seeded fake store and a chosen language; waits until the view is ready. */
export async function openApp(page: Page, fixture: Fixture, locale: "de" | "en" = "en") {
  await page.addInitScript((l) => {
    if (!localStorage.getItem("meeting-companion.locale"))
      localStorage.setItem("meeting-companion.locale", l);
  }, locale);
  await page.goto(`/?fixture=${fixture}`);
  await page.locator('main[data-view="agenda-setup"][aria-busy="false"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
}
