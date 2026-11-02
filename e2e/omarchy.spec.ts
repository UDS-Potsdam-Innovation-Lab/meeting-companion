// Job 020: the app follows the Omarchy theme of the fake core (`&omarchy=<fixture>`).
import { expect, test, type Page } from "@playwright/test";
import { LIVE_TIMES } from "../src/features/agenda/fixtures";
import { toApplied } from "../src/features/theme/apply";
import { OMARCHY_FIXTURES } from "../src/features/theme/fixtures";
import { expectNoAxeViolations, expectNoHorizontalScroll, expectTargetsAtLeast24px } from "./a11y";
import { openApp, type Fixture, type OmarchyFixture } from "./helpers";

const token = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);
const tokens = (f: OmarchyFixture) => toApplied(OMARCHY_FIXTURES[f])!.tokens;

test.describe("AC3 live switch", () => {
  test("tokyo-night → catppuccin-latte while the live view is open, without a reload", async ({ page }) => {
    await page.clock.setFixedTime(LIVE_TIMES.running);
    await openApp(page, "live", "en", "light", "tokyo-night");
    await expect.poll(() => token(page, "--bg")).toBe("#1a1b26");
    expect(await token(page, "--accent")).toBe(tokens("tokyo-night")["--accent"]);
    expect(await theme(page)).toBe("dark");

    // A marker that a reload would lose, and the meeting as it stands.
    await page.evaluate(() => ((window as unknown as { marker: number }).marker = 42));
    const meetingBefore = await page.evaluate(() => localStorage.getItem("mock-backend.meetings"));
    const text = () =>
      page.evaluate(() =>
        [".live-row--now", ".timer-card"].map((s) => document.querySelector(s)?.textContent),
      );
    const before = await text();

    await page.evaluate(() => window.__mockOmarchy!("catppuccin-latte"));
    await expect.poll(() => token(page, "--bg")).toBe("#eff1f5");
    expect(await token(page, "--accent")).toBe(tokens("catppuccin-latte")["--accent"]);
    expect(await token(page, "--accent")).not.toBe(tokens("tokyo-night")["--accent"]);
    expect(await theme(page)).toBe("light");

    expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(42);
    expect(await page.evaluate(() => localStorage.getItem("mock-backend.meetings"))).toBe(meetingBefore);
    expect(await text()).toEqual(before);
    await expect(page.locator('main[data-view="live"]')).toBeVisible();

    // The theme is gone: back to the app's own tokens (the browser prefers light).
    await page.evaluate(() => window.__mockOmarchy!(null));
    await expect.poll(() => token(page, "--bg")).toBe("#f5f4f0");
    expect(await theme(page)).toBe("light");
  });
});

test.describe("AC6 no flash at start-up", () => {
  const boot = async (page: Page, cache: unknown) => {
    await page.addInitScript((c) => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("meeting-companion.locale", "en");
      localStorage.setItem("meeting-companion.theme", "system");
      localStorage.setItem("meeting-companion.omarchy", typeof c === "string" ? c : JSON.stringify(c));
      document.addEventListener("DOMContentLoaded", () => {
        const s = getComputedStyle(document.documentElement);
        (window as unknown as { atDcl: unknown }).atDcl = {
          bg: s.getPropertyValue("--bg").trim(),
          theme: document.documentElement.dataset.theme,
        };
      });
    }, cache);
  };

  test("the cached Omarchy tokens are on <html> at DOMContentLoaded", async ({ page }) => {
    await boot(page, { mode: "dark", tokens: tokens("tokyo-night") });
    await page.goto("/?omarchy=tokyo-night");
    await page.locator('main[data-view="agenda-setup"]').waitFor();
    expect(await page.evaluate(() => (window as unknown as { atDcl: unknown }).atDcl)).toEqual({
      bg: "#1a1b26",
      theme: "dark",
    });
    expect(await token(page, "--bg")).toBe("#1a1b26");
  });

  test("junk in the cache is ignored; the app's own tokens show", async ({ page }) => {
    await boot(page, {
      mode: "dark",
      tokens: { "--bg": "url(http://x)", "--ink": "var(--x)", "--evil": "#ff0000", "--accent": "#12345" },
    });
    await page.goto("/?omarchy=none");
    await page.locator('main[data-view="agenda-setup"]').waitFor();
    expect(await page.evaluate(() => (window as unknown as { atDcl: unknown }).atDcl)).toEqual({
      bg: "#f5f4f0",
      theme: "light",
    });
    expect(await page.evaluate(() => document.documentElement.getAttribute("style"))).toBeNull();
  });
});

// AC4: axe (WCAG 2.2 AA, colour contrast included) on the views of the Omarchy screenshots.
const AXE_VIEWS: { name: string; fixture: Fixture; time?: number; general?: boolean }[] = [
  { name: "setup", fixture: "filled" },
  { name: "live-nudge", fixture: "live", time: LIVE_TIMES.nudge },
  { name: "live-over", fixture: "live", time: LIVE_TIMES.over },
  { name: "live-transcript", fixture: "live-transcript", time: LIVE_TIMES.running },
  { name: "speakers", fixture: "speakers", time: LIVE_TIMES.running },
  { name: "settings-general", fixture: "settings", general: true },
];
const AXE_THEMES: OmarchyFixture[] = ["tokyo-night", "catppuccin-latte", "fwu-dark", "low-contrast"];

for (const omarchy of AXE_THEMES) {
  for (const view of AXE_VIEWS) {
    test(`AC4 axe: ${view.name} with ${omarchy}`, async ({ page }) => {
      if (view.time !== undefined) await page.clock.setFixedTime(view.time);
      await openApp(page, view.fixture, "en", "light", omarchy);
      await expect.poll(() => token(page, "--bg")).toBe(tokens(omarchy)["--bg"]);
      if (view.fixture === "live-transcript") await page.locator(".transcript-line--partial").waitFor();
      if (view.fixture === "speakers") {
        await page.locator("[data-speakers-button]").click();
        await page.locator('main[data-view="speakers"]').waitFor();
      }
      if (view.general) {
        await page.getByRole("tab", { name: /General/ }).click();
        await expect(page.getByText(/^Follows Omarchy · now /)).toBeVisible();
      }
      await expectNoAxeViolations(page);
    });
  }
}

// AC7: the layouts hold under the Omarchy palette (colours only; the font stays Inter).
const AC7_SIZES = [
  { width: 375, height: 812 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
  { width: 1024, height: 600 },
  { width: 768, height: 480 },
];

/** The settings view's board-size check (e2e/settings.spec.ts): every control at least 48×48 px. */
async function expectTargetsAtLeast48px(page: Page) {
  const small = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        '.settings-view button, .settings-view select, .settings-view input:not([type="radio"]), .settings-view label.choice',
      ),
    )
      .filter((el) => el.offsetParent !== null)
      .map((el) => {
        const target = el.matches("select") ? el.closest(".device-select")! : el;
        const r = target.getBoundingClientRect();
        return { what: target.outerHTML.slice(0, 80), w: r.width, h: r.height };
      })
      .filter((t) => t.w < 48 || t.h < 48),
  );
  expect(small).toEqual([]);
}

for (const size of AC7_SIZES) {
  test.describe(`AC7 tokyo-night at ${size.width}×${size.height}`, () => {
    test.use({ viewport: size });

    test("live view: no overflow, no clipped label, targets large enough", async ({ page }) => {
      await page.clock.setFixedTime(LIVE_TIMES.nudge);
      await openApp(page, "live", "en", "light", "tokyo-night");
      await expect.poll(() => token(page, "--bg")).toBe("#1a1b26");
      expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain("Inter");
      await expectNoHorizontalScroll(page);
      await expectNoClippedLabels(page);
      await expectTargetsAtLeast24px(page);
    });

    test("setup and settings: no overflow, no clipped label", async ({ page }) => {
      await openApp(page, "filled", "en", "light", "tokyo-night");
      await expectNoHorizontalScroll(page);
      await expectNoClippedLabels(page);
      await openApp(page, "settings", "en", "light", "tokyo-night");
      await expectNoHorizontalScroll(page);
      await expectNoClippedLabels(page);
      await expectTargetsAtLeast24px(page);
      if (size.width === 1920) await expectTargetsAtLeast48px(page);
    });
  });
}

async function expectNoClippedLabels(page: Page) {
  const clipped = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("button"))
      .filter((el) => el.offsetParent !== null && el.textContent?.trim())
      // The meeting title in the top bar is shortened with an ellipsis on purpose.
      .filter((el) => !el.closest(".top-bar__title"))
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.outerHTML.slice(0, 80)),
  );
  expect(clipped).toEqual([]);
}
