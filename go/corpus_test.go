package jsontomd

import (
	"encoding/json"
	"errors"
	"io/fs"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The parity corpus at ../corpus is the contract of record: every case must
// byte-match here exactly as it does under the TypeScript suite. Read via
// os.ReadFile — go:embed cannot escape the module directory.

type errorFixture struct {
	Code          string          `json:"code"`
	Pointer       *string         `json:"pointer"`
	Location      *SourceLocation `json:"location"`
	FirstLocation *SourceLocation `json:"firstLocation"`
}

func corpusCases(t *testing.T) []string {
	t.Helper()
	var bases []string
	err := filepath.WalkDir("../corpus", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() && strings.HasSuffix(path, ".input.json") {
			bases = append(bases, strings.TrimSuffix(path, ".input.json"))
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walking corpus: %v", err)
	}
	if len(bases) == 0 {
		t.Fatal("no corpus cases found")
	}
	return bases
}

func sameLocation(got, want *SourceLocation) bool {
	if got == nil || want == nil {
		return got == nil && want == nil
	}
	return *got == *want
}

func TestCorpus(t *testing.T) {
	for _, base := range corpusCases(t) {
		name := strings.TrimPrefix(filepath.ToSlash(base), "../corpus/")
		input, err := os.ReadFile(base + ".input.json")
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}

		t.Run(name, func(t *testing.T) {
			if expected, err := os.ReadFile(base + ".expected.md"); err == nil {
				got, convErr := ConvertText(input)
				if convErr != nil {
					t.Fatalf("unexpected error: %v", convErr)
				}
				if got != string(expected) {
					t.Fatalf("output mismatch\n--- got ---\n%s\n--- want ---\n%s", got, expected)
				}
				return
			}

			raw, err := os.ReadFile(base + ".error.json")
			if err != nil {
				t.Fatalf("case has neither .expected.md nor .error.json: %v", err)
			}
			var fixture errorFixture
			if err := json.Unmarshal(raw, &fixture); err != nil {
				t.Fatalf("bad error fixture: %v", err)
			}

			_, convErr := ConvertText(input)
			var e *Error
			if !errors.As(convErr, &e) {
				t.Fatalf("expected *jsontomd.Error, got %v", convErr)
			}
			if string(e.Code) != fixture.Code {
				t.Errorf("code: got %s, want %s", e.Code, fixture.Code)
			}
			wantPointer := ""
			if fixture.Pointer != nil {
				wantPointer = *fixture.Pointer
			}
			if e.Pointer != wantPointer {
				t.Errorf("pointer: got %q, want %q", e.Pointer, wantPointer)
			}
			if !sameLocation(e.Location, fixture.Location) {
				t.Errorf("location: got %+v, want %+v", e.Location, fixture.Location)
			}
			if !sameLocation(e.FirstLocation, fixture.FirstLocation) {
				t.Errorf("firstLocation: got %+v, want %+v", e.FirstLocation, fixture.FirstLocation)
			}
		})
	}
}

func TestConvertValue(t *testing.T) {
	t.Run("struct field order and json.Number lexeme", func(t *testing.T) {
		got, err := ConvertValue(struct {
			Z json.Number `json:"z"`
			A string      `json:"a"`
		}{Z: json.Number("1.00"), A: "x"})
		if err != nil {
			t.Fatal(err)
		}
		want := "# Results\n\n## z\n\n1.00\n\n## a\n\nx\n"
		if got != want {
			t.Fatalf("got %q, want %q", got, want)
		}
	})

	t.Run("equals ConvertText on the marshaled bytes", func(t *testing.T) {
		v := map[string]any{"b": []any{1.0, "x"}, "a": nil}
		data, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		fromValue, err := ConvertValue(v)
		if err != nil {
			t.Fatal(err)
		}
		fromText, err := ConvertText(data)
		if err != nil {
			t.Fatal(err)
		}
		if fromValue != fromText {
			t.Fatalf("ConvertValue diverged from ConvertText:\n%q\n%q", fromValue, fromText)
		}
	})

	t.Run("cycle", func(t *testing.T) {
		type ring struct {
			Self *ring `json:"self"`
		}
		r := &ring{}
		r.Self = r
		_, err := ConvertValue(r)
		var e *Error
		if !errors.As(err, &e) || e.Code != ErrCyclicReference {
			t.Fatalf("want ErrCyclicReference, got %v", err)
		}
	})

	t.Run("NaN", func(t *testing.T) {
		_, err := ConvertValue(math.NaN())
		var e *Error
		if !errors.As(err, &e) || e.Code != ErrInvalidParsedValue {
			t.Fatalf("want ErrInvalidParsedValue, got %v", err)
		}
	})

	t.Run("unsupported type", func(t *testing.T) {
		_, err := ConvertValue(make(chan int))
		var e *Error
		if !errors.As(err, &e) || e.Code != ErrInvalidParsedValue {
			t.Fatalf("want ErrInvalidParsedValue, got %v", err)
		}
	})
}
