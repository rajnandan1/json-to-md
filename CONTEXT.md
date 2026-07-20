# JSON-to-Markdown Conversion

This context describes the language used when turning JSON documents into readable Markdown documents.

## Language

**JSON Document**:
Any valid JSON value: an object, array, string, number, boolean, or `null`. Values that exist only in a host programming language, such as functions or cyclic objects, are not JSON Documents.
_Avoid_: JSON object, when referring to the complete input

**Convertible JSON Document**:
A JSON Document in which every object has unique member names. Duplicate member names make identity ambiguous and are rejected rather than resolved by first- or last-value precedence.
_Avoid_: Valid JSON, when the unique-name requirement matters

**Parsed JSON Document**:
A JSON Document already represented as caller-trusted, inert values. It is not a sandbox boundary for hostile host-language objects; untrusted content belongs in Serialized JSON Text.
_Avoid_: JSON input, when the input form matters

**Serialized JSON Text**:
Text containing exactly one JSON Document in JSON syntax.
_Avoid_: JSON string, which can also mean a string value inside a JSON Document

**Results Heading**:
The fixed, case-sensitive top-level heading `# Results` that begins every converted Markdown document.
_Avoid_: `# results`, custom root title

**Output Document**:
A deterministic, human-readable GitHub Flavored Markdown projection of one JSON Document, beginning with the Results Heading. It is not a reversible serialization format.
_Avoid_: CommonMark document, lossless serialization

**Canonical Spacing**:
The deterministic whitespace of an Output Document: LF line endings, one blank line between block elements, no trailing spaces, and exactly one final newline. Formatting whitespace from Serialized JSON Text is not retained.

**Conversion Error**:
A structured failure produced instead of an Output Document at the first invalid or unsupported input in Encounter Order. It has a stable code and message plus a JSON Pointer when locatable, or source coordinates for serialized syntax failures; conversion never returns partial output.
_Avoid_: Partial result, best-effort conversion

**Heading-form Key**:
An object key represented as a Markdown heading. The five key positions beneath the Results Heading use H2 through H6.

**List-form Key**:
An object key beyond the Heading-form Key range, represented as a nested unordered-list item. A scalar value shares the item with its key; a container value owns indented child items.

**Section Depth**:
The number of rendered named sections beneath the Results Heading. Object keys and Detail Headings advance Section Depth; array indices remain part of JSON Pointers but do not advance it.
_Avoid_: JSON Pointer depth

**Tabular Array**:
A non-empty array containing only objects whose combined keys provide at least one column. Its columns are the exhaustive union of member keys in first-seen order; a missing member value is an empty cell.

**Non-tabular Array**:
Any array that does not meet the definition of a Tabular Array. It is represented as an unordered list in source order, with container items nested recursively and empty containers shown explicitly as `[]` or `{}`.
_Avoid_: Mixed array, unless the array actually contains multiple value kinds

**Missing Property**:
The absence of a Tabular Array column's key from one member object. It is represented by an empty table cell and is distinct from a Null Value or Empty String.
_Avoid_: Nullable, which does not distinguish absence from `null`

**Null Value**:
The explicit JSON value `null`, represented as `` `null` `` and distinct from a Missing Property.

**Empty String**:
A JSON string containing zero characters, represented as `` `""` `` and distinct from a Missing Property.

**Scalar Value**:
A string, number, boolean, or `null` rendered consistently wherever it appears in an Output Document. A Missing Property is absence, not a Scalar Value.

**URL String**:
A string whose complete, unmodified content is a valid absolute HTTP or HTTPS URL. It is rendered as a link using the same URL as label and destination; URLs embedded in prose and all other schemes remain ordinary strings.
_Avoid_: URL-containing string, link-like string

**Literal String**:
Any non-URL JSON string treated as untrusted text rather than Markdown or HTML. GFM and HTML control characters are escaped, newline sequences become generated `<br>` elements, other control characters remain visible through escape notation, and significant spaces use generated non-breaking-space entities when Markdown would collapse them.
_Avoid_: Raw Markdown, trusted string

**Numeric Lexeme**:
The exact source spelling of a number in Serialized JSON Text, including its precision and decimal or exponent notation. A Parsed JSON Document has only the numeric value supplied by its caller and may no longer retain a Numeric Lexeme.
_Avoid_: Number value, when exact source spelling matters

**Encounter Order**:
The order in which object members or array items are presented by the selected input form. Output preserves this order; Tabular Array columns use the first encounter of each member name.
_Avoid_: Alphabetical order, canonical order

**Root Value**:
The value at the empty JSON Pointer. It appears directly beneath the Results Heading without a generated `value` or `items` label; its own kind determines whether it is rendered as a scalar, explicit empty container, table, list, or keyed structure.

**Key Label**:
The literal, escaped display of an object member name. Empty names appear as `` `""` ``, control characters use visible JSON-style escapes, and URL-like names are not automatically linked.

**JSON Pointer**:
The canonical, slash-separated identity of a value within a JSON Document. Pointer escaping keeps arbitrary object keys unambiguous.
_Avoid_: Underscore-joined path, dotted path

**Detail Section**:
The linked rendering of a non-empty object or array extracted from a table cell, identified by the value's JSON Pointer. Detail Sections follow their parent table in row-major encounter order, with each section's descendants rendered before its next sibling; empty containers remain explicit inside their cells.

**Detail Heading**:
The addressable heading `Detail: {JSON Pointer}` that introduces a Detail Section. It follows the surrounding hierarchy until H6 and remains at H6 when further nesting would otherwise exceed Markdown's heading range; the fixed prefix guarantees a non-empty Heading Fragment.

**Heading Fragment**:
The document-wide, GFM-compatible link target allocated to a heading in final output order. Collisions receive GitHub-style numeric suffixes, and Detail Section links use the fragment allocated to their Detail Heading.

## Example dialogue

> **Developer:** Does the converter require a JSON object at the root?
>
> **Domain expert:** No. Every Convertible JSON Document may have a root array, scalar, object, or `null`.
>
> **Developer:** Is `{"name":"first","name":"second"}` convertible?
>
> **Domain expert:** No. Duplicate member names prevent it from being a Convertible JSON Document.
>
> **Developer:** Is this string a value to convert or text that still needs parsing?
>
> **Domain expert:** Call it a Parsed JSON Document in the first case and Serialized JSON Text in the second.
>
> **Developer:** Can an untrusted JavaScript Proxy be treated as a Parsed JSON Document?
>
> **Domain expert:** No. Parsed values are caller-trusted; use Serialized JSON Text for untrusted content.
>
> **Developer:** Which heading begins the Markdown document?
>
> **Domain expert:** Use the Results Heading exactly as `# Results`.
>
> **Developer:** Which Markdown rules define an Output Document?
>
> **Domain expert:** GitHub Flavored Markdown, including its table syntax.
>
> **Developer:** Does output spacing depend on the caller's operating system or source indentation?
>
> **Domain expert:** No. Every Output Document uses Canonical Spacing.
>
> **Developer:** What happens when a parsed value contains `undefined` or a cycle?
>
> **Domain expert:** Conversion fails atomically with a Conversion Error rather than coercing the value or returning partial Markdown.
>
> **Developer:** What happens after nested keys consume H6?
>
> **Domain expert:** Further keys are List-form Keys, not additional headings.
>
> **Developer:** Does row index `0` make `/table1/0/degrees` one heading deeper?
>
> **Domain expert:** No. Array indices identify items but do not add Section Depth.
>
> **Developer:** Can an array with different object keys still be a table?
>
> **Domain expert:** Yes. It is a Tabular Array whose columns are the first-seen union of all member keys; missing values leave empty cells.
>
> **Developer:** How do we represent an array that is not tabular?
>
> **Domain expert:** It is a Non-tabular Array: preserve item order in an unordered list and show empty containers explicitly.
>
> **Developer:** Are a missing property, `null`, and an empty string all blank table cells?
>
> **Domain expert:** No. Only a Missing Property is blank; Null Value and Empty String are explicit.
>
> **Developer:** Does `null` render differently at the root or inside a table?
>
> **Domain expert:** No. Scalar Values have one representation in every context; only required table escaping differs.
>
> **Developer:** Should `See https://example.com` become a link?
>
> **Domain expert:** No. Only a URL String, such as `https://example.com`, is automatically linked.
>
> **Developer:** Can a JSON string inject Markdown or HTML into the output?
>
> **Domain expert:** No. It is a Literal String and must remain visible data rather than executable formatting.
>
> **Developer:** Should serialized `1.00` be rendered as `1`?
>
> **Domain expert:** No. Preserve its Numeric Lexeme; a Parsed JSON Document may already have lost that spelling.
>
> **Developer:** Should object members be sorted before conversion?
>
> **Domain expert:** No. Preserve Encounter Order, including when collecting table columns.
>
> **Developer:** What heading labels a root scalar or array?
>
> **Domain expert:** None. Render the Root Value directly beneath the Results Heading.
>
> **Developer:** Is an empty or Markdown-shaped object key copied directly into a heading?
>
> **Domain expert:** No. Render it as a literal Key Label while retaining the original name in its JSON Pointer.
>
> **Developer:** What name identifies a nested value extracted from a table cell?
>
> **Domain expert:** Use its JSON Pointer, such as `/table1/0/degrees`, rather than inventing an underscore-joined path.
>
> **Developer:** Does every container-valued table cell become a Detail Section?
>
> **Domain expert:** Only non-empty containers do; render empty objects and arrays directly as `{}` and `[]`.
>
> **Developer:** Which Detail Section appears first when several are linked?
>
> **Domain expert:** Follow row-major encounter order and finish each section's descendants before its next sibling.
>
> **Developer:** What if a Detail Section would require an H7 heading?
>
> **Domain expert:** Use a Detail Heading capped at H6; the H6-to-list transition applies to JSON keys, not generated navigation.
>
> **Developer:** Can a punctuation-only JSON Pointer produce an empty link target?
>
> **Domain expert:** No. Prefix every Detail Heading with `Detail:` so its Heading Fragment is always non-empty.
>
> **Developer:** What if two headings produce the same GFM link target?
>
> **Domain expert:** Give each a unique Heading Fragment in output order and link each Detail Section to its allocation.
