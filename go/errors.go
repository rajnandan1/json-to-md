package jsontomd

// ErrorCode identifies why a conversion failed. The string values are shared
// verbatim with the TypeScript implementation (see corpus/); codes whose
// triggering condition cannot exist in Go (SPARSE_ARRAY) are deliberately
// absent rather than defined-but-unreachable.
type ErrorCode string

const (
	// ErrInvalidJSONSyntax reports that the serialized text is not one valid
	// JSON document.
	ErrInvalidJSONSyntax ErrorCode = "INVALID_JSON_SYNTAX"
	// ErrDuplicateMemberName reports an object declaring the same member name
	// twice; the error carries both occurrences (Location and FirstLocation).
	ErrDuplicateMemberName ErrorCode = "DUPLICATE_MEMBER_NAME"
	// ErrInvalidParsedValue reports that ConvertValue received a value outside
	// the JSON data model (NaN/±Inf floats, channels, funcs, complex values,
	// or other unsupported types).
	ErrInvalidParsedValue ErrorCode = "INVALID_PARSED_VALUE"
	// ErrCyclicReference reports that ConvertValue received a self-referencing
	// value.
	ErrCyclicReference ErrorCode = "CYCLIC_REFERENCE"
	// ErrInvalidOption reports an invalid conversion option (an empty Document
	// Heading; use WithoutHeading to omit the heading instead).
	ErrInvalidOption ErrorCode = "INVALID_OPTION"
)

// SourceLocation is a position inside Serialized JSON Text.
//
// Offset is a zero-based UTF-16 code-unit index into the text, Line is
// one-based counting LF line breaks only, and Column is the one-based UTF-16
// code-unit position within the line — identical numbers to the TypeScript
// implementation for the same input, including beyond ASCII.
type SourceLocation struct {
	Offset int
	Line   int
	Column int
}

// Error is the typed failure returned by every conversion function.
// Match it with errors.As:
//
//	var convErr *jsontomd.Error
//	if errors.As(err, &convErr) {
//		switch convErr.Code { ... }
//	}
type Error struct {
	// Code is stable and shared with the TypeScript implementation.
	Code ErrorCode
	// Pointer is the JSON Pointer of the offending value ("" when the failure
	// has no addressable value, e.g. a syntax error).
	Pointer string
	// Location is where conversion failed, for serialized-text failures.
	Location *SourceLocation
	// FirstLocation is the first occurrence of a duplicated member name; nil
	// for every other code.
	FirstLocation *SourceLocation
	// Message is human wording. It is idiomatic Go and deliberately not
	// covered by the parity contract — compare Code, Pointer, and the
	// locations, never this string.
	Message string
}

func (e *Error) Error() string { return e.Message }
