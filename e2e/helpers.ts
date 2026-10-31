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
  | "live-speakers"
  | "settings"
  | "settings-no-model"
  | "settings-mic-test"
  | "settings-recording"
  | "settings-dark"
  | "settings-missing"
  | "live-mic-missing"
  | "live-switched"
  | "free"
  | "live-free-empty"
  | "live-free"
  | "live-level-speech"
  | "live-level-silence"
  | "live-no-signal"
  | "help"
  | "help-no-org"
  | "help-bad-org"
  | "help-markup";

/** Fixtures whose meeting is running: they open in the live view (the settings ones on top of it). */
const LIVE_UNDER: Fixture[] = ["settings-recording", "settings-dark"];

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
    fixture.startsWith("live") || fixture.startsWith("speakers") || LIVE_UNDER.includes(fixture)
      ? 'main[data-view="live"]'
      : 'main[data-view="agenda-setup"][aria-busy="false"]';
  await page.locator(view).waitFor();
  // The settings fixtures open the settings view from there, as a person would.
  if (fixture.startsWith("settings")) {
    await page.locator("[data-settings-button]").first().click();
    await page.locator('main[data-view="settings"]').waitFor();
    // The device list has arrived from the core.
    await page.locator(".device-select__select option").nth(1).waitFor({ state: "attached" });
  }
  // The help fixtures open "Help & legal" from setup, as a person would.
  if (fixture.startsWith("help")) {
    await page.locator("[data-help-button]").first().click();
    await page.locator('main[data-view="help"]').waitFor();
  }
  if (fixture === "settings-mic-test") {
    await page.locator(".settings button", { hasText: /Test microphone|Mikrofon testen/ }).click();
    await page.locator('[data-testid="mic-test-running"]').waitFor();
  }
  if (fixture === "settings-no-model") {
    await page.getByRole("tab", { name: /On this device|Auf diesem Gerät/ }).click();
    await page.locator('[data-testid="no-model"]').waitFor();
  }
  await page.evaluate(() => document.fonts.ready);
}
