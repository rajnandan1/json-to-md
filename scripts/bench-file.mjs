// Times convertJsonText over a real JSON document:
//
//   pnpm build && node scripts/bench-file.mjs <file.json> [runs=7]
//
// Reports the median of `runs` timed conversions after one warmup.
import { readFileSync } from "node:fs";
import { convertJsonText } from "../dist/index.js";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/bench-file.mjs <file.json> [runs]");
  process.exit(2);
}
const runs = Number(process.argv[3] ?? 7);
const src = readFileSync(file, "utf8");

const out = convertJsonText(src); // warmup + output size
console.log(
  `input ${(src.length / 1048576).toFixed(1)} MiB -> output ${(out.length / 1048576).toFixed(1)} MiB`,
);

const times = [];
for (let i = 0; i < runs; i++) {
  const t = performance.now();
  convertJsonText(src);
  times.push(performance.now() - t);
}
times.sort((a, b) => a - b);
console.log(
  `median ${times[Math.floor(runs / 2)].toFixed(0)} ms over ${runs} runs ` +
    `(min ${times[0].toFixed(0)}, max ${times[runs - 1].toFixed(0)})`,
);
