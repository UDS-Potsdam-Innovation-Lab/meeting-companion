import { expect, test, type Page } from "@playwright/test";
import {
  expectInOrder,
  expectNoAxeViolations,
  expectNoHorizontalScroll,
  expectTargetsAtLeast24px,
  tabOrder,
} from "./a11y";
import { openApp, type Fixture } from "./helpers";

// Job 011, frame 17 "Language model".

const FIXTURES: Fixture[] = [
  "settings-llm-off",
  "settings-llm-local",
  "settings-llm-none-found",
  "settings-llm-claude",
  "settings-llm-claude-nokey",
  "settings-llm-error",
];

// 1280×800, the board, 375 px and the sizes of e2e/responsive.spec.ts.
const SIZES = [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 480, height: 800 },
];

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

test.describe("AC5 accessible and responsive in light and dark", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const size of SIZES) {
      for (const fixture of FIXTURES) {
        test(`${fixture} at ${size.width}×${size.height}, ${theme}`, async ({ page }) => {
          await page.setViewportSize(size);
          await openApp(page, fixture, "en", theme);
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
          await expectNoAxeViolations(page);
          await expectNoHorizontalScroll(page);
          await expectTargetsAtLeast24px(page);
          if (size.width === 1920) await expectTargetsAtLeast48px(page);
        });
      }
    }
  }
});

test.describe("AC5 keyboard only", () => {
  test("choose Claude, confirm, save a key and test, without a mouse", async ({ page }) => {
    await openApp(page, "settings-llm-off");
    const off = page.getByRole("radio", { name: /^Off/ });
    await expect(off).toBeChecked();
    // From the section's tab, the first stop is the engine group (one stop, its checked radio).
    await expect(page.getByRole("tab", { name: /^Language model/ })).toBeFocused();
    const order = await tabOrder(page, (n) => /Off/.test(n), 20);
    expectInOrder(order, [/^Off/]);
    expect(order).toHaveLength(1);
    await expect(off).toBeFocused();
    // Arrow keys move through the group: On this device applies the first model found at once.
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio", { name: /^On this device/ })).toBeChecked();
    await expect(page.getByRole("region", { name: "Model on this device" })).toBeVisible();
    // Claude waits for the confirmation; focus stays on the radio.
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio", { name: /^Claude API/ })).toBeFocused();
    await expect(page.getByTestId("llm-confirm")).toContainText("Anthropic, api.anthropic.com, USA");
    await expect(page.getByRole("radio", { name: /^On this device/ })).toBeChecked();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Use Claude API" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("radio", { name: /^Claude API/ })).toBeChecked();
    await expect(page.getByTestId("llm-destination-line")).toContainText("api.anthropic.com");
    // Model, then the key field.
    const model = page.getByRole("combobox", { name: "Model" });
    await model.focus();
    await page.keyboard.press("Tab");
    const field = page.getByRole("textbox", { name: "Claude API key" });
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute("type", "password");
    await page.keyboard.type("FAKE-TOKEN-for-tests-only");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("key-status")).toHaveText("Key saved");
    await expect(field).toHaveCount(0);
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
    expect(stored).not.toContain("FAKE-TOKEN-for-tests-only");
    await page.getByRole("button", { name: "Test" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("llm-reply")).toContainText("Reply received");
    await page.keyboard.press("Escape");
    await expect(page.locator('main[data-view="settings"]')).toHaveCount(0);
  });

  test("Cancel in the confirmation keeps the setting and returns focus to the radio", async ({ page }) => {
    await openApp(page, "settings-llm-off");
    await page.getByRole("radio", { name: /^Claude API/ }).focus();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("llm-confirm")).toBeVisible();
    await page.getByTestId("llm-confirm").getByRole("button", { name: "Cancel" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("llm-confirm")).toHaveCount(0);
    await expect(page.getByRole("radio", { name: /^Off/ })).toBeChecked();
    await expect(page.getByRole("radio", { name: /^Claude API/ })).toBeFocused();
    await page.reload();
    await page.locator('main[data-view="agenda-setup"]').waitFor();
    const stored = await page.evaluate(() => localStorage.getItem("mock-backend.settings"));
    expect(JSON.parse(stored!).languageModel).toBe("none");
  });
});

test.describe("AC6 the Test can be cancelled and blocks nothing", () => {
  test("Cancel test answers within a second; the rest of the settings work meanwhile", async ({ page }) => {
    await openApp(page, "settings-llm-local");
    await expect(page.getByTestId("llm-waiting")).toContainText(
      "Waiting for Qwen2.5-3B-Instruct-Q4_K_M.gguf",
    );
    // Another model can be picked while waiting: the test of the old one ends.
    const started = Date.now();
    await page.getByRole("button", { name: "Cancel test" }).click();
    await expect(page.getByTestId("llm-error")).toContainText("Cancelled");
    expect(Date.now() - started).toBeLessThan(1_000);
    await page.getByRole("button", { name: "Test again" }).click();
    await page.getByRole("tab", { name: /General/ }).click();
    await page.getByRole("radio", { name: "Dark" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});
