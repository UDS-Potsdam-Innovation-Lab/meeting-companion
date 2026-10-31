import { expect, test, type Page } from "@playwright/test";
import { LIVE_TIMES } from "../src/features/agenda/fixtures";

/** Longer than the 6 s the End meeting confirm stays armed (`CONFIRM_MS` in EndMeeting.tsx). */
const SLOW_STOP_MS = 10_000;
import {
  expectInOrder,
  expectNoAxeViolations,
  expectNoHorizontalScroll,
  expectTargetsAtLeast24px,
  tabOrder,
} from "./a11y";
import { openApp, type Fixture } from "./helpers";

const MINUTE = 60_000;

/** Opens a live fixture at a fixed clock time (Playwright's clock API). */
async function openLiveAt(page: Page, time: number, fixture: Fixture = "live", locale: "de" | "en" = "en") {
  await page.clock.setFixedTime(time);
  await openApp(page, fixture, locale);
}

const timer = (page: Page) => page.getByRole("region", { name: /^(Current item|Aktueller Punkt)$/ });
const nudge = (page: Page) => page.locator(".nudge");

async function expectAccessibleLayout(page: Page) {
  await expectNoAxeViolations(page);
  await expectNoHorizontalScroll(page);
  await expectTargetsAtLeast24px(page);
}

test.describe("AC7 live view accessibility at 1280×800", () => {
  test("normal state: no axe violations, no horizontal scroll, targets ≥ 24 px", async ({ page }) => {
    await openLiveAt(page, LIVE_TIMES.running);
    await expect(timer(page)).toContainText("3:12");
    await expect(nudge(page)).toHaveCount(0);
    await expectAccessibleLayout(page);
  });

  test("nudge state: no axe violations, no horizontal scroll, targets ≥ 24 px", async ({ page }) => {
    await openLiveAt(page, LIVE_TIMES.nudge);
    await expect(nudge(page)).toContainText("3 minutes left for item 02");
    await expectAccessibleLayout(page);
  });

  test("overrun, agenda done, open parking lot and End meeting armed, in German", async ({ page }) => {
    await openLiveAt(page, LIVE_TIMES.over, "live", "de");
    await expect(timer(page)).toContainText("2:10überzogen");
    await expectAccessibleLayout(page);
    await openLiveAt(page, LIVE_TIMES.done, "live-done", "de");
    await page.getByRole("button", { name: /^Parkplatz/ }).click();
    await page.getByRole("button", { name: "Meeting beenden" }).click();
    await expect(page.getByRole("heading", { name: "Agenda erledigt" })).toBeVisible();
    await expectAccessibleLayout(page);
  });

  test("the keyboard reaches every live control in a logical order with a visible focus ring", async ({
    page,
  }) => {
    await openLiveAt(page, LIVE_TIMES.nudge);
    await expect(nudge(page)).toBeVisible();
    const order = await tabOrder(page, (n) => n === "End meeting");
    // Reading order: language switch, the timer card, the parking lot, the nudge, and "End meeting" last
    // (bottom right), as AC7 lists it.
    expectInOrder(order, [
      "Deutsch",
      "English",
      "+5 min",
      "Park it",
      "Next ›",
      /^Parking lot/,
      "Wrap up",
      "End meeting",
    ]);
    expect(order.filter((n) => n === "+5 min")).toHaveLength(2);
    expect(order.lastIndexOf("+5 min")).toBeGreaterThan(order.indexOf("Wrap up"));
    expect(order.at(-1)).toBe("End meeting");
  });

  test("each action works by keyboard", async ({ page }) => {
    await openLiveAt(page, LIVE_TIMES.running);
    await page.getByRole("button", { name: "+5 min" }).focus();
    await page.keyboard.press("Enter");
    await expect(timer(page)).toContainText("left of 20:00");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Space");
    await expect(timer(page)).toContainText("Now · Item 03");
    await expect(page.getByRole("button", { name: /^Parking lot/ })).toContainText("1");
    await page.getByRole("button", { name: "Next ›" }).focus();
    await page.keyboard.press("Enter");
    await expect(timer(page)).toContainText("Now · Item 04");
    await page.getByRole("button", { name: /^Parking lot/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("list", { name: "Parking lot" })).toContainText(
      "Beta launch: scope and date",
    );
  });
});

test.describe("AC5 nudge", () => {
  test("appears at 80 % without taking focus, and Wrap up dismisses it", async ({ page }) => {
    await openLiveAt(page, LIVE_TIMES.running);
    await page.getByRole("button", { name: "Park it" }).focus();
    await expect(nudge(page)).toHaveCount(0);
    await page.clock.setFixedTime(LIVE_TIMES.nudge);
    await expect(nudge(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Park it" })).toBeFocused();
    await expect(page.getByTestId("nudge-announcement")).toContainText("3 minutes left for item 02");
    await nudge(page).getByRole("button", { name: "Wrap up" }).click();
    await expect(nudge(page)).toHaveCount(0);
    await page.clock.setFixedTime(LIVE_TIMES.over);
    await expect(timer(page)).toContainText("2:10");
    await expect(nudge(page)).toHaveCount(0);
  });
});

test.describe("AC6 restart and End meeting", () => {
  test("a running meeting reopens after a reload on the same item, with the time recomputed", async ({
    page,
  }) => {
    const t0 = LIVE_TIMES.start;
    await page.clock.setFixedTime(t0);
    await openApp(page, "filled");
    await page.getByRole("button", { name: "Start meeting" }).click();
    await expect(timer(page)).toContainText("Now · Item 01");
    await page.clock.setFixedTime(t0 + 6 * MINUTE);
    await page.getByRole("button", { name: "Next ›" }).click();
    await expect(timer(page)).toContainText("Now · Item 02");

    await page.clock.setFixedTime(t0 + 10 * MINUTE);
    await page.reload();
    await page.locator('main[data-view="live"]').waitFor();
    await expect(timer(page)).toContainText("Now · Item 02");
    await expect(timer(page)).toContainText("11:00left of 15:00");
    await expect(page.locator(".live-row").first()).toContainText("6 of 5 min");
  });

  test("End meeting needs a second click, then a new meeting opens and the ended one stays closed", async ({
    page,
  }) => {
    await openLiveAt(page, LIVE_TIMES.running);
    await page.getByRole("button", { name: "End meeting" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator('main[data-view="live"]')).toBeVisible();
    await page.getByRole("button", { name: "Click again to end" }).click();
    await page.locator('main[data-view="agenda-setup"][aria-busy="false"]').waitFor();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue("New meeting");
    await page.reload();
    await page.locator('main[data-view="agenda-setup"][aria-busy="false"]').waitFor();
    await expect(page.locator('main[data-view="live"]')).toHaveCount(0);
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("mock-backend.meetings") ?? "[]"),
    );
    expect(stored).toHaveLength(2);
    expect(stored[0].id).toBe("fixture-live");
    expect(stored[0].run.endedAt).toBe(LIVE_TIMES.running);
  });

  test("job 008: with recording on and a slow stop, End meeting opens agenda setup within 1 s", async ({
    page,
  }) => {
    // The core takes longer to answer `stop_recording` than the confirm stays armed.
    await page.addInitScript(
      (ms) => localStorage.setItem("mock-backend.stop-delay-ms", String(ms)),
      SLOW_STOP_MS,
    );
    await openLiveAt(page, LIVE_TIMES.running, "live-transcript");
    await expect(page.getByTestId("rec-chip")).toBeVisible();
    await page.getByRole("button", { name: "End meeting" }).click();
    await page.getByRole("button", { name: "Click again to end" }).click();
    await expect(page.locator('main[data-view="agenda-setup"][aria-busy="false"]')).toBeVisible({
      timeout: 1_000,
    });
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue("New meeting");
    await expect(page.getByTestId("rec-chip")).toHaveCount(0);
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("mock-backend.meetings") ?? "[]"),
    );
    expect(stored.find((m: { id: string }) => m.id === "fixture-live").run.endedAt).toBe(LIVE_TIMES.running);
  });

  test("the live view makes no network request beyond its own assets", async ({ page }) => {
    const foreign: string[] = [];
    page.on("request", (r) => {
      if (!r.url().startsWith("http://localhost:4173/")) foreign.push(r.url());
    });
    await openLiveAt(page, LIVE_TIMES.nudge);
    await page.getByRole("button", { name: "Next ›" }).click();
    await page.getByRole("button", { name: "+5 min" }).click();
    expect(foreign).toEqual([]);
  });
});
