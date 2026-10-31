// The one speaker model the speaker-accuracy test runs with (CAM++ from 3D-Speaker, Apache-2.0, published
// by k2-fsa in the release "speaker-recongition-models"), checked against the SHA-256 pinned in
// src-tauri/native/speaker-model.sha256.
//
// Only this script downloads; the test itself never does. It reads the model from
// MEETING_COMPANION_SPEAKER_MODEL. The app does not use this file: it ships and downloads no model.
//
//   node scripts/speaker-model.mjs fetch            download the pinned model once into src-tauri/native/models/, verify
//   node scripts/speaker-model.mjs verify           verify the downloaded model (exit 1 if missing or altered)
//   node scripts/speaker-model.mjs verify <file>    verify any file against the pin for its name
//   node scripts/speaker-model.mjs path             print the model's path (for MEETING_COMPANION_SPEAKER_MODEL)
//
// Options: --sums <file> (another checksum file, for tests), --dir <folder> (another model folder).
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function option(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
}

const sumsFile = option("--sums", join(root, "src-tauri/native/speaker-model.sha256"));
const modelDir = option("--dir", join(root, "src-tauri/native/models"));

function fail(message) {
  console.error(`speaker-model: ${message}`);
  process.exit(1);
}

/** The pinned model: the one line `<sha256>  <file name>` of the checksum file. */
function pin() {
  const pins = [];
  for (const line of readFileSync(sumsFile, "utf8").split("\n")) {
    const m = /^([0-9a-f]{64}) {2}(\S+\.onnx)$/.exec(line.trim());
    if (m) pins.push({ sha256: m[1], name: m[2] });
  }
  if (pins.length !== 1) fail(`${sumsFile} must pin exactly one model`);
  return pins[0];
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function verify(file) {
  const { sha256: expected, name } = pin();
  if (basename(file) !== name) fail(`${basename(file)} is not the pinned model ${name}`);
  if (!existsSync(file)) fail(`${file} not found; run "node scripts/speaker-model.mjs fetch"`);
  const actual = await sha256(file);
  if (actual !== expected) fail(`checksum mismatch for ${name}: expected ${expected}, got ${actual}`);
  console.log(`speaker-model: ${name} OK (sha256 ${actual})`);
}

async function fetchModel() {
  const { sha256: expected, name } = pin();
  const file = join(modelDir, name);
  if (!existsSync(file)) {
    const url = `${RELEASE}/${name}`;
    console.log(`speaker-model: downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok) fail(`download failed: HTTP ${res.status}`);
    mkdirSync(modelDir, { recursive: true });
    const partial = `${file}.part`;
    writeFileSync(partial, Buffer.from(await res.arrayBuffer()));
    const actual = await sha256(partial);
    if (actual !== expected) {
      rmSync(partial);
      fail(`checksum mismatch for the download of ${name}: expected ${expected}, got ${actual}`);
    }
    renameSync(partial, file);
  }
  await verify(file);
}

const positional = [];
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith("--")) i++;
  else positional.push(process.argv[i]);
}
const [command, arg] = positional;
if (command === "fetch") {
  await fetchModel();
} else if (command === "verify" && arg) {
  await verify(arg);
} else if (command === "verify") {
  await verify(join(modelDir, pin().name));
} else if (command === "path") {
  console.log(join(modelDir, pin().name));
} else {
  fail("usage: node scripts/speaker-model.mjs fetch|verify [file]|path [--sums file] [--dir folder]");
}
