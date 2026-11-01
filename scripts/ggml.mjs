// The one ggml of the app (job 016). whisper.cpp (whisper-rs-sys) and llama.cpp (llama-cpp-sys-2) each
// vendor their own ggml and would each build static `libggml*.a` under the same names; the linker keeps
// one copy without an error, so one engine would silently run on the other's ggml. Instead, this
// script builds ggml once, from the tree llama-cpp-sys-2 vendors (the version pinned in
// src-tauri/Cargo.toml), into src-tauri/native/ggml/prefix/. .cargo/config.toml points both crates
// there: llama-cpp-sys-2 with its `system-ggml-static` feature, whisper-rs-sys with
// WHISPER_USE_SYSTEM_GGML=ON (whisper.cpp then compiles against these headers and builds no ggml).
// prefix/SOURCE records the crate, the ggml version and the options it was built from.
//
//   node scripts/ggml.mjs build     build once (again only when the pinned crate or the options change)
//   node scripts/ggml.mjs verify    exit 1 unless prefix/ holds a build of the pinned crate's ggml
//   node scripts/ggml.mjs path      print the prefix folder
//
// Both sys crates keep a copy of the archives in their build output, and cargo does not rerun their
// build scripts when the environment from .cargo/config.toml or the prefix changes. A stale output (for
// example whisper-rs-sys built with its own ggml, restored from a CI cache, or built against an earlier
// prefix) would bring a second ggml back. The CMake hooks therefore stamp each crate's build folder with
// the prefix's SOURCE (which names the build), and `build` cleans every profile whose stamp is missing
// or differs (`cargo clean -p <crate>`; CARGO_TARGET_DIR is honoured); `verify` fails on one.
// Options: --force (rebuild even when up to date).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CRATE = "llama-cpp-sys-2";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = join(root, "src-tauri/Cargo.toml");
const wrapper = join(root, "src-tauri/native/ggml");
const buildDir = join(wrapper, "build");
const prefix = join(wrapper, "prefix");
const stampFile = join(prefix, "SOURCE");
const targetDir = process.env.CARGO_TARGET_DIR ?? join(root, "src-tauri/target");
const SYS_CRATES = ["whisper-rs-sys", CRATE];
/** Written by the CMake hooks into each sys crate's CMake build folder (out/build). */
const CRATE_STAMP = "meeting-companion-ggml.SOURCE";

function fail(message) {
  console.error(`ggml: ${message}`);
  process.exit(1);
}

/** The pinned llama-cpp-sys-2 from Cargo.lock, and its vendored ggml folder. */
function pinnedCrate() {
  let meta;
  try {
    meta = JSON.parse(
      execFileSync("cargo", ["metadata", "--format-version", "1", "--manifest-path", manifest], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["ignore", "pipe", "inherit"],
      }),
    );
  } catch {
    fail("cargo metadata failed");
  }
  const pkg = meta.packages.find((p) => p.name === CRATE);
  if (!pkg) fail(`${CRATE} is not a dependency of src-tauri/Cargo.toml`);
  const source = join(dirname(pkg.manifest_path), "llama.cpp/ggml");
  if (!existsSync(join(source, "CMakeLists.txt"))) fail(`no ggml sources in ${source}`);
  const cmake = readFileSync(join(source, "CMakeLists.txt"), "utf8");
  const part = (name) => (new RegExp(`set\\(GGML_VERSION_${name} (\\d+)\\)`).exec(cmake) ?? [])[1];
  const ggml = [part("MAJOR"), part("MINOR"), part("PATCH")].join(".");
  return { version: pkg.version, source, ggml };
}

/** CMake options of the shared build: static, position independent, CPU only, no OpenMP. */
function options() {
  const opts = {
    CMAKE_BUILD_TYPE: "Release",
    BUILD_SHARED_LIBS: "OFF",
    CMAKE_POSITION_INDEPENDENT_CODE: "ON",
    GGML_OPENMP: "OFF",
    GGML_CCACHE: "OFF",
    GGML_METAL: "OFF",
    GGML_CUDA: "OFF",
    GGML_VULKAN: "OFF",
    GGML_BACKEND_DL: "OFF",
  };
  // whisper-rs-sys links ggml-blas (Accelerate) on macOS; elsewhere BLAS stays off.
  if (process.platform !== "darwin") opts.GGML_BLAS = "OFF";
  // GGML_NATIVE stays at ggml's default (as whisper-rs-sys built it before); it can be set here.
  if (process.env.GGML_NATIVE) opts.GGML_NATIVE = process.env.GGML_NATIVE;
  return opts;
}

function stampOf(crate) {
  return {
    crate: `${CRATE} ${crate.version}`,
    ggml: crate.ggml,
    platform: `${process.platform}-${process.arch}`,
    options: options(),
  };
}

function libraries() {
  const names =
    process.platform === "win32"
      ? ["ggml.lib", "ggml-base.lib", "ggml-cpu.lib"]
      : ["libggml.a", "libggml-base.a", "libggml-cpu.a"];
  return names.map((n) => join(prefix, "lib", n));
}

function current(crate) {
  if (!existsSync(stampFile) || !libraries().every(existsSync)) return false;
  try {
    // `built` names this build; the rest must match what would be built now.
    const { built, ...recorded } = JSON.parse(readFileSync(stampFile, "utf8"));
    return Boolean(built) && JSON.stringify(recorded) === JSON.stringify(stampOf(crate));
  } catch {
    return false;
  }
}

/** The cargo profile folders of the target dir (`debug`, `release`, `<triple>/release`, …). */
function profileDirs() {
  const dirs = [];
  const visit = (dir, triple, depth) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const path = join(dir, e.name);
      if (existsSync(join(path, "build")) && existsSync(join(path, "deps"))) {
        dirs.push({ path, profile: e.name, triple });
      } else if (depth === 0) visit(path, e.name, 1);
    }
  };
  visit(targetDir, null, 0);
  return dirs;
}

/** Sys crate outputs not built against the current prefix: [{ profile, triple, crate, path }]. */
function staleOutputs() {
  const want = existsSync(stampFile) ? readFileSync(stampFile, "utf8") : null;
  const stale = [];
  for (const dir of profileDirs()) {
    for (const entry of readdirSync(join(dir.path, "build"))) {
      const crate = SYS_CRATES.find((c) => new RegExp(`^${c}-[0-9a-f]+$`).test(entry));
      const out = join(dir.path, "build", entry, "out");
      if (!crate || !existsSync(out)) continue;
      const stamp = join(out, "build", CRATE_STAMP);
      const have = existsSync(stamp) ? readFileSync(stamp, "utf8") : null;
      if (want === null || have !== want) stale.push({ ...dir, crate, path: out });
    }
  }
  return stale;
}

/** `cargo clean -p` for every crate and profile with a stale output. */
function cleanStale() {
  const groups = new Map();
  for (const s of staleOutputs()) {
    const key = `${s.triple ?? ""}/${s.profile}`;
    groups.set(key, { ...s, crates: new Set([...(groups.get(key)?.crates ?? []), s.crate]) });
  }
  for (const g of groups.values()) {
    const args = ["clean", "--manifest-path", manifest];
    args.push(...(g.profile === "debug" ? ["--profile", "dev"] : ["--profile", g.profile]));
    if (g.triple) args.push("--target", g.triple);
    for (const c of g.crates) args.push("-p", c);
    console.log(`ggml: ${[...g.crates].join(", ")} in ${g.path} were not built against ${prefix}: cleaning`);
    run("cargo", args);
  }
}

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: root, stdio: "inherit" });
}

function build() {
  const crate = pinnedCrate();
  if (!process.argv.includes("--force") && current(crate)) {
    console.log(`ggml: ${prefix} is up to date (ggml ${crate.ggml} from ${CRATE} ${crate.version})`);
    cleanStale();
    return;
  }
  rmSync(buildDir, { recursive: true, force: true });
  rmSync(prefix, { recursive: true, force: true });
  mkdirSync(buildDir, { recursive: true });
  const defines = Object.entries(options()).map(([k, v]) => `-D${k}=${v}`);
  run("cmake", [
    "-S",
    wrapper,
    "-B",
    buildDir,
    `-DGGML_SOURCE_DIR=${crate.source}`,
    `-DCMAKE_INSTALL_PREFIX=${prefix}`,
    ...defines,
  ]);
  run("cmake", ["--build", buildDir, "--config", "Release", "--parallel", String(availableParallelism())]);
  run("cmake", ["--install", buildDir, "--config", "Release"]);
  if (!libraries().every(existsSync)) fail(`the build did not produce ${libraries().join(", ")}`);
  const stamp = { ...stampOf(crate), built: new Date().toISOString() };
  writeFileSync(stampFile, `${JSON.stringify(stamp, null, 2)}\n`);
  rmSync(buildDir, { recursive: true, force: true });
  console.log(`ggml: built ggml ${crate.ggml} from ${CRATE} ${crate.version} into ${prefix}`);
  // The sys crates keep a copy of the archives in their build output: drop every stale one.
  cleanStale();
}

function verify() {
  const crate = pinnedCrate();
  if (!current(crate)) {
    fail(
      `${prefix} does not hold ggml ${crate.ggml} from ${CRATE} ${crate.version}: run node scripts/ggml.mjs build`,
    );
  }
  const stale = staleOutputs();
  if (stale.length > 0) {
    fail(
      `not built against ${prefix}: ${stale.map((s) => s.path).join(", ")}: run node scripts/ggml.mjs build`,
    );
  }
  console.log(
    `ggml: ${prefix} holds ggml ${crate.ggml} from ${CRATE} ${crate.version}; no stale sys crate output`,
  );
}

const command = process.argv[2];
if (command === "build") build();
else if (command === "verify") verify();
else if (command === "path") console.log(prefix);
else fail("usage: node scripts/ggml.mjs build|verify|path [--force]");
