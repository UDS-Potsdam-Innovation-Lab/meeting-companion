// Starts the built app with the in-memory store, the fake microphone, speech engine and diarizer, and
// waits until it reports that the agenda setup view rendered. Exit code 0 on success, 1 otherwise. Usage: node scripts/smoke.mjs [path-to-binary]
// On Linux it also scans the app's sockets while it runs: the app must listen on no port (the phone web
// view of job 012 opens one only when a person asks for it during a recording).
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";

const exe = process.platform === "win32" ? "meeting-companion.exe" : "meeting-companion";
const binary = process.argv[2] ?? join("src-tauri", "target", "release", exe);
if (!existsSync(binary)) {
  console.error(`smoke: ${binary} not found; run "npm run tauri build -- --no-bundle" first`);
  process.exit(1);
}

const child = spawn(binary, [], {
  env: {
    ...process.env,
    MEETING_COMPANION_SMOKE: "1",
    MEETING_COMPANION_AUDIO: "fake",
    MEETING_COMPANION_STT: "fake",
    MEETING_COMPANION_DIARIZE: "fake",
  },
  stdio: ["ignore", "pipe", "inherit"],
});

/**
 * The listening TCP sockets and bound UDP sockets of process `pid` (from /proc), as "proto address:port"
 * in /proc's hex notation; null if the process is gone.
 */
function openPorts(pid) {
  try {
    const inodes = new Set(
      readdirSync(`/proc/${pid}/fd`)
        .map((fd) => {
          try {
            return /^socket:\[(\d+)\]$/.exec(readlinkSync(`/proc/${pid}/fd/${fd}`))?.[1];
          } catch {
            return undefined;
          }
        })
        .filter(Boolean),
    );
    const found = [];
    for (const proto of ["tcp", "tcp6", "udp", "udp6"]) {
      const lines = readFileSync(`/proc/${pid}/net/${proto}`, "utf8").trim().split("\n").slice(1);
      for (const line of lines) {
        const f = line.trim().split(/\s+/);
        const listening = proto.startsWith("tcp") ? f[3] === "0A" : true;
        if (listening && inodes.has(f[9])) found.push(`${proto} ${f[1]}`);
      }
    }
    return found;
  } catch {
    return null;
  }
}

const scan = process.platform === "linux";
let scans = 0;
const ports = new Set();
const scanOnce = () => {
  const found = openPorts(child.pid);
  if (found === null) return;
  scans += 1;
  for (const p of found) ports.add(p);
};
const scanner = scan ? setInterval(scanOnce, 100) : null;

let out = "";
child.stdout.on("data", (d) => {
  out += d;
  process.stdout.write(d);
  // The UI is up: the last moment to look before the smoke run exits.
  if (scan && out.includes("SMOKE OK")) scanOnce();
});
const timer = setTimeout(() => {
  console.error("smoke: timed out");
  child.kill();
  process.exit(1);
}, 120_000);
child.on("exit", (code) => {
  clearTimeout(timer);
  if (scanner) clearInterval(scanner);
  let ok = code === 0 && out.includes("SMOKE OK: agenda-setup rendered");
  if (scan) {
    if (scans === 0) {
      console.error("smoke: could not scan the app's sockets");
      ok = false;
    } else if (ports.size > 0) {
      console.error(`smoke: the app opened network ports: ${[...ports].join(", ")}`);
      ok = false;
    } else {
      console.log(`smoke: no listening port (${scans} scans)`);
    }
  }
  console.log(ok ? "smoke: passed" : `smoke: failed (exit ${code})`);
  process.exit(ok ? 0 : 1);
});
