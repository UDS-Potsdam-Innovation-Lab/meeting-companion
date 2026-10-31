// Generates the open-source licence list of "Help & legal" (src/features/help/licences.json) from the
// lockfiles: every Rust crate the app links (normal dependencies of src-tauri, for every target
// platform, from `cargo metadata`), every npm package in the shipped UI bundle (the non-dev packages of
// package-lock.json), and the native code listed in scripts/licences-native.json. Each entry carries
// name, version, SPDX licence expression and the full licence texts the component ships (LICENSE*,
// COPYING*, UNLICENSE, NOTICE). A component without a licence file gets the standard text of its
// licence from scripts/licence-texts/, with its authors as the copyright line.
//
// Run after a dependency change and commit the output:
//   node scripts/licences.mjs           write src/features/help/licences.json
//   node scripts/licences.mjs --check   exit 1 if the committed file is out of date
//
// `cargo metadata` needs the sources of every crate in Cargo.lock (all platforms); cargo fetches
// missing ones from crates.io. The app and its tests never run this script.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "src/features/help/licences.json");
const TEMPLATES = join(root, "scripts/licence-texts");
const LICENCE_FILE = /^(licen[cs]e|copying|unlicense|notice|copyright)([-._ ].*)?$/i;
/** Order in which one licence is picked from an `OR` expression when a standard text is needed. */
const PREFERRED = [
  "MIT",
  "Apache-2.0",
  "Zlib",
  "BSD-3-Clause",
  "BSD-2-Clause",
  "ISC",
  "Unlicense",
  "MPL-2.0",
];
const MAX_TEXT_BYTES = 200 * 1024;

function fail(message) {
  console.error(`licences: ${message}`);
  process.exit(1);
}

const texts = new Map();
/** Stores a text once and returns its id. */
function addText(text) {
  const clean = text
    .replace(/\r\n?/g, "\n")
    .replace(/^\uFEFF/, "")
    .trim();
  if (!clean) return null;
  const id = createHash("sha256").update(clean).digest("hex").slice(0, 12);
  texts.set(id, clean);
  return id;
}

function licenceFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => LICENCE_FILE.test(f) && !/\.(spdx|json|toml|rs|js|ts|html)$/i.test(f))
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).isFile() && statSync(p).size <= MAX_TEXT_BYTES)
    .sort();
}

/** `MIT/Apache-2.0` and `Apache-2.0 / MIT` are old spellings of `OR`. */
function normalise(expr) {
  return expr
    .replace(/\s*\/\s*/g, " OR ")
    .replace(/\s+/g, " ")
    .trim();
}

function template(expr, copyright) {
  const ids = expr.match(/[A-Za-z0-9.+-]+/g)?.filter((t) => !["OR", "AND", "WITH"].includes(t)) ?? [];
  const pick = PREFERRED.find((p) => ids.includes(p));
  if (!pick) fail(`no standard text for "${expr}"`);
  const file = join(TEMPLATES, `${pick}.txt`);
  if (!existsSync(file)) fail(`missing ${file}`);
  const body = readFileSync(file, "utf8");
  return body.includes("{copyright}")
    ? body.replace("{copyright}", copyright)
    : copyright
      ? `${copyright}\n\n${body}`
      : body;
}

/** A file this short only points to other files ("MIT OR Apache-2.0"); it is not a licence text. */
const MIN_TEXT_CHARS = 200;

function textsOf(files, expr, copyright) {
  const ids = files.map((f) => addText(readFileSync(f, "utf8"))).filter(Boolean);
  if (ids.some((id) => texts.get(id).length >= MIN_TEXT_CHARS)) return ids;
  return [...ids, addText(template(expr, copyright))];
}

// ---- Rust -------------------------------------------------------------------------------------------
function rustComponents() {
  const meta = spawnSync(
    "cargo",
    ["metadata", "--format-version", "1", "--locked", "--manifest-path", join(root, "src-tauri/Cargo.toml")],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (meta.status !== 0) fail(`cargo metadata failed:\n${meta.stderr}`);
  const { packages, resolve } = JSON.parse(meta.stdout);
  const byId = new Map(packages.map((p) => [p.id, p]));
  const nodes = new Map(resolve.nodes.map((n) => [n.id, n]));
  // Normal dependencies only (no build or dev dependencies), for every target platform.
  const shipped = new Set();
  const stack = [resolve.root];
  while (stack.length) {
    for (const dep of nodes.get(stack.pop()).deps) {
      if (dep.dep_kinds.some((k) => k.kind === null) && !shipped.has(dep.pkg)) {
        shipped.add(dep.pkg);
        stack.push(dep.pkg);
      }
    }
  }
  const out = [];
  const dirs = new Map();
  for (const id of shipped) {
    const p = byId.get(id);
    if (!p.license) fail(`${p.name} ${p.version} has no licence expression`);
    const licence = normalise(p.license);
    const dir = dirname(p.manifest_path);
    dirs.set(p.name, { dir, version: p.version });
    const authors = p.authors.length ? p.authors.join(", ") : `the ${p.name} authors`;
    out.push({
      name: p.name,
      version: p.version,
      licence,
      kind: "rust",
      texts: textsOf(licenceFiles(dir), licence, `Copyright (c) ${authors}`),
    });
  }
  return { out, dirs };
}

// ---- npm --------------------------------------------------------------------------------------------
function npmComponents() {
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const out = [];
  for (const [path, p] of Object.entries(lock.packages)) {
    if (!path || p.dev || p.devOptional) continue;
    const name = path.replace(/^.*node_modules\//, "");
    const dir = join(root, path);
    if (!existsSync(dir)) fail(`${path} is not installed; run npm ci first`);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    if (pkg.version !== p.version) fail(`${name}: installed ${pkg.version}, locked ${p.version}`);
    const licence = normalise(p.license ?? pkg.license ?? fail(`${name} has no licence`));
    const author = typeof pkg.author === "string" ? pkg.author : pkg.author?.name;
    out.push({
      name,
      version: p.version,
      licence,
      kind: "npm",
      texts: textsOf(licenceFiles(dir), licence, `Copyright (c) ${author ?? `the ${name} authors`}`),
    });
  }
  return out;
}

// ---- native -----------------------------------------------------------------------------------------
function nativeComponents(rustDirs) {
  const list = JSON.parse(readFileSync(join(root, "scripts/licences-native.json"), "utf8")).components;
  return list.map((c) => {
    let version = c.version ?? null;
    let files = [];
    if (version?.startsWith("from:")) {
      const crate = rustDirs.get(version.slice(5)) ?? fail(`${c.name}: no crate ${version.slice(5)}`);
      const cmake = readFileSync(join(crate.dir, "whisper.cpp/CMakeLists.txt"), "utf8");
      version = cmake.match(/project\("whisper\.cpp" VERSION ([\d.]+)\)/)?.[1] ?? fail("whisper.cpp version");
    }
    if (c.textFrom) {
      const [crate, file] = c.textFrom.split(":");
      files = [join((rustDirs.get(crate) ?? fail(`${c.name}: no crate ${crate}`)).dir, file)];
    }
    const via = c.via ? `${c.via} ${(rustDirs.get(c.via) ?? fail(`no crate ${c.via}`)).version}` : null;
    return {
      name: c.name,
      version,
      licence: c.licence,
      kind: "native",
      via,
      texts: textsOf(files, c.licence, c.copyright ?? ""),
    };
  });
}

const { out: rust, dirs } = rustComponents();
const components = [...nativeComponents(dirs), ...rust, ...npmComponents()].sort(
  (a, b) => a.name.localeCompare(b.name, "en") || a.version?.localeCompare(b.version ?? "") || 0,
);
const used = new Set(components.flatMap((c) => c.texts));
const result = {
  generatedBy: "scripts/licences.mjs",
  components,
  texts: Object.fromEntries([...texts].filter(([id]) => used.has(id)).sort(([a], [b]) => a.localeCompare(b))),
};
const json = `${JSON.stringify(result, null, 1)}\n`;

if (process.argv.includes("--check")) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (current !== json) fail(`${OUT} is out of date; run "node scripts/licences.mjs"`);
  console.log(`licences: up to date (${components.length} components)`);
} else {
  writeFileSync(OUT, json);
  console.log(`licences: ${components.length} components, ${used.size} distinct texts → ${OUT}`);
}
