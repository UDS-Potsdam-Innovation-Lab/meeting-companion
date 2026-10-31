// Job 006 AC6: every colour comes from a custom property, and the dark theme sets the same tokens.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start) + 1);
}

const light = block(":root");
const dark = block(':root[data-theme="dark"]');
const colourTokens = (b: string) =>
  [...b.matchAll(/(--[\w-]+):\s*([^;]+);/g)]
    .filter(([, , v]) => /#[0-9a-fA-F]{3,8}\b/.test(v!))
    .map(([, k]) => k!);

describe("styles.css colours", () => {
  it("has no hex literal outside the two token blocks", () => {
    const rest = css.replace(light, "").replace(dark, "");
    expect(rest.match(HEX) ?? []).toEqual([]);
  });

  it("the dark block sets every colour token of the light block (except the fixed theme previews)", () => {
    const missing = colourTokens(light)
      .filter((k) => !k.startsWith("--preview-"))
      .filter((k) => !dark.includes(`${k}:`));
    expect(missing).toEqual([]);
    expect(dark).toContain("color-scheme: dark");
  });
});
