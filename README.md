<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-white.svg">
  <img src="assets/logo.svg" alt="json-to-md logo" width="96">
</picture>

# json-to-md

Convert one JSON document into deterministic, human-readable [GitHub Flavored Markdown](https://github.github.com/gfm/).

The same conversion runs in the browser, in Node, in Go, and on the command line — the TypeScript and Go implementations produce **byte-identical output**, enforced by a shared [`corpus/`](corpus/) and a cross-implementation fuzz gate in CI. Output is a readable **projection**, not a reversible serialization format — every document begins with a `# Results` heading and uses canonical spacing (LF endings, one blank line between blocks, no trailing spaces, one final newline).

## Node

### Install

```sh
npm install @rajnandan1/json-to-md      # or: pnpm add / yarn add
```

Ships ESM and CommonJS builds with TypeScript declarations, and no runtime dependencies. Node ≥ 18.

### Use

```ts
import { convertJsonText, convertJsonValue } from "@rajnandan1/json-to-md";

convertJsonText('{ "hello": "world" }');   // untrusted serialized JSON text
convertJsonValue({ hello: "world" });      // already-parsed, caller-trusted data
// # Results
//
// ## hello
//
// world
```

CommonJS works too: `const { convertJsonText } = require("@rajnandan1/json-to-md")`. See the [API reference](#api-reference) for the two entry points' exact contracts and errors.

## Browser

### Install

The same package: bundle it (Vite, webpack, esbuild — it's plain ESM with no dependencies), or skip the build step and import straight from a module CDN:

```html
<script type="module">
  import { convertJsonText } from "https://esm.sh/@rajnandan1/json-to-md";
  document.body.textContent = convertJsonText('{"hello":"world"}');
</script>
```

### Use

Identical API to Node — the conversion core is pure and runs anywhere. A live playground lives in [`demo/`](demo/):

```sh
pnpm demo   # builds the library, then serves the page and prints a localhost URL
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

var convErr *jsontomd.Error
if errors.As(err, &convErr) {
	// convErr.Code, .Pointer, .Location — same codes and UTF-16 locations as the TS errors
}
```

`ConvertText` preserves member order and numeric lexemes exactly like `convertJsonText`. `ConvertValue` is defined as `json.Marshal(v)` piped into the same core: struct fields render in field order, map keys in sorted order, and cycles or NaN are rejected. The library packages are dependency-free.

## CLI

### Install

```sh
brew tap rajnandan1/homebrew-rajnandan && brew install json-to-md
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

Exit codes: `0` success, `1` conversion failed, `2` usage or I/O error. Failures print one greppable line — `json-to-md: DUPLICATE_MEMBER_NAME at 3:7 (first at 1:9): …` — or, with `--json`, the full error object (`code`, `pointer`, `location`, `firstLocation`, `message`).

## API reference

There are two entry points — one for already-parsed data, one for untrusted JSON text — plus a typed error. Both functions return the complete Markdown string or throw `JsonToMarkdownError`. Calls are pure, never mutate input, share no state, and are safe to run concurrently.

Go mirrors these contracts one-for-one: `ConvertText` ↔ `convertJsonText` (byte-identical output), `ConvertValue` ↔ `convertJsonValue` (host-language marshaling semantics), and `*jsontomd.Error` ↔ `JsonToMarkdownError` — same codes, JSON Pointers, and UTF-16 locations (`SPARSE_ARRAY` cannot occur in Go).

### `convertJsonValue(value: unknown): string`

Accepts caller-trusted, already-parsed JSON data and validates it at runtime. Rejects anything that is not JSON-compatible — cycles, sparse arrays, `undefined`, `BigInt`, `NaN`/`Infinity`, functions, symbols, `Date`/`Map`/`Set`, and class instances. Getters are never invoked, so a hostile `Proxy` cannot be detected — untrusted content belongs in `convertJsonText`.

### `convertJsonText(source: string): string`

Accepts untrusted **serialized** JSON, parses it without executing caller code, and preserves each number's original spelling. Object-member order, array order, and numeric tokens are kept exactly.

```ts
convertJsonText("9007199254740993"); // "…\n\n9007199254740993\n"  (preserved)
convertJsonValue(9007199254740993);  // "…\n\n9007199254740992\n"  (already rounded by JS)

convertJsonText("1.00"); // "1.00"
convertJsonValue(1.0);   // "1"
```

### Errors

```ts
try {
  convertJsonText('{"name":"a","name":"b"}');
} catch (e) {
  if (e instanceof JsonToMarkdownError) {
    e.code;          // "DUPLICATE_MEMBER_NAME"
    e.message;       // human-readable
    e.location;      // { offset, line, column } for serialized syntax failures
    e.firstLocation; // first occurrence, for duplicate member names
    e.pointer;       // JSON Pointer, when the invalid value is locatable
  }
}
```

Conversion fails atomically at the first error in encounter order and never returns partial Markdown. Codes: `INVALID_JSON_SYNTAX`, `DUPLICATE_MEMBER_NAME`, `INVALID_PARSED_VALUE`, `CYCLIC_REFERENCE`, `SPARSE_ARRAY`.

## How values render

| Input | Rendering |
| --- | --- |
| Object keys | Headings H2–H6, then nested unordered lists once nesting passes H6 |
| Array of objects (a Tabular Array) | One GFM table; also when nested inside a list |
| Any other array | Unordered list in source order |
| Non-empty container in a table cell | Link to a Detail Section headed by the value's JSON Pointer, preceded by a `---` thematic break |
| String | Escaped literal text — never injects Markdown or HTML |
| Whole-string absolute `http(s)` URL | Markdown link |
| `null` / `""` / `[]` / `{}` | `` `null` `` / `` `""` `` / `` `[]` `` / `` `{}` `` (each kept distinct from a missing table cell) |

```ts
convertJsonText(JSON.stringify({
  table1: [{ age: 14, degrees: [{ name: "B-Degree", year: "2023" }] }],
}));
```

```markdown
# Results

## table1

| age | degrees |
| --- | --- |
| 14 | [/table1/0/degrees](#table10degrees) |

---

### /table1/0/degrees

| name | year |
| --- | --- |
| B-Degree | 2023 |
```

There is no converter-defined input-size, nesting-depth, or table-size limit; parsing, validation, and rendering are iterative, so deeply nested documents do not overflow the stack. See [`docs/adr/`](docs/adr/) for the decisions behind numeric-lexeme preservation, duplicate-name rejection, always-tabular tables, and the no-nesting-limit guarantee, and [`CONTEXT.md`](CONTEXT.md) for the domain vocabulary.

## Development

```sh
pnpm build       # ESM + CJS + type declarations (tsup)
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm bench       # 10 MiB conversion benchmarks
```

## Releasing

One version ships everywhere — npm (`@rajnandan1/json-to-md`), the Go module (via the `go/vX.Y.Z` tag), and the Homebrew tap — from one pushed tag:

```sh
git checkout main && git pull
npm version patch      # or minor / major, or an explicit version
git push --follow-tags
```

The `v*` tag triggers [`release.yml`](.github/workflows/release.yml): a gate first (both test suites, the shared [`corpus/`](corpus/), the cross-implementation fuzz differ, and a tag↔package.json check), then three independent publish legs — npm publish with provenance, the `go/vX.Y.Z` module tag, and [GoReleaser](.goreleaser.yaml) building binaries and bumping `json-to-md.rb` in [homebrew-rajnandan](https://github.com/rajnandan1/homebrew-rajnandan).

- **A leg failed?** Fix the cause, then `gh run rerun <run-id> --failed` — legs are idempotent. Never delete or re-point a published tag (the Go module proxy caches it forever); ship the next patch instead.
- **Secrets** (repo → Settings → Actions): `NPM_TOKEN` (npm granular token, read/write on the `@rajnandan1` scope) and `PUBLISHER_TOKEN` (fine-grained PAT, Contents read/write on this repo and the tap). The PAT expires within a year — when releases start failing with 401, mint a new one and `gh secret set` it.
- **Majors couple by design**: releasing npm `2.0.0` requires bumping the Go module path to `…/go/v2` (tags `go/v2.x.y`) in the same change.

## License

MIT
