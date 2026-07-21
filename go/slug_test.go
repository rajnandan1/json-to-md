package jsontomd

import "testing"

// Goldens produced by V8 (the TS oracle's runtime):
//
//	node -e 'const cases=[...]; for (const c of cases) print(c.toLowerCase())'
//
// They pin jsLowercase's two deviations from unicode.ToLower — U+0130 and the
// contextual Final_Sigma rule — across cased, case-ignorable, and breaking
// neighbors. Regenerate with any Node ≥18 if Unicode data shifts.
func TestJSLowercase(t *testing.T) {
	goldens := map[string]string{
		"ΑΣ":      "ας",
		"Σ":       "σ",
		"ΑΣΒ":     "ασβ",
		"ΑΣ Β":    "ας β",
		"ΑΣ.Β":    "ασ.β",
		"ΑΣ.":     "ας.",
		"ασΣ":     "ασς",
		"ΣΣ":      "σς",
		"ΑΣ̈":     "ας̈",
		"ΑΣ̈Β":    "ασ̈β",
		"x·Σ·y":   "x·σ·y",
		"ΑΣ:Β":    "ασ:β",
		"ΑΣ:":     "ας:",
		"ΑΣ’Β":    "ασ’β",
		"ΑΣ/0/b":  "ας/0/b",
		"/ΑΣ/0/b": "/ας/0/b",
		"İ":       "i̇",
		"AΣ״Β":    "aσ״β",
		"3Σ4":     "3σ4",
		"_Σ_":     "_σ_",
	}
	for in, want := range goldens {
		if got := jsLowercase(in); got != want {
			t.Errorf("jsLowercase(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSlugBaseFinalSigma(t *testing.T) {
	// The github-slugger pipeline over a Detail Heading pointer: lowercase
	// (final sigma), strip slashes, keep letters/digits.
	if got := slugBase("/ΑΣ/0/b"); got != "ας0b" {
		t.Fatalf("slugBase(/ΑΣ/0/b) = %q, want %q", got, "ας0b")
	}
}
