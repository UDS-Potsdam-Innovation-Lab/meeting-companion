// Checks that a macOS binary built without a bundle declares why it uses the microphone (job 017).
//
// macOS shows the microphone prompt only for a process whose Info.plist names NSMicrophoneUsageDescription;
// without one, the capture is refused silently. A bundled app has Contents/Info.plist; a bare binary
// (`npm run tauri build -- --no-bundle`, the debug binary of `tauri dev`) carries src-tauri/Info.plist in
// its Mach-O section `__TEXT,__info_plist` (src-tauri/src/main.rs and tauri::generate_context!).
//
//   node scripts/plist-check.mjs <binary>
//
// Reads the Mach-O load commands itself (thin 64-bit or universal binary, no Xcode tools needed), so the
// tests in src/config.test.ts run on Linux too. Exits 0 when every slice has the section and it holds
// NSMicrophoneUsageDescription with the German text of src-tauri/Info.plist; 1 otherwise.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "NSMicrophoneUsageDescription";
const MH_MAGIC_64 = 0xfeedfacf;
const FAT_MAGIC = 0xcafebabe;
const LC_SEGMENT_64 = 0x19;

const cstr = (buf, at, len) => {
  const raw = buf.subarray(at, at + len);
  const end = raw.indexOf(0);
  return raw.subarray(0, end < 0 ? len : end).toString("latin1");
};

/** The `__TEXT,__info_plist` bytes of one thin 64-bit Mach-O image starting at `base`; null if absent. */
function infoPlistOf(buf, base) {
  if (buf.readUInt32LE(base) !== MH_MAGIC_64) throw new Error("not a 64-bit little-endian Mach-O image");
  const ncmds = buf.readUInt32LE(base + 16);
  let at = base + 32;
  for (let i = 0; i < ncmds; i += 1) {
    const cmd = buf.readUInt32LE(at);
    const size = buf.readUInt32LE(at + 4);
    if (size < 8) throw new Error("corrupt load command");
    if (cmd === LC_SEGMENT_64) {
      const nsects = buf.readUInt32LE(at + 64);
      for (let s = 0; s < nsects; s += 1) {
        const sect = at + 72 + s * 80;
        if (cstr(buf, sect, 16) === "__info_plist" && cstr(buf, sect + 16, 16) === "__TEXT") {
          const bytes = Number(buf.readBigUInt64LE(sect + 40));
          const offset = buf.readUInt32LE(sect + 48);
          return buf.subarray(base + offset, base + offset + bytes);
        }
      }
    }
    at += size;
  }
  return null;
}

/** Every image of a thin or universal binary: [{ arch, base }]. */
function images(buf) {
  if (buf.length >= 4 && buf.readUInt32BE(0) === FAT_MAGIC) {
    const n = buf.readUInt32BE(4);
    return Array.from({ length: n }, (_, i) => ({
      arch: `cputype ${buf.readUInt32BE(8 + i * 20)}`,
      base: buf.readUInt32BE(8 + i * 20 + 8),
    }));
  }
  return [{ arch: "thin", base: 0 }];
}

const decode = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

/** The string value of `key` in an XML plist, or null. */
export function plistString(xml, key) {
  const m = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(xml);
  return m ? decode(m[1]) : null;
}

/** Problems found in `binary`, as sentences; empty when the check holds. */
export function check(binary, expected) {
  let buf;
  try {
    buf = readFileSync(binary);
  } catch (e) {
    return [`cannot read ${binary}: ${e.message}`];
  }
  const problems = [];
  let list;
  try {
    list = images(buf);
  } catch (e) {
    return [`${binary}: ${e.message}`];
  }
  for (const { arch, base } of list) {
    let section;
    try {
      section = infoPlistOf(buf, base);
    } catch (e) {
      problems.push(`${binary} (${arch}): ${e.message}`);
      continue;
    }
    if (!section) {
      problems.push(`${binary} (${arch}) has no __TEXT,__info_plist section`);
      continue;
    }
    const value = plistString(section.toString("utf8"), KEY);
    if (value === null) problems.push(`${binary} (${arch}): the embedded Info.plist has no ${KEY}`);
    else if (value !== expected)
      problems.push(`${binary} (${arch}): ${KEY} differs from src-tauri/Info.plist: "${value}"`);
  }
  return problems;
}

function main(argv) {
  if (!argv[0]) {
    console.error("usage: node scripts/plist-check.mjs <binary>");
    return 1;
  }
  const expected = plistString(readFileSync(join(root, "src-tauri/Info.plist"), "utf8"), KEY);
  if (!expected) {
    console.error(`plist-check: src-tauri/Info.plist has no ${KEY}`);
    return 1;
  }
  const problems = check(argv[0], expected);
  for (const p of problems) console.error(`plist-check: ${p}`);
  if (problems.length === 0) console.log(`plist-check: ${argv[0]} declares ${KEY} (de)`);
  return problems.length === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
