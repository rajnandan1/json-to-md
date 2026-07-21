// Cross-implementation fuzz differ for the parity contract: generates random
// JSON documents, runs the built TS library and the Go CLI on each, and
// byte-compares output (or error codes via --json). Zero diffs expected.
//
//   pnpm build && node scripts/fuzz-diff.mjs [count] [seed]
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { convertJsonText, JsonToMarkdownError } from "../dist/index.js";

const count = Number(process.argv[2] ?? 300);
const seed = Number(process.argv[3] ?? Date.now() % 2147483647);
console.log(`fuzz-diff: ${count} documents, seed ${seed}`);

// Deterministic PRNG so failures reproduce from the printed seed.
let state = seed || 1;
function rand() {
  state = (state * 48271) % 2147483647;
  return state / 2147483647;
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const intBelow = (n) => Math.floor(rand() * n);

const keyPool = ["a", "b", "name", "value", "", "x y", "a/b~c", "#tag", "😀", "ключ", "ΑΣ", "ΝΙΚΟΣ Β", "k".repeat(30)];
const stringPool = [
  "plain",
  "",
  "  spaced  out ",
  "# heading *bold* [link](x) | pipe",
  "line1\nline2",
  "tab\tandbell",
  "emoji 😀 and é",
  "https://example.com/path?q=1",
  "See https://example.com",
  "12. numbered",
  "- dash",
  "a&b<c>d`e~f_g\\h",
  "ΤΕΛΟΣ Σ İstanbul",
];
const numberPool = [0, -0, 1, 3.14, -2.5e10, 1e-7, 9007199254740993, 123456789.000001];

function genValue(depth) {
  const scalars = () => {
    const kind = intBelow(4);
    if (kind === 0) return null;
    if (kind === 1) return rand() < 0.5;
    if (kind === 2) return pick(numberPool);
    return pick(stringPool);
  };
  if (depth <= 0 || rand() < 0.35) return scalars();
  if (rand() < 0.5) {
    const n = intBelow(4);
    // Bias toward object-only arrays so Tabular Arrays and Detail Sections appear.
    if (rand() < 0.5) {
      return Array.from({ length: n + 1 }, () => genObject(depth - 1));
    }
    return Array.from({ length: n }, () => genValue(depth - 1));
  }
  return genObject(depth - 1);
}

function genObject(depth) {
  const obj = {};
  const n = intBelow(4);
  for (let i = 0; i < n; i++) obj[pick(keyPool) + (rand() < 0.3 ? String(i) : "")] = genValue(depth - 1);
  return obj;
}

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const bin = join(mkdtempSync(join(tmpdir(), "json-to-md-fuzz-")), "json-to-md");
execFileSync("go", ["build", "-o", bin, "./cmd/json-to-md"], { cwd: join(repoRoot, "go") });

let failures = 0;
for (let i = 0; i < count; i++) {
  const doc = JSON.stringify(genValue(4));

  let tsOut = null;
  let tsCode = null;
  try {
    tsOut = convertJsonText(doc);
  } catch (e) {
    if (!(e instanceof JsonToMarkdownError)) throw e;
    tsCode = e.code;
  }

  const res = spawnSync(bin, ["--json"], { input: doc, encoding: "utf8", maxBuffer: 1 << 28 });
  const goOut = res.status === 0 ? res.stdout : null;
  const goCode = res.status === 1 ? JSON.parse(res.stderr).code : null;

  if (tsOut !== goOut || tsCode !== goCode) {
    failures++;
    const reproPath = join(tmpdir(), `json-to-md-fuzz-repro-${seed}-${i}.json`);
    writeFileSync(reproPath, doc);
    console.error(`DIFF at doc ${i} (repro: ${reproPath})`);
    console.error(`  ts:  ${tsCode ? `error ${tsCode}` : JSON.stringify(tsOut?.slice(0, 200))}`);
    console.error(`  go:  ${goCode ? `error ${goCode}` : JSON.stringify(goOut?.slice(0, 200))}`);
    if (failures >= 5) break;
  }
}

if (failures > 0) {
  console.error(`fuzz-diff: ${failures} divergence(s)`);
  process.exit(1);
}
console.log("fuzz-diff: all outputs byte-identical");
