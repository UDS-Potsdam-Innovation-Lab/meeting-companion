// Checks on configuration that the app's privacy and CI promises rest on.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("AC5 no network: Tauri configuration", () => {
  const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
  const cargo = read("src-tauri/Cargo.toml");
  const pkg = JSON.parse(read("package.json"));

  it("enables no HTTP, websocket, localhost or shell plugin", () => {
    for (const plugin of [
      "tauri-plugin-http",
      "tauri-plugin-websocket",
      "tauri-plugin-localhost",
      "tauri-plugin-shell",
      "tauri-plugin-upload",
    ]) {
      expect(cargo).not.toContain(plugin);
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(deps).filter((d) => /^@tauri-apps\/plugin-/.test(d))).toEqual([]);
    expect(conf.plugins ?? {}).toEqual({});
  });

  it("grants no HTTP or shell permission to the window", () => {
    const dir = join(root, "src-tauri/capabilities");
    for (const file of readdirSync(dir)) {
      const cap = JSON.parse(readFileSync(join(dir, file), "utf8"));
      for (const perm of cap.permissions) {
        const id = typeof perm === "string" ? perm : perm.identifier;
        expect(id).toMatch(/^core:/);
      }
    }
  });

  it("has a CSP whose connect-src allows only Tauri IPC", () => {
    const csp = conf.app.security.csp;
    expect(csp).toBeTypeOf("object");
    expect(csp["default-src"]).toBe("'self'");
    const connect = String(csp["connect-src"]).split(/\s+/);
    expect(connect.sort()).toEqual(["http://ipc.localhost", "ipc:"]);
    for (const directive of Object.values(csp) as string[]) {
      expect(directive).not.toMatch(/\*|https?:\/\/(?!ipc\.localhost)|wss?:/);
    }
    expect(conf.app.security.dangerousDisableAssetCspModification).toBeUndefined();
  });

  it("the Rust core opens no socket", () => {
    const sources = readdirSync(join(root, "src-tauri/src"), { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".rs"))
      .map((f) => readFileSync(join(root, "src-tauri/src", f), "utf8"))
      .join("\n");
    expect(sources).not.toMatch(/TcpListener|UdpSocket|TcpStream|reqwest|hyper::/);
  });
});

describe("AC1 CI workflow", () => {
  const wf = parse(read(".github/workflows/ci.yml"));

  it("runs on every push and pull request", () => {
    expect(Object.keys(wf.on)).toEqual(expect.arrayContaining(["push", "pull_request"]));
    expect(wf.on.push?.branches).toBeUndefined();
  });

  it("builds, tests and smoke-tests on Linux (macOS and Windows are deferred)", () => {
    const job = Object.values(wf.jobs)[0] as {
      strategy: { matrix: { os: string[] }; "fail-fast": boolean };
      steps: { run?: string }[];
    };
    expect(job.strategy.matrix.os).toContain("ubuntu-latest");
    const runs = job.steps.map((s) => s.run ?? "").join("\n");
    for (const cmd of ["npm ci", "npm run lint", "npm test", "npm run tauri build -- --no-bundle", "smoke"]) {
      expect(runs).toContain(cmd);
    }
    // No step may swallow a failure.
    expect(JSON.stringify(job.steps)).not.toContain("continue-on-error");
    expect(runs).not.toMatch(/\|\|\s*true/);
  });
});

describe("AC6 (job 003) recording adds no network and declares the microphone", () => {
  const cargo = read("src-tauri/Cargo.toml");
  const lock = read("src-tauri/Cargo.lock");
  const conf = JSON.parse(read("src-tauri/tauri.conf.json"));

  it("adds no HTTP client crate and no Tauri plugin for the engines", () => {
    for (const crate of ["reqwest", "ureq", "hyper", "curl", "isahc", "attohttpc", "tauri-plugin-"]) {
      expect(cargo).not.toContain(crate);
    }
    // Neither engine crate pulls one in, directly or through its dependencies.
    const deps = new Map<string, string[]>();
    for (const block of lock.split("[[package]]").slice(1)) {
      const name = /name = "([^"]+)"/.exec(block)?.[1];
      const list = /dependencies = \[([^\]]*)\]/.exec(block)?.[1] ?? "";
      if (name)
        deps.set(
          name,
          [...list.matchAll(/"([^" ]+)/g)].map((m) => m[1]!),
        );
    }
    const closure = new Set<string>();
    const visit = (n: string) => {
      if (closure.has(n)) return;
      closure.add(n);
      for (const d of deps.get(n) ?? []) visit(d);
    };
    for (const engine of ["cpal", "whisper-rs"]) {
      expect(deps.has(engine), engine).toBe(true);
      visit(engine);
    }
    for (const crate of ["reqwest", "ureq", "hyper", "isahc", "curl", "curl-sys", "tokio"]) {
      expect(closure.has(crate), crate).toBe(false);
    }
  });

  it("the window's capability grants nothing beyond the core defaults", () => {
    const cap = JSON.parse(read("src-tauri/capabilities/default.json"));
    expect(cap.permissions).toEqual(["core:default"]);
  });

  it("the macOS bundle declares NSMicrophoneUsageDescription in German and English", () => {
    const plist = read("src-tauri/Info.plist");
    expect(plist).toContain("<key>NSMicrophoneUsageDescription</key>");
    const files = conf.bundle.macOS.files as Record<string, string>;
    for (const lang of ["de", "en"]) {
      const source = files[`Resources/${lang}.lproj/InfoPlist.strings`];
      expect(source).toBeDefined();
      const strings = read(join("src-tauri", source!));
      expect(strings).toMatch(/^"NSMicrophoneUsageDescription" = ".+";$/m);
    }
    expect(read("src-tauri/macos/de.lproj/InfoPlist.strings")).toContain("Gerät");
  });
});
