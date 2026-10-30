import { expect, test, type Page } from "@playwright/test";
import { LIVE_TIMES } from "../src/features/agenda/fixtures";
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

async function openSpeakers(page: Page) {
  await page.locator("[data-speakers-button]").click();
  await page.locator('main[data-view="speakers"]').waitFor();
}

async function expectAccessibleLayout(page: Page) {
  await expectNoAxeViolations(page);
  await expectNoHorizontalScroll(page);
  await expectTargetsAtLeast24px(page);
}

const heading = (page: Page) => page.getByRole("heading", { level: 1 });
/** The name of a line's speaker button: "Mara Klein, speaker of the line at 10:11" (Chromium puts a
 * space before the comma of the visually hidden part). */
const line = (who: string, time = "") => new RegExp(`^${who} ?, speaker of the line at ${time}`);

test.describe("AC7 speakers accessibility at 1280×800", () => {
  test("speakers: 5 voices (2 confirmed, 1 suggested, 1 unsure, 1 unassigned)", async ({ page }) => {
    await openAt(page, "speakers");
    await expect(page.getByRole("button", { name: "Listening · 5 speakers" })).toBeVisible();
    await openSpeakers(page);
    await expect(heading(page)).toHaveText("5 voices detected · 2 matched");
    await expect(page.getByTestId("rec-chip")).toHaveText("REC00:16:48");
    await expect(page.getByRole("combobox", { name: /^Person for Voice [A-E]$/ })).toHaveCount(5);
    await expect(page.locator(".voice-row--unsure")).toContainText("Unsure: Yusuf or Jana?");
    await expectAccessibleLayout(page);
    // The guest input is part of the checked layout too.
    await page.getByRole("combobox", { name: "Person for Voice E" }).selectOption({ label: "Add guest…" });
    await expect(page.getByRole("textbox", { name: "Name of the guest" })).toBeFocused();
    await expectAccessibleLayout(page);
  });

  test("speakers in German", async ({ page }) => {
    await openAt(page, "speakers", "de");
    await openSpeakers(page);
    await expect(heading(page)).toHaveText("5 Stimmen erkannt · 2 zugeordnet");
    await expectAccessibleLayout(page);
  });

  test("speakers-empty", async ({ page }) => {
    await openAt(page, "speakers-empty");
    await openSpeakers(page);
    await expect(heading(page)).toHaveText("No voices detected yet");
    await expectAccessibleLayout(page);
  });

  test("speakers-no-model", async ({ page }) => {
    await openAt(page, "speakers-no-model");
    await openSpeakers(page);
    await expect(page.getByText("No speaker model found on this device")).toBeVisible();
    await expect(page.getByText("/home/user/.cache/huggingface/hub")).toBeVisible();
    await expectAccessibleLayout(page);
  });

  test("live-speakers: names, a line override and the Who said this? picker", async ({ page }) => {
    await openAt(page, "live-speakers");
    await expect(page.getByRole("button", { name: line("Mara Klein") })).toHaveCount(3);
    await expect(page.getByRole("button", { name: line("Jana Roth", "10:12$") })).toBeVisible();
    await expect(page.getByRole("button", { name: line("Voice D") })).toHaveCount(2);
    await expectAccessibleLayout(page);
    await page.getByRole("button", { name: line("Voice D", "10:11$") }).click();
    await expect(page.getByRole("dialog", { name: "Speaker of the line at 10:11" })).toBeVisible();
    await expectAccessibleLayout(page);
  });

  test("the keyboard reaches Back, every picker, the guest input and Apply in order", async ({ page }) => {
    await openAt(page, "speakers");
    await openSpeakers(page);
    // Opening the view puts focus on its heading; "Back to meeting" comes before it, in the top bar.
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "Back to meeting" })).toBeFocused();
    const order = await tabOrder(page, (n) => n === "Apply names to transcript");
    expectInOrder(order, [
      "Deutsch",
      "English",
      "Person for Voice A",
      "Person for Voice B",
      "Person for Voice C",
      "Person for Voice D",
      "Person for Voice E",
      "Apply names to transcript",
    ]);
    // Choosing "Add guest…" by keyboard opens the input next.
    await page.getByRole("combobox", { name: "Person for Voice E" }).selectOption({ label: "Add guest…" });
    await expect(page.getByRole("textbox", { name: "Name of the guest" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("combobox", { name: "Person for Voice E" })).toBeFocused();
  });

  test("the keyboard reaches each line's speaker picker; Escape returns focus", async ({ page }) => {
    await openAt(page, "live-speakers");
    const order = await tabOrder(page, (n) => n === "MKMara Klein, speaker of the line at 10:12", 80);
    expectInOrder(order, [
      // Focus order names are the buttons' text: initials, name and the visually hidden part.
      "MKMara Klein, speaker of the line at 10:01",
      "TBTobias Brandt, speaker of the line at 10:01",
      "DVoice D, speaker of the line at 10:11",
      "JRJana Roth, speaker of the line at 10:12",
    ]);
    await page.keyboard.press("Enter");
    const picker = page.getByRole("dialog", { name: "Speaker of the line at 10:12" });
    await expect(picker).toBeVisible();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(page.getByRole("button", { name: line("Mara Klein", "10:12$") })).toBeFocused();
  });
});

test.describe("AC5 choices survive a reload", () => {
  test("voice and line choices, and a guest, are stored in the meeting", async ({ page }) => {
    await openAt(page, "speakers");
    await openSpeakers(page);
    await page.getByRole("combobox", { name: "Person for Voice C" }).selectOption({ label: "Lena Sommer" });
    await expect(heading(page)).toHaveText("5 voices detected · 3 matched");
    await page.getByRole("combobox", { name: "Person for Voice E" }).selectOption({ label: "Add guest…" });
    await page.getByRole("textbox", { name: "Name of the guest" }).fill("  Petra Sand ");
    await page.keyboard.press("Enter");
    await expect(heading(page)).toHaveText("5 voices detected · 4 matched");
    await page.getByRole("button", { name: "Back to meeting" }).click();
    await page.getByRole("button", { name: line("Voice D", "10:11$") }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Yusuf Aydin" }).click();
    await expect(page.getByRole("button", { name: line("Yusuf Aydin", "10:11$") })).toBeVisible();

    await page.reload();
    await page.locator('main[data-view="live"]').waitFor();
    await expect(page.getByRole("button", { name: line("Yusuf Aydin", "10:11$") })).toBeVisible();
    await expect(page.getByRole("button", { name: line("Lena Sommer") })).toHaveCount(2);
    await expect(page.getByRole("button", { name: line("Petra Sand") })).toHaveCount(1);
    // The other line of voice D still follows its voice.
    await expect(page.getByRole("button", { name: line("Voice D", "10:01$") })).toBeVisible();
  });
});
