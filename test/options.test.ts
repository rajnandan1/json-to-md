import { describe, expect, it } from "vitest";
import { convertJsonText, convertJsonValue, JsonToMarkdownError } from "../src/index.js";

describe("Document Heading option", () => {
  it("replaces the default heading text in both entry points", () => {
    expect(convertJsonText("1", { heading: "Users", showTypes: false })).toBe("# Users\n\n1\n");
    expect(convertJsonValue(1, { heading: "Users", showTypes: false })).toBe("# Users\n\n1\n");
  });

  it("escapes the heading as plain text, never raw Markdown", () => {
    expect(convertJsonText("1", { heading: "# raw *md*", showTypes: false })).toBe(
      "# # raw \\*md\\*\n\n1\n",
    );
  });

  it("omits the H1 entirely for heading: null, body levels unchanged", () => {
    expect(convertJsonValue({ a: 1 }, { heading: null, showTypes: false })).toBe("## a\n\n1\n");
  });

  it("throws INVALID_OPTION for an empty heading", () => {
    expect(() => convertJsonText("1", { heading: "" })).toThrow(
      expect.objectContaining({ code: "INVALID_OPTION" }),
    );
    expect(() => convertJsonValue(1, { heading: "" })).toThrow(JsonToMarkdownError);
  });

  it("uses default heading and annotations when options are omitted", () => {
    expect(convertJsonText("42")).toBe("# Results\n\n42 *(integer)*\n");
  });

  it("keeps detail links resolvable when the heading collides with a detail slug", () => {
    const md = convertJsonValue({ t: [{ kids: [{ n: 1 }] }] }, { heading: "/t/0/kids", showTypes: false });
    // H1 takes the base slug; the Detail Heading is deduped and the link follows it.
    expect(md).toContain("[/t/0/kids](#t0kids-1)");
    expect(md).toContain("### /t/0/kids");
  });
});

describe("Type Annotations in paragraph position", () => {
  it("annotates string, integer, number, and boolean values", () => {
    expect(convertJsonText("42")).toBe("# Results\n\n42 *(integer)*\n");
    expect(convertJsonText("-7")).toBe("# Results\n\n-7 *(integer)*\n");
    expect(convertJsonText("1.00")).toBe("# Results\n\n1.00 *(number)*\n");
    expect(convertJsonText("1e3")).toBe("# Results\n\n1e3 *(number)*\n");
    expect(convertJsonText('"hi"')).toBe("# Results\n\nhi *(string)*\n");
    expect(convertJsonText("true")).toBe("# Results\n\ntrue *(boolean)*\n");
  });

  it("distinguishes the string \"true\" from the boolean true", () => {
    expect(convertJsonText('"true"')).toBe("# Results\n\ntrue *(string)*\n");
  });

  it("annotates URL strings as string, after the link", () => {
    expect(convertJsonText('"https://a.io"')).toBe(
      "# Results\n\n[https://a.io](https://a.io) *(string)*\n",
    );
  });

  it("leaves Self-Describing Values bare (null, `[]`, `{}`); empty string is still a string", () => {
    expect(convertJsonText("null")).toBe("# Results\n\n`null`\n");
    expect(convertJsonText("[]")).toBe("# Results\n\n`[]`\n");
    expect(convertJsonText("{}")).toBe("# Results\n\n`{}`\n");
    expect(convertJsonText('""')).toBe('# Results\n\n`""` *(string)*\n');
  });

  it("annotates member values under their key headings", () => {
    expect(convertJsonValue({ a: "x" })).toBe("# Results\n\n## a\n\nx *(string)*\n");
  });
});

describe("Type Annotations in list position", () => {
  it("annotates array items and object members in lists", () => {
    expect(convertJsonValue({ values: [1, "two", null, true, 2.5, []] })).toBe(
      `# Results

## values

- 1 *(integer)*
- two *(string)*
- \`null\`
- true *(boolean)*
- 2.5 *(number)*
- \`[]\`
`,
    );
  });

  it("annotates key-value list lines past H6", () => {
    expect(convertJsonValue({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } })).toContain(
      "  - **g:** 1 *(integer)*",
    );
  });
});

describe("Type Annotations on table headers", () => {
  it("annotates a Uniform Column's header; mixed columns stay bare", () => {
    expect(convertJsonValue([{ n: 1, v: 1 }, { n: 2.5, v: 2 }])).toBe(
      `# Results

| n | v *(integer)* |
| --- | --- |
| 1 | 1 |
| 2.5 | 2 |
`,
    );
  });

  it("skips columns holding links, nulls, or empty containers", () => {
    const md = convertJsonValue([
      { kid: [{ x: 1 }], note: null, empty: {}, name: "a" },
      { kid: [{ x: 2 }], note: null, empty: {}, name: "b" },
    ]);
    expect(md).toContain("| kid | note | empty | name *(string)* |");
  });

  it("ignores Missing Properties when judging uniformity", () => {
    expect(convertJsonValue([{ a: 1 }, { a: 2, b: 3 }])).toBe(
      `# Results

| a *(integer)* | b *(integer)* |
| --- | --- |
| 1 |  |
| 2 | 3 |
`,
    );
  });

  it("annotates a uniform URL String column as string (only container-link columns stay bare)", () => {
    const md = convertJsonValue([{ u: "https://a.example" }, { u: "https://b.example" }]);
    expect(md).toContain("| u *(string)* |");
  });

  it("does not annotate cells themselves", () => {
    const md = convertJsonValue([{ a: 1 }, { a: 2 }]);
    expect(md).not.toContain("| 1 *(integer)* |");
  });

  it("annotates headers of tables nested in lists", () => {
    expect(convertJsonValue({ outer: [1, [{ x: 1 }, { x: 2 }]] })).toBe(
      `# Results

## outer

- 1 *(integer)*
-
  | x *(integer)* |
  | --- |
  | 1 |
  | 2 |
`,
    );
  });
});

describe("showTypes: false reproduces v1 output", () => {
  it("suppresses every annotation site", () => {
    const value = { s: "x", n: [1, 2.5], t: [{ a: 1 }, { a: 2 }] };
    const md = convertJsonValue(value, { showTypes: false });
    expect(md).not.toContain("*(");
    expect(md).toBe(
      `# Results

## s

x

## n

- 1
- 2.5

## t

| a |
| --- |
| 1 |
| 2 |
`,
    );
  });
});
