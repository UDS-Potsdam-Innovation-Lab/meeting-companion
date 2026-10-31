import { expect, test, type Page } from "@playwright/test";
import { expectNoAxeViolations, expectNoHorizontalScroll } from "./a11y";
import { openApp, type Fixture } from "./helpers";

// Job 007: the sound wave in the frame 02 transcript footer and the settings meter.
const STATES: { fixture: Fixture; state: string; status: RegExp }[] = [
  { fixture: "live-level-speech", state: "listening", status: /^Listening · \d+ speakers?$/ },
  { fixture: "live-level-silence", state: "listening", status: /^Listening · \d+ speakers?$/ },
  { fixture: "live-paused", state: "paused", status: /^Paused · \d+ speakers?$/ },
  { fixture: "live-no-signal", state: "noSignal", status: /^No signal · \d+ speakers?$/ },
  { fixture: "live-mic-error", state: "lost", status: /^Microphone lost · \d+ speakers?$/ },
];

const SIZES = [
  { width: 375, height: 812 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 480, height: 800 },
  { width: 1024, height: 600 },
  { width: 768, height: 480 },
];

const footer = (page: Page) => page.locator(".transcript-card__footer");
const wave = (page: Page) => footer(page).locator(".sound-wave");

async function barHeights(page: Page) {
  return footer(page)
    .locator(".sound-wave__bar")
    .evaluateAll((bars) => bars.map((b) => b.getBoundingClientRect().height));
}

/** WCAG relative luminance contrast of two computed CSS colours. */
async function contrast(page: Page, fg: string, bg: string) {
  return page.evaluate(
    ([a, b]) => {
      const lum = (c: string) => {
        const [r, g, bl] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
          const s = Number(v) / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
      };
      const [hi, lo] = [lum(a!), lum(b!)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    },
    [fg, bg],
  );
}

for (const { fixture, state, status } of STATES) {
  test(`${fixture}: the footer shows ${state} with its status text, at every window size`, async ({
    page,
  }) => {
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await openApp(page, fixture);
      await expect(wave(page)).toHaveAttribute("data-state", state);
      await expect(wave(page)).toHaveAttribute("aria-hidden", "true");
      await expect(footer(page).locator("[data-speakers-button]")).toHaveText(status);
      await expectNoHorizontalScroll(page);
      if ([375, 1280, 1920].includes(size.width) && size.height !== 600) await expectNoAxeViolations(page);
    }
  });
}

test("speech moves the wave; silence keeps it low but alive", async ({ page }) => {
  await openApp(page, "live-level-speech");
  await page.waitForTimeout(2_200);
  const speech = await barHeights(page);
  expect(speech).toHaveLength(21);
  expect(Math.max(...speech)).toBeGreaterThan(12);
  expect(new Set(speech.map(Math.round)).size).toBeGreaterThan(5);
  await openApp(page, "live-level-silence");
  await page.waitForTimeout(2_200);
  const silence = await barHeights(page);
  expect(Math.max(...silence)).toBeLessThan(6);
  expect(Math.max(...silence)).toBeGreaterThan(2);
});

test("the wave keeps 3:1 against the card in light and dark", async ({ page }) => {
  for (const theme of ["light", "dark"] as const) {
    await page.addInitScript((t) => localStorage.setItem("meeting-companion.theme", t), theme);
    await openApp(page, "live-level-speech");
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    const colours = await page.evaluate(() => {
      const card = getComputedStyle(document.querySelector(".transcript-card")!).backgroundColor;
      const bar = getComputedStyle(document.querySelector(".sound-wave__bar")!).backgroundColor;
      return { card, bar };
    });
    expect(await contrast(page, colours.bar, colours.card), theme).toBeGreaterThanOrEqual(3);
    await openApp(page, "live-paused");
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    const flat = await page.evaluate(() => ({
      card: getComputedStyle(document.querySelector(".transcript-card")!).backgroundColor,
      line: getComputedStyle(document.querySelector(".sound-wave__line")!).backgroundColor,
    }));
    expect(await contrast(page, flat.line, flat.card), theme).toBeGreaterThanOrEqual(3);
  }
});

test("reduced motion: a static level bar, at most 4 updates a second, no transition or animation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openApp(page, "live-level-speech");
  await expect(footer(page).locator(".sound-wave--reduced")).toHaveAttribute("data-state", "listening");
  await expect(footer(page).locator(".sound-wave__bar")).toHaveCount(0);
  const value = footer(page).locator(".sound-wave__value");
  const style = await value.evaluate((el) => {
    const s = getComputedStyle(el);
    return { transition: s.transitionDuration, animation: s.animationName };
  });
  expect(style).toEqual({ transition: "0s", animation: "none" });
  const writes = await value.evaluate(
    (el) =>
      new Promise<number>((resolve) => {
        let n = 0;
        new MutationObserver(() => (n += 1)).observe(el, { attributes: true });
        setTimeout(() => resolve(n), 2_000);
      }),
  );
  expect(writes).toBeGreaterThan(0);
  expect(writes).toBeLessThanOrEqual(9);
  // Same states: flat when paused, "No signal" and "Microphone lost" in text.
  for (const { fixture, state, status } of STATES.slice(2)) {
    await openApp(page, fixture);
    await expect(footer(page).locator(".sound-wave--reduced")).toHaveAttribute("data-state", state);
    await expect(footer(page).locator("[data-speakers-button]")).toHaveText(status);
  }
});

test("German: Kein Signal", async ({ page }) => {
  await openApp(page, "live-no-signal", "de");
  await expect(footer(page).locator("[data-speakers-button]")).toHaveText(/^Kein Signal · \d+ Stimmen?$/);
});

test("the settings meter is the same wave while the microphone test runs", async ({ page }) => {
  await openApp(page, "settings-mic-test");
  const meter = page.getByTestId("settings-meter").locator(".sound-wave");
  await expect(meter).toHaveClass(/sound-wave--settings/);
  await expect(meter).toHaveAttribute("data-state", "listening");
  await page.waitForTimeout(600);
  const heights = await page
    .getByTestId("settings-meter")
    .locator(".sound-wave__bar")
    .evaluateAll((bars) => bars.map((b) => b.getBoundingClientRect().height));
  expect(Math.max(...heights)).toBeGreaterThan(8);
  await expectNoAxeViolations(page);
});
