// Regenerates the parity corpus (corpus/) by running the BUILT TypeScript
// implementation — TS is the oracle of the parity contract. Regenerating is a
// semantic change: land it only in a reviewed lockstep PR.
//
//   pnpm build && node scripts/generate-corpus.mjs
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { convertJsonText, JsonToMarkdownError } from "../dist/index.js";

const root = fileURLToPath(new URL("../corpus/", import.meta.url));

// Programmatic helpers for bulky cases.
const deepArray = "[".repeat(100) + "1" + "]".repeat(100);
// Heading-fragment collision: pointers /a/10/b and /a1/0/b both slug to "a10b".
const collisionRows = [];
for (let i = 0; i < 10; i++) collisionRows.push('{"b":1}');
collisionRows.push('{"b":{"z":9}}');
const fragmentCollision = `{"a":[${collisionRows.join(",")}],"a1":[{"b":{"z":9}}]}`;

const cases = {
  // Root Values
  "scalars/root-string": '"hello world"',
  "scalars/root-number": "-0.5e+2",
  "scalars/root-true": "true",
  "scalars/root-null": "null",
  "scalars/root-empty-object": "{}",
  "scalars/root-empty-array": "[]",

  // Literal Strings
  "strings/markdown-injection": '"# not a heading *nor* [link](x) | pipe"',
  "strings/entities-and-escapes": '"a&b<c>d\\\\e`f~g_h"',
  "strings/space-runs": '"  lead mid   run trail  "',
  "strings/multiline": '"line1\\nline2\\r\\nline3\\rline4"',
  "strings/control-chars": '"tab\\tbell\\u0007del\\u007f"',
  "strings/emoji-pair": '"smile \u{1F600} end"',
  "strings/lone-surrogate": '"bad \\ud800 half"',
  "strings/numeric-lead": '"12. list-looking"',
  "strings/dash-lead": '"- not a bullet"',
  "strings/url-true": '"https://example.com/path?q=1"',
  "strings/url-with-paren": '"https://example.com/a(b)|c"',
  "strings/url-false-space": '"https://example.com/a b"',
  "strings/url-false-scheme": '"ftp://example.com"',
  "strings/url-false-embedded": '"See https://example.com"',

  // Numeric Lexemes
  "numbers/lexeme-preservation": '{"price":1.00,"big":9007199254740993,"exp":1e2,"neg":-0.0,"E":2E+3}',

  // Objects / heading ladder
  "objects/heading-ladder": '{"a":{"b":{"c":{"d":{"e":{"f":1,"g":false}}}}}}',
  "objects/weird-keys": '{"":1,"# md":2,"a/b~c":3}',
  "objects/key-order": '{"z":1,"a":2,"m":3}',

  // Non-tabular Arrays
  "arrays/scalar-list": '[1,"two",null,true,[],{}]',
  "arrays/nested-list": "[[1,2],[3,[4]]]",
  "arrays/table-in-list": '{"wrap":[[{"a":1},{"a":2}]]}',

  // Tabular Arrays
  "tables/simple-table": '{"people":[{"name":"Ada","age":36},{"name":"Lin"}]}',
  "tables/column-union-order": '[{"b":1,"a":2},{"c":3,"a":4}]',
  "tables/empty-containers-in-cells": '[{"x":{},"y":[]},{"x":1}]',
  "tables/cell-escaping": '[{"note":"a|b\\nnewline"}]',

  // Detail Sections
  "details/nested-detail": '{"table1":[{"age":14,"degrees":[{"name":"B-Degree","year":"2023"}]}]}',
  "details/detail-chain": '{"t":[{"kids":[{"n":1}],"obj":{"deep":{"x":[1,2]}}}]}',
  "details/fragment-collision": fragmentCollision,
  // Greek capital sigma exercises JS toLowerCase's contextual Final_Sigma
  // rule in Heading Fragments (word-final Σ → ς, else σ).
  "details/greek-final-sigma": '{"ΑΣ":[{"b":{"z":1}}],"ΟΔΟΣ Α":[{"Σ":{"z":2}}]}',

  // Depth (no-nesting-limit ADR)
  "deep/deep-array": deepArray,

  // Errors — every reachable code, exact locations
  "errors/syntax-truncated": '{"a":',
  "errors/duplicate-member": '{"name":"a","name":"b"}',
  "errors/duplicate-utf16": '{"\u{1F600}":1,"\u{1F600}":2}',
  "errors/duplicate-nested": '{"o":{"k":1,"k":2}}',
  "errors/trailing-content": '{"a":1} x',
  "errors/unterminated-string": '"abc',
  "errors/bad-escape": '"a\\q"',
  "errors/bad-unicode-escape": '"\\u12G4"',
  "errors/control-in-string": '"ab"',
  "errors/missing-colon": '{"a" 1}',
  "errors/missing-comma-array": "[1 2]",
  "errors/empty-input": "",
  "errors/ws-only": "  ",
  "errors/bad-number-fraction": "1.",
  "errors/bad-number-exponent": "1e+",
  "errors/lone-minus": "-",
};

const README = `# Parity corpus

The contract of record for the byte-identical promise between the TypeScript
and Go implementations: for every case here, both must produce the same bytes.

- \`<group>/<case>.input.json\` — raw Serialized JSON Text, byte-exact.
- \`<case>.expected.md\` — the Output Document, byte-exact (one final newline).
- \`<case>.error.json\` — contractual error fields only: \`code\`, and when
  present \`pointer\`, \`location\`/\`firstLocation\` \`{offset,line,column}\`
  counted in UTF-16 code units. \`message\` is deliberately absent.
- Exactly one of \`.expected.md\` / \`.error.json\` per case.
- Consumed by \`test/corpus.test.ts\` and \`go/corpus_test.go\`.
- Regenerate with \`pnpm build && node scripts/generate-corpus.mjs\` — only in
  a reviewed lockstep PR; the TS implementation is the oracle.
`;

await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
await writeFile(root + "README.md", README);

let ok = 0;
let err = 0;
for (const [name, input] of Object.entries(cases)) {
  const base = root + name;
  await mkdir(dirname(base), { recursive: true });
  await writeFile(`${base}.input.json`, input);
  try {
    const md = convertJsonText(input);
    await writeFile(`${base}.expected.md`, md);
    ok++;
  } catch (e) {
    if (!(e instanceof JsonToMarkdownError)) throw new Error(`${name}: unexpected ${e}`);
    const details = { code: e.code };
    if (e.pointer !== undefined) details.pointer = e.pointer;
    if (e.location !== undefined) details.location = e.location;
    if (e.firstLocation !== undefined) details.firstLocation = e.firstLocation;
    await writeFile(`${base}.error.json`, JSON.stringify(details, null, 2) + "\n");
    err++;
  }
}
console.log(`corpus: ${ok} expected.md, ${err} error.json`);
