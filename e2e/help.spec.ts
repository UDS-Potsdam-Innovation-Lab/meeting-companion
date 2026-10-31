import { expect, test, type Page } from "@playwright/test";
import { LIVE_TIMES } from "../src/features/agenda/fixtures";
import { expectNoAxeViolations, expectNoHorizontalScroll, tabOrder } from "./a11y";
import { openApp, type Fixture } from "./helpers";

// Job 014, frame 19 "Help & legal".

const helpView = (page: Page) => page.locator('main[data-view="help"]');
const timer = (page: Page) => page.getByRole("region", { name: /^(Current item|Aktueller Punkt)$/ });
const visibleChip = (page: Page) => page.getByTestId("rec-chip").locator("visible=true");

async function open(page: Page, fixture: Fixture, locale: "de" | "en" = "en") {
  await page.clock.setFixedTime(LIVE_TIMES.running);
  await openApp(page, fixture, locale);
}

/**
 * Opens the legal tab with an expanded licence. With `all`, also the list of all other components
 * (about 500 entries: too many for an axe run, which checks the same entry markup on the named ones).
 */
async function expandEverything(page: Page, all = true) {
  await page.getByRole("tab", { name: /Legal notes|Rechtliche Hinweise/ }).click();
  await page.locator('[data-component="whisper.cpp"] summary').click();
  if (all) await page.locator(".licences__others > summary").click();
  await expect(page.locator('[data-component="whisper.cpp"] pre')).toBeVisible();
}

test.describe("AC1 entry, same window, recording carries on", () => {
  test("live-transcript: REC and the meeting timer keep running while the view is open and after", async ({
    page,
  }) => {
    // The clock stands still except when the test moves it.
    await page.clock.install({ time: LIVE_TIMES.running - 5_000 });
    await page.clock.pauseAt(LIVE_TIMES.running);
    await openApp(page, "live-transcript");
    await expect(timer(page)).toContainText("3:12");
    await expect(visibleChip(page)).toHaveText("REC00:16:48");
    await page.locator("[data-help-button]").click();
    await expect(helpView(page)).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // The REC chip stays in the top bar of the view.
    await expect(visibleChip(page)).toHaveText("REC00:16:48");
    await page.clock.runFor(60_000);
    await page.keyboard.press("Escape");
    await expect(helpView(page)).toHaveCount(0);
    await expect(visibleChip(page)).toHaveText("REC00:16:48");
    // A minute went by on the meeting timer while Help & legal was open.
    await expect(timer(page)).toContainText("2:12");
    await expect(page.locator("[data-help-button]")).toBeFocused();
  });

  test("setup, live (agenda-free) and settings have the button; the settings also have the link", async ({
    page,
  }) => {
    await open(page, "filled");
    await expect(page.locator("[data-help-button]")).toBeVisible();
    await open(page, "live-free");
    await expect(page.locator("[data-help-button]")).toBeVisible();
    await open(page, "settings");
    await expect(page.locator(".settings-view [data-help-button]")).toBeVisible();
    const link = page.locator("[data-help-link]").locator("visible=true");
    await link.click();
    await expect(helpView(page)).toBeVisible();
    await page.getByRole("button", { name: "Back to settings" }).click();
    await expect(page.locator('main[data-view="settings"]')).toBeVisible();
    await expect(link).toBeFocused();
  });
});

test.describe("AC6 offline and in two languages", () => {
  test("with every non-local request blocked, each tab and section renders and nothing leaves the origin", async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const outside: string[] = [];
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(origin) || url.startsWith("data:") || url.startsWith("blob:"))
        return route.continue();
      outside.push(url);
      return route.abort();
    });
    page.on("request", (r) => {
      const url = r.url();
      if (!url.startsWith(origin) && !url.startsWith("data:") && !url.startsWith("blob:")) outside.push(url);
    });
    await open(page, "help");
    for (const id of ["how-it-works", "shortcuts", "troubleshooting"]) {
      await expect(page.locator(`#${id} h2`)).toBeVisible();
    }
    await expandEverything(page);
    for (const id of ["privacy", "consent-texts", "organisation", "licences"]) {
      await expect(page.locator(`#${id} h2`)).toBeVisible();
    }
    await expect(page.locator("#organisation dd").first()).toHaveText("Grundschule am Lindenpark");
    const total = await page.locator("[data-component]").count();
    expect(total).toBeGreaterThan(100);
    // The Inter font is the bundled one.
    expect(await page.evaluate(() => document.fonts.check('16px "Inter Variable"'))).toBe(true);
    expect([...new Set(outside)]).toEqual([]);
  });

  test("German by default; the top-bar language switch changes the open view at once", async ({ page }) => {
    await page.clock.setFixedTime(LIVE_TIMES.running);
    await page.goto("/?fixture=help");
    await page.locator('main[data-view="agenda-setup"][aria-busy="false"]').waitFor();
    await page.getByRole("button", { name: "Hilfe & Rechtliches" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hilfe & Rechtliches");
    await expect(page.getByRole("tab", { name: "Rechtliche Hinweise" })).toBeVisible();
    await page.getByRole("button", { name: "English" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Help & legal");
    await expect(page.getByRole("heading", { level: 2, name: "Keyboard shortcuts" })).toBeVisible();
  });
});

const SIZES = [
  { name: "laptop", width: 1280, height: 800 },
  { name: "phone", width: 375, height: 812 },
  { name: "board", width: 1920, height: 1080 },
];

test.describe("AC7 accessible on laptop, phone width and board", () => {
  for (const size of SIZES) {
    for (const theme of ["light", "dark"] as const) {
      test(`${size.name} ${size.width}×${size.height}, ${theme}: no axe violations, no horizontal scroll`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.addInitScript((t) => localStorage.setItem("meeting-companion.theme", t), theme);
        await open(page, "help");
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expectNoAxeViolations(page);
        await expectNoHorizontalScroll(page);
        await expandEverything(page, false);
        await expectNoAxeViolations(page);
        await page.locator(".licences__others > summary").click();
        await expectNoHorizontalScroll(page);
        await page.getByRole("tab", { name: "Help" }).click();
        await page.locator("#troubleshooting").scrollIntoViewIfNeeded();
        await expectNoAxeViolations(page);
      });
    }
  }

  test("phone: the placeholder and the could-not-read notice reflow too", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    for (const fixture of ["help-no-org", "help-bad-org", "help-markup"] as const) {
      await open(page, fixture);
      await page.getByRole("tab", { name: "Legal notes" }).click();
      await page.locator("#organisation").scrollIntoViewIfNeeded();
      await expectNoAxeViolations(page);
      await expectNoHorizontalScroll(page);
    }
    await expect(page.locator("#organisation img, #organisation a")).toHaveCount(0);
    await expect(page.locator("#organisation")).toContainText("<img src=x onerror=alert(1)>");
  });

  test("one h1, sections as h2", async ({ page }) => {
    await open(page, "help");
    for (const tab of ["Help", "Legal notes"]) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.locator("h1:visible")).toHaveCount(1);
      const levels = await page
        .locator(".help-view")
        .locator("h1, h2, h3, h4, h5, h6")
        .evaluateAll((hs) => hs.map((h) => Number(h.tagName[1])));
      expect(levels[0]).toBe(1);
      expect(levels.filter((l) => l === 1)).toHaveLength(1);
      // No level is skipped.
      for (let i = 1; i < levels.length; i++) expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
    }
  });

  test("tabs work with arrows, Home and End; every control is reached by keyboard with a visible focus ring", async ({
    page,
  }) => {
    await open(page, "help");
    await page.getByRole("tab", { name: "Help" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Legal notes" })).toBeFocused();
    await expect(page.getByRole("tab", { name: "Legal notes" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(page.getByRole("tab", { name: "Help" })).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Legal notes" })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tab", { name: "Help" })).toBeFocused();

    const order = await tabOrder(page, (n) => n.startsWith("Open On this device"), 40);
    for (const name of [
      "How a meeting works",
      "Keyboard shortcuts",
      "Troubleshooting",
      "Open Audio settings",
    ]) {
      expect(order, order.join(" | ")).toContain(name);
    }
    // A section link moves focus to its heading.
    await page
      .getByRole("navigation", { name: "On this page" })
      .getByRole("button", { name: "Troubleshooting" })
      .click();
    await expect(page.locator("#troubleshooting-title")).toBeFocused();
    // Enter on a troubleshooting button opens the settings there.
    await page.getByRole("button", { name: "Open Audio settings" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('main[data-view="settings"]')).toBeVisible();
    await expect(page.getByRole("tab", { name: /Audio/ })).toBeFocused();
  });

  test("legal tab: licences open and close by keyboard", async ({ page }) => {
    await open(page, "help");
    await page.getByRole("tab", { name: "Legal notes" }).click();
    const summary = page.locator('[data-component="whisper.cpp"] summary');
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-component="whisper.cpp"] pre')).toContainText("MIT License");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-component="whisper.cpp"] pre')).toHaveCount(0);
  });

  test("board 1920×1080: every control of the view is at least 48 px", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await open(page, "help");
    const small = async () =>
      page.evaluate(() =>
        Array.from(
          document.querySelectorAll<HTMLElement>(".help-view button, .help-view select, .help-view summary"),
        )
          .filter((el) => el.offsetParent !== null)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { what: el.outerHTML.slice(0, 80), w: r.width, h: r.height };
          })
          .filter((t) => t.w < 48 || t.h < 48),
      );
    expect(await small()).toEqual([]);
    await expandEverything(page);
    expect(await small()).toEqual([]);
  });

  test("phone 375: the section list is a select and long legal text reflows", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, "help");
    const select = page.getByRole("combobox", { name: "On this page" });
    await expect(select).toBeVisible();
    await select.selectOption("troubleshooting");
    await expect(page.locator("#troubleshooting-title")).toBeFocused();
    await expandEverything(page);
    await expectNoHorizontalScroll(page);
    // The help button is an icon with the full accessible name.
    await expect(page.getByRole("button", { name: "Help & legal" })).toBeVisible();
  });
});
