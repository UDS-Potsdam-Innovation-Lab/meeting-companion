import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

export async function expectNoHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(client);
}

export async function expectTargetsAtLeast24px(page: Page) {
  const small = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("button, input, select, a[href]"))
      .filter((el) => el.offsetParent !== null)
      .map((el) => {
        // A visually hidden radio is operated through its label, which is the target.
        const target = el.matches('input[type="radio"]') ? el.closest("label")! : el;
        const r = target.getBoundingClientRect();
        return { what: target.outerHTML.slice(0, 80), w: r.width, h: r.height };
      })
      .filter((t) => t.w < 24 || t.h < 24),
  );
  expect(small).toEqual([]);
}

/** Presses Tab until `stop` matches (or `max` presses) and returns the names in focus order. */
export async function tabOrder(page: Page, stop: (name: string) => boolean, max = 60) {
  const order: string[] = [];
  for (let i = 0; i < max; i++) {
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
    const name = info.label || info.name;
    order.push(name);
    if (stop(name)) break;
  }
  return order;
}

/** Asserts that every expected entry occurs in `order`, in the given sequence. */
export function expectInOrder(order: string[], expected: (string | RegExp)[]) {
  const idx = (s: string | RegExp) => order.findIndex((n) => (typeof s === "string" ? n === s : s.test(n)));
  const positions = expected.map(idx);
  expect(
    positions.every((p) => p >= 0),
    `tab order: ${order.join(" | ")}`,
  ).toBe(true);
  expect(
    [...positions].sort((a, b) => a - b),
    `tab order: ${order.join(" | ")}`,
  ).toEqual(positions);
}
