import { test, type Page } from "@playwright/test";
import { openApp, type Fixture } from "../helpers";

// One PNG per state and width: screenshots/<view>-<width>.png.
const WIDTHS = [375, 1280, 1920];

const VIEWS: { name: string; fixture: Fixture; act?: (page: Page) => Promise<void> }[] = [
  { name: "agenda-empty", fixture: "empty" },
  { name: "agenda-filled", fixture: "filled" },
  {
    name: "agenda-editing",
    fixture: "filled",
    act: async (page) => {
      await page.getByRole("button", { name: /^Beta launch/ }).click();
    },
  },
  {
    name: "agenda-errors",
    fixture: "filled",
    act: async (page) => {
      await page.getByLabel("Title", { exact: true }).fill("");
      await page.getByLabel("End", { exact: true }).fill("09:00");
      await page.getByLabel("Add a person").fill("mara klein");
      await page.getByLabel("Add a person").press("Enter");
      await page.getByRole("button", { name: /^Pilot schools/ }).click();
      await page.getByLabel("Minutes", { exact: true }).fill("300");
      await page.locator("body").click({ position: { x: 5, y: 300 } });
    },
  },
  { name: "agenda-over-budget", fixture: "over" },
  { name: "agenda-store-error", fixture: "corrupt" },
  { name: "agenda-key-unavailable", fixture: "locked" },
  { name: "agenda-filled-de", fixture: "filled" },
];

for (const width of WIDTHS) {
  for (const view of VIEWS) {
    test(`${view.name}-${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1920 ? 1080 : width === 375 ? 812 : 800 });
      await openApp(page, view.fixture, view.name.endsWith("-de") ? "de" : "en");
      await view.act?.(page);
      await page.screenshot({ path: `screenshots/${view.name}-${width}.png`, fullPage: true });
    });
  }
}
