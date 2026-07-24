import { describe, expect, it } from "vitest";
import { convertJsonText, convertJsonValue } from "../src/index.js";

// Depths chosen to exceed this platform's native recursion cliff (~8.8k frames)
// while keeping the quadratic Output Document size within host memory. A renderer
// that leaned on the call stack would overflow here; an iterative one does not.
describe("no converter-defined nesting limit (ADR-0004)", () => {
  it("renders deeply nested objects without a stack overflow", () => {
    let value: unknown = 1;
    for (let i = 0; i < 12_000; i++) value = { n: value };
    const md = convertJsonValue(value);
    expect(md.startsWith("# Results\n")).toBe(true);
    expect(md.endsWith("\n")).toBe(true);
  });

  it("renders deeply nested arrays without a stack overflow", () => {
    let value: unknown = 1;
    for (let i = 0; i < 12_000; i++) value = [value];
    const md = convertJsonValue(value);
    expect(md.startsWith("# Results\n")).toBe(true);
  });

  it("renders deeply nested detail sections without a stack overflow", () => {
    // Each level is a one-row table whose only cell is a nested one-object array,
    // forcing a chain of Detail Sections through the same iterative task stack.
    let inner = "1";
    for (let i = 0; i < 2_000; i++) inner = `[{"a":${inner}}]`;
    const md = convertJsonText(inner);
    expect(md.startsWith("# Results\n")).toBe(true);
  });
});

describe("heading range transitions", () => {
  it("switches object keys to list form after H6", () => {
    const md = convertJsonValue({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } });
    expect(md).toContain("###### e");
    expect(md).toContain("- **f**");
    expect(md).toContain("  - **g:** 1");
    expect(md).not.toContain("#######");
  });

  it("caps Detail headings at H6 instead of emitting H7", () => {
    // Nest tables five deep so the innermost detail heading would want H7.
    const value = {
      l1: [{ l2: [{ l3: [{ l4: [{ l5: [{ leaf: 1 }] }] }] }] }],
    };
    const md = convertJsonText(JSON.stringify(value));
    expect(md).not.toContain("#######");
    expect(md).toContain("###### /l1/0/l2/0/l3/0/l4/0/l5");
  });
});
