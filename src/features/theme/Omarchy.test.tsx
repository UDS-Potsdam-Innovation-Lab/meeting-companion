// Job 020 AC5 (the setting decides who wins), AC2 (only hex reaches the DOM), AC3 (live switch in the
// UI) and AC6 (the cache and the boot script).
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emit } from "@tauri-apps/api/event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EVENT_OMARCHY_THEME } from "../../lib/ipc";
import { renderApp, type FakeRecording } from "../../test/backend";
import { filledMeeting } from "../agenda/fixtures";
import { THEME_STORAGE_KEY } from "../settings/theme";
import { OMARCHY_STORAGE_KEY, setOmarchyTokens, toApplied } from "./apply";
import { OMARCHY_FIXTURES } from "./fixtures";
import { TOKEN_NAMES, TOKEN_VALUE, type OmarchyTheme } from "./omarchy";

const TOKYO = OMARCHY_FIXTURES["tokyo-night"];
const LATTE = OMARCHY_FIXTURES["catppuccin-latte"];
const root = () => document.documentElement;
const inline = (name: string) => root().style.getPropertyValue(name);
/** Every inline property on <html> as `name: value`. */
const inlineAll = () => Array.from(root().style).map((n) => [n, root().style.getPropertyValue(n)] as const);
const settingsButton = () =>
  screen.getAllByRole("button", { name: /^(Settings|Einstellungen)$/ }).find((b) => !b.closest("[hidden]"))!;

beforeEach(() => {
  localStorage.setItem("meeting-companion.locale", "en");
});
afterEach(() => {
  setOmarchyTokens(null);
  root().removeAttribute("style");
  delete root().dataset.theme;
});

async function setup(rec: FakeRecording = {}) {
  return renderApp(
    { meeting: filledMeeting(), error: null },
    { recording: { ...rec, settings: { locale: "en", ...rec.settings } } },
  );
}

async function openTheme(user: ReturnType<typeof userEvent.setup>) {
  await user.click(settingsButton());
  await user.click(screen.getByRole("tab", { name: /General|Allgemein/ }));
}

describe("AC5 the setting decides who wins", () => {
  it("System with a palette applies the Omarchy tokens and names the theme (en)", async () => {
    const user = userEvent.setup();
    await setup({ omarchy: TOKYO, settings: { theme: "system" } });
    await waitFor(() => expect(inline("--bg")).toBe("#1a1b26"));
    expect(root().dataset.theme).toBe("dark");
    const tokens = toApplied(TOKYO)!.tokens;
    for (const name of TOKEN_NAMES) expect(inline(name), name).toBe(tokens[name]);
    // Colours only (spec review 1): the font stays the app's own.
    expect(inline("font-family")).toBe("");
    expect(inline("--font-ui")).toBe("");
    await openTheme(user);
    const hint = screen.getByText("Follows Omarchy · now Tokyo Night");
    expect(hint).toBeVisible();
    expect(hint.children).toHaveLength(0);
  });

  it("names the theme in German", async () => {
    localStorage.setItem("meeting-companion.locale", "de");
    const user = userEvent.setup();
    await renderApp(
      { meeting: filledMeeting(), error: null },
      { recording: { omarchy: TOKYO, settings: { locale: "de", theme: "system" } } },
    );
    await openTheme(user);
    expect(screen.getByText("Folgt Omarchy · jetzt Tokyo Night")).toBeVisible();
  });

  it("Light and Dark remove every inline token in the same step; System brings them back", async () => {
    const user = userEvent.setup();
    await setup({ omarchy: TOKYO, settings: { theme: "system" } });
    await waitFor(() => expect(inline("--bg")).toBe("#1a1b26"));
    await openTheme(user);

    await user.click(screen.getByRole("radio", { name: /Light/ }));
    expect(inlineAll()).toEqual([]);
    expect(root().dataset.theme).toBe("light");

    await user.click(screen.getByRole("radio", { name: /Dark/ }));
    expect(inlineAll()).toEqual([]);
    expect(root().dataset.theme).toBe("dark");

    await user.click(screen.getByRole("radio", { name: /System/ }));
    expect(inline("--bg")).toBe("#1a1b26");
    expect(inlineAll()).toHaveLength(TOKEN_NAMES.length);
    expect(root().dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
  });

  it("System without a palette behaves as before (prefers-color-scheme), with no inline token", async () => {
    const user = userEvent.setup();
    await setup({ omarchy: null, settings: { theme: "system" } });
    await waitFor(() => expect(root().dataset.theme).toBe("light"));
    expect(inlineAll()).toEqual([]);
    await openTheme(user);
    expect(screen.getByText("Follows the system · now light")).toBeVisible();
    expect(screen.queryByText(/Omarchy/)).toBeNull();
  });

  it("a stored Light setting keeps the app's tokens even with a palette", async () => {
    await setup({ omarchy: TOKYO, settings: { theme: "light" } });
    await waitFor(() => expect(root().dataset.theme).toBe("light"));
    expect(inlineAll()).toEqual([]);
  });
});

describe("AC3 a switch arrives without a reload", () => {
  it("follows the omarchy-theme event, and falls back on null", async () => {
    await setup({ omarchy: TOKYO, settings: { theme: "system" } });
    await waitFor(() => expect(inline("--bg")).toBe("#1a1b26"));
    await act(() => emit(EVENT_OMARCHY_THEME, LATTE));
    await waitFor(() => expect(inline("--bg")).toBe("#eff1f5"));
    expect(root().dataset.theme).toBe("light");
    expect(JSON.parse(localStorage.getItem(OMARCHY_STORAGE_KEY)!).tokens["--bg"]).toBe("#eff1f5");

    await act(() => emit(EVENT_OMARCHY_THEME, null));
    await waitFor(() => expect(inlineAll()).toEqual([]));
    expect(localStorage.getItem(OMARCHY_STORAGE_KEY)).toBeNull();
  });
});

describe("AC2 nothing but hex colours reaches <html>", () => {
  const onlyHex = () => {
    const all = inlineAll();
    expect(all.length).toBeGreaterThan(0);
    for (const [name, value] of all) {
      expect(TOKEN_NAMES as readonly string[], name).toContain(name);
      expect(value, name).toMatch(TOKEN_VALUE);
    }
    expect(root().getAttribute("style") ?? "").not.toMatch(/url|var\(|expression|script|rgb/i);
  };

  it("a palette with junk values from the core", async () => {
    await setup({ omarchy: OMARCHY_FIXTURES.junk, settings: { theme: "system" } });
    await waitFor(() => expect(inline("--bg")).toBe("#1a1b26"));
    onlyHex();
  });

  it("junk sent as a switch, including unknown keys and non-string values", async () => {
    await setup({ omarchy: TOKYO, settings: { theme: "system" } });
    await waitFor(() => expect(inline("--bg")).toBe("#1a1b26"));
    const evil = {
      name: "<img src=x onerror=alert(1)>",
      mode: "dark",
      palette: {
        background: "#101010",
        foreground: "#f0f0f0",
        accent: "#fff; background: url(http://x)",
        red: { toString: () => "#ff0000" },
        "--bg": "#ff0000",
        __proto__: { green: "#00ff00" },
      },
    } as unknown as OmarchyTheme;
    await act(() => emit(EVENT_OMARCHY_THEME, evil));
    await waitFor(() => expect(inline("--bg")).toBe("#101010"));
    onlyHex();
    const user = userEvent.setup();
    await openTheme(user);
    // An invalid name is not shown at all.
    expect(screen.getByText("Follows Omarchy")).toBeVisible();
    expect(document.querySelector("img")).toBeNull();
  });

  it("a palette without background and foreground keeps the app's own tokens", async () => {
    await setup({
      omarchy: { name: "x", mode: "dark", palette: { accent: "#ff0000" } },
      settings: { theme: "system" },
    });
    await waitFor(() => expect(root().dataset.theme).toBe("light"));
    expect(inlineAll()).toEqual([]);
  });
});

describe("AC6 the token cache and the boot script", () => {
  const boot = readFileSync(join(__dirname, "../../../public/theme-boot.js"), "utf8");
  const runBoot = () => new Function(boot)();
  const cache = (value: unknown) => localStorage.setItem(OMARCHY_STORAGE_KEY, JSON.stringify(value));

  it("knows exactly the mapping's token names", () => {
    const list = /var TOKENS = \[([\s\S]*?)\];/.exec(boot)![1]!;
    expect([...list.matchAll(/"([^"]+)"/g)].map((m) => m[1])).toEqual([...TOKEN_NAMES]);
  });

  it("with System and a cached map, sets the tokens and data-theme before React", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "system");
    cache({ mode: "dark", tokens: toApplied(TOKYO)!.tokens });
    runBoot();
    expect(inline("--bg")).toBe("#1a1b26");
    expect(root().dataset.theme).toBe("dark");
    expect(inlineAll()).toHaveLength(TOKEN_NAMES.length);
  });

  it("ignores entries with unknown names or values that are not hex", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "system");
    cache({
      mode: "light",
      tokens: {
        "--bg": "#eff1f5",
        "--ink": "red; background: url(http://x)",
        "--accent": "var(--x)",
        "--surface": 12,
        "--font-ui": "#ffffff",
        "background-image": "#ffffff",
        "--muted": "#12345",
      },
    });
    runBoot();
    expect(inlineAll()).toEqual([["--bg", "#eff1f5"]]);
    expect(root().dataset.theme).toBe("light");
  });

  it.each([
    ["not JSON", "{oops"],
    ["no mode", JSON.stringify({ tokens: { "--bg": "#000000" } })],
    ["a wrong mode", JSON.stringify({ mode: "url(x)", tokens: { "--bg": "#000000" } })],
    ["no valid token", JSON.stringify({ mode: "dark", tokens: { "--bg": "black" } })],
    ["tokens not an object", JSON.stringify({ mode: "dark", tokens: "#000000" })],
  ])("falls back to the system with %s", (_what, raw) => {
    localStorage.setItem(THEME_STORAGE_KEY, "system");
    localStorage.setItem(OMARCHY_STORAGE_KEY, raw);
    runBoot();
    expect(inlineAll()).toEqual([]);
    expect(root().dataset.theme).toBe("light");
  });

  it("with Light or Dark, the cache is not applied", () => {
    cache({ mode: "dark", tokens: toApplied(TOKYO)!.tokens });
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    runBoot();
    expect(inlineAll()).toEqual([]);
    expect(root().dataset.theme).toBe("light");
  });

  it("the app keeps the cached map until the core answers, then replaces it", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "system");
    cache({ mode: "dark", tokens: toApplied(TOKYO)!.tokens });
    runBoot();
    await setup({ omarchy: LATTE });
    await waitFor(() => expect(inline("--bg")).toBe("#eff1f5"));
    expect(JSON.parse(localStorage.getItem(OMARCHY_STORAGE_KEY)!)).toEqual({
      mode: "light",
      tokens: toApplied(LATTE)!.tokens,
    });
  });

  it("the cache is cleared when the core reports no theme", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "system");
    cache({ mode: "dark", tokens: toApplied(TOKYO)!.tokens });
    await setup({ omarchy: null });
    await waitFor(() => expect(localStorage.getItem(OMARCHY_STORAGE_KEY)).toBeNull());
    expect(inlineAll()).toEqual([]);
  });

  it("caches colours and the mode only", async () => {
    await setup({ omarchy: TOKYO, settings: { theme: "system" } });
    await waitFor(() => expect(localStorage.getItem(OMARCHY_STORAGE_KEY)).not.toBeNull());
    const cached = JSON.parse(localStorage.getItem(OMARCHY_STORAGE_KEY)!);
    expect(Object.keys(cached).sort()).toEqual(["mode", "tokens"]);
    expect(Object.values(cached.tokens).every((v) => TOKEN_VALUE.test(v as string))).toBe(true);
  });
});
