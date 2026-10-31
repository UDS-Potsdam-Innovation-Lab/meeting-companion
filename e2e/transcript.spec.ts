import { expect, test, type Page } from "@playwright/test";
import { LIVE_TIMES, LIVE_TRANSCRIPT } from "../src/features/agenda/fixtures";
import {
  expectInOrder,
  expectNoAxeViolations,
  expectNoHorizontalScroll,
  expectTargetsAtLeast24px,
  tabOrder,
} from "./a11y";
import { openApp, type Fixture } from "./helpers";

async function openAt(page: Page, fixture: Fixture, locale: "de" | "en" = "en") {
  await page.clock.setFixedTime(LIVE_TIMES.running);
  await openApp(page, fixture, locale);
}

const card = (page: Page) => page.getByRole("region", { name: /^(Transcript|Transkript)$/ });
const chip = (page: Page) => page.getByTestId("rec-chip");
const consentBox = (page: Page) =>
  page.getByRole("checkbox", { name: "Everyone was informed that this meeting is transcribed" });

async function expectAccessibleLayout(page: Page) {
  await expectNoAxeViolations(page);
  await expectNoHorizontalScroll(page);
  await expectTargetsAtLeast24px(page);
}

test.describe("AC7 transcript accessibility at 1280×800", () => {
  test("consent state", async ({ page }) => {
    await openAt(page, "live");
    await expect(consentBox(page)).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expectAccessibleLayout(page);
  });

  test("recording state", async ({ page }) => {
    await openAt(page, "live-transcript");
    await expect(chip(page)).toHaveText("REC00:16:48");
    await expect(page.getByTestId("partial-line")).toBeVisible();
    await expectAccessibleLayout(page);
  });

  test("paused state, in German too", async ({ page }) => {
    await openAt(page, "live-paused");
    await expect(chip(page)).toHaveText("Paused00:16:48");
    await expectAccessibleLayout(page);
    await page.getByRole("button", { name: "Deutsch" }).click();
    await expect(chip(page)).toHaveText("Pausiert00:16:48");
    await expectAccessibleLayout(page);
  });

  test("error state and no speech model", async ({ page }) => {
    await openAt(page, "live-mic-error");
    await expect(card(page).getByRole("alert")).toContainText("No microphone found");
    await expect(chip(page)).toHaveCount(0);
    await expectAccessibleLayout(page);
    await openAt(page, "live-no-model");
    // The model is chosen in the settings now; without one, starting says so.
    await consentBox(page).check();
    await page.getByRole("button", { name: "Start recording" }).click();
    await expect(card(page)).toContainText("No speech model installed");
    await expectAccessibleLayout(page);
  });

  test("the keyboard reaches consent, Start recording and the left column in order", async ({ page }) => {
    await openAt(page, "live");
    const order = await tabOrder(page, (n) => n === "End meeting");
    expectInOrder(order, [
      "Deutsch",
      "English",
      "Settings",
      "+5 min",
      "Park it",
      "Next ›",
      /^Parking lot/,
      "Everyone was informed that this meeting is transcribed",
      "End meeting",
    ]);
    // Start recording is disabled until the box is ticked; then it is next after the box.
    await consentBox(page).focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Start recording" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(chip(page)).toContainText("REC");
    // Focus moves to Pause instead of getting lost with the consent prompt.
    await expect(page.getByRole("button", { name: "Pause" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Resume" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Pause" })).toBeFocused();
    // While recording, from the top: Pause in the top bar, the left column, the transcript, End meeting.
    await openAt(page, "live-transcript");
    await expect(chip(page)).toContainText("REC");
    const recording = await tabOrder(page, (n) => n === "End meeting");
    expectInOrder(recording, [
      "Pause",
      "Deutsch",
      "English",
      "+5 min",
      "Next ›",
      "Transcript",
      "End meeting",
    ]);
  });

  test("Jump to latest is reachable by keyboard after scrolling up", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await openAt(page, "live-transcript");
    const feed = card(page).getByRole("list", { name: "Transcript" });
    await feed.evaluate((el) => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event("scroll"));
    });
    const jump = page.getByRole("button", { name: "Jump to latest" });
    await expect(jump).toBeVisible();
    // Jump to latest comes right before the list (whose lines hold a speaker button each).
    await feed.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(jump).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(jump).toHaveCount(0);
    await expect(feed).toBeFocused();
    const atBottom = await feed.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 2);
    expect(atBottom).toBe(true);
    await expectAccessibleLayout(page);
  });
});

test.describe("AC1–AC5 recording with the mock core", () => {
  test("consent, start, German and English lines, pause, resume and restart", async ({ page }) => {
    await openAt(page, "live");
    await expect(chip(page)).toHaveCount(0);
    await consentBox(page).check();
    await page.getByRole("button", { name: "Start recording" }).click();
    await expect(chip(page)).toContainText("REC");
    await expect(page.getByTestId("partial-line")).toContainText("speaking…");
    await expect(
      card(page).locator('.transcript-line[lang="de"]:not(.transcript-line--partial)').first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      card(page).locator('.transcript-line[lang="en"]:not(.transcript-line--partial)').first(),
    ).toBeVisible();
    await expect(card(page).locator("[data-speakers-button]")).toContainText("Listening");

    await page.getByRole("button", { name: "Pause" }).click();
    await expect(chip(page)).toContainText("Paused");
    const frozen = await chip(page).textContent();
    await page.waitForTimeout(1_000);
    await expect(chip(page)).toHaveText(frozen!);
    await expect(card(page).locator("[data-speakers-button]")).toContainText("Paused");
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(chip(page)).toContainText("REC");
    await page.getByRole("button", { name: "Pause" }).click();
    const lines = await card(page).locator(".transcript-line:not(.transcript-line--partial)").count();
    expect(lines).toBeGreaterThanOrEqual(2);

    // Restart: the transcript comes back in full, recording is off, one tap resumes it without asking again.
    await page.reload();
    await page.locator('main[data-view="live"]').waitFor();
    await expect(card(page).locator(".transcript-line")).toHaveCount(lines);
    await expect(chip(page)).toHaveCount(0);
    await expect(consentBox(page)).toHaveCount(0);
    await card(page).getByRole("button", { name: "Resume recording" }).click();
    await expect(chip(page)).toContainText("REC");
  });

  test("the stored transcript is shown with times; markup stays text", async ({ page }) => {
    await openAt(page, "live-paused");
    const items = card(page).locator(".transcript-line");
    await expect(items).toHaveCount(LIVE_TRANSCRIPT.length);
    await expect(items.first()).toContainText("10:09");
    await expect(card(page).locator("img, script")).toHaveCount(0);
  });

  test("a microphone error shows the reason and Resume recording, without a REC chip", async ({ page }) => {
    await openAt(page, "live-mic-error");
    await expect(card(page).getByRole("button", { name: "Resume recording" })).toBeVisible();
    await card(page).getByRole("button", { name: "Resume recording" }).click();
    await expect(card(page).getByRole("alert")).toContainText("No microphone found");
    await expect(chip(page)).toHaveCount(0);
  });

  test("End meeting stops recording first", async ({ page }) => {
    await openAt(page, "live-transcript");
    await page.getByRole("button", { name: "End meeting" }).click();
    await page.getByRole("button", { name: "Click again to end" }).click();
    await page.locator('main[data-view="agenda-setup"][aria-busy="false"]').waitFor();
    await expect(chip(page)).toHaveCount(0);
  });

  test("recording makes no network request beyond the app's own assets", async ({ page }) => {
    const foreign: string[] = [];
    page.on("request", (r) => {
      if (!r.url().startsWith("http://localhost:4173/")) foreign.push(r.url());
    });
    await openAt(page, "live");
    await consentBox(page).check();
    await page.getByRole("button", { name: "Start recording" }).click();
    await expect(card(page).locator(".transcript-line").first()).toBeVisible();
    expect(foreign).toEqual([]);
  });
});
