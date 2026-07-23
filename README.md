<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-white.svg">
  <img src="assets/logo.svg" alt="json-to-md logo" width="96">
</picture>

# json-to-md

Convert one JSON document into deterministic, human-readable [GitHub Flavored Markdown](https://github.github.com/gfm/).

The same conversion runs in the browser, in Node, in Go, and on the command line. The TypeScript and Go implementations produce **byte-identical output**, enforced by a shared [`corpus/`](corpus/) and a cross-implementation fuzz gate in CI. Output is a readable **projection** rather than a reversible serialization format. Every document begins with a `# Results` heading (replace or omit it via the `heading` option), annotates value types — `42 *(integer)*` — unless `showTypes: false`, and uses canonical spacing: LF endings, one blank line between blocks, no trailing spaces, one final newline.

## Motivation

If you feed JSON into an LLM, you pay for its punctuation. Every `{`, `}`, `"`,
`:`, and `,` is tokens spent on structure the model does not need to read the
data. Converting the same document to Markdown headings and lists is measurably
cheaper and easier for models to follow:

- **Fewer tokens.** A [tiktoken measurement][md-tokens] of one real document
  came out to 13,869 tokens as JSON versus 11,612 as Markdown — about 16% less.
  Reports in the wild put the JSON tax anywhere from [15–20%][md-reddit] up to 2x
  depending on how nested and quote-heavy the data is.
- **Native format.** Markdown is the lingua franca of LLM training corpora, so
  it tends to tokenize efficiently and models parse its structure reliably.
- **Human-readable in the loop.** Prompts, agent memory logs, and RAG context
  are easier to read, diff, and hand-edit as Markdown than as escaped JSON — and
  Markdown chunks concatenate cleanly, where stringified JSON does not.
- **Fits tighter context windows.** In IDE assistants and agent loops where
  context is aggressively trimmed, token-heavy JSON is a real risk; a leaner
  projection leaves more room for the actual task.

The tradeoff: this is a one-way, human-facing **projection**, not a reversible
serialization. When a downstream step must parse, validate, or store the data,
keep the JSON. A common pattern is JSON for the machine contract and Markdown
for everything a model or a person has to read.


## Node

### Install

```sh
npm install @rajnandan1/json-to-md      # or: pnpm add / yarn add
```

Ships ESM and CommonJS builds with TypeScript declarations, and no runtime dependencies. Node ≥ 18.

### Use

```ts
import { convertJsonText, convertJsonValue } from "@rajnandan1/json-to-md";

convertJsonText('{ "hello": "world" }'); // untrusted serialized JSON text
convertJsonValue({ hello: "world" }); // already-parsed, caller-trusted data
// # Results
//
// ## hello
//
// world *(string)*

convertJsonValue({ hello: "world" }, { heading: "Greeting" }); // custom H1
convertJsonValue({ hello: "world" }, { heading: null }); // no H1 at all
convertJsonValue({ hello: "world" }, { showTypes: false }); // v1-identical output
```

CommonJS works too: `const { convertJsonText } = require("@rajnandan1/json-to-md")`. See the [API reference](#api-reference) for the two entry points' exact contracts and errors.

## Browser

### Install

The same package: bundle it (Vite, webpack, esbuild; it's plain ESM with no dependencies), or skip the build step entirely. Every npm release lands on the CDNs, and the build is a single self-contained ES module, so the raw file imports directly:

```html
<script type="module">
    import { convertJsonText } from "https://cdn.jsdelivr.net/npm/@rajnandan1/json-to-md@2/dist/index.js";
    document.body.textContent = convertJsonText('{"hello":"world"}');
</script>
```

(`@2` floats on the latest 2.x; pin `@2.0.0` for exact bytes. The same path works on unpkg at `https://unpkg.com/@rajnandan1/json-to-md@2.0.0/dist/index.js`, or via esm.sh as `https://esm.sh/@rajnandan1/json-to-md`.)

No modules? A classic script tag works too; the IIFE build exposes a `jsonToMd` global. Pin it with [Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity) so a compromised CDN can't swap the code (the hash is per-version, so update both together when bumping):

```html
<script
    src="https://cdn.jsdelivr.net/npm/@rajnandan1/json-to-md@1.0.1/dist/index.global.js"
    integrity="sha384-v5+v71wtLTKJo2nT4Ly2Ov4u1QDPPPC0fhwy1q9I8lqsEtDOIuH/4AIwyt9lRQmR"
    crossorigin="anonymous"
></script>
<script>
    document.body.textContent = jsonToMd.convertJsonText('{"hello":"world"}');
</script>
```

### Use

Identical API to Node; the conversion core is pure and runs anywhere. A live playground lives in [`demo/`](https://json-to-md.rajnandan.com/demo/), a fully static page that loads the released library from the CDN, so any static file server works:

```sh
pnpm demo   # serves it via vite and prints a localhost URL
```

Paste JSON, watch it convert, toggle between the rendered preview and raw Markdown, and switch the input between the serialized and parsed entry points to see numeric spelling preserved or lost.

## Go

### Install

```sh
go get github.com/rajnandan1/json-to-md/go
```

### Use

```go
import (
	"errors"

	jsontomd "github.com/rajnandan1/json-to-md/go"
)

md, err := jsontomd.ConvertText([]byte(`{"hello":"world"}`)) // byte-identical to convertJsonText
md, err = jsontomd.ConvertValue(v)                           // any Go value, marshal-then-convert

// Options mirror the TS ConvertOptions:
md, err = jsontomd.ConvertText(src, jsontomd.WithHeading("Greeting")) // heading: "Greeting"
md, err = jsontomd.ConvertText(src, jsontomd.WithoutHeading())        // heading: null
md, err = jsontomd.ConvertText(src, jsontomd.WithoutTypes())          // showTypes: false

var convErr *jsontomd.Error
if errors.As(err, &convErr) {
	// convErr.Code, .Pointer, .Location: same codes and UTF-16 locations as the TS errors
}
```

`ConvertText` preserves member order and numeric lexemes just like `convertJsonText`. `ConvertValue` is defined as `json.Marshal(v)` piped into the same core: struct fields render in field order, map keys in sorted order, and the core rejects cycles or NaN. The library packages are dependency-free.

## CLI

### Install

```sh
brew tap rajnandan1/homebrew-rajnandan
brew trust rajnandan1/rajnandan     # once per machine; newer Homebrew gates third-party taps
brew install json-to-md
# or, via the Go toolchain:
go install github.com/rajnandan1/json-to-md/go/cmd/json-to-md@latest
```

### Use

```sh
json-to-md data.json > out.md                       # file in, Markdown out
curl -s https://api.example.com/items | json-to-md  # stdin (no arg, or '-')
json-to-md --json broken.json 2> error.json         # structured errors on stderr
json-to-md --version
```

Exit codes: `0` success, `1` conversion failed, `2` usage or I/O error. Failures print one greppable line (`json-to-md: DUPLICATE_MEMBER_NAME at 3:7 (first at 1:9): …`), or with `--json` the full error object (`code`, `pointer`, `location`, `firstLocation`, `message`).

## API reference

There are two entry points, one for already-parsed data and one for untrusted JSON text, plus a typed error. Both functions return the complete Markdown string or throw `JsonToMarkdownError`. Calls are pure, never mutate input, share no state, and are safe to run concurrently.

Go mirrors these contracts one-for-one: `ConvertText` ↔ `convertJsonText` (byte-identical output), `ConvertValue` ↔ `convertJsonValue` (host-language marshaling semantics), functional options ↔ `ConvertOptions` (`WithHeading`/`WithoutHeading`/`WithoutTypes`), and `*jsontomd.Error` ↔ `JsonToMarkdownError`, with the same codes, JSON Pointers, and UTF-16 locations (`SPARSE_ARRAY` cannot occur in Go).

### `convertJsonValue(value: unknown, options?: ConvertOptions): string`

Accepts caller-trusted, already-parsed JSON data and validates it at runtime. Rejects anything that is not JSON-compatible: cycles, sparse arrays, `undefined`, `BigInt`, `NaN`/`Infinity`, functions, symbols, `Date`/`Map`/`Set`, and class instances. It never invokes getters, so it cannot detect a hostile `Proxy`; put untrusted content in `convertJsonText`.

### `convertJsonText(source: string, options?: ConvertOptions): string`

Accepts untrusted **serialized** JSON, parses it without executing caller code, and preserves each number's original spelling. It keeps object-member order, array order, and numeric tokens intact.

```ts
convertJsonText("9007199254740993"); // "…\n\n9007199254740993 *(integer)*\n"  (preserved)
convertJsonValue(9007199254740993); // "…\n\n9007199254740992 *(integer)*\n"  (already rounded by JS)

convertJsonText("1.00"); // "1.00 *(number)*"
convertJsonValue(1.0); // "1 *(integer)*"
```

### `ConvertOptions`

| Option      | Type             | Default     | Effect                                                                                                                                              |
| ----------- | ---------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `heading`   | `string \| null` | `"Results"` | The H1 the document begins with, rendered as plain text (never raw Markdown). `null` omits the H1 entirely; body heading levels are unchanged.       |
| `showTypes` | `boolean`        | `true`      | Appends ` *(string)*` / ` *(integer)*` / ` *(number)*` / ` *(boolean)*` to values, and to a table header when every present cell shares one type. `false` reproduces v1 output byte for byte. |

An empty-string `heading` throws `INVALID_OPTION` (pass `null` to omit the heading). Annotations never appear on `` `null` ``, `` `[]` ``, or `` `{}` `` — their rendering already states the type — and never inside table cells. The `*(…)*` token cannot be forged by data: a literal `*` in a string is always escaped.

### Errors

```ts
try {
    convertJsonText('{"name":"a","name":"b"}');
} catch (e) {
    if (e instanceof JsonToMarkdownError) {
        e.code; // "DUPLICATE_MEMBER_NAME"
        e.message; // human-readable
        e.location; // { offset, line, column } for serialized syntax failures
        e.firstLocation; // first occurrence, for duplicate member names
        e.pointer; // JSON Pointer, when the invalid value is locatable
    }
}
```

Conversion fails atomically at the first error in encounter order and never returns partial Markdown. Codes: `INVALID_JSON_SYNTAX`, `DUPLICATE_MEMBER_NAME`, `INVALID_PARSED_VALUE`, `CYCLIC_REFERENCE`, `SPARSE_ARRAY`, `INVALID_OPTION`.

## How values render

| Input                               | Rendering                                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| Object keys                         | Headings H2–H6, then nested unordered lists once nesting passes H6                                 |
| Array of objects (a Tabular Array)  | One GFM table; also when nested inside a list                                                      |
| Any other array                     | Unordered list in source order                                                                     |
| Non-empty container in a table cell | Link to a Detail Section headed by the value's JSON Pointer, preceded by a `---` thematic break    |
| String                              | Escaped literal text; never injects Markdown or HTML                                               |
| Whole-string absolute `http(s)` URL | Markdown link                                                                                      |
| `null` / `""` / `[]` / `{}`         | `` `null` `` / `` `""` `` / `` `[]` `` / `` `{}` `` (each kept distinct from a missing table cell) |
| Scalar types (`showTypes`, default) | ` *(string)*` / ` *(integer)*` / ` *(number)*` / ` *(boolean)*` after the value; on a table header when the column's type is uniform |

```ts
convertJsonText(
    JSON.stringify({
        table1: [{ age: 14, degrees: [{ name: "B-Degree", year: "2023" }] }],
    }),
);
```

```markdown
# Results

## table1

| age *(integer)* | degrees                              |
| --------------- | ------------------------------------ |
| 14              | [/table1/0/degrees](#table10degrees) |

---

### /table1/0/degrees

| name *(string)* | year *(string)* |
| --------------- | --------------- |
| B-Degree        | 2023            |
```

There is no converter-defined input-size, nesting-depth, or table-size limit; parsing, validation, and rendering are iterative, so deeply nested documents do not overflow the stack.

## Benchmarks

Measured on Stripe's OpenAPI spec ([spec3.json](https://github.com/stripe/openapi/blob/master/openapi/spec3.json): 7.5 MiB of JSON in, 6.1 MiB of Markdown out), Apple M3 Pro, 2026-07. Both implementations produced **byte-identical output** for this document (sha256-verified). The corpus promise holds on real-world data.

| Surface                                                  | Median  | Input throughput |
| -------------------------------------------------------- | ------- | ---------------- |
| Go `ConvertText`                                         | 128 ms  | ~59 MiB/s        |
| TypeScript `convertJsonText` (Node 24)                   | 211 ms  | ~36 MiB/s        |
| CLI `json-to-md spec3.json` (whole process, brew binary) | ~120 ms | —                |

Reproduce with any large JSON document:

```sh
pnpm build && node scripts/bench-file.mjs path/to/big.json
cd go && BENCH_FILE=path/to/big.json go test -bench ConvertTextFile -run '^$'
```

## Development

```sh
pnpm build       # ESM + CJS + type declarations (tsup)
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm bench       # 10 MiB conversion benchmarks
```

## License

MIT
