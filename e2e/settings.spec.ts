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

// Job 006, frame 14 "Settings".

const SETTINGS_FIXTURES: Fixture[] = [
  "settings",
  "settings-no-model",
  "settings-mic-test",
  "settings-recording",
  "settings-dark",
];

async function open(page: Page, fixture: Fixture) {
  await page.clock.setFixedTime(LIVE_TIMES.running);
  await openApp(page, fixture);
}

const settingsView = (page: Page) => page.locator('main[data-view="settings"]');

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

test.describe("AC2 reachable, non-modal, applies at once", () => {
  test("Ctrl+, opens the settings from setup and live; Escape returns; a change survives a reload", async ({
    page,
  }) => {
    await open(page, "filled");
    await page.keyboard.press("Control+Comma");
    await expect(settingsView(page)).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(settingsView(page)).toHaveCount(0);
    await expect(page.locator("[data-settings-button]")).toBeFocused();

    await page.keyboard.press("Enter");
    await page.getByRole("tab", { name: /General/ }).click();
    await page.getByRole("radio", { name: "Dark" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("tab", { name: /On this device/ }).click();
    await page.getByRole("radio", { name: "English", exact: true }).check();
    await page.reload();
    await page.locator('main[data-view="agenda-setup"]').waitFor();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.keyboard.press("Control+Comma");
    await page.getByRole("tab", { name: /On this device/ }).click();
    await expect(page.getByRole("radio", { name: "English", exact: true })).toBeChecked();
  });

  test("from the live view recording carries on and the REC chip stays visible", async ({ page }) => {
    await open(page, "live-transcript");
    await page.locator("[data-settings-button]").click();
    await expect(settingsView(page)).toBeVisible();
    // The live view stays mounted underneath, hidden; the visible chip is the settings view's.
    await expect(page.getByTestId("rec-chip").locator("visible=true")).toHaveText("REC00:16:48");
    await expect(page.getByRole("button", { name: "Test microphone" })).toBeDisabled();
    await expect(page.getByText("Not available while the meeting records or is paused.")).toBeVisible();
    await page.getByRole("button", { name: "Back to meeting" }).click();
    await expect(page.getByTestId("rec-chip")).toHaveText(/^REC/);
    await expect(page.locator("[data-settings-button]")).toBeFocused();
  });
});

test.describe("AC4 microphone test", () => {
  test("runs with a label and a countdown and stops on Stop test", async ({ page }) => {
    await open(page, "settings");
    await page.getByRole("button", { name: "Test microphone" }).click();
    await expect(page.getByTestId("mic-test-running")).toHaveText("Microphone test running");
    await expect(page.getByText(/^0:\d\d left$/)).toBeVisible();
    await page.getByRole("button", { name: "Stop test" }).click();
    await expect(page.getByTestId("mic-test-running")).toHaveCount(0);
    await expect(page.getByText("No test running")).toBeVisible();
  });
});

test.describe("AC3 chosen microphone missing", () => {
  test("the live view offers Use system default, which starts recording", async ({ page }) => {
    await open(page, "live-mic-missing");
    await page.getByRole("button", { name: "Resume recording" }).click();
    await expect(page.getByRole("heading", { name: "Jabra Speak 710 is not connected" })).toBeVisible();
    await page.getByRole("button", { name: "Use system default" }).click();
    await expect(page.getByTestId("rec-chip")).toContainText("REC");
  });
});

test.describe("AC3 switched to the system default", () => {
  test("the live view shows a non-blocking notice with text and an icon; recording carries on", async ({
    page,
  }) => {
    await open(page, "live-switched");
    const notice = page.getByTestId("mic-switched");
    await expect(notice).toContainText("Switched to the system microphone");
    await expect(notice).toContainText("Jabra Speak 510 stopped at");
    await expect(notice.locator("svg")).toBeVisible();
    await expect(page.getByTestId("rec-chip")).toContainText("REC");
    await expectNoAxeViolations(page);
    // Nothing blocks the meeting: the left column still works.
    await page.getByRole("button", { name: "+5 min" }).click();
    await notice.getByRole("button", { name: "Dismiss" }).click();
    await expect(notice).toHaveCount(0);
    await expect(page.getByTestId("rec-chip")).toContainText("REC");
  });
});

test.describe("AC6 theme", () => {
  test("System follows prefers-color-scheme without a reload", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await open(page, "filled");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
    expect(bg).toBe("rgb(18, 19, 23)");
  });

  test("the first paint uses the cached dark theme: no light flash", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.addInitScript(() => {
      localStorage.setItem("meeting-companion.theme", "dark");
      // The first animation frame comes before the first paint.
      requestAnimationFrame(() => {
        (window as unknown as { firstPaint: object }).firstPaint = {
          theme: document.documentElement.dataset.theme,
          bg: getComputedStyle(document.documentElement).backgroundColor,
        };
      });
    });
    await open(page, "filled");
    const first = await page.evaluate(() => (window as unknown as { firstPaint: unknown }).firstPaint);
    expect(first).toEqual({ theme: "dark", bg: "rgb(18, 19, 23)" });
  });

  // "settings-dark" stores the dark theme itself; the other two follow a dark system.
  for (const fixture of ["filled", "live-transcript", "settings-dark"] as Fixture[]) {
    test(`dark theme has no WCAG 2.2 AA violation: ${fixture}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.addInitScript(() => localStorage.setItem("meeting-companion.theme", "system"));
      await open(page, fixture);
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await expectNoAxeViolations(page);
    });
  }
});

test.describe("AC7 accessible and responsive", () => {
  const SIZES = [
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
    { width: 375, height: 812 },
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 480, height: 800 },
  ];
  for (const size of SIZES) {
    for (const fixture of SETTINGS_FIXTURES) {
      test(`${fixture} at ${size.width}×${size.height}`, async ({ page }) => {
        await page.setViewportSize(size);
        await open(page, fixture);
        await expectNoAxeViolations(page);
        await expectNoHorizontalScroll(page);
        await expectTargetsAtLeast24px(page);
        if (size.width === 1920) await expectTargetsAtLeast48px(page);
      });
    }
  }

  test("every section's controls in order, with a visible focus ring", async ({ page }) => {
    await open(page, "settings");
    // Audio is open; the tab list is one stop, the section's controls follow.
    // A radio group is one stop (its checked radio); arrow keys move within it.
    const audio = await tabOrder(page, (n) => /Stop recording and tell me/.test(n), 40);
    expectInOrder(audio, [
      "Deutsch",
      "English",
      "Settings",
      "Back to setup",
      /^Audio/,
      "Input device",
      "Test microphone",
      /Stop recording and tell me/,
    ]);
    await page.getByRole("tab", { name: /^Audio/ }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("tab", { name: /On this device/ })).toBeFocused();
    const device = await tabOrder(page, (n) => n === "Meetings and transcripts", 20);
    expectInOrder(device, [/ggml-base\.bin/, /German \+ English/, "Meetings and transcripts"]);
    await page.getByRole("tab", { name: /On this device/ }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("tab", { name: /Language model/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    const general = await tabOrder(page, (n) => /Light/.test(n), 20);
    expectInOrder(general, [/English/, /Light/]);
    await expect(
      page.getByRole("radiogroup", { name: "Theme" }).or(page.getByRole("group", { name: "Theme" })),
    ).toBeVisible();
  });
});
