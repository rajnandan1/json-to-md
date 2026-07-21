import { describe, expect, it } from "vitest";
import { convertJsonText, convertJsonValue, JsonToMarkdownError } from "../src/index.js";

describe("Output Document shape", () => {
  it("always begins with the Results Heading and one final newline", () => {
    const md = convertJsonValue(null);
    expect(md.startsWith("# Results\n")).toBe(true);
    expect(md.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
  });

  it("uses canonical spacing: LF, one blank line between blocks, no trailing spaces", () => {
    const md = convertJsonValue({ a: 1, b: 2 });
    expect(md).not.toContain("\r");
    expect(md).not.toMatch(/ \n/); // no trailing spaces
    expect(md).not.toContain("\n\n\n"); // never more than one blank line
  });

  it("renders the deep-nesting spec example", () => {
    expect(convertJsonValue({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } })).toBe(
      `# Results

## a

### b

#### c

##### d

###### e

- **f**
  - **g:** 1
`,
    );
  });

  it("renders the non-tabular array spec example", () => {
    expect(convertJsonValue({ values: [1, "two", null, [true, false], {}] })).toBe(
      `# Results

## values

- 1
- two
- \`null\`
-
  - true
  - false
- \`{}\`
`,
    );
  });

  it("renders the complete table spec example with detail sections", () => {
    const input = {
      table1: [
        { age: 14, degrees: [{ name: "B-Degree", year: "2023" }, { name: "C-Degree", year: "2024" }] },
        { age: 24, degrees: [{ name: "K-Degree", year: "2003" }, { name: "M-Degree", year: "2004" }] },
      ],
    };
    expect(convertJsonText(JSON.stringify(input))).toBe(
      `# Results

## table1

| age | degrees |
| --- | --- |
| 14 | [/table1/0/degrees](#table10degrees) |
| 24 | [/table1/1/degrees](#table11degrees) |

---

### /table1/0/degrees

| name | year |
| --- | --- |
| B-Degree | 2023 |
| C-Degree | 2024 |

---

### /table1/1/degrees

| name | year |
| --- | --- |
| K-Degree | 2003 |
| M-Degree | 2004 |
`,
    );
  });
});

describe("root values", () => {
  it("renders root scalars directly under the heading", () => {
    expect(convertJsonText("1.00")).toBe("# Results\n\n1.00\n");
    expect(convertJsonValue(true)).toBe("# Results\n\ntrue\n");
    expect(convertJsonValue("hi")).toBe("# Results\n\nhi\n");
  });

  it("renders empty root containers explicitly", () => {
    expect(convertJsonValue({})).toBe("# Results\n\n`{}`\n");
    expect(convertJsonValue([])).toBe("# Results\n\n`[]`\n");
  });

  it("renders a root tabular array without a key heading", () => {
    expect(convertJsonValue([{ a: 1 }, { a: 2, b: 3 }])).toBe(
      `# Results

| a | b |
| --- | --- |
| 1 |  |
| 2 | 3 |
`,
    );
  });
});

describe("distinct blank states in a table", () => {
  it("keeps missing, null, and empty string distinct", () => {
    const md = convertJsonValue([{ a: null }, { b: "" }]);
    expect(md).toBe(
      `# Results

| a | b |
| --- | --- |
| \`null\` |  |
|  | \`""\` |
`,
    );
  });
});

describe("tabular arrays nested in lists render as indented tables (ADR-0003)", () => {
  it("renders a tabular array nested in a non-tabular array as an indented table", () => {
    expect(convertJsonValue({ outer: [1, [{ x: 1 }, { x: 2 }]] })).toBe(
      `# Results

## outer

- 1
-
  | x |
  | --- |
  | 1 |
  | 2 |
`,
    );
  });

  it("renders a tabular array as an indented table for a beyond-H6 object value", () => {
    expect(convertJsonValue({ a: { b: { c: { d: { e: { f: { g: [{ n: 1 }] } } } } } } })).toBe(
      `# Results

## a

### b

#### c

##### d

###### e

- **f**
  - **g**
    | n |
    | --- |
    | 1 |
`,
    );
  });

  it("emits Detail Sections at block level for a table nested in a list", () => {
    expect(convertJsonValue({ outer: [0, [{ x: 1, kids: [{ y: 9 }] }]] })).toBe(
      `# Results

## outer

- 0
-
  | x | kids |
  | --- | --- |
  | 1 | [/outer/1/0/kids](#outer10kids) |

---

### /outer/1/0/kids

| y |
| --- |
| 9 |
`,
    );
  });
});

describe("keys and pointers with collapsible spaces stay canonical", () => {
  it("renders boundary spaces in a key heading as &nbsp; (no trailing space)", () => {
    expect(convertJsonValue({ " ": 1 })).toBe("# Results\n\n## &nbsp;\n\n1\n");
    expect(convertJsonValue({ "trailing ": 1 })).toBe("# Results\n\n## trailing&nbsp;\n\n1\n");
  });

  it("keeps a space-keyed Detail pointer trailing-space-free and link-resolvable", () => {
    const md = convertJsonValue([[{ " ": [[]] }]]);
    expect(md).toContain("[/0/0/&nbsp;](#00nbsp)");
    expect(md).toContain("## /0/0/&nbsp;");
    for (const line of md.split("\n")) expect(line).toBe(line.replace(/\s+$/, ""));
  });
});

describe("thematic breaks fence Detail Sections", () => {
  it("emits one --- immediately before every Detail Heading and nowhere else", () => {
    const md = convertJsonValue({
      rows: [{ a: 1, kid: [{ b: 2, grandkid: [{ c: 3 }] }] }],
      dash: "---",
    });
    const lines = md.split("\n");
    const hrIndexes = lines.flatMap((line, i) => (line === "---" ? [i] : []));
    const detailHeadings = md.match(/^#{2,6} \//gm) ?? [];
    expect(detailHeadings.length).toBe(2); // /rows/0/kid and its nested grandkid detail
    expect(hrIndexes.length).toBe(detailHeadings.length);
    for (const i of hrIndexes) {
      expect(lines[i + 1]).toBe("");
      expect(lines[i + 2]).toMatch(/^#{2,6} \//);
    }
  });
});

describe("table cell escaping", () => {
  it("escapes pipes in headers and string cells exactly once", () => {
    expect(convertJsonValue([{ "a|b": "x|y" }])).toBe(
      `# Results

| a\\|b |
| --- |
| x\\|y |
`,
    );
  });
});

describe("numeric lexemes", () => {
  it("preserves serialized spelling but renders the parsed value", () => {
    expect(convertJsonText("9007199254740993")).toContain("9007199254740993");
    expect(convertJsonValue(9007199254740993)).toContain("9007199254740992");
    expect(convertJsonText("1.00")).toContain("1.00");
    expect(convertJsonValue(1.0)).toContain("\n1\n");
  });
});

describe("errors propagate from both entry points", () => {
  it("throws typed errors", () => {
    expect(() => convertJsonText("{,}")).toThrow(JsonToMarkdownError);
    expect(() => convertJsonValue(undefined)).toThrow(JsonToMarkdownError);
    expect(() => convertJsonText('{"a":1,"a":2}')).toThrow(
      expect.objectContaining({ code: "DUPLICATE_MEMBER_NAME" }),
    );
  });

  it("does not mutate the input", () => {
    const input = { a: [1, 2], b: { c: 3 } };
    const copy = structuredClone(input);
    convertJsonValue(input);
    expect(input).toEqual(copy);
  });
});
