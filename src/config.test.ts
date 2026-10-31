// Checks on configuration that the app's privacy and CI promises rest on.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

  it("the Rust core opens no socket outside the opt-in phone view (job 012)", () => {
    const files = readdirSync(join(root, "src-tauri/src"), { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".rs"));
    const read = (f: string) => readFileSync(join(root, "src-tauri/src", f), "utf8");
    const elsewhere = files
      .filter((f) => !f.startsWith("phone_view"))
      .map(read)
      .join("\n");
    expect(elsewhere).not.toMatch(/TcpListener|UdpSocket|TcpStream|SocketAddr|reqwest|hyper::|axum::/);
    // In the phone view (tests aside): one listener, bound to one address of the chosen interface; no
    // UDP, no outgoing connection, no wildcard address.
    const phone = files.filter((f) => f.startsWith("phone_view") && !f.endsWith("tests.rs"));
    expect(phone.length).toBeGreaterThan(0);
    for (const f of phone) {
      // Without comments and the inline test module at the end of a file.
      const src = read(f)
        .replace(/#\[cfg\(test\)\]\s*(pub )?mod tests \{[\s\S]*$/, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(src, f).not.toMatch(
        /UdpSocket|TcpStream::connect|TcpSocket|reqwest|hyper::client|0\.0\.0\.0|UNSPECIFIED|Ipv6Addr|::bind\(\(?"/,
      );
    }
    const binds = phone.flatMap((f) =>
      [...read(f).matchAll(/TcpListener::bind\(([^)]*)\)/g)].map((m) => m[1]),
    );
    expect(binds).toEqual(["SocketAddrV4::new(ip, 0"]);
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
    for (const crate of ["reqwest", "ureq", "curl", "isahc", "attohttpc", "tauri-plugin-"]) {
      expect(cargo).not.toContain(crate);
    }
    // The phone view (job 012) is the only HTTP code: server side only, HTTP/1, no client features.
    const httpDeps = cargo.split("\n").filter((l) => /^(hyper|hyper-util|axum)\s*=/.test(l));
    expect(httpDeps).toEqual([
      'axum = { version = "0.8", default-features = false, features = ["http1", "json", "tokio"] }',
      'hyper = { version = "1", features = ["server", "http1"] }',
      'hyper-util = { version = "0.1", features = ["tokio", "server", "http1", "service"] }',
    ]);
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

describe("AC6 (job 004) speaker detection adds no network and only the checksum-pinned native code", () => {
  const cargo = read("src-tauri/Cargo.toml");
  const lock = read("src-tauri/Cargo.lock");
  const blocks = lock.split("[[package]]").slice(1);
  const depsOf = (name: string) => {
    const block = blocks.find((b) => new RegExp(`name = "${name}"`).test(b)) ?? "";
    const list = /dependencies = \[([^\]]*)\]/.exec(block)?.[1] ?? "";
    return [...list.matchAll(/"([^" ]+)/g)].map((m) => m[1]!);
  };

  it("pins the official sherpa-onnx crate and links it only from the verified folder", () => {
    expect(cargo).toMatch(/sherpa-onnx = \{ version = "=2\.0\.1"/);
    const config = read(".cargo/config.toml");
    expect(config).toMatch(
      /SHERPA_ONNX_LIB_DIR = \{ value = "src-tauri\/native\/lib", relative = true, force = true \}/,
    );
    const sums = read("src-tauri/native/sherpa-onnx.sha256").trim().split("\n");
    expect(sums).toHaveLength(6);
    for (const line of sums)
      expect(line).toMatch(/^[0-9a-f]{64} {2}sherpa-onnx-v2\.0\.1-[\w-]+-static[\w-]*-lib\.tar\.bz2$/);
    const wf = read(".github/workflows/ci.yml");
    expect(wf).toContain("node scripts/sherpa-onnx.mjs fetch");
    expect(wf).toContain("A corrupted sherpa-onnx archive fails the check");
  });

  it("the HTTP client in the lock file is only a build dependency of sherpa-onnx-sys", () => {
    const users = blocks
      .filter((b) => /dependencies = \[[^\]]*"ureq[" ]/.test(b))
      .map((b) => /name = "([^"]+)"/.exec(b)?.[1]);
    expect(users).toEqual(["sherpa-onnx-sys"]);
    // The runtime crate sherpa-onnx itself pulls in no HTTP client.
    const runtime = depsOf("sherpa-onnx");
    expect(runtime).toContain("sherpa-onnx-sys");
    for (const crate of ["ureq", "reqwest", "hyper", "curl", "tokio"]) expect(runtime).not.toContain(crate);
  });

  it("uses sherpa-onnx only through SpeakerEmbeddingExtractor, in sherpa.rs", () => {
    const dir = join(root, "src-tauri/src");
    const files = readdirSync(dir, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".rs"));
    for (const f of files) {
      const src = readFileSync(join(dir, f), "utf8");
      const uses = [...src.matchAll(/sherpa_onnx::(\{[^}]*\}|\w+)/g)].map((m) => m[1]!);
      if (!f.endsWith("sherpa.rs")) {
        expect(uses, f).toEqual([]);
        continue;
      }
      const names = uses.flatMap((u) =>
        u
          .replace(/[{}\s]/g, "")
          .split(",")
          .filter(Boolean),
      );
      expect(names.sort()).toEqual(["SpeakerEmbeddingExtractor", "SpeakerEmbeddingExtractorConfig"]);
    }
  });

  it("the capability file still grants nothing beyond the core defaults", () => {
    const cap = JSON.parse(read("src-tauri/capabilities/default.json"));
    expect(cap.permissions).toEqual(["core:default"]);
  });
});

describe("AC2 (job 004) the archive check", () => {
  const script = join(root, "scripts/sherpa-onnx.mjs");
  const run = (args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

  it("accepts the pinned bytes and rejects a corrupted or unpinned archive", () => {
    const dir = mkdtempSync(join(tmpdir(), "sherpa-check-"));
    try {
      const name = "sherpa-onnx-v2.0.1-linux-x64-static-lib.tar.bz2";
      const bytes = Buffer.from("FAKE-ARCHIVE-for-tests-only");
      const sum = createHash("sha256").update(bytes).digest("hex");
      const sums = join(dir, "sums");
      writeFileSync(sums, `${sum}  ${name}\n`);
      const file = join(dir, name);
      writeFileSync(file, bytes);
      expect(run(["verify", file, "--sums", sums]).status).toBe(0);
      bytes[3] = bytes[3]! ^ 1;
      writeFileSync(file, bytes);
      const bad = run(["verify", file, "--sums", sums]);
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain("checksum mismatch");
      const other = join(dir, "sherpa-onnx-v9.9.9-linux-x64-static-lib.tar.bz2");
      writeFileSync(other, bytes);
      expect(run(["verify", other, "--sums", sums]).status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("AC7 (job 007) the level event adds nothing beyond one listed core event", () => {
  const lib = read("src-tauri/src/lib.rs");
  const events = [...lib.matchAll(/pub const EVENT_\w+: &str = "([^"]+)";/g)].map((m) => m[1]!).sort();

  it("the core sends exactly these events, and the capability file lists each", () => {
    expect(events).toEqual([
      "capture-level",
      "capture-state",
      "mic-test",
      "microphone-switched",
      "phone-view-state",
      "settings-changed",
      "transcript-segment",
      "transcript-voice",
    ]);
    const cap = JSON.parse(read("src-tauri/capabilities/default.json"));
    for (const e of events) expect(cap.description).toContain(e);
    expect(cap.permissions).toEqual(["core:default"]);
  });

  it("the UI listens to the level event only through ipc.ts", () => {
    const ipc = read("src/lib/ipc.ts");
    expect(ipc).toContain('export const EVENT_LEVEL = "capture-level";');
  });
});
