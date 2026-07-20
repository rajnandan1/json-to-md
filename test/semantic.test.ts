import fc from "fast-check";
import { Lexer, marked } from "marked";
import { describe, expect, it } from "vitest";
import GithubSlugger from "github-slugger";
import { convertJsonValue } from "../src/index.js";

/** Recompute the heading fragment set a GFM renderer would allocate for this document. */
function headingFragments(md: string): Set<string> {
  const slugger = new GithubSlugger();
  const fragments = new Set<string>();
  for (const token of Lexer.lex(md)) {
    if (token.type === "heading") fragments.add(slugger.slug(token.text));
  }
  return fragments;
}

/** Count `table` tokens anywhere in the parsed Markdown, including inside list items. */
function tableCount(md: string): number {
  let count = 0;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const token = node as { type?: string; tokens?: unknown; items?: unknown };
    if (token.type === "table") count++;
    visit(token.tokens);
    visit(token.items);
  };
  visit(Lexer.lex(md));
  return count;
}

/** Collect every internal (#...) link target from the rendered Markdown. */
function internalLinkTargets(md: string): string[] {
  const targets: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const token = node as { type?: string; href?: string; tokens?: unknown; items?: unknown; header?: unknown; rows?: unknown };
    if (token.type === "link" && typeof token.href === "string" && token.href.startsWith("#")) {
      targets.push(token.href.slice(1));
    }
    visit(token.tokens);
    visit(token.items);
    visit(token.header);
    visit(token.rows);
  };
  visit(Lexer.lex(md));
  return targets;
}

describe("semantic guarantees", () => {
  it("produces GFM that parses without throwing", () => {
    const value = {
      a: [{ x: 1, y: { deep: true } }, { x: 2 }],
      b: "*not bold* | pipe",
      c: [1, [2, 3], {}],
    };
    expect(() => marked.parse(convertJsonValue(value), { gfm: true })).not.toThrow();
  });

  it("renders tabular arrays nested in lists as real GFM tables at every indent depth", () => {
    // Indent grows 2 spaces per list level; a wrong indent would parse as a code block.
    expect(tableCount(convertJsonValue({ o: [1, [{ x: 1 }]] }))).toBe(1); // 2-space table
    expect(tableCount(convertJsonValue({ o: [[[{ z: 1 }]]] }))).toBe(1); // 4-space table
    expect(tableCount(convertJsonValue({ a: { b: { c: { d: { e: { f: { g: [{ n: 1 }] } } } } } } }))).toBe(1);
  });

  it("resolves every Detail Section link to exactly one heading fragment", () => {
    const value = {
      rows: [
        { name: "a", meta: { note: [1, 2] }, tags: ["x", "y"] },
        { name: "b", meta: { note: [3] } },
      ],
    };
    const md = convertJsonValue(value);
    const fragments = headingFragments(md);
    const targets = internalLinkTargets(md);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect(fragments.has(target)).toBe(true);
  });

  it("property: every output starts with the heading, ends in one newline, and parses as GFM", () => {
    const json: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
      value: fc.oneof(
        { depthSize: "small" },
        fc.constant(null),
        fc.boolean(),
        fc.integer(),
        fc.string(),
        fc.array(tie("value"), { maxLength: 4 }),
        fc.dictionary(fc.string(), tie("value"), { maxKeys: 4 }),
      ),
    })).value;

    fc.assert(
      fc.property(json, (value) => {
        const md = convertJsonValue(value);
        expect(md.startsWith("# Results\n")).toBe(true);
        expect(md.endsWith("\n")).toBe(true);
        expect(md).not.toContain("\r");
        expect(md).not.toContain("\n\n\n");
        // Canonical Spacing: no line carries trailing whitespace.
        for (const line of md.split("\n")) expect(line).toBe(line.replace(/\s+$/, ""));
        expect(() => marked.parse(md, { gfm: true })).not.toThrow();
        // Every internal link resolves to a heading fragment.
        const fragments = headingFragments(md);
        for (const target of internalLinkTargets(md)) expect(fragments.has(target)).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });
});
