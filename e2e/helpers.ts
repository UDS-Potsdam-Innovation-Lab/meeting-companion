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
  | "settings-llm-off"
  | "settings-llm-local"
  | "settings-llm-none-found"
  | "settings-llm-claude"
  | "settings-llm-claude-nokey"
  | "settings-llm-error"
  | "settings-llm-local-failed"
  | "live-mic-missing"
  | "live-switched"
  | "free"
  | "live-free-empty"
  | "live-free"
  | "live-level-speech"
  | "live-level-silence"
  | "live-no-signal"
  | "live-captures"
  | "live-captures-empty"
  | "live-captures-edit"
  | "live-captures-error"
  | "live-free-captures"
  | "live-suggest"
  | "live-suggest-edit"
  | "live-suggest-many"
  | "live-suggest-off"
  | "live-suggest-local"
  | "live-suggest-cloud"
  | "live-suggest-error";

/** Fixtures whose meeting is running: they open in the live view (the settings ones on top of it). */
const LIVE_UNDER: Fixture[] = ["settings-recording", "settings-dark"];

/**
 * Opens the app with a seeded fake store and a chosen language; waits until the view is ready. Live
 * fixtures open in the live view; give them a fixed clock first (`page.clock`), see `LIVE_TIMES`.
 */
export async function openApp(
  page: Page,
  fixture: Fixture,
  locale: "de" | "en" = "en",
  theme: "light" | "dark" = "light",
) {
  await page.addInitScript((l) => {
    if (!localStorage.getItem("meeting-companion.locale"))
      localStorage.setItem("meeting-companion.locale", l);
  }, locale);
  await page.goto(`/?fixture=${fixture}${theme === "dark" ? "&theme=dark" : ""}`);
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
  if (fixture === "settings-mic-test") {
    await page.locator(".settings button", { hasText: /Test microphone|Mikrofon testen/ }).click();
    await page.locator('[data-testid="mic-test-running"]').waitFor();
  }
  if (fixture.startsWith("settings-llm")) {
    await page.getByRole("tab", { name: /Language model|Sprachmodell/ }).click();
    await page.locator(".llm-sample").waitFor();
  }
  if (fixture === "settings-llm-none-found") {
    await page.getByRole("radio", { name: /^(On this device|Auf diesem Gerät)/ }).click();
    await page.getByTestId("no-llm-model").waitFor();
  }
  if (fixture === "settings-llm-claude-nokey") await page.getByTestId("llm-key").waitFor();
  if (
    fixture === "settings-llm-claude" ||
    fixture === "settings-llm-error" ||
    fixture === "settings-llm-local" ||
    fixture === "settings-llm-local-failed"
  ) {
    await page
      .getByTestId("llm-key")
      .or(page.getByRole("region", { name: /Model on this device|Modell auf diesem Gerät/ }))
      .first()
      .waitFor();
    await page.getByRole("button", { name: /^(Test|Testen)$/ }).click();
    await page
      .getByTestId(
        fixture === "settings-llm-claude"
          ? "llm-reply"
          : fixture === "settings-llm-error" || fixture === "settings-llm-local-failed"
            ? "llm-error"
            : "llm-waiting",
      )
      .waitFor();
  }
  if (fixture === "settings-no-model") {
    await page.getByRole("tab", { name: /On this device|Auf diesem Gerät/ }).click();
    await page.locator('[data-testid="no-model"]').waitFor();
  }
  await page.evaluate(() => document.fonts.ready);
}

// ---- the phone page (job 012) ---------------------------------------------------------------------

export type PhoneFixture = "phone-open" | "phone-closed";

/** The token in the fixtures' phone URL (the mock core's `phone_view_open` returns the same one). */
export const PHONE_TOKEN = "FAKE-TOKEN-for-tests-only";

/**
 * Opens the phone page as a phone that scanned the QR code. The session check is answered here, as the
 * core would: `phone-open` 204 (Connected), `phone-closed` 403 (This page is closed). The language
 * follows the browser context's locale (`test.use({ locale })`).
 */
export async function openPhone(page: Page, fixture: PhoneFixture) {
  await page.route("**/api/session", (route) =>
    route.fulfill({ status: fixture === "phone-open" ? 204 : 403 }),
  );
  await page.goto(`/phone/phone.html#t=${PHONE_TOKEN}`);
  await page.locator(`.phone[data-state="${fixture === "phone-open" ? "open" : "closed"}"]`).waitFor();
  await page.evaluate(() => document.fonts.ready);
}
