// Starts the built app with the in-memory store and waits until it reports that the agenda setup
// view rendered. Exit code 0 on success, 1 otherwise. Usage: node scripts/smoke.mjs [path-to-binary]
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const exe = process.platform === "win32" ? "meeting-companion.exe" : "meeting-companion";
const binary = process.argv[2] ?? join("src-tauri", "target", "release", exe);
if (!existsSync(binary)) {
  console.error(`smoke: ${binary} not found; run "npm run tauri build -- --no-bundle" first`);
  process.exit(1);
}

const child = spawn(binary, [], {
  env: { ...process.env, MEETING_COMPANION_SMOKE: "1" },
  stdio: ["ignore", "pipe", "inherit"],
});
let out = "";
child.stdout.on("data", (d) => {
  out += d;
  process.stdout.write(d);
});
const timer = setTimeout(() => {
  console.error("smoke: timed out");
  child.kill();
  process.exit(1);
}, 120_000);
child.on("exit", (code) => {
  clearTimeout(timer);
  const ok = code === 0 && out.includes("SMOKE OK: agenda-setup rendered");
  console.log(ok ? "smoke: passed" : `smoke: failed (exit ${code})`);
  process.exit(ok ? 0 : 1);
});
