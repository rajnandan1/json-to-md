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
// returned. Every Output Document begins with its Document Heading ("# Results"
// unless WithHeading/WithoutHeading says otherwise), leaves values bare unless
// WithTypes opts into Type Annotations, and uses canonical spacing (LF
// endings, one blank line between blocks, one final newline).
package jsontomd

import (
	"encoding/json"
	"strings"
)

// Option configures a conversion. The zero configuration (no options) uses
// the Document Heading "Results" and emits no Type Annotations — the same
// defaults as the TypeScript implementation.
type Option func(*convertOptions)

type convertOptions struct {
	heading     string
	omitHeading bool
	showTypes   bool
}

// WithHeading replaces the default Document Heading text "Results". The text
// is rendered as plain text, never raw Markdown. An empty string is
// ErrInvalidOption; use WithoutHeading to omit the heading.
func WithHeading(heading string) Option {
	return func(o *convertOptions) { o.heading = heading; o.omitHeading = false }
}

// WithoutHeading omits the H1 Document Heading entirely. Body heading levels
// are unchanged (top-level keys stay H2).
func WithoutHeading() Option {
	return func(o *convertOptions) { o.omitHeading = true }
}

// WithTypes emits Type Annotations (` *(integer)*` …) after annotatable
// values. They are off by default.
func WithTypes() Option {
	return func(o *convertOptions) { o.showTypes = true }
}

func resolveOptions(opts []Option) (convertOptions, error) {
	o := convertOptions{heading: "Results"}
	for _, opt := range opts {
		opt(&o)
	}
	if !o.omitHeading && o.heading == "" {
		return o, &Error{Code: ErrInvalidOption, Message: "heading must not be empty; use WithoutHeading to omit it"}
	}
	return o, nil
}

// ConvertText converts untrusted Serialized JSON Text into an Output
// Document. src must be UTF-8 encoded text containing exactly one JSON
// document.
//
// This is the byte-identical parity surface with the TypeScript
// convertJsonText: member Encounter Order is preserved, each number's exact
// source spelling (Numeric Lexeme) is kept, and duplicate member names are
// rejected with both locations reported.
func ConvertText(src []byte, opts ...Option) (string, error) {
	root, err := parseSerialized(src)
	if err != nil {
		return "", err
	}
	o, err := resolveOptions(opts)
	if err != nil {
		return "", err
	}
	return renderDocument(root, o), nil
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
func ConvertValue(v any, opts ...Option) (string, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return "", translateMarshalError(err)
	}
	return ConvertText(data, opts...)
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
