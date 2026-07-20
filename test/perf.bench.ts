import { bench, describe } from "vitest";
import { convertJsonText } from "../src/index.js";

const TEN_MIB = 10 * 1024 * 1024;

/** Build ~10 MiB of serialized JSON for one representative shape. */
function fixture(kind: "table" | "strings" | "nested" | "mixed"): string {
  const parts: string[] = [];
  let size = 0;
  let i = 0;
  const push = (s: string): void => {
    parts.push(s);
    size += s.length + 1;
  };
  while (size < TEN_MIB) {
    switch (kind) {
      case "table":
        push(JSON.stringify({ id: i, name: "user" + i, active: i % 2 === 0, score: i * 1.5 }));
        break;
      case "strings":
        push(JSON.stringify(`some *markdown* | text <b>tags</b> https://ex.com/${i}\nand newlines`));
        break;
      case "nested":
        push(JSON.stringify({ a: { b: { c: { d: { e: { f: i } } } } } }));
        break;
      case "mixed":
        push(JSON.stringify([i, { a: i, b: [1, 2, { c: true }] }, null, "s" + i]));
        break;
    }
    i++;
  }
  return "[" + parts.join(",") + "]";
}

// Baseline for the 10 MiB performance target; guard against ~20% regressions.
describe("10 MiB conversion", () => {
  for (const kind of ["table", "strings", "nested", "mixed"] as const) {
    const src = fixture(kind);
    bench(kind, () => {
      convertJsonText(src);
    });
  }
});
