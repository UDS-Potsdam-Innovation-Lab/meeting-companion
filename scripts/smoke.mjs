// Starts the built app with the in-memory store, the fake microphone, speech engine, diarizer and language model, and
// waits until it reports that the agenda setup view rendered. Exit code 0 on success, 1 otherwise. Usage: node scripts/smoke.mjs [path-to-binary]
// On Linux (/proc) and macOS (lsof, job 017) it also scans the app's sockets while it runs: the app must
// listen on no port (the phone web view of job 012 opens one only when a person asks for it during a
// recording). It fails when the app has a listening TCP or bound UDP socket, and when no scan succeeded.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { scannerFor } from "./sockets.mjs";

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
    MEETING_COMPANION_LLM: "fake",
  },
  stdio: ["ignore", "pipe", "inherit"],
});

// One scan at a time (lsof takes a moment on macOS); every finished scan counts.
const scanner = scannerFor();
let scans = 0;
let running = null;
const ports = new Set();
const scanOnce = () => {
  if (running) return running;
  running = scanner(child.pid).then((found) => {
    running = null;
    if (found === null) return;
    scans += 1;
    for (const p of found) ports.add(p);
  });
  return running;
};
const interval = scanner ? setInterval(scanOnce, process.platform === "linux" ? 100 : 250) : null;

let out = "";
child.stdout.on("data", (d) => {
  out += d;
  process.stdout.write(d);
  // The UI is up: the last moment to look before the smoke run exits.
  if (scanner && out.includes("SMOKE OK")) scanOnce();
});
const timer = setTimeout(() => {
  console.error("smoke: timed out");
  child.kill();
  process.exit(1);
}, 120_000);
child.on("exit", async (code) => {
  clearTimeout(timer);
  if (interval) clearInterval(interval);
  // A scan still running sees the process gone and counts nothing; wait for it before judging.
  if (running) await running;
  let ok = code === 0 && out.includes("SMOKE OK: agenda-setup rendered");
  if (scanner) {
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
