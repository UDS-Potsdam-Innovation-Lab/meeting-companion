// Checks on configuration that the app's privacy and CI promises rest on.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
    for (const crate of ["reqwest", "curl", "isahc", "attohttpc", "tauri-plugin-"]) {
      expect(cargo).not.toContain(crate);
    }
    // Deliberately loosened in job 011: one HTTP client, ureq, for the Claude API only (see below).
    expect(cargo.match(/^ureq\b.*$/gm)).toEqual([
      'ureq = { version = "3.5", default-features = false, features = ["rustls"] }',
    ]);
    // The phone view (job 012) is the only HTTP server code: server side only, HTTP/1, no client features.
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

  it("the HTTP client in the lock file is a build dependency of sherpa-onnx-sys and the core's Claude client", () => {
    const users = blocks
      .filter((b) => /dependencies = \[[^\]]*"ureq[" ]/.test(b))
      .map((b) => `${/name = "([^"]+)"/.exec(b)?.[1]} → ${/"(ureq[^"]*)"/.exec(b)?.[1]}`);
    // ureq 2 builds sherpa-onnx-sys (and is not linked); ureq 3 is the core's client for the Claude API (job 011).
    expect(users.sort()).toEqual(["meeting-companion → ureq 3.5.0", "sherpa-onnx-sys → ureq 2.12.1"]);
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

describe("AC3 (job 011) the one network path: HTTPS to api.anthropic.com from engines/claude.rs only", () => {
  const cargo = read("src-tauri/Cargo.toml");
  const lock = read("src-tauri/Cargo.lock");
  const blocks = lock.split("[[package]]").slice(1);
  const dir = join(root, "src-tauri/src");
  const files = readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".rs"))
    .map((f) => ({ file: f.replaceAll("\\", "/"), src: readFileSync(join(dir, f), "utf8") }));
  /** The code of a file without its `#[cfg(test)]` module(s) and without test-only files. */
  const production = files
    .filter(({ file }) => !/(^|\/)tests?(\.rs|\/)/.test(file) && !file.includes("speaker_eval/"))
    .map(({ file, src }) => ({ file, src: src.split("#[cfg(test)]")[0]! }));

  it("ureq 3 with rustls only: no native-tls, no OpenSSL, no proxy, no async runtime", () => {
    const deps = new Map<string, string[]>();
    for (const block of blocks) {
      const name = /name = "([^"]+)"/.exec(block)?.[1];
      const version = /version = "([^"]+)"/.exec(block)?.[1];
      const list = /dependencies = \[([^\]]*)\]/.exec(block)?.[1] ?? "";
      deps.set(
        `${name} ${version}`,
        [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]!),
      );
    }
    const resolve = (dep: string) =>
      deps.has(dep) ? dep : ([...deps.keys()].find((k) => k.startsWith(`${dep} `)) ?? dep);
    const closure = new Set<string>();
    const visit = (n: string) => {
      const key = resolve(n);
      if (closure.has(key)) return;
      closure.add(key);
      for (const d of deps.get(key) ?? []) visit(d);
    };
    visit("ureq 3.5.0");
    const names = [...closure].map((k) => k.split(" ")[0]);
    expect(names).toContain("rustls");
    expect(names).toContain("webpki-roots");
    for (const crate of [
      "native-tls",
      "openssl",
      "openssl-sys",
      "tokio",
      "hyper",
      "socks",
      "rustls-platform-verifier",
    ])
      expect(names, crate).not.toContain(crate);
    expect(cargo).not.toMatch(/native-tls|socks-proxy|win-system-proxy|platform-verifier/);
  });

  it("only engines/claude.rs uses the HTTP client", () => {
    const users = files.filter(({ src }) => /\bureq\b/.test(src)).map(({ file }) => file);
    expect(users).toEqual(["engines/claude.rs"]);
  });

  it("the only URL in the core's code is the Messages API on api.anthropic.com", () => {
    const urls = production.flatMap(({ file, src }) =>
      [...src.matchAll(/"(https?:\/\/[^"]*)"/g)].map((m) => `${file}: ${m[1]}`),
    );
    // The SVG namespace of the phone view's QR code (job 012) is an XML name, not a request.
    expect(urls.filter((u) => u !== "phone_view/qr.rs: http://www.w3.org/2000/svg\\")).toEqual([
      "engines/claude.rs: https://api.anthropic.com/v1/messages",
    ]);
    const claude = production.find((f) => f.file === "engines/claude.rs")!.src;
    expect(claude).toContain('pub const API_HOST: &str = "api.anthropic.com";');
    expect(claude).toContain('pub const API_URL: &str = "https://api.anthropic.com/v1/messages";');
    // The agent posts to the constant only, HTTPS only, without proxy, with both timeouts.
    expect([...claude.matchAll(/\.post\(([^)]*)\)/g)].map((m) => m[1])).toEqual(["API_URL", "&request"]);
    expect(claude).toContain("if req.url != API_URL {");
    for (const setting of [
      ".https_only(true)",
      ".proxy(None)",
      ".max_redirects(0)",
      ".timeout_connect(Some(CONNECT_TIMEOUT))",
      ".timeout_global(Some(TOTAL_TIMEOUT))",
      "pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);",
      "pub const TOTAL_TIMEOUT: Duration = Duration::from_secs(60);",
    ])
      expect(claude).toContain(setting);
  });

  it("opens no listening socket outside the phone view, adds no Tauri HTTP/shell plugin and keeps connect-src IPC only", () => {
    // The phone view (job 012) is the one listener; "AC5 no network" checks it binds one private address.
    const all = files
      .filter(({ file }) => !file.startsWith("phone_view"))
      .map((f) => f.src)
      .join("\n");
    expect(all).not.toMatch(/TcpListener|UdpSocket/);
    expect(cargo).not.toMatch(/tauri-plugin-(http|shell|websocket|localhost|upload)/);
    const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
    expect(String(conf.app.security.csp["connect-src"]).split(/\s+/).sort()).toEqual([
      "http://ipc.localhost",
      "ipc:",
    ]);
    const cap = JSON.parse(read("src-tauri/capabilities/default.json"));
    expect(cap.permissions).toEqual(["core:default"]);
  });

  it("the UI never sees an engine type: the IPC module names no engine, host or key", () => {
    const ipc = read("src/lib/ipc.ts");
    expect(ipc).not.toMatch(/anthropic\.com|x-api-key|llama|ureq|ClaudeLanguageModel|ScriptedLanguageModel/i);
  });
});

describe("AC1 (job 016) one ggml, llama.cpp without HTTP client, sockets or processes", () => {
  const cargo = read("src-tauri/Cargo.toml");
  const lock = read("src-tauri/Cargo.lock");
  const cargoConfig = read(".cargo/config.toml");
  const dir = join(root, "src-tauri/src");
  const files = readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".rs"))
    .map((f) => ({ file: f.replaceAll("\\", "/"), src: readFileSync(join(dir, f), "utf8") }));

  it("pins llama-cpp-2 with default features off and none of common, mtmd, dynamic linking or GPU", () => {
    const lines = cargo.split("\n").filter((l) => /^llama-cpp/.test(l));
    expect(lines).toEqual([
      'llama-cpp-2 = { version = "=0.1.160", default-features = false, features = ["system-ggml-static"] }',
      'llama-cpp-sys-2 = { version = "=0.1.160", default-features = false, features = ["system-ggml-static"] }',
    ]);
    for (const feature of [
      "common",
      "mtmd",
      "dynamic-link",
      "dynamic-backends",
      "llguidance",
      "openmp",
      "cuda",
      "vulkan",
      "metal",
      "rocm",
      "opencl",
      "webgpu",
    ]) {
      for (const l of lines) expect(l).not.toContain(`"${feature}"`);
    }
    // whisper.cpp runs on llama.cpp's ggml: its version is pinned as well.
    expect(cargo).toMatch(/^whisper-rs = "=0\.16\.0"$/m);
  });

  it("links the one shared ggml: both crates find it through .cargo/config.toml", () => {
    expect(cargoConfig).toContain(
      'CMAKE_PREFIX_PATH = { value = "src-tauri/native/ggml/prefix", relative = true, force = true }',
    );
    expect(cargoConfig).toContain('WHISPER_USE_SYSTEM_GGML = { value = "ON", force = true }');
    expect(cargoConfig).toContain(
      '"CMAKE_PROJECT_whisper.cpp_INCLUDE" = { value = "src-tauri/native/ggml/whisper-shared-ggml.cmake", relative = true, force = true }',
    );
    expect(read("src-tauri/native/ggml/CMakeLists.txt")).toContain(
      "add_subdirectory(${GGML_SOURCE_DIR} ggml)",
    );
  });

  it("neither engine crate pulls in an HTTP client, a TLS stack or an async runtime", () => {
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
    for (const engine of ["llama-cpp-2", "llama-cpp-sys-2", "whisper-rs"]) {
      expect(deps.has(engine), engine).toBe(true);
      visit(engine);
    }
    for (const crate of [
      "reqwest",
      "ureq",
      "hyper",
      "isahc",
      "curl",
      "curl-sys",
      "tokio",
      "rustls",
      "openssl-sys",
    ])
      expect(closure.has(crate), crate).toBe(false);
    // The lock file holds exactly the pinned version.
    expect(lock).toMatch(/name = "llama-cpp-2"\nversion = "0\.1\.160"/);
    expect(lock).toMatch(/name = "llama-cpp-sys-2"\nversion = "0\.1\.160"/);
  });

  it("still: no listening or UDP socket outside phone_view/, no process started from engines/", () => {
    const outside = files.filter(({ file }) => !file.startsWith("phone_view"));
    for (const { file, src } of outside) expect(src, file).not.toMatch(/TcpListener|UdpSocket/);
    const engines = files.filter(({ file }) => file.startsWith("engines/"));
    expect(engines.map((f) => f.file)).toContain("engines/llama.rs");
    for (const { file, src } of engines) {
      expect(src, file).not.toMatch(/process::Command|Command::new|std::process::\{[^}]*Command/);
      expect(src, file).not.toMatch(/TcpStream|TcpListener|UdpSocket|UnixListener|UnixStream/);
    }
  });

  it("still: the only HTTP client crate is 011's ureq, used only in engines/claude.rs", () => {
    for (const crate of ["reqwest", "curl", "isahc", "attohttpc", "surf", "awc", "hyper-tls", "hyper-rustls"])
      expect(cargo, crate).not.toMatch(new RegExp(`^${crate}\\s*=`, "m"));
    expect(cargo.match(/^ureq\b.*$/gm)).toEqual([
      'ureq = { version = "3.5", default-features = false, features = ["rustls"] }',
    ]);
    expect(files.filter(({ src }) => /\bureq\b/.test(src)).map(({ file }) => file)).toEqual([
      "engines/claude.rs",
    ]);
    // hyper only as the phone view's server, never with its client feature.
    expect(cargo).not.toMatch(/^hyper\s*=.*"client"/m);
  });

  it("CI builds the shared ggml before the tests and checks the release app with ggml-check", () => {
    const wf = parse(read(".github/workflows/ci.yml"));
    const steps = (Object.values(wf.jobs)[0] as { steps: { name?: string; run?: string }[] }).steps;
    const at = (needle: string) => steps.findIndex((s) => (s.run ?? "").includes(needle));
    const build = at("node scripts/ggml.mjs build");
    const test = at("npm test");
    const compile = at("npm run tauri build -- --no-bundle");
    const check = at("node scripts/ggml-check.mjs src-tauri/target/release/meeting-companion");
    expect(build).toBeGreaterThan(-1);
    expect(build).toBeLessThan(test);
    expect(check).toBeGreaterThan(compile);
  });
});

describe("AC1 (job 016) ggml-check on recorded symbol lists", () => {
  const fixtures = join(root, "scripts/fixtures/ggml-check");
  const run = (file: string) =>
    spawnSync(process.execPath, [join(root, "scripts/ggml-check.mjs"), "--symbols", join(fixtures, file)], {
      encoding: "utf8",
    });

  it("passes the symbol list recorded from the release app", () => {
    const r = run("clean.txt");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it.each([
    ["two-ggml.txt", /ggml_init is defined 2 times/],
    ["no-whisper.txt", /whisper_init_from_file_with_params_no_state is missing/],
    ["no-llama.txt", /llama_model_load_from_file is missing/],
    ["httplib.txt", /cpp-httplib symbols are linked/],
    ["curl.txt", /curl symbols are linked/],
    ["llama-server.txt", /llama-server symbols are linked/],
    ["stripped.txt", /no symbol table/],
  ])("fails on %s", (file, message) => {
    const r = run(file);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(message);
  });

  it("fails on a binary it cannot read", () => {
    const r = spawnSync(
      process.execPath,
      [join(root, "scripts/ggml-check.mjs"), join(fixtures, "missing-binary")],
      {
        encoding: "utf8",
      },
    );
    expect(r.status).toBe(1);
  });
});

describe("job 016: a cached sys crate output not built against the shared ggml is found", () => {
  // Hermetic: a fake prefix and a fake target dir in a temp folder; `outputs` reads only those, so the
  // result does not depend on the real prefix, its build options or the environment.
  const STAMP = '{ "crate": "llama-cpp-sys-2 0.1.160", "built": "2026-11-01T00:00:00.000Z" }\n';
  const check = (prefix: string, target: string) =>
    spawnSync(process.execPath, [join(root, "scripts/ggml.mjs"), "outputs", "--prefix", prefix], {
      encoding: "utf8",
      env: { ...process.env, CARGO_TARGET_DIR: target },
    });
  /** A temp folder with `prefix/` (SOURCE = STAMP unless null) and `target/release` holding one
   * whisper-rs-sys and one llama-cpp-sys-2 output, stamped with `stamp`. */
  const fixture = (stamp: string | null, ownGgml = false, source: string | null = STAMP) => {
    const dir = mkdtempSync(join(tmpdir(), "ggml-stale-"));
    mkdirSync(join(dir, "prefix"), { recursive: true });
    if (source !== null) writeFileSync(join(dir, "prefix/SOURCE"), source);
    for (const name of ["whisper-rs-sys-1c761927bb6971f2", "llama-cpp-sys-2-01336d13d7a6e883"]) {
      const build = join(dir, "target/release/build", name, "out/build");
      mkdirSync(build, { recursive: true });
      if (ownGgml && name.startsWith("whisper")) mkdirSync(join(build, "ggml/src"), { recursive: true });
      if (stamp !== null) writeFileSync(join(build, "meeting-companion-ggml.SOURCE"), stamp);
    }
    mkdirSync(join(dir, "target/release/deps"), { recursive: true });
    const r = check(join(dir, "prefix"), join(dir, "target"));
    rmSync(dir, { recursive: true, force: true });
    return r;
  };

  it("passes when both outputs carry the prefix's stamp", () => {
    const r = fixture(STAMP);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it.each([
    ["whisper-rs-sys with its own ggml (no stamp), as restored from the CI cache", null, true, STAMP],
    ["an output built against an earlier prefix", '{ "built": "earlier" }\n', false, STAMP],
    ["a prefix without SOURCE", STAMP, false, null],
  ])("fails on %s", (_, stamp, ownGgml, source) => {
    const r = fixture(stamp, ownGgml, source);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not built against .*prefix/);
    expect(r.stderr).toMatch(/whisper-rs-sys-1c761927bb6971f2/);
  });

  it("verify runs the same output check after the prefix check", () => {
    const script = read("scripts/ggml.mjs");
    expect(script).toMatch(/function verify\(\) \{[\s\S]*?if \(!current\(crate\)\)[\s\S]*?outputs\(\);/);
    expect(script).toMatch(/function build\(\) \{[\s\S]*?cleanStale\(\);[\s\S]*?cleanStale\(\);/);
  });
});
