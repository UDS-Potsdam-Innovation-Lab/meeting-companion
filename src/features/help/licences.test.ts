// Job 014 AC5: the licence list bundled with the app matches the lockfiles and has every text.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import list from "./licences.json";
import { FEATURED, type LicenceList } from "./Licences";

const root = join(__dirname, "../../..");
const licences = list as unknown as LicenceList;
const byName = (name: string) => licences.components.filter((c) => c.name === name);

/** `name version` of every package in Cargo.lock. */
function cargoLock(): Map<string, Set<string>> {
  const lock = readFileSync(join(root, "src-tauri/Cargo.lock"), "utf8");
  const out = new Map<string, Set<string>>();
  for (const block of lock.split("[[package]]").slice(1)) {
    const name = block.match(/^name = "(.+)"$/m)?.[1];
    const version = block.match(/^version = "(.+)"$/m)?.[1];
    if (name && version) out.set(name, (out.get(name) ?? new Set()).add(version));
  }
  return out;
}

describe("AC5 licence list", () => {
  const cargo = cargoLock();
  const npm = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")).packages as Record<
    string,
    { version: string; dev?: boolean; devOptional?: boolean }
  >;

  it("names whisper.cpp, whisper-rs, sherpa-onnx, Tauri, React and the Inter font", () => {
    for (const name of [
      "whisper.cpp",
      "whisper-rs",
      "sherpa-onnx",
      "tauri",
      "react",
      "@fontsource-variable/inter",
    ]) {
      expect(byName(name), name).toHaveLength(1);
      expect(FEATURED.map((f) => f.name)).toContain(name);
    }
    expect(byName("whisper.cpp")[0]!.via).toBe(`whisper-rs ${[...cargo.get("whisper-rs")!][0]}`);
    expect(byName("@fontsource-variable/inter")[0]!.licence).toBe("OFL-1.1");
  });

  it("lists the versions of whisper-rs and sherpa-onnx that Cargo.lock pins", () => {
    for (const name of ["whisper-rs", "sherpa-onnx", "tauri"]) {
      expect([byName(name)[0]!.version], name).toEqual([...cargo.get(name)!]);
    }
  });

  it("every Rust entry is in Cargo.lock and every npm entry is a shipped package of package-lock.json", () => {
    for (const c of licences.components.filter((x) => x.kind === "rust")) {
      expect(cargo.get(c.name)?.has(c.version!), `${c.name} ${c.version}`).toBe(true);
    }
    const shipped = Object.entries(npm).filter(([p, v]) => p && !v.dev && !v.devOptional);
    const listed = licences.components.filter((x) => x.kind === "npm");
    expect(listed.map((c) => `${c.name}@${c.version}`).sort()).toEqual(
      shipped.map(([p, v]) => `${p.replace(/^.*node_modules\//, "")}@${v.version}`).sort(),
    );
    // The runtime dependencies of Cargo.toml are all there.
    const toml = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");
    const deps = toml.split("[dependencies]")[1]!.split(/^\[/m)[0]!;
    for (const name of [...deps.matchAll(/^([\w-]+)\s*=/gm)].map((m) => m[1]!)) {
      expect(byName(name).length, name).toBeGreaterThan(0);
    }
  });

  it("no entry has an empty licence, version or text", () => {
    expect(licences.components.length).toBeGreaterThan(100);
    for (const c of licences.components) {
      const what = `${c.name} ${c.version}`;
      expect(c.licence.trim(), what).not.toBe("");
      expect(c.version ?? c.via, what).toBeTruthy();
      expect(c.texts.length, what).toBeGreaterThan(0);
      for (const id of c.texts) expect(licences.texts[id]?.trim(), `${what}: ${id}`).toBeTruthy();
      // At least one full licence text, not only a pointer like "MIT OR Apache-2.0".
      const longest = Math.max(...c.texts.map((id) => licences.texts[id]?.length ?? 0));
      expect(longest, what).toBeGreaterThanOrEqual(200);
    }
  });

  it("the texts match the licence: MIT, Apache-2.0, OFL-1.1", () => {
    const text = (name: string) =>
      byName(name)[0]!
        .texts.map((id) => licences.texts[id])
        .join("\n");
    expect(text("whisper.cpp")).toMatch(/MIT License[\s\S]*Permission is hereby granted/);
    expect(text("sherpa-onnx")).toContain("Apache License");
    expect(text("react")).toContain("Permission is hereby granted");
    expect(text("@fontsource-variable/inter")).toContain("SIL OPEN FONT LICENSE");
  });
});
