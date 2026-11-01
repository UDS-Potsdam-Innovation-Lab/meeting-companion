// Checks the built app for the promises of job 016, on its symbol table (ELF, Linux CI):
//
//   - one ggml: none of the ggml/gguf symbols below is defined more than once. whisper.cpp and llama.cpp
//     each vendor a ggml; two copies in one binary mean one engine runs on the other's ggml.
//   - both engines are linked: whisper.cpp's and llama.cpp's model loaders are defined.
//   - no HTTP client: no cpp-httplib, curl or llama-server symbol (the `common` and server parts of
//     llama.cpp stay out).
//
//   node scripts/ggml-check.mjs <binary>            read the symbols with `nm` (binutils)
//   node scripts/ggml-check.mjs --symbols <file>    read a recorded `nm` listing (the tests' fixtures)
//
// Exits 0 when every check holds, 1 otherwise (also when the binary has no symbol table: a stripped
// binary cannot be checked).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Defined at most once: the ggml entry points both engines use, and whisper's GGUF loader. */
export const ONE_COPY = [
  "ggml_init",
  "ggml_free",
  "ggml_log_set",
  "ggml_graph_compute",
  "ggml_backend_cpu_init",
  "ggml_backend_cpu_reg",
  "ggml_backend_load_all",
  "gguf_init_from_file",
  "gguf_init_from_file_impl",
  "gguf_get_n_tensors",
];

/** Must be defined: the model loaders of whisper.cpp and llama.cpp. */
export const REQUIRED = ["whisper_init_from_file_with_params_no_state", "llama_model_load_from_file"];

/** Must not occur at all (defined or referenced): an HTTP client or llama.cpp's server. */
export const FORBIDDEN = [
  { what: "cpp-httplib", pattern: /httplib/i },
  { what: "curl", pattern: /(^|[^A-Za-z0-9])(curl_(easy|multi|global|share|url)_\w+|Curl_\w+)/ },
  { what: "llama-server", pattern: /llama[-_]server|server_context|server_http_context|server_routes/ },
];

/** Parses `nm` output into `{ name, type }` (undefined symbols have type U, w or v). */
export function parseNm(text) {
  const symbols = [];
  for (const line of text.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const name = parts[parts.length - 1];
    const type = parts[parts.length - 2];
    if (!/^[A-Za-z?-]$/.test(type)) continue;
    symbols.push({ name, type });
  }
  return symbols;
}

const defined = (s) => !["U", "w", "v"].includes(s.type);

/** The problems found, as sentences; empty when every check holds. */
export function check(symbols) {
  const problems = [];
  if (symbols.length === 0) return ["the binary has no symbol table (stripped?): nothing to check"];
  const counts = new Map();
  for (const s of symbols) if (defined(s)) counts.set(s.name, (counts.get(s.name) ?? 0) + 1);
  for (const name of ONE_COPY) {
    const n = counts.get(name) ?? 0;
    if (n > 1) problems.push(`${name} is defined ${n} times: more than one ggml is linked`);
  }
  for (const name of REQUIRED) {
    if (!counts.has(name)) problems.push(`${name} is missing: an engine is not linked`);
  }
  for (const { what, pattern } of FORBIDDEN) {
    const hits = [...new Set(symbols.filter((s) => pattern.test(s.name)).map((s) => s.name))];
    if (hits.length > 0) problems.push(`${what} symbols are linked: ${hits.slice(0, 3).join(", ")}`);
  }
  return problems;
}

function main(argv) {
  let text;
  const i = argv.indexOf("--symbols");
  if (i >= 0) {
    if (!argv[i + 1]) return usage();
    text = readFileSync(argv[i + 1], "utf8");
  } else {
    if (!argv[0]) return usage();
    try {
      text = execFileSync("nm", ["--no-demangle", argv[0]], {
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      console.error(`ggml-check: nm could not read ${argv[0]}: ${String(e.stderr ?? e.message).trim()}`);
      return 1;
    }
  }
  const problems = check(parseNm(text));
  for (const p of problems) console.error(`ggml-check: ${p}`);
  if (problems.length === 0) {
    console.log(
      `ggml-check: one ggml, both engines linked, no HTTP client (${ONE_COPY.length} symbols checked)`,
    );
  }
  return problems.length === 0 ? 0 : 1;
}

function usage() {
  console.error("usage: node scripts/ggml-check.mjs <binary> | --symbols <nm-listing>");
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
