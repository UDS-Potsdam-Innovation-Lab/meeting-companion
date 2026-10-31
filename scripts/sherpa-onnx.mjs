// The prebuilt sherpa-onnx static libraries the `sherpa-onnx-sys` crate links, checked against the
// SHA-256 pinned in src-tauri/native/sherpa-onnx.sha256 (one line per target, as GitHub publishes them).
//
// The crate's build script would otherwise download the archive itself without checking it. Instead,
// this script downloads the archive once (src-tauri/native/archive/), checks it, and unpacks its
// libraries into src-tauri/native/lib/, and the repository's .cargo/config.toml points the build at that
// folder (SHERPA_ONNX_LIB_DIR). A build therefore only ever links libraries from a verified archive, and
// fails if there are none. lib/SOURCE records the archive and checksum they came from.
//
// On Linux the libraries are built with GCC 11 against an older libstdc++, and whisper.cpp is compiled
// on the build machine. Both contain inline C++ standard-library templates (std::regex) under the same
// names, and the linker keeps one copy for both: with a newer GCC the layouts differ and onnxruntime
// crashes on start. The unpack step therefore gives the weak standard-library symbols of the sherpa
// libraries their own names (objcopy --redefine-syms, suffix ".mcsherpa"), so each side keeps its own
// copy. Nothing else in the libraries changes.
//
//   node scripts/sherpa-onnx.mjs fetch            download this platform's archive once, verify, unpack
//   node scripts/sherpa-onnx.mjs verify           verify the archive and that lib/ came from it (exit 1 if not)
//   node scripts/sherpa-onnx.mjs verify <file>    verify any file against the pin for its name
//
// Options: --sums <file> (another checksum file, for tests), --dir <folder> (another archive folder),
// --target <os>-<arch> (e.g. linux-x64; default: this machine).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "2.0.1";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function option(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
}

const sumsFile = option("--sums", join(root, "src-tauri/native/sherpa-onnx.sha256"));
const archiveDir = option("--dir", join(root, "src-tauri/native/archive"));
const libDir = join(root, "src-tauri/native/lib");
const SUFFIX = ".mcsherpa";

/** The archive name the crate's build script expects for a target (see sherpa-onnx-sys build.rs). */
function archiveFor(target) {
  const names = {
    "linux-x64": "linux-x64-static-lib",
    "linux-arm64": "linux-aarch64-static-lib",
    "darwin-x64": "osx-x64-static-lib",
    "darwin-arm64": "osx-arm64-static-lib",
    "win32-x64": "win-x64-static-MT-Release-lib",
    "win32-arm64": "win-arm64-static-MT-Release-lib",
  };
  const name = names[target];
  if (!name) fail(`no sherpa-onnx archive for ${target}`);
  return `sherpa-onnx-v${VERSION}-${name}.tar.bz2`;
}

function pins() {
  const map = new Map();
  for (const line of readFileSync(sumsFile, "utf8").split("\n")) {
    const m = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line.trim());
    if (m) map.set(m[2], m[1]);
  }
  return map;
}

function fail(message) {
  console.error(`sherpa-onnx: ${message}`);
  process.exit(1);
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function verify(file) {
  const expected = pins().get(basename(file));
  if (!expected) fail(`${basename(file)} has no pinned checksum`);
  if (!existsSync(file)) fail(`${file} not found; run "node scripts/sherpa-onnx.mjs fetch"`);
  const actual = await sha256(file);
  if (actual !== expected) {
    fail(`checksum mismatch for ${basename(file)}: expected ${expected}, got ${actual}`);
  }
  console.log(`sherpa-onnx: ${basename(file)} OK (sha256 ${actual})`);
}

function sourceLine(name) {
  return `${pins().get(name)}  ${name}\n`;
}

/** Unpacks the verified archive's libraries into lib/ (renaming the weak std symbols on Linux). */
function unpack(file, target) {
  const name = basename(file);
  const work = mkdtempSync(join(tmpdir(), "sherpa-onnx-"));
  try {
    execFileSync("tar", ["-xjf", file, "-C", work], { stdio: "inherit" });
    const src = join(work, name.replace(/\.tar\.bz2$/, ""), "lib");
    const libs = readdirSync(src).filter((f) => /\.(a|lib)$/.test(f));
    if (libs.length === 0) fail(`${name} holds no libraries`);
    rmSync(libDir, { recursive: true, force: true });
    mkdirSync(libDir, { recursive: true });
    if (target.startsWith("linux-")) {
      const names = new Set();
      for (const lib of libs) {
        const out = execFileSync("nm", [join(src, lib)], {
          maxBuffer: 1 << 30,
          stdio: ["ignore", "pipe", "ignore"],
        });
        for (const line of out.toString().split("\n")) {
          const [, kind, sym] = line.trim().split(/\s+/).length === 3 ? line.trim().split(/\s+/) : [];
          // Weak definitions and COMDAT group signatures of the C++ standard library, except type info
          // (kept shared, so exceptions and RTTI still match libstdc++).
          if (/^[WVn]$/.test(kind ?? "") && /^(_ZN?K?St|_ZTVN?St)/.test(sym ?? "") && !/^_ZT[IS]/.test(sym)) {
            names.add(sym);
          }
        }
      }
      const map = join(work, "rename.map");
      writeFileSync(map, [...names].map((n) => `${n} ${n}${SUFFIX}`).join("\n") + "\n");
      for (const lib of libs) {
        execFileSync("objcopy", [`--redefine-syms=${map}`, join(src, lib), join(libDir, lib)], {
          stdio: "inherit",
        });
      }
      console.log(`sherpa-onnx: gave ${names.size} weak standard-library symbols their own names`);
    } else {
      for (const lib of libs) renameSync(join(src, lib), join(libDir, lib));
    }
    writeFileSync(join(libDir, "SOURCE"), sourceLine(name));
    console.log(`sherpa-onnx: unpacked ${libs.length} libraries into ${libDir}`);
    console.log(
      'sherpa-onnx: run "cargo clean --manifest-path src-tauri/Cargo.toml -p sherpa-onnx-sys" if it was built before',
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The libraries in lib/ came from this archive (its pinned checksum). */
function verifyLibs(name) {
  const source = join(libDir, "SOURCE");
  if (!existsSync(source) || readFileSync(source, "utf8") !== sourceLine(name)) {
    fail(`${libDir} was not unpacked from the pinned ${name}; run "node scripts/sherpa-onnx.mjs fetch"`);
  }
  console.log(`sherpa-onnx: ${libDir} comes from ${name}`);
}

async function fetchArchive(name) {
  const file = join(archiveDir, name);
  if (!existsSync(file)) {
    const url = `https://github.com/k2-fsa/sherpa-onnx/releases/download/v${VERSION}/${name}`;
    console.log(`sherpa-onnx: downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok) fail(`download failed: HTTP ${res.status}`);
    mkdirSync(archiveDir, { recursive: true });
    const partial = `${file}.part`;
    writeFileSync(partial, Buffer.from(await res.arrayBuffer()));
    const expected = pins().get(name);
    const actual = await sha256(partial);
    if (actual !== expected) {
      rmSync(partial);
      fail(`checksum mismatch for the download of ${name}: expected ${expected}, got ${actual}`);
    }
    renameSync(partial, file);
  }
  await verify(file);
  const source = join(libDir, "SOURCE");
  if (!existsSync(source) || readFileSync(source, "utf8") !== sourceLine(name)) unpack(file, target);
  verifyLibs(name);
}

const positional = [];
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith("--")) i++;
  else positional.push(process.argv[i]);
}
const [command, arg] = positional;
const target = option("--target", `${process.platform}-${process.arch}`);
if (command === "fetch") {
  await fetchArchive(archiveFor(target));
} else if (command === "verify" && arg) {
  await verify(arg);
} else if (command === "verify") {
  await verify(join(archiveDir, archiveFor(target)));
  verifyLibs(archiveFor(target));
} else {
  fail(
    "usage: node scripts/sherpa-onnx.mjs fetch|verify [file] [--sums file] [--dir folder] [--target os-arch]",
  );
}
