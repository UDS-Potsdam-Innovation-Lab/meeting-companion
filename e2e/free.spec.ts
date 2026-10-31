import { expect, test, type Page } from "@playwright/test";
import { FREE_TIMES } from "../src/features/agenda/fixtures";
import {
  expectInOrder,
  expectNoAxeViolations,
  expectNoHorizontalScroll,
  expectTargetsAtLeast24px,
  tabOrder,
} from "./a11y";
import { openApp, type Fixture } from "./helpers";

// Job 009: agenda-free mode (frame 16) against the browser build with the mock core.

async function openAt(page: Page, time: number, fixture: Fixture = "live-free", locale: "de" | "en" = "en") {
  await page.clock.setFixedTime(time);
  await openApp(page, fixture, locale);
}

const timer = (page: Page) => page.getByRole("region", { name: /^(Whole meeting|Ganzes Meeting)$/ });
const topics = (page: Page) => page.getByRole("region", { name: /^(Topics so far|Bisherige Themen)$/ });
const nudge = (page: Page) => page.locator(".nudge");
const card = (page: Page) => page.getByRole("region", { name: /^(Transcript|Transkript)$/ });
const chip = (page: Page) => page.getByTestId("rec-chip");

async function expectAccessibleLayout(page: Page) {
  await expectNoAxeViolations(page);
  await expectNoHorizontalScroll(page);
  await expectTargetsAtLeast24px(page);
}

test.describe("AC1 + AC7 frame 01 in agenda-free mode at 1280×800", () => {
  test("no axe violations, no horizontal scroll, targets ≥ 24 px, in English and German", async ({
    page,
  }) => {
    await openApp(page, "free");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("A meeting without an agenda");
    await expect(page.getByRole("button", { name: "Agenda-free" })).toHaveAttribute("aria-pressed", "true");
    await expectAccessibleLayout(page);
    await page.getByRole("button", { name: "Deutsch" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ein Meeting ohne Agenda");
    await expectAccessibleLayout(page);
  });

  test("the keyboard reaches the mode switch, then Start meeting, with a visible focus ring", async ({
    page,
  }) => {
    await openApp(page, "free");
    const order = await tabOrder(page, (n) => n.includes("Start meeting"));
    expectInOrder(order, ["With agenda", "Agenda-free", "Title", /Start meeting/]);
  });

  test("switching back and forth keeps the typed items; free starts the free live view", async ({ page }) => {
    await page.clock.setFixedTime(FREE_TIMES.start);
    await openApp(page, "filled");
    await page.getByRole("button", { name: "Agenda-free" }).click();
    await expect(page.locator(".agenda-list")).toHaveCount(0);
    await expect(page.locator(".budget-line")).toHaveCount(0);
    await page.reload();
    await page.locator('main[data-view="agenda-setup"][aria-busy="false"]').waitFor();
    await expect(page.getByRole("button", { name: "Agenda-free" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "With agenda" }).click();
    await expect(page.locator(".agenda-row")).toHaveCount(5);
    await page.getByRole("button", { name: "Agenda-free" }).click();
    await page.getByRole("button", { name: "Start meeting" }).click();
    await page.locator('main[data-view="live"][data-mode="free"]').waitFor();
    await expect(timer(page)).toContainText("60min left");
    await expect(page.getByText("Free mode")).toBeVisible();
  });
});

test.describe("AC7 free live view at 1280×800", () => {
  test("normal state", async ({ page }) => {
    await openAt(page, FREE_TIMES.running);
    await expect(timer(page)).toContainText("31min left · ends 11:00 AM");
    await expect(nudge(page)).toHaveCount(0);
    await expectAccessibleLayout(page);
  });

  test("nudge state, adding with an error, and German", async ({ page }) => {
    await openAt(page, FREE_TIMES.half);
    await expect(nudge(page)).toContainText("Half the time is gone");
    await expect(nudge(page)).toContainText("29 min left, ends 11:00 AM");
    await expectAccessibleLayout(page);
    await page.getByRole("button", { name: "Add topic" }).click();
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(topics(page)).toContainText("Enter a title for the topic.");
    await expectAccessibleLayout(page);
    await page.getByRole("button", { name: "Deutsch" }).click();
    await expect(nudge(page)).toContainText("Die Hälfte der Zeit ist um");
    await expect(nudge(page)).toContainText("Noch 29 Min., endet 11:00");
    await expectAccessibleLayout(page);
  });

  test("overrun and the empty start", async ({ page }) => {
    await openAt(page, FREE_TIMES.over);
    await expect(timer(page)).toContainText("6min over · slot ended 11:00 AM");
    await expectAccessibleLayout(page);
    await openAt(page, FREE_TIMES.early, "live-free-empty");
    await expect(topics(page)).toContainText("No topics yet");
    await expectAccessibleLayout(page);
  });

  test("the keyboard reaches Add topic, the topic rows, Dismiss, the recording controls and End meeting", async ({
    page,
  }) => {
    await openAt(page, FREE_TIMES.half);
    await expect(nudge(page)).toBeVisible();
    const order = await tabOrder(page, (n) => n === "End meeting");
    expectInOrder(order, [
      "Pause",
      "Deutsch",
      "English",
      /^Offline mode for the beta/,
      /^Interview recruiting/,
      "Add topic",
      "Transcript",
      "Dismiss",
      "End meeting",
    ]);
    expect(order.at(-1)).toBe("End meeting");
  });

  test("each topic action is one key press", async ({ page }) => {
    await openAt(page, FREE_TIMES.running);
    const row = topics(page).getByRole("button", { name: /^Teacher onboarding/ });
    await row.focus();
    await page.keyboard.press("Enter");
    await expect(row).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Enter");
    await expect(row).toHaveAttribute("aria-pressed", "false");
    await expect(topics(page)).toContainText("No topic is current");
    await page.getByRole("button", { name: "Add topic" }).click();
    await page.keyboard.type("Pilot school visits in March");
    await page.keyboard.press("Enter");
    const added = topics(page).getByRole("button", { name: /^Pilot school visits in March/ });
    await expect(added).toHaveAttribute("aria-pressed", "true");
    await expect(added).toContainText("talking now");
    await expect(page.getByRole("button", { name: "Add topic" })).toBeFocused();
  });
});

test.describe("AC5 reload with the mock backend", () => {
  test("a running free meeting reopens in the free view with the same current topic and recomputed times", async ({
    page,
  }) => {
    await openAt(page, FREE_TIMES.running);
    await topics(page)
      .getByRole("button", { name: /^Teacher onboarding/ })
      .click();
    await expect(topics(page).getByRole("button", { name: /^Teacher onboarding/ })).toContainText("9 min");
    // Ten minutes later, after a restart.
    await page.clock.setFixedTime(FREE_TIMES.running + 10 * 60_000);
    await page.reload();
    await page.locator('main[data-view="live"][data-mode="free"]').waitFor();
    const row = topics(page).getByRole("button", { name: /^Teacher onboarding/ });
    await expect(row).toHaveAttribute("aria-pressed", "true");
    await expect(row).toContainText("talking now");
    await expect(row).toContainText("19 min");
    await expect(topics(page).getByRole("button", { name: /^Interview recruiting/ })).toContainText("2 min");
    await expect(timer(page)).toContainText("21min left");
    // Past half time on reload: the nudge shows again, once.
    await expect(nudge(page)).toBeVisible();
  });
});

test.describe("AC6 recording in a free meeting with the fake speech-to-text", () => {
  test("consent first, then transcript lines in the free view, with no foreign request", async ({ page }) => {
    const foreign: string[] = [];
    page.on("request", (r) => {
      if (!r.url().startsWith("http://localhost:4173/")) foreign.push(r.url());
    });
    await openAt(page, FREE_TIMES.early, "live-free-empty");
    await expect(chip(page)).toHaveCount(0);
    const start = card(page).getByRole("button", { name: "Start recording" });
    await expect(start).toBeDisabled();
    await card(page)
      .getByRole("checkbox", { name: "Everyone was informed that this meeting is transcribed" })
      .check();
    await start.click();
    await expect(chip(page)).toContainText("REC");
    await expect(card(page).locator(".transcript-line:not(.transcript-line--partial)").first()).toBeVisible({
      timeout: 10_000,
    });
    // The speakers view opens from the free live view.
    await page.locator("[data-speakers-button]").click();
    await page.locator('main[data-view="speakers"]').waitFor();
    await expect(chip(page)).toBeVisible();
    expect(foreign).toEqual([]);
  });
});
