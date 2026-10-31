// Job 014 AC2: the shortcut list in Help is the registry the app binds keys with.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import de from "../i18n/de.json";
import { matches, SHORTCUTS, tabTarget, type BoundShortcut, type KeyLike } from "./shortcuts";

const src = join(__dirname, "..");
const sources = (readdirSync(src, { recursive: true }) as string[])
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("test/"))
  .map((f) => ({ file: f.replaceAll("\\", "/"), text: readFileSync(join(src, f), "utf8") }));
const app = sources.filter(
  (s) => s.file !== "app/shortcuts.ts" && s.file !== "lib/mockBackend.ts" && s.file !== "lib/ipc.ts",
);

/** How a component binds each shortcut of the registry. A new bound shortcut needs an entry here. */
const BINDING: Record<BoundShortcut, RegExp> = {
  openSettings: /\bmatches\(\s*"openSettings"/,
  back: /\bmatches\(\s*"back"/,
  moveTabs: /\btabTarget\(/,
};

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("AC2 shortcut registry", () => {
  it("no component compares keys itself: every binding goes through the registry", () => {
    const offenders = app.flatMap(({ file, text }) =>
      text
        .split("\n")
        .map((line, i) => ({ line, at: `${file}:${i + 1}` }))
        .filter(
          ({ line }) =>
            /\b(e|ev|evt|event)\.(key|code)\b(?!s)/.test(line) ||
            /\bcase\s+["'](Escape|Enter|Tab|Home|End|Arrow\w+|F\d{1,2}|,)["']/.test(line),
        )
        .map(({ at, line }) => `${at}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
    // A window key listener matches through the registry too.
    const listeners = app.filter(({ text }) => /addEventListener\(\s*["']key(down|up|press)["']/.test(text));
    expect(listeners.length).toBeGreaterThan(0);
    for (const { file, text } of listeners) expect(text, file).toMatch(/\bmatches\(/);
  });

  it("every bound shortcut in the list is bound by a component, and every binding is listed", () => {
    const bound = SHORTCUTS.filter((s) => !s.native).map((s) => s.id as BoundShortcut);
    // A shortcut in the registry without a known binding fails here, as does a binding without an entry.
    expect([...bound].sort()).toEqual(Object.keys(BINDING).sort());
    for (const id of bound) {
      const users = app.filter(({ text }) => BINDING[id].test(text)).map((s) => s.file);
      expect(users, `"${id}" is listed but no component binds it`).not.toEqual([]);
    }
    // The registry's own matchers cover exactly the bound ids.
    const shortcutsTs = sources.find((s) => s.file === "app/shortcuts.ts")!.text;
    for (const id of ["openSettings", "back"]) expect(shortcutsTs).toMatch(new RegExp(`\\b${id}: \\(e\\)`));
  });

  it("only Tab and Enter are listed as keys the web view handles", () => {
    expect(SHORTCUTS.filter((s) => s.native).map((s) => s.id)).toEqual(["nextControl", "confirm"]);
  });

  it("every key cap, label and place is a message key", () => {
    for (const s of SHORTCUTS) {
      for (const k of [...s.keys, s.label, s.where]) expect(de, `${s.id}: ${k}`).toHaveProperty([k]);
    }
  });

  it("matches Ctrl+, and Cmd+, but not with Alt or Shift", () => {
    expect(matches("openSettings", key(",", { ctrlKey: true }))).toBe(true);
    expect(matches("openSettings", key(",", { metaKey: true }))).toBe(true);
    expect(matches("openSettings", { ...key(";", { ctrlKey: true }), code: "Comma" })).toBe(true);
    expect(matches("openSettings", key(",", { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(matches("openSettings", key(",", { ctrlKey: true, altKey: true }))).toBe(false);
    expect(matches("openSettings", key(","))).toBe(false);
    expect(matches("back", key("Escape"))).toBe(true);
    expect(matches("back", key("Enter"))).toBe(false);
  });

  it("moves between tabs with arrows (wrapping), Home and End", () => {
    const tabs = ["a", "b", "c"] as const;
    expect(tabTarget(key("ArrowRight"), tabs, "c")).toBe("a");
    expect(tabTarget(key("ArrowDown"), tabs, "a")).toBe("b");
    expect(tabTarget(key("ArrowLeft"), tabs, "a")).toBe("c");
    expect(tabTarget(key("ArrowUp"), tabs, "b")).toBe("a");
    expect(tabTarget(key("Home"), tabs, "c")).toBe("a");
    expect(tabTarget(key("End"), tabs, "a")).toBe("c");
    expect(tabTarget(key("x"), tabs, "a")).toBeNull();
    expect(tabTarget(key("ArrowRight", { ctrlKey: true }), tabs, "a")).toBeNull();
  });
});
