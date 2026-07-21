# Parity corpus

The contract of record for the byte-identical promise between the TypeScript
and Go implementations: for every case here, both must produce the same bytes.

- `<group>/<case>.input.json` — raw Serialized JSON Text, byte-exact.
- `<case>.expected.md` — the Output Document, byte-exact (one final newline).
- `<case>.error.json` — contractual error fields only: `code`, and when
  present `pointer`, `location`/`firstLocation` `{offset,line,column}`
  counted in UTF-16 code units. `message` is deliberately absent.
- Exactly one of `.expected.md` / `.error.json` per case.
- Consumed by `test/corpus.test.ts` and `go/corpus_test.go`.
- Regenerate with `pnpm build && node scripts/generate-corpus.mjs` — only in
  a reviewed lockstep PR; the TS implementation is the oracle.
