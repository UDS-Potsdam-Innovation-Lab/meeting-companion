// Job 020 AC4 (and the UI half of AC2): the Omarchy mapping covers the whole token set, keeps WCAG 2.2
// AA, keeps the four meanings apart by hue, and lets nothing but hex colours through.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OMARCHY_FIXTURES } from "./fixtures";
import {
  contrast,
  hueDistance,
  MIN_HUE_DISTANCE,
  omarchyTokens,
  themeDisplayName,
  TOKEN_NAMES,
  TOKEN_VALUE,
  type OmarchyTheme,
  type OmarchyTokens,
  type TokenName,
} from "./omarchy";

// The colour tokens of the `:root` block, read the way src/styles.test.ts reads them.
const css = readFileSync(join(__dirname, "../../styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const start = css.indexOf(":root {");
const rootBlock = css.slice(start, css.indexOf("}", start) + 1);
const colourTokens = [...rootBlock.matchAll(/(--[\w-]+):\s*([^;]+);/g)]
  .filter(([, , v]) => /#[0-9a-fA-F]{3,8}\b/.test(v!))
  .map(([, k]) => k!);
/** Not single colours but shadow lists: they follow `data-theme` from the token blocks. */
const SHADOWS = ["--shadow", "--shadow-small"];

const FIXTURES = Object.entries(OMARCHY_FIXTURES) as [string, OmarchyTheme][];
const map = (theme: OmarchyTheme): OmarchyTokens => {
  const tokens = omarchyTokens(theme);
  expect(tokens).not.toBeNull();
  return tokens!;
};

const TEXT_TOKENS: TokenName[] = [
  "--ink",
  "--ink-2",
  "--muted",
  "--accent-ink",
  "--teal-ink",
  "--amber-ink",
  "--green-ink",
  "--warn-ink",
  "--overrun-ink",
];
/** Tokens the stylesheet also uses as text colour (`color: var(--accent)` and the like). */
const ALSO_TEXT: TokenName[] = ["--accent", "--green", "--overrun"];
const SOFT: Partial<Record<TokenName, TokenName>> = {
  "--accent-ink": "--accent-soft",
  "--teal-ink": "--teal-soft",
  "--amber-ink": "--amber-soft",
  "--green-ink": "--green-soft",
  "--warn-ink": "--warn-soft",
  "--overrun-ink": "--overrun-soft",
};

describe("AC4 the mapping covers the token set", () => {
  it("names exactly the colour tokens of the :root block (except --preview-* and the shadows)", () => {
    const expected = colourTokens.filter((k) => !k.startsWith("--preview-") && !SHADOWS.includes(k));
    expect([...TOKEN_NAMES].sort()).toEqual([...expected].sort());
  });

  it.each(FIXTURES.map(([n]) => n))("%s gives every token a hex value", (name) => {
    const tokens = map(OMARCHY_FIXTURES[name as keyof typeof OMARCHY_FIXTURES]);
    for (const k of TOKEN_NAMES) expect(tokens[k], k).toMatch(TOKEN_VALUE);
    expect(Object.keys(tokens).sort()).toEqual([...TOKEN_NAMES].sort());
  });
});

describe.each(FIXTURES)("AC4 WCAG 2.2 AA with %s", (_name, theme) => {
  const t = map(theme);
  const ratio = (a: TokenName, b: TokenName) => contrast(t[a], t[b]);

  it("text tokens reach 4.5:1 on --bg, --surface, --sunken and their own soft tint", () => {
    for (const k of [...TEXT_TOKENS, ...ALSO_TEXT]) {
      for (const g of ["--bg", "--surface", "--sunken"] as const)
        expect(ratio(k, g), `${k} on ${g}`).toBeGreaterThanOrEqual(4.5);
      const soft = SOFT[k];
      if (soft) expect(ratio(k, soft), `${k} on ${soft}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("--on-accent reaches 4.5:1 on --accent, --on-ink on --ink and --overrun", () => {
    expect(ratio("--on-accent", "--accent")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("--on-ink", "--ink")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("--on-ink", "--overrun")).toBeGreaterThanOrEqual(4.5);
  });

  it("--line-strong and the focus ring (--accent) reach 3:1 on --surface", () => {
    expect(ratio("--line-strong", "--surface")).toBeGreaterThanOrEqual(3);
    expect(ratio("--accent", "--surface")).toBeGreaterThanOrEqual(3);
  });

  it("the dark cards keep their text readable", () => {
    for (const k of [
      "--dark-ink",
      "--dark-muted",
      "--dark-strong",
      "--dark-amber",
      "--dark-overrun",
    ] as const)
      for (const g of ["--dark", "--dark-3"] as const)
        expect(ratio(k, g), `${k} on ${g}`).toBeGreaterThanOrEqual(4.5);
    expect(ratio("--warn-soft", "--warn-line")).toBeGreaterThanOrEqual(4.5);
  });

  it("decisions, to-dos, questions and overrun differ pairwise by hue", () => {
    const groups: TokenName[][] = [
      ["--green-ink", "--amber-ink", "--accent-ink", "--overrun-ink"],
      ["--green", "--warn-line", "--accent", "--overrun"],
      ["--dark-amber", "--dark-accent", "--dark-overrun"],
    ];
    for (const group of groups)
      for (const a of group)
        for (const b of group)
          if (a < b)
            expect(hueDistance(t[a], t[b]), `${a} ${t[a]} vs ${b} ${t[b]}`).toBeGreaterThanOrEqual(
              MIN_HUE_DISTANCE - 5,
            );
  });
});

describe("AC4 the mapping follows the palette", () => {
  it("takes the base colours from the palette when they already pass", () => {
    const t = map(OMARCHY_FIXTURES["tokyo-night"]);
    expect(t["--bg"]).toBe("#1a1b26");
    expect(t["--surface"]).toBe("#24283b");
    expect(hueDistance(t["--accent"], "#7aa2f7")).toBeLessThan(2);
    expect(t["--green"]).toBe("#9ece6a");
    // Lightened a little for 4.5:1 on --sunken, same hue.
    expect(hueDistance(t["--overrun"], "#f7768e")).toBeLessThan(2);
    const latte = map(OMARCHY_FIXTURES["catppuccin-latte"]);
    expect(latte["--bg"]).toBe("#eff1f5");
    expect(latte["--ink"]).toBe("#4c4f69");
  });

  it("an accent too close in hue to red or yellow gives way to the palette's blue", () => {
    // fwu-dark: orange accent #e96429 between red #f55050 and yellow #f2b84b.
    const t = map(OMARCHY_FIXTURES["fwu-dark"]);
    expect(hueDistance(t["--accent"], "#6a9cf0")).toBeLessThan(2);
  });

  it("a low-contrast palette is pushed apart until every pair passes", () => {
    const t = map(OMARCHY_FIXTURES["low-contrast"]);
    expect(contrast(t["--ink"], t["--bg"])).toBeGreaterThanOrEqual(4.5);
    expect(t["--ink"]).not.toBe("#6a6e78");
  });

  it("needs a background and a foreground", () => {
    expect(omarchyTokens({ name: "x", mode: "dark", palette: { background: "#000000" } })).toBeNull();
    expect(omarchyTokens({ name: "x", mode: "dark", palette: { foreground: "#ffffff" } })).toBeNull();
    expect(
      omarchyTokens({ name: "x", mode: "dark", palette: { background: "url(x)", foreground: "#ffffff" } }),
    ).toBeNull();
    expect(omarchyTokens({ name: "x", mode: "dark", palette: null } as unknown as OmarchyTheme)).toBeNull();
  });
});

describe("AC2 the UI rejects every value that is not a hex colour", () => {
  it("the junk palette's non-hex values are ignored key by key; only hex comes out", () => {
    const junk = OMARCHY_FIXTURES.junk;
    const t = map(junk);
    for (const k of TOKEN_NAMES) expect(t[k], k).toMatch(TOKEN_VALUE);
    const all = Object.values(t).join(" ");
    for (const bad of ["url", "var(", "expression", "script", ";", "}", "rgb"])
      expect(all).not.toContain(bad);
    // The junk accent was dropped; the palette's next candidate (none here) gives the app's own.
    expect(t["--accent"]).not.toContain("red");
  });

  it("names are shown only for a valid slug", () => {
    expect(themeDisplayName("tokyo-night")).toBe("Tokyo Night");
    expect(themeDisplayName("catppuccin-latte")).toBe("Catppuccin Latte");
    expect(themeDisplayName("<b>x</b>")).toBe("");
    expect(themeDisplayName("a".repeat(65))).toBe("");
    expect(themeDisplayName(42)).toBe("");
  });
});
