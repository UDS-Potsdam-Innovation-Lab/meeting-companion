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
// A rebuild also runs `cargo clean -p whisper-rs-sys -p llama-cpp-sys-2`: both crates copy the archives
// into their own build output, and a stale copy would bring a second ggml back.
// Options: --force (rebuild even when up to date).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    return JSON.stringify(JSON.parse(readFileSync(stampFile, "utf8"))) === JSON.stringify(stampOf(crate));
  } catch {
    return false;
  }
}

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: root, stdio: "inherit" });
}

function build() {
  const crate = pinnedCrate();
  if (!process.argv.includes("--force") && current(crate)) {
    console.log(`ggml: ${prefix} is up to date (ggml ${crate.ggml} from ${CRATE} ${crate.version})`);
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
  writeFileSync(stampFile, `${JSON.stringify(stampOf(crate), null, 2)}\n`);
  rmSync(buildDir, { recursive: true, force: true });
  console.log(`ggml: built ggml ${crate.ggml} from ${CRATE} ${crate.version} into ${prefix}`);
  // The sys crates keep a copy of the archives in their build output: drop it, so no stale ggml stays.
  if (existsSync(join(root, "src-tauri/target"))) {
    run("cargo", ["clean", "--manifest-path", manifest, "-p", "whisper-rs-sys", "-p", CRATE]);
  }
}

function verify() {
  const crate = pinnedCrate();
  if (!current(crate)) {
    fail(
      `${prefix} does not hold ggml ${crate.ggml} from ${CRATE} ${crate.version}: run node scripts/ggml.mjs build`,
    );
  }
  console.log(`ggml: ${prefix} holds ggml ${crate.ggml} from ${CRATE} ${crate.version}`);
}

const command = process.argv[2];
if (command === "build") build();
else if (command === "verify") verify();
else if (command === "path") console.log(prefix);
else fail("usage: node scripts/ggml.mjs build|verify|path [--force]");
