import { expect, test } from "@playwright/test";
import { expectNoAxeViolations, expectNoHorizontalScroll, expectTargetsAtLeast24px } from "./a11y";
import { openApp } from "./helpers";

test.describe("AC7 accessibility at 1280×800", () => {
  test("filled agenda: no axe violations, no horizontal scroll, targets ≥ 24 px", async ({ page }) => {
    await openApp(page, "filled");
    await expectNoAxeViolations(page);
    await expectNoHorizontalScroll(page);
    await expectTargetsAtLeast24px(page);
  });

  test("open editor and validation errors: no axe violations", async ({ page }) => {
    await openApp(page, "filled");
    await page.getByRole("button", { name: /^Beta launch/ }).click();
    await page.getByLabel("Minutes").fill("500");
    await page.getByLabel("Title", { exact: true }).fill("");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Please enter a name.")).toBeVisible();
    await expectNoAxeViolations(page);
    await expectNoHorizontalScroll(page);
    await expectTargetsAtLeast24px(page);
  });

  test("over budget and store error, in German: no axe violations", async ({ page }) => {
    await openApp(page, "over", "de");
    await expect(page.getByRole("status")).toHaveText("70 von 60 Min. geplant · 10 Min. zu viel");
    await expectNoAxeViolations(page);
    await openApp(page, "corrupt", "de");
    await expect(page.getByRole("alert")).toBeVisible();
    await expectNoAxeViolations(page);
    await expectNoHorizontalScroll(page);
    await openApp(page, "locked", "de");
    await expect(page.getByRole("alert")).toContainText("Schlüsselbund");
    await expectNoAxeViolations(page);
  });

  test("every control is reachable by Tab in a logical order, with a visible focus indicator", async ({
    page,
  }) => {
    await openApp(page, "filled");
    const order: string[] = [];
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const style = getComputedStyle(el);
        return {
          name: el.getAttribute("aria-label") ?? (el.textContent?.trim() || el.outerHTML.slice(0, 80)),
          label: (el as HTMLInputElement).labels?.[0]?.textContent ?? "",
          outline: style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2,
        };
      });
      expect(info.outline, `focus indicator on ${info.name}`).toBe(true);
      order.push(info.label || info.name);
      if (info.name === "Add" || info.label === "Add") break;
    }
    const idx = (s: string | RegExp) => order.findIndex((n) => (typeof s === "string" ? n === s : s.test(n)));
    const expected = [
      "New meeting",
      "Deutsch",
      "English",
      /^Check-in & goals/,
      "Move “Check-in & goals” down",
      "Remove “Check-in & goals”",
      /^Beta launch/,
      "Add topic",
      "Title",
      "Date",
      "Start",
      "End",
      "Remove Mara Klein",
      "Add a person",
      "Add",
    ];
    const positions = expected.map(idx);
    expect(
      positions.every((p) => p >= 0),
      `tab order: ${order.join(" | ")}`,
    ).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  test("items move up and down by keyboard", async ({ page }) => {
    await openApp(page, "filled");
    await page.getByRole("button", { name: "Move “Check-in & goals” down" }).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(page.locator(".agenda-row__title").nth(2)).toHaveText("Check-in & goals");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Space");
    await expect(page.locator(".agenda-row__title").nth(1)).toHaveText("Check-in & goals");
    await expect(page.locator(".agenda-row__num")).toHaveText(["01", "02", "03", "04", "05"]);
  });

  test("an item can be edited entirely by keyboard", async ({ page }) => {
    await openApp(page, "empty");
    await page.getByRole("button", { name: "Add topic" }).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.type("Kick-off");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Everyone knows the goal");
    await page.keyboard.press("Tab"); // lead
    await page.keyboard.press("Tab"); // goal radios
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Tab"); // minutes
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("20");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /^Kick-off/ })).toBeFocused();
    const row = page.locator(".agenda-row").first();
    await expect(row).toContainText("Kick-off");
    await expect(row).toContainText("Decide");
    await expect(row).toContainText("20 min");
  });
});

test.describe("AC5 restart", () => {
  test("after a reload the last meeting is back with all fields", async ({ page }) => {
    await openApp(page, "empty");
    await page.getByLabel("Title", { exact: true }).fill("Board meeting");
    await page.getByLabel("Add a person").fill("Mara Klein");
    await page.getByLabel("Add a person").press("Enter");
    await page.getByRole("button", { name: "Add topic" }).click();
    await page.getByLabel("Topic", { exact: true }).fill("Budget");
    await page.getByLabel("Lead", { exact: true }).selectOption({ label: "Mara Klein" });
    await page.getByRole("button", { name: "Done" }).click();
    await page.reload();
    await page.locator('main[aria-busy="false"]').waitFor();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Board meeting");
    await expect(page.getByText("Mara Klein")).toBeVisible();
    await expect(page.locator(".agenda-row").first()).toContainText("Budget");
    await expect(page.getByRole("img", { name: "Lead: Mara Klein" })).toBeVisible();
  });
});

test("the page makes no network request beyond its own assets", async ({ page }) => {
  const foreign: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://localhost:4173/")) foreign.push(r.url());
  });
  await openApp(page, "filled");
  await page.getByRole("button", { name: "Add topic" }).click();
  expect(foreign).toEqual([]);
});
