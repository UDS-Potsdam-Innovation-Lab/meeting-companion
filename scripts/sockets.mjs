// The open network sockets of a running process, for the smoke test's "no listening port" check
// (NFR Security). Linux reads /proc; macOS (job 017) asks `lsof`. Both return the listening TCP sockets
// and bound UDP sockets as strings, or null when the scan could not run (the caller must then fail: a
// scan that did not run is never a pass).
//
//   node scripts/sockets.mjs --lsof <file> <pid>   parse a recorded `lsof -F` listing (the tests' fixtures);
//                                                  prints the open sockets, exit 0 if none, 1 otherwise
//                                                  (also when the listing is not a scan of <pid>)
import { execFile } from "node:child_process";
import { readFileSync, readdirSync, readlinkSync } from "node:fs";

/** The `lsof` arguments of one scan: every file of `pid` (so a successful scan always lists the process),
 * machine-readable fields fd, type, protocol, name and TCP state. */
export const LSOF_ARGS = (pid) => ["-a", "-p", String(pid), "-n", "-P", "-F", "ftPnT", "-Tqs"];

/**
 * Parses `lsof -F ftPnT -Tqs` output. Returns null unless it is a listing of process `pid` (the `p` line),
 * else the sockets that count as open: TCP in state LISTEN, and UDP bound to a local port (an unbound
 * `*:*` UDP socket does not count). Outbound TCP connections (`a:1->b:2`, ESTABLISHED) do not count.
 */
export function parseLsof(text, pid) {
  let seen = false;
  const files = [];
  let file = null;
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    const field = line[0];
    const value = line.slice(1);
    if (field === "p") {
      seen = seen || value === String(pid);
      file = null;
    } else if (field === "f") {
      file = { fd: value, type: "", proto: "", name: "", state: "" };
      files.push(file);
    } else if (file && field === "t") file.type = value;
    else if (file && field === "P") file.proto = value;
    else if (file && field === "n") file.name = value;
    else if (file && field === "T" && value.startsWith("ST=")) file.state = value.slice(3);
  }
  if (!seen) return null;
  const open = [];
  for (const f of files) {
    if (f.type !== "IPv4" && f.type !== "IPv6") continue;
    const local = f.name.split("->")[0];
    const port = local.slice(local.lastIndexOf(":") + 1);
    if (f.proto === "TCP" && f.state === "LISTEN") open.push(`tcp ${local} (LISTEN)`);
    else if (f.proto === "UDP" && port !== "*" && port !== "0") open.push(`udp ${local}`);
  }
  return open;
}

/** One `lsof` scan of `pid`: the open sockets, or null when lsof is missing or the scan failed. */
export function scanLsof(pid) {
  return new Promise((resolve) => {
    execFile("lsof", LSOF_ARGS(pid), { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      // lsof exits 1 when one of its selections found nothing; with every file of a live process
      // selected, a good scan exits 0 and names the process.
      if (err) return resolve(null);
      resolve(parseLsof(stdout, pid));
    });
  });
}

/**
 * The listening TCP sockets and bound UDP sockets of process `pid` (from /proc), as "proto address:port"
 * in /proc's hex notation; null if the process is gone.
 */
export function scanProc(pid) {
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

/** The scanner of this platform (a promise of the open sockets or null), or null where none exists. */
export function scannerFor(platform = process.platform) {
  if (platform === "linux") return async (pid) => scanProc(pid);
  if (platform === "darwin") return scanLsof;
  return null;
}

function main(argv) {
  const i = argv.indexOf("--lsof");
  if (i < 0 || !argv[i + 1] || !argv[i + 2]) {
    console.error("usage: node scripts/sockets.mjs --lsof <lsof-listing> <pid>");
    return 1;
  }
  const open = parseLsof(readFileSync(argv[i + 1], "utf8"), argv[i + 2]);
  if (open === null) {
    console.error(`sockets: the listing is not a scan of process ${argv[i + 2]}`);
    return 1;
  }
  for (const s of open) console.error(`sockets: open: ${s}`);
  if (open.length === 0) console.log("sockets: no listening or bound socket");
  return open.length === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
