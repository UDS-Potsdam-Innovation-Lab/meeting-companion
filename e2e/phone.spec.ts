import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { expectNoAxeViolations, expectNoHorizontalScroll } from "./a11y";
import { openPhone, PHONE_TOKEN } from "./helpers";

// Job 012 AC7 (and AC5's inline-free bundle): the phone page at 375×667.
type PhoneKey =
  | "phone.appName"
  | "phone.status.connected"
  | "phone.status.closed"
  | "phone.waiting.title"
  | "phone.closed.title"
  | "phone.closed.hint"
  | "phone.footer.open"
  | "phone.footer.closed";
const catalogue = (l: string) =>
  JSON.parse(readFileSync(join(process.cwd(), `src/i18n/${l}.json`), "utf8")) as Record<PhoneKey, string>;
const de = catalogue("de");
const en = catalogue("en");
test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

/** Every control (consumers add them) is at least 48×48 px; the shell itself has none. */
async function expectTargetsAtLeast48px(page: import("@playwright/test").Page) {
  const small = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]"))
      .filter((el) => el.offsetParent !== null)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { what: el.outerHTML.slice(0, 80), w: r.width, h: r.height };
      })
      .filter((t) => t.w < 48 || t.h < 48),
  );
  expect(small).toEqual([]);
}

for (const [locale, t] of [
  ["de-DE", de],
  ["en-US", en],
] as const) {
  test.describe(`phone page (${locale})`, () => {
    test.use({ locale });

    test("phone-open: Connected, the token leaves the address bar and goes only in the bearer header", async ({
      page,
    }) => {
      const auth: (string | null)[] = [];
      const urls: string[] = [];
      page.on("request", (r) => {
        urls.push(r.url());
        if (r.url().endsWith("/api/session")) auth.push(r.headers()["authorization"] ?? null);
      });
      await openPhone(page, "phone-open");
      await expect(page.getByRole("heading", { name: t["phone.waiting.title"] })).toBeVisible();
      await expect(page.getByRole("status")).toHaveText(t["phone.status.connected"]);
      await expect(page.getByText(t["phone.appName"])).toBeVisible();
      await expect(page.getByText(t["phone.footer.open"])).toBeVisible();
      expect(page.url()).not.toContain("#");
      expect(page.url()).not.toContain(PHONE_TOKEN);
      expect(auth).toEqual([`Bearer ${PHONE_TOKEN}`]);
      // The fragment is never sent: no request URL carries the token.
      expect(urls.filter((u) => u.includes(PHONE_TOKEN))).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.lang)).toBe(locale.slice(0, 2));
      await expectNoAxeViolations(page);
      await expectNoHorizontalScroll(page);
      await expectTargetsAtLeast48px(page);
    });

    test("phone-closed: This page is closed, with the hint to scan again", async ({ page }) => {
      await openPhone(page, "phone-closed");
      await expect(page.getByRole("heading", { name: t["phone.closed.title"] })).toBeVisible();
      await expect(page.getByText(t["phone.closed.hint"])).toBeVisible();
      await expect(page.getByRole("status")).toHaveText(t["phone.status.closed"]);
      await expect(page.getByText(t["phone.footer.closed"])).toBeVisible();
      await expect(page.getByRole("button")).toHaveCount(0);
      await expect(page.getByRole("link")).toHaveCount(0);
      await expectNoAxeViolations(page);
      await expectNoHorizontalScroll(page);
    });
  });
}

test.describe("phone page behaviour", () => {
  test.use({ locale: "en-US" });

  test("a network error shows the closed page", async ({ page }) => {
    await page.route("**/api/session", (route) => route.abort("connectionrefused"));
    await page.goto(`/phone/phone.html#t=${PHONE_TOKEN}`);
    await expect(page.getByRole("heading", { name: en["phone.closed.title"] })).toBeVisible();
  });

  test("without a token it asks nothing and shows the closed page", async ({ page }) => {
    let asked = false;
    await page.route("**/api/session", (route) => {
      asked = true;
      return route.fulfill({ status: 204 });
    });
    await page.goto(`/phone/phone.html`);
    await expect(page.getByRole("heading", { name: en["phone.closed.title"] })).toBeVisible();
    expect(asked).toBe(false);
  });

  test("a failed check when the page becomes visible again closes it", async ({ page }) => {
    await openPhone(page, "phone-open");
    await page.unroute("**/api/session");
    await page.route("**/api/session", (route) => route.fulfill({ status: 403 }));
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.getByRole("heading", { name: en["phone.closed.title"] })).toBeVisible();
    await expect(page.getByRole("status")).toHaveText(en["phone.status.closed"]);
  });

  test("other languages get German", async ({ browser }) => {
    const context = await browser.newContext({ locale: "fr-FR", viewport: { width: 375, height: 667 } });
    const page = await context.newPage();
    await openPhone(page, "phone-open");
    await expect(page.getByRole("heading", { name: de["phone.waiting.title"] })).toBeVisible();
    await context.close();
  });

  test("follows the phone's dark setting and stays accessible", async ({ browser }) => {
    const context = await browser.newContext({
      locale: "en-US",
      colorScheme: "dark",
      viewport: { width: 375, height: 667 },
    });
    for (const fixture of ["phone-open", "phone-closed"] as const) {
      const page = await context.newPage();
      await openPhone(page, fixture);
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
      await expectNoAxeViolations(page);
    }
    await context.close();
  });

  test("runs under the server's CSP with no inline script or style", async ({ page }) => {
    const csp =
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; " +
      "frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
    const violations: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") violations.push(m.text());
    });
    await page.route("**/phone/**", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": csp } });
    });
    await page.exposeFunction("reportViolation", (v: string) => violations.push(v));
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (e) =>
        (window as unknown as { reportViolation: (v: string) => void }).reportViolation(
          `${e.violatedDirective} ${e.blockedURI}`,
        ),
      );
    });
    await openPhone(page, "phone-open");
    await expect(page.getByRole("heading", { name: en["phone.waiting.title"] })).toBeVisible();
    // The font loaded under the CSP (no data: URL).
    expect(await page.evaluate(() => document.fonts.check('16px "Inter Variable"'))).toBe(true);
    const inline = await page.evaluate(() => ({
      scripts: [...document.scripts].filter((s) => !s.src).length,
      styles: document.querySelectorAll("style").length,
      styleAttributes: document.querySelectorAll("[style]").length,
    }));
    expect(inline).toEqual({ scripts: 0, styles: 0, styleAttributes: 0 });
    expect(violations).toEqual([]);
  });
});
