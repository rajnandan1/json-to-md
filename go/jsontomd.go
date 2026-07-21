// Package jsontomd converts one JSON document into deterministic,
// human-readable GitHub Flavored Markdown.
//
// The package is the Go implementation of json-to-md and is bound by the
// parity contract with the TypeScript implementation: for every Convertible
// JSON Document, ConvertText produces byte-identical output to the TS
// convertJsonText, and errors carry identical code, JSON Pointer, and
// location (UTF-16 code units). The shared corpus/ directory at the
// repository root is the contract of record.
//
// All functions are pure: they never mutate input, share no state, are safe
// for concurrent use, and fail atomically — on error no partial Markdown is
// returned. Every Output Document begins with "# Results" and uses canonical
// spacing (LF endings, one blank line between blocks, one final newline).
package jsontomd

import (
	"encoding/json"
	"strings"
)

// ConvertText converts untrusted Serialized JSON Text into an Output
// Document. src must be UTF-8 encoded text containing exactly one JSON
// document.
//
// This is the byte-identical parity surface with the TypeScript
// convertJsonText: member Encounter Order is preserved, each number's exact
// source spelling (Numeric Lexeme) is kept, and duplicate member names are
// rejected with both locations reported.
func ConvertText(src []byte) (string, error) {
	root, err := parseSerialized(src)
	if err != nil {
		return "", err
	}
	return renderDocument(root), nil
}

// ConvertValue converts caller-trusted, already-parsed Go data into an
// Output Document. It is the Go analogue of the TypeScript convertJsonValue,
// defined as: marshal v with encoding/json semantics, then convert the
// resulting text exactly as ConvertText would.
//
// Determinism therefore follows encoding/json: struct fields render in field
// order, map keys render in sorted order (Go maps carry no Encounter Order —
// this is the documented cross-language difference from JS objects, which
// carry insertion order), and json.Number values keep their literal spelling
// while float64 values render per Go marshaling, analogous to the TS parsed
// entry point losing numeric lexemes.
//
// Failures: cyclic values return ErrCyclicReference; NaN/±Inf and
// non-JSON-representable types return ErrInvalidParsedValue; a custom
// json.Marshaler emitting duplicate member names is caught by the conversion
// core as ErrDuplicateMemberName. Sparse arrays cannot exist in Go, so no
// SPARSE_ARRAY code exists.
func ConvertValue(v any) (string, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return "", translateMarshalError(err)
	}
	return ConvertText(data)
}

func translateMarshalError(err error) error {
	code := ErrInvalidParsedValue
	// encoding/json exposes no structured cycle sentinel — only
	// UnsupportedValueError with "encountered a cycle" in Str. If Go ever
	// rewords it, this degrades to ErrInvalidParsedValue (still a truthful
	// code), and TestConvertValue/cycle fails to flag the rewording.
	if uve, ok := err.(*json.UnsupportedValueError); ok && strings.Contains(uve.Str, "cycle") {
		code = ErrCyclicReference
	}
	return &Error{Code: code, Message: "value is not JSON-compatible: " + err.Error()}
}
