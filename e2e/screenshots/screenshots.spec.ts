import { test, type Page } from "@playwright/test";
import { LIVE_TIMES } from "../../src/features/agenda/fixtures";
import { openApp, type Fixture } from "../helpers";

// One PNG per state and width: screenshots/<view>-<width>.png.
const WIDTHS = [375, 1280, 1920];

interface View {
  name: string;
  fixture: Fixture;
  /** Fixed clock time (Playwright's clock API) for the live views. */
  time?: number;
  act?: (page: Page) => Promise<void>;
}

/** Waits until the mock core's state is on screen. */
const waitFor = (selector: string) => async (page: Page) => {
  await page.locator(selector).first().waitFor();
};

const VIEWS: View[] = [
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
  {
    name: "agenda-start-blocked",
    fixture: "filled",
    act: async (page) => {
      await page.getByLabel("Title", { exact: true }).fill("");
    },
  },
  // Frame 02, left column: 79 % (3:12 left), the 80 % nudge, 2:10 over, and the agenda done.
  { name: "live", fixture: "live", time: LIVE_TIMES.running },
  { name: "live-nudge", fixture: "live", time: LIVE_TIMES.nudge },
  { name: "live-over", fixture: "live", time: LIVE_TIMES.over },
  {
    name: "live-done",
    fixture: "live-done",
    time: LIVE_TIMES.done,
    act: async (page) => {
      await page.getByRole("button", { name: /^Parking lot/ }).click();
    },
  },
  {
    name: "live-end-confirm",
    fixture: "live",
    time: LIVE_TIMES.running,
    act: async (page) => {
      await page.getByRole("button", { name: "End meeting" }).click();
    },
  },
  { name: "live-nudge-de", fixture: "live", time: LIVE_TIMES.nudge },
  // Frame 02, centre column and recording controls (job 003), with segments from the mock core.
  { name: "live-consent", fixture: "live", time: LIVE_TIMES.running, act: waitFor(".consent-check") },
  { name: "live-transcript", fixture: "live-transcript", time: LIVE_TIMES.running, act: waitFor(".transcript-line--partial") },
  { name: "live-paused", fixture: "live-paused", time: LIVE_TIMES.running, act: waitFor(".rec-chip--paused") },
  { name: "live-mic-error", fixture: "live-mic-error", time: LIVE_TIMES.running, act: waitFor(".rec-notice--error") },
  { name: "live-no-model", fixture: "live-no-model", time: LIVE_TIMES.running, act: waitFor(".consent-check") },
  {
    name: "live-transcript-de",
    fixture: "live-transcript",
    time: LIVE_TIMES.running,
    act: waitFor(".transcript-line--partial"),
  },
  // Frame 14 Settings (job 006).
  { name: "settings", fixture: "settings" },
  {
    name: "settings-device",
    fixture: "settings",
    act: async (page) => {
      await page.getByRole("tab", { name: /On this device/ }).click();
      await page.locator(".choice").first().waitFor();
    },
  },
  {
    name: "settings-general",
    fixture: "settings",
    act: async (page) => {
      await page.getByRole("tab", { name: /General/ }).click();
    },
  },
  { name: "settings-no-model", fixture: "settings-no-model" },
  { name: "settings-mic-test", fixture: "settings-mic-test" },
  { name: "settings-recording", fixture: "settings-recording", time: LIVE_TIMES.running },
  { name: "settings-dark", fixture: "settings-dark", time: LIVE_TIMES.running },
  { name: "settings-missing", fixture: "settings-missing", act: waitFor(".settings-notice--error") },
  {
    name: "live-mic-missing",
    fixture: "live-mic-missing",
    time: LIVE_TIMES.running,
    act: async (page) => {
      await page.getByRole("button", { name: "Resume recording" }).click();
      await page.locator('[data-testid="mic-missing"]').waitFor();
    },
  },
  { name: "live-switched", fixture: "live-switched", time: LIVE_TIMES.running, act: waitFor(".switched-notice") },
  { name: "live-transcript-dark", fixture: "settings-dark", time: LIVE_TIMES.running, act: async (page) => {
      await page.getByRole("button", { name: "Back to meeting" }).click();
      await page.locator(".transcript-line--partial").waitFor();
    } },
];

for (const width of WIDTHS) {
  for (const view of VIEWS) {
    test(`${view.name}-${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1920 ? 1080 : width === 375 ? 812 : 800 });
      if (view.time !== undefined) await page.clock.setFixedTime(view.time);
      await openApp(page, view.fixture, view.name.endsWith("-de") ? "de" : "en");
      await view.act?.(page);
      await page.screenshot({ path: `screenshots/${view.name}-${width}.png`, fullPage: true });
    });
  }
}

// Rework 1, responsive layout: setup and live view at the window sizes the layout is checked at
// (e2e/responsive.spec.ts), plus short windows for the live view: screenshots/<view>-<w>x<h>.png.
const RESPONSIVE_SIZES = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 480, height: 800 },
];
const SHORT_SIZES = [
  { width: 1024, height: 600 },
  { width: 768, height: 480 },
];
const RESPONSIVE_VIEWS = [
  "agenda-filled",
  "agenda-editing",
  "live-nudge",
  "live-over",
  "live-done",
  "live-transcript",
  "live-consent",
  "settings",
  "settings-recording",
];

const sized = [
  ...RESPONSIVE_SIZES.flatMap((size) => RESPONSIVE_VIEWS.map((name) => ({ size, name }))),
  ...SHORT_SIZES.map((size) => ({ size, name: "live-nudge" })),
];

for (const { size, name } of sized) {
  const view = VIEWS.find((v) => v.name === name)!;
  test(`${name}-${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    if (view.time !== undefined) await page.clock.setFixedTime(view.time);
    await openApp(page, view.fixture, "en");
    await view.act?.(page);
    // The window as the user sees it, not the full page: shows what fits and where the nudge sits.
    await page.screenshot({ path: `screenshots/${name}-${size.width}x${size.height}.png` });
  });
}
