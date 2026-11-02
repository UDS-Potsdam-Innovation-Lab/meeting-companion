import { expect, test, type Page } from "@playwright/test";
import { LIVE_TIMES } from "../src/features/agenda/fixtures";
import { expectInOrder, expectNoAxeViolations, expectNoHorizontalScroll, tabOrder } from "./a11y";
import { openApp, type Fixture } from "./helpers";

// Job 019: capture suggestions (frames 21g/h/l/f/n/s) against the browser build with the mock core.

async function openAt(
  page: Page,
  fixture: Fixture,
  opts: { locale?: "de" | "en"; theme?: "light" | "dark" } = {},
) {
  await page.clock.install({ time: LIVE_TIMES.running });
  await openApp(page, fixture, opts.locale ?? "en", opts.theme ?? "light");
  await page.locator(".composer").waitFor();
}

const column = (page: Page) => page.getByTestId("captures-column");
const pin = (page: Page) => page.getByTestId("suggestion-pin");
const card = (page: Page) => pin(page).locator(".suggest-card");
const status = (page: Page) => page.getByTestId("suggest-status");
const line = (page: Page, seq: number) => page.locator(`.transcript-line[data-seq="${seq}"]`);
const notice = (page: Page) => page.getByTestId("undo-notice");

/** Opens the centre card's "Captured" tab below 1200 px. */
async function capturedTab(page: Page) {
  const centre = page.locator("#centre-captures-tab");
  if (await centre.isVisible()) await centre.click();
}

const STATES: { fixture: Fixture; act?: (page: Page) => Promise<void> }[] = [
  { fixture: "live-suggest" },
  {
    fixture: "live-suggest-edit",
    act: async (page) => {
      await column(page)
        .getByRole("button", { name: /^To-dos/ })
        .click();
      await page.locator("[data-suggest-edit]").click();
      await page.locator(".suggest-card--editing").waitFor();
    },
  },
  { fixture: "live-suggest-many" },
  { fixture: "live-suggest-off" },
  { fixture: "live-suggest-local" },
  { fixture: "live-suggest-cloud" },
  { fixture: "live-suggest-error" },
];

test.describe("AC6 axe reports no violations for the column and transcript, light and dark", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const state of STATES) {
      test(`${state.fixture} (${theme})`, async ({ page }) => {
        await openAt(page, state.fixture, { theme });
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await state.act?.(page);
        await expectNoAxeViolations(page);
      });
    }
  }
});

test("AC4 Bestätigen stores a suggested capture that survives a reload; its chip says captured", async ({
  page,
}) => {
  await openAt(page, "live-suggest");
  await expect(card(page)).toContainText("Beta launches on 14 Nov without offline mode");
  await expect(line(page, 2).getByTestId("line-chip")).toHaveText("✦ Decision spotted");
  await card(page).getByRole("button", { name: "Confirm" }).click();
  await expect(notice(page)).toContainText("Decision saved · Item 02");
  await expect(notice(page)).toContainText("from a suggestion");
  await expect(line(page, 2).getByTestId("line-chip")).toHaveText("Decision captured");
  await expect(column(page).getByText("Beta launches on 14 Nov without offline mode")).toBeVisible();
  // The suggestions are in the core's memory only; the capture is in the stored meeting.
  await page.reload();
  await page.locator(".composer").waitFor();
  await expect(line(page, 2).getByTestId("line-chip")).toHaveText("Decision captured");
  await expect(column(page).getByTestId("from-suggestion")).toBeVisible();
});

test("AC4 Bearbeiten is inline, Esc returns to the card, and Verwerfen drops the suggestion", async ({
  page,
}) => {
  await openAt(page, "live-suggest-many");
  await expect(page.getByTestId("suggestion-waiting")).toHaveText(/1 more suggestion/);
  await card(page).getByRole("button", { name: "Edit" }).click();
  const editor = pin(page).locator(".suggest-card--editing");
  await expect(editor).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(editor.getByRole("textbox")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(card(page).getByRole("button", { name: "Edit" })).toBeFocused();
  await card(page).getByRole("button", { name: "Dismiss" }).click();
  await expect(card(page)).toContainText("The launch moves from the 7th to the 14th");
  await expect(page.getByTestId("suggestion-waiting")).toHaveCount(0);
  await expect(line(page, 2).getByTestId("line-chip")).toHaveCount(0);
  // Nothing was written by the dismiss.
  await expect(column(page).getByRole("button", { name: /^Decisions/ })).toContainText("8");
});

test("AC6 a chip moves focus to its card; Tab reaches every control with a visible focus", async ({
  page,
}) => {
  await openAt(page, "live-suggest");
  await line(page, 4)
    .getByRole("button", { name: /To-do spotted/ })
    .click();
  await expect(column(page).getByRole("button", { name: /^To-dos/ })).toHaveAttribute("aria-pressed", "true");
  await expect(card(page)).toBeFocused();
  await expect(card(page)).toContainText("Write to the third pilot school");
  const order = await tabOrder(page, (n) => n === "Dismiss");
  expectInOrder(order, [/^Go to the transcript line: Mara Klein, 10:12/, "Confirm", "Edit", "Dismiss"]);
});

test("AC6 a new suggestion is announced through the polite region and never takes focus", async ({
  page,
}) => {
  await openAt(page, "live-suggest");
  const field = page.getByRole("textbox", { name: "Note a decision …" });
  await field.click();
  await expect(page.getByTestId("nudge-announcement")).toHaveAttribute("aria-live", "polite");
  await page.clock.runFor(3_000);
  await expect(field).toBeFocused();
});

test("AC5 off: “Choose a language model” opens the settings at the language model section", async ({
  page,
}) => {
  await openAt(page, "live-suggest-off");
  await expect(status(page)).toHaveText("○Suggestions off · Choose a language model");
  await expect(page.getByTestId("suggest-cloud-chip")).toHaveCount(0);
  await status(page).getByRole("button", { name: "Choose a language model" }).click();
  await expect(page.getByRole("tab", { name: /Language model/ })).toHaveAttribute("aria-selected", "true");
});

test("AC5 each setting names where the text goes; with Claude the top bar says so too", async ({ page }) => {
  await openAt(page, "live-suggest-local");
  await expect(status(page)).toHaveText("Suggestions on this device");
  await expect(page.getByTestId("suggest-cloud-chip")).toHaveCount(0);
  await openAt(page, "live-suggest-cloud");
  await expect(status(page)).toHaveText(
    "CloudSuggestions via Anthropic · transcript text leaves this device",
  );
  await expect(page.getByTestId("suggest-cloud-chip")).toContainText("Suggestions: Anthropic (cloud)");
  await openAt(page, "live-suggest-error");
  await expect(status(page)).toHaveText("!Suggestions paused: no internet connection.");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("AC6 the board has 48 px targets for the card, the chips and the status link", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  for (const fixture of ["live-suggest", "live-suggest-off"] as const) {
    await openAt(page, fixture);
    const small = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          ".suggest-pin button, .line-chip, .suggest-status button, [data-testid='captures-column'] button",
        ),
      )
        .filter((el) => el.offsetParent !== null)
        .map((el) => ({ what: el.textContent?.trim(), r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width < 48 || r.height < 48)
        .map(({ what, r }) => `${what}: ${Math.round(r.width)}×${Math.round(r.height)}`),
    );
    expect(small).toEqual([]);
  }
});

/** No two of these boxes overlap. */
async function expectApart(page: Page, selectors: string[]) {
  const boxes = [];
  for (const s of selectors) {
    const b = await page.locator(s).first().boundingBox();
    if (b) boxes.push({ s, ...b });
  }
  for (const a of boxes)
    for (const b of boxes) {
      if (a === b) continue;
      const apart =
        a.x + a.width <= b.x + 0.5 ||
        b.x + b.width <= a.x + 0.5 ||
        a.y + a.height <= b.y + 0.5 ||
        b.y + b.height <= a.y + 0.5;
      expect(apart, `${a.s} overlaps ${b.s}`).toBe(true);
    }
}

test.describe("AC6 the layout has no overlap (frames 21g, 21l)", () => {
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 375, height: 812 },
  ]) {
    test(`${size.width}×${size.height}`, async ({ page }) => {
      await page.setViewportSize(size);
      await openAt(page, "live-suggest", { locale: "de" });
      await expectNoHorizontalScroll(page);
      // The top bar: the cloud chip, REC, Pause, the language switch and Settings side by side.
      await expectApart(page, [
        "[data-testid='suggest-cloud-chip']",
        ".rec-chip",
        "[data-rec-action]",
        ".lang-switch",
        "[data-settings-button]",
        ".top-bar__title",
      ]);
      await capturedTab(page);
      await expect(card(page)).toBeVisible();
      await expectApart(page, [
        ".capture-tabs",
        ".suggest-pin",
        ".capture-group",
        ".composer",
        "[data-testid='suggest-status']",
      ]);
      const pinBox = (await pin(page).boundingBox())!;
      const tabs = (await page.locator(".capture-tabs").boundingBox())!;
      expect(tabs.y + tabs.height).toBeLessThanOrEqual(pinBox.y);
      const form = (await page.locator(".composer").boundingBox())!;
      const st = (await status(page).boundingBox())!;
      expect(form.y + form.height).toBeLessThanOrEqual(st.y + 0.5);
      expect(st.x + st.width).toBeLessThanOrEqual(size.width);
      for (const name of ["Bestätigen", "Bearbeiten", "Verwerfen"]) {
        const b = (await card(page).getByRole("button", { name }).boundingBox())!;
        expect(b.x).toBeGreaterThanOrEqual(pinBox.x);
        expect(b.x + b.width).toBeLessThanOrEqual(pinBox.x + pinBox.width + 0.5);
      }
    });
  }
});

test("AC5 nothing leaves the page: the mock build makes no request to another origin", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await openAt(page, "live-suggest");
  await card(page).getByRole("button", { name: "Confirm" }).click();
  await expect(notice(page)).toBeVisible();
  const origin = new URL(page.url()).origin;
  expect(requests.filter((u) => new URL(u).origin !== origin)).toEqual([]);
});

test.describe("round 2 (UI review): tab labels stay on one line with the dot at 375 px", () => {
  for (const locale of ["en", "de"] as const) {
    test(`375×812 (${locale})`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await openAt(page, "live-suggest", { locale });
      await capturedTab(page);
      // live-suggest has a decision and a to-do waiting: two tabs carry the dot.
      await expect(page.locator(".capture-tabs__dot")).toHaveCount(2);
      const tabs = await page.evaluate(() => {
        const row = document.querySelector(".capture-tabs")!.getBoundingClientRect();
        return Array.from(document.querySelectorAll<HTMLElement>(".capture-tabs__tab")).map((tab) => {
          const r = tab.getBoundingClientRect();
          const name = tab.querySelector(".capture-tabs__name")!;
          const dot = tab.querySelector(".capture-tabs__dot")?.getBoundingClientRect();
          return {
            label: tab.textContent,
            nameLines: name.getClientRects().length,
            nameHeight: name.getBoundingClientRect().height,
            fits: tab.scrollWidth <= tab.clientWidth + 0.5,
            inRow: r.left >= row.left - 0.5 && r.right <= row.right + 0.5,
            dotInside:
              !dot ||
              (dot.left >= r.left && dot.right <= r.right && dot.top >= r.top && dot.bottom <= r.bottom),
          };
        });
      });
      for (const t of tabs) {
        expect(t.nameLines, `${t.label} wraps`).toBe(1);
        expect(t.nameHeight, `${t.label} wraps`).toBeLessThan(24);
        expect(t.fits, `${t.label} overflows its tab`).toBe(true);
        expect(t.inRow, `${t.label} leaves the tab row`).toBe(true);
        expect(t.dotInside, `${t.label}: dot clipped`).toBe(true);
      }
    });
  }
});

test("round 2 (UI review): at 1280 the cloud chip sits after the device chip, before Pause (frame 21g)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAt(page, "live-suggest");
  const x = async (s: string) => (await page.locator(s).first().boundingBox())!;
  const device = await x("[data-testid='device-chip']");
  const chip = await x("[data-testid='suggest-cloud-chip']");
  const pause = await x("[data-rec-action]");
  expect(device.x + device.width).toBeLessThanOrEqual(chip.x);
  expect(chip.x + chip.width).toBeLessThanOrEqual(pause.x);
});
