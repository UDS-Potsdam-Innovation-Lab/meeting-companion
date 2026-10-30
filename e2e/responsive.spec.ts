import { expect, test, type Locator, type Page } from "@playwright/test";
import { LIVE_TIMES } from "../src/features/agenda/fixtures";
import { expectNoHorizontalScroll, expectTargetsAtLeast24px } from "./a11y";
import { openApp } from "./helpers";

// Window sizes the layout has to handle (rework 1): wide (frame layout), small laptop, tablet
// portrait, a narrow split window, and short windows for the live view.
const WINDOWS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 480, height: 800 },
];
const SHORT_WINDOWS = [
  { width: 1024, height: 600 },
  { width: 768, height: 480 },
  { width: 480, height: 480 },
];

/** Nothing is cut off: no element in the view clips its content horizontally or sticks out of the window. */
async function expectNothingCutOff(page: Page) {
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    const vw = document.documentElement.clientWidth;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      if (el.closest(".visually-hidden") || el.offsetParent === null) continue;
      // The meeting title in the top bar is shortened with an ellipsis on purpose.
      if (el.classList.contains("top-bar__title")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const what = `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80);
      if (r.right > vw + 0.5 || r.left < -0.5) out.push(`${what} outside the window (${r.left}–${r.right})`);
      const style = getComputedStyle(el);
      if (style.overflowX !== "visible" && el.scrollWidth > el.clientWidth + 1)
        out.push(`${what} clips its content (${el.scrollWidth} > ${el.clientWidth})`);
      // Avatar initials scale with the avatar (frame 01); the person's name is always written out next to it.
      if (parseFloat(style.fontSize) < 11 && el.textContent?.trim() && !el.classList.contains("avatar"))
        out.push(`${what} text below 11 px`);
    }
    return out;
  });
  expect(problems).toEqual([]);
}

/** Visible and clickable: Playwright's trial click scrolls to it and checks that nothing covers it. */
async function expectUsable(...controls: Locator[]) {
  for (const control of controls) {
    await expect(control).toBeVisible();
    await control.click({ trial: true, timeout: 2000 });
  }
}

async function box(l: Locator) {
  const b = await l.boundingBox();
  expect(b).not.toBeNull();
  return b!;
}

async function expectResponsive(page: Page) {
  await expectNoHorizontalScroll(page);
  await expectNothingCutOff(page);
  await expectTargetsAtLeast24px(page);
}

for (const size of WINDOWS) {
  const label = `${size.width}×${size.height}`;
  const wide = size.width >= 1080;

  test.describe(`agenda setup at ${label}`, () => {
    test.use({ viewport: size });

    test(`reflows without squeezing; key controls usable`, async ({ page }) => {
      await openApp(page, "filled");
      await expectResponsive(page);
      const list = page.locator(".agenda-list");
      const card = page.locator(".meeting-card");
      const [l, c] = [await box(list), await box(card)];
      if (wide) {
        // Frame 01: the meeting card to the right of the agenda.
        expect(c.x).toBeGreaterThanOrEqual(l.x + l.width);
      } else {
        // One column: the card below the agenda, both as wide as the column.
        expect(c.y).toBeGreaterThanOrEqual(l.y + l.height);
        expect(Math.abs(c.width - l.width)).toBeLessThan(2);
      }
      // The topic column never gets squeezed (the reported bug: 90 px at 1024).
      for (const topic of await page.locator(".agenda-row__topic").all()) {
        expect((await box(topic)).width).toBeGreaterThanOrEqual(160);
      }
      // Table header only while the table layout fits.
      await expect(page.locator(".agenda-list__header")).toBeVisible({ visible: size.width > 640 });
      await expectUsable(
        page.getByRole("button", { name: /^Beta launch/ }),
        page.getByRole("button", { name: "Add topic" }),
        page.getByLabel("Title", { exact: true }),
        page.getByLabel("Add a person"),
        page.getByRole("button", { name: "Start meeting" }),
        page.getByRole("button", { name: "New meeting" }),
        page.getByRole("button", { name: "Deutsch" }),
      );
    });

    test(`the open item editor and validation errors fit`, async ({ page }) => {
      await openApp(page, "filled", "de");
      await page.getByLabel("Ende", { exact: true }).fill("09:00");
      await page.getByRole("button", { name: /^Pilotschulen|^Pilot schools/ }).click();
      await page.getByLabel("Minuten", { exact: true }).fill("300");
      await expectResponsive(page);
      await expectUsable(
        page.getByLabel("Minuten", { exact: true }),
        page.getByRole("button", { name: "Fertig" }),
      );
    });
  });

  test.describe(`live view at ${label}`, () => {
    test.use({ viewport: size });

    test(`timer, agenda and nudge reflow; key controls usable`, async ({ page }) => {
      await page.clock.setFixedTime(LIVE_TIMES.nudge);
      await openApp(page, "live");
      await expect(page.locator(".nudge")).toBeVisible();
      await expectResponsive(page);
      const t = await box(page.locator(".timer-card"));
      const a = await box(page.locator(".live-agenda"));
      if (size.width >= 800) {
        // Frame 02: the 300 px left column.
        expect(Math.round(t.width)).toBe(300);
        expect((await box(page.locator(".nudge"))).x).toBeGreaterThan(t.x + t.width);
      } else {
        // One column across the window.
        expect(t.width).toBeGreaterThan(size.width - 40);
      }
      expect(a.y).toBeGreaterThanOrEqual(t.y + t.height);
      await expectUsable(
        page.getByRole("button", { name: "+5 min" }).first(),
        page.getByRole("button", { name: "Park it" }),
        page.getByRole("button", { name: "Next ›" }),
        page.getByRole("button", { name: /^Parking lot/ }),
        page.getByRole("button", { name: "Wrap up" }),
        page.getByRole("button", { name: "End meeting" }),
      );
      // "End meeting" is the last control, at the bottom right.
      const end = await box(page.getByRole("button", { name: "End meeting" }));
      expect(end.y).toBeGreaterThanOrEqual(a.y + a.height);
    });

    test(`agenda done, open parking lot and End meeting armed`, async ({ page }) => {
      await page.clock.setFixedTime(LIVE_TIMES.done);
      await openApp(page, "live-done", "de");
      await page.getByRole("button", { name: /^Parkplatz/ }).click();
      await page.getByRole("button", { name: "Meeting beenden" }).click();
      await expectResponsive(page);
      await expectUsable(page.getByRole("button", { name: "Weitermachen" }));
    });
  });
}

for (const size of SHORT_WINDOWS) {
  test.describe(`live view in a short window ${size.width}×${size.height}`, () => {
    test.use({ viewport: size });

    test(`nothing is cut off and every control can be reached and clicked`, async ({ page }) => {
      await page.clock.setFixedTime(LIVE_TIMES.nudge);
      await openApp(page, "live");
      await page.getByRole("button", { name: /^Parking lot/ }).click();
      await expectResponsive(page);
      await expectUsable(
        page.getByRole("button", { name: "Next ›" }),
        page.getByRole("button", { name: /^Parking lot/ }),
        page.getByRole("button", { name: "Wrap up" }),
        page.getByRole("button", { name: "End meeting" }),
      );
      // The sticky nudge never hides the end of the page: scrolled to the bottom, the overall line and
      // "End meeting" are both clear of it.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const nudge = await box(page.locator(".nudge"));
      for (const l of [page.locator(".overall"), page.getByRole("button", { name: "End meeting" })]) {
        const b = await box(l);
        const overlaps =
          b.y < nudge.y + nudge.height &&
          nudge.y < b.y + b.height &&
          b.x < nudge.x + nudge.width &&
          nudge.x < b.x + b.width;
        expect(overlaps).toBe(false);
      }
    });
  });
}
