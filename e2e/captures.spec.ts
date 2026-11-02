import { expect, test, type Page } from "@playwright/test";
import { FREE_TIMES, LIVE_TIMES } from "../src/features/agenda/fixtures";
import { expectInOrder, expectNoAxeViolations, expectNoHorizontalScroll, tabOrder } from "./a11y";
import { openApp, type Fixture } from "./helpers";

// Job 018: quick capture in the right column of frames 02 and 16 (frames 21), against the browser
// build with the mock core.

async function openAt(
  page: Page,
  fixture: Fixture,
  opts: { locale?: "de" | "en"; theme?: "light" | "dark"; time?: number } = {},
) {
  await page.clock.install({
    time: opts.time ?? (fixture.includes("free") ? FREE_TIMES.running : LIVE_TIMES.running),
  });
  await openApp(page, fixture, opts.locale ?? "en", opts.theme ?? "light");
  await page.locator(".composer").waitFor();
}

const column = (page: Page) => page.getByTestId("captures-column");
const composer = (page: Page) => page.getByRole("form", { name: /^(Quick capture|Schnell festhalten)$/ });
const field = (page: Page) => composer(page).getByRole("textbox");
const notice = (page: Page) => page.getByTestId("undo-notice");

/** Opens the inline editor of the first to-do (fixture `live-captures-edit`). */
async function openEditor(page: Page) {
  await column(page)
    .getByRole("button", { name: /^To-dos/ })
    .click();
  await column(page)
    .getByRole("button", { name: /^Edit: Send the feedback form/ })
    .click();
  await page.locator(".capture-editor").waitFor();
}

/** A refused save (fixture `live-captures-error`: the mock core cannot write). */
async function failSave(page: Page) {
  await field(page).fill("Ask the district office");
  await field(page).press("Enter");
  await composer(page).locator(".capture-error").waitFor();
}

const STATES: { fixture: Fixture; act?: (page: Page) => Promise<void> }[] = [
  { fixture: "live-captures" },
  { fixture: "live-captures-empty" },
  { fixture: "live-captures-edit", act: openEditor },
  { fixture: "live-captures-error", act: failSave },
  { fixture: "live-free-captures" },
];

test.describe("AC5 axe reports no violations for the column, light and dark", () => {
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

test("AC1 + AC3 a capture survives a reload; edit, delete and Undo follow the stored file", async ({
  page,
}) => {
  await openAt(page, "live-captures-empty");
  await expect(column(page)).toContainText("Nothing captured yet");
  await field(page).click();
  await page.keyboard.type("/t Write to the third pilot school");
  await composer(page).getByRole("group", { name: "Who" }).getByRole("button", { name: "Yusuf" }).click();
  await field(page).press("Enter");
  await expect(column(page).getByText("just saved")).toBeVisible();
  await expect(field(page)).toBeFocused();
  await expect(field(page)).toHaveValue("");
  await expect(notice(page)).toContainText("To-do saved · Item 02");
  await expect(column(page).getByRole("button", { name: /^To-dos/ })).toContainText("1");
  await expect(page.locator(".live-row--now")).toContainText("1 to-do");

  await page.reload();
  await page.locator(".composer").waitFor();
  await column(page)
    .getByRole("button", { name: /^To-dos/ })
    .click();
  const card = column(page).locator("article", { hasText: "Write to the third pilot school" });
  await expect(card).toContainText("Yusuf Aydin");

  // Edit inline, Esc cancels, Save writes.
  await card.getByRole("button", { name: /^Edit:/ }).click();
  const editor = page.locator(".capture-editor");
  await editor.getByRole("textbox").fill("changed");
  await page.keyboard.press("Escape");
  await expect(card).toContainText("Write to the third pilot school");
  await card.getByRole("button", { name: /^Edit:/ }).click();
  await editor.getByRole("textbox").fill("Write to the third pilot school today");
  await editor.getByRole("textbox").press("Enter");
  await expect(column(page).getByText("Write to the third pilot school today")).toBeVisible();

  // Delete, then Undo within 8 s; a second delete stays after the notice is gone.
  await column(page)
    .getByRole("button", { name: /^Edit:/ })
    .click();
  await editor.getByRole("button", { name: "Delete" }).click();
  await expect(column(page).locator("article")).toHaveCount(0);
  await expect(notice(page)).toContainText("To-do deleted");
  await page.clock.runFor(7_000);
  await notice(page).getByRole("button", { name: "Undo" }).click();
  await expect(column(page).getByText("Write to the third pilot school today")).toBeVisible();
  await column(page)
    .getByRole("button", { name: /^Edit:/ })
    .click();
  await editor.getByRole("button", { name: "Delete" }).click();
  await page.clock.runFor(8_500);
  await expect(notice(page)).toHaveCount(0);
  await page.reload();
  await page.locator(".composer").waitFor();
  await expect(column(page).getByRole("button", { name: /^To-dos/ })).toContainText("0");
});

test("AC2 a refused save shows the reason next to the field and keeps the text", async ({ page }) => {
  await openAt(page, "live-captures-error");
  await failSave(page);
  await expect(composer(page).locator(".capture-error")).toHaveText(
    "Not saved: the meeting could not be written on this device. Try again.",
  );
  await expect(field(page)).toHaveValue("Ask the district office");
  await expect(field(page)).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("AC4 markup in a capture is shown as text and nothing leaves the device", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await openAt(page, "live-captures-empty");
  const text = '<img src=x onerror="window.pwned=1"><b>bold</b>';
  await field(page).fill(text);
  await field(page).press("Enter");
  await expect(column(page).getByText(text)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { pwned?: number }).pwned)).toBeUndefined();
  await expect(column(page).locator("article img, article b")).toHaveCount(0);
  const origin = new URL(page.url()).origin;
  expect(requests.filter((u) => new URL(u).origin !== origin)).toEqual([]);
});

test("AC5 the keyboard reaches tabs, cards, the notice and the composer with a visible focus", async ({
  page,
}) => {
  await openAt(page, "live-captures");
  await field(page).fill("Pilot schools get the notes in German");
  await field(page).press("Enter");
  await notice(page).waitFor();
  await page.locator(".capture-tabs__tab").first().focus();
  const order = await tabOrder(page, (n) => n === "Save");
  expectInOrder(order, [
    /^Questions/,
    /^Edit: Pilot schools get the notes in German/,
    /^Edit: Pilot check-ins/,
    "Undo",
    "Decision",
    "To-do",
    "Question",
    "Note a decision …",
    "Save",
  ]);
});

test("AC5 a kind is one tap and Enter saves; the board has 48 px targets", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openAt(page, "live-captures");
  await composer(page).getByRole("button", { name: "To-do" }).click();
  await expect(column(page).getByRole("button", { name: /^To-dos/ })).toHaveAttribute("aria-pressed", "true");
  await openEditor(page);
  await expect(page.locator(".capture-editor")).toBeVisible();
  const small = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="captures-column"] button, [data-testid="captures-column"] input, [data-testid="captures-column"] textarea',
      ),
    )
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({
        what: el.textContent?.trim() || el.getAttribute("aria-label"),
        r: el.getBoundingClientRect(),
      }))
      .filter(({ r }) => r.width < 48 || r.height < 48)
      .map(({ what, r }) => `${what}: ${Math.round(r.width)}×${Math.round(r.height)}`),
  );
  expect(small).toEqual([]);
});

test.describe("AC5 the column lays out without overlap (frames 21)", () => {
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
  ]) {
    test(`three columns at ${size.width}×${size.height}`, async ({ page }) => {
      await page.setViewportSize(size);
      await openAt(page, "live-captures");
      await expectNoHorizontalScroll(page);
      const right = (await column(page).boundingBox())!;
      const centre = (await page.locator(".transcript-card").boundingBox())!;
      expect(right.x).toBeGreaterThanOrEqual(centre.x + centre.width);
      expect(right.x + right.width).toBeLessThanOrEqual(size.width);
      // Tabs on top, list in between, composer at the bottom; nothing overlaps.
      const tabs = (await column(page).locator(".capture-tabs").boundingBox())!;
      const list = (await column(page).locator(".capture-list").boundingBox())!;
      const form = (await composer(page).boundingBox())!;
      expect(tabs.y + tabs.height).toBeLessThanOrEqual(list.y);
      expect(list.y + list.height).toBeLessThanOrEqual(form.y);
      expect(form.y + form.height).toBeLessThanOrEqual(right.y + right.height + 1);
    });
  }

  for (const size of [
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 375, height: 812 },
  ]) {
    test(`the centre card's second tab at ${size.width}×${size.height}`, async ({ page }) => {
      await page.setViewportSize(size);
      await openAt(page, "live-captures", { locale: "de" });
      const tab = page.getByRole("button", { name: /^Festgehalten/ });
      await expect(tab).toContainText("3");
      await tab.click();
      await expect(tab).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".transcript-card__body")).toBeHidden();
      await expect(column(page).getByText("Pilot check-ins are on Thursdays from now on")).toBeVisible();
      await expectNoHorizontalScroll(page);
      // The composer sticks to the bottom of the window.
      const form = (await composer(page).boundingBox())!;
      expect(form.y + form.height).toBeLessThanOrEqual(size.height);
      expect(form.x).toBeGreaterThanOrEqual(0);
      expect(form.x + form.width).toBeLessThanOrEqual(size.width);
      await field(page).fill("Termin am 14.");
      await field(page).press("Enter");
      await expect(column(page).getByText("Termin am 14.")).toBeVisible();
      await expect(tab).toContainText("4");
      await expectNoAxeViolations(page);
    });
  }
});

test("agenda-free: captures go to the running topic; counts show in Topics so far", async ({ page }) => {
  await openAt(page, "live-free-captures");
  await expect(composer(page)).toContainText("Interview recruiting");
  await field(page).fill("First round remote");
  await field(page).press("Enter");
  await expect(
    column(page).getByRole("heading", { name: "Talking now · Interview recruiting" }),
  ).toBeVisible();
  const topics = page.getByRole("region", { name: "Topics so far" });
  await expect(topics.getByRole("button", { name: /Interview recruiting/ })).toContainText("1 decision");
  await expect(column(page).getByRole("heading", { name: "No topic" })).toBeVisible();
});

test.describe("round 2 (UI review): nothing hides the editor or the list", () => {
  /** In the window, and the element at its centre is itself (nothing sticky covers it). */
  async function expectUncovered(page: Page, locator: ReturnType<Page["locator"]>) {
    await expect(locator).toBeVisible();
    const b = (await locator.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height).toBeLessThanOrEqual(vp.height);
    const hit = await locator.evaluate(
      (el, p) => {
        const at = document.elementFromPoint(p.x, p.y);
        return !!at && (el === at || el.contains(at));
      },
      { x: b.x + b.width / 2, y: b.y + b.height / 2 },
    );
    expect(hit, "covered by another element").toBe(true);
  }

  test("1280×800: the composer rests as one line while a card is edited; Delete, Cancel and Save are in view", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openAt(page, "live-captures-edit", { locale: "de" });
    await column(page)
      .getByRole("button", { name: /^Aufgaben/ })
      .click();
    await column(page).locator("[data-edit]").last().click();
    const editor = page.locator(".capture-editor");
    await editor.waitFor();
    await expect(composer(page)).toHaveAttribute("data-open", "false");
    for (const name of ["Löschen", "Abbrechen", "Speichern"]) {
      await expectUncovered(page, editor.getByRole("button", { name, exact: true }));
    }
    // The editor's buttons sit above the composer, not under it.
    const actions = (await editor.locator(".capture-editor__actions").boundingBox())!;
    const form = (await composer(page).boundingBox())!;
    expect(actions.y + actions.height).toBeLessThanOrEqual(form.y);
  });

  for (const time of [LIVE_TIMES.running, LIVE_TIMES.over]) {
    test(`375×812${time === LIVE_TIMES.over ? " with the time-up nudge" : ""}: "Festgehalten" shows the list above the composer`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await openAt(page, "live-captures", { locale: "de", time });
      await page.getByRole("button", { name: /^Festgehalten/ }).click();
      await expect(composer(page)).toHaveAttribute("data-open", "false");
      const tabs = column(page).locator(".capture-tabs");
      await expectUncovered(page, tabs);
      const card = column(page).locator("article").first();
      await expectUncovered(page, card.locator(".capture-card__text"));
      const form = (await composer(page).boundingBox())!;
      const cardBox = (await card.boundingBox())!;
      expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(form.y);
      // The list scrolls on its own: the last card comes into view inside it.
      await column(page)
        .getByRole("button", { name: /^Aufgaben/ })
        .click();
      const last = column(page).locator("article").last();
      await last.scrollIntoViewIfNeeded();
      await expectUncovered(page, last.locator(".capture-card__text"));
    });
  }
});
