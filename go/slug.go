package jsontomd

import (
	"strconv"
	"strings"
	"unicode"
)

// The TS build bundles github-slugger, making its exact behavior part of the
// byte-identical parity surface: lowercase, remove the characters in
// slugranges_gen.go (generated from the installed package), then turn spaces
// into hyphens, deduplicating repeats with -N suffixes.

// isCased reports Unicode Cased characters — the Final_Sigma condition's
// "cased letter".
func isCased(r rune) bool {
	return unicode.In(r, unicode.Lu, unicode.Ll, unicode.Lt, unicode.Other_Lowercase, unicode.Other_Uppercase)
}

// isCaseIgnorable approximates Unicode Case_Ignorable: the Mn/Me/Cf/Lm/Sk
// categories plus the Word_Break MidLetter/MidNumLet/Single_Quote code
// points. Verified against V8 in slug_test.go.
func isCaseIgnorable(r rune) bool {
	switch r {
	case '\'', '.', ':', 0x00b7, 0x0387, 0x05f4, 0x2018, 0x2019, 0x2024, 0x2027,
		0xfe13, 0xfe52, 0xfe55, 0xff07, 0xff0e, 0xff1a:
		return true
	}
	return unicode.In(r, unicode.Mn, unicode.Me, unicode.Cf, unicode.Lm, unicode.Sk)
}

// finalSigma implements the Unicode Final_Sigma context for rs[i]: a cased
// letter precedes it (looking through case-ignorables) and no cased letter
// follows (again through case-ignorables).
func finalSigma(rs []rune, i int) bool {
	before := false
	for j := i - 1; j >= 0; j-- {
		if isCaseIgnorable(rs[j]) {
			continue
		}
		before = isCased(rs[j])
		break
	}
	if !before {
		return false
	}
	for j := i + 1; j < len(rs); j++ {
		if isCaseIgnorable(rs[j]) {
			continue
		}
		return !isCased(rs[j])
	}
	return true
}

// jsLowercase mirrors JS String.prototype.toLowerCase: Unicode simple
// mappings plus the two language-insensitive deviations — the unconditional
// full mapping U+0130 (İ → i + combining dot above) and the contextual
// Final_Sigma rule (Σ at word end → ς, U+03C2).
func jsLowercase(s string) string {
	rs := []rune(s)
	var b strings.Builder
	b.Grow(len(s))
	for i, r := range rs {
		switch {
		case r == 0x0130:
			b.WriteString("i̇")
		case r == 0x03a3 && finalSigma(rs, i):
			b.WriteRune(0x03c2)
		default:
			b.WriteRune(unicode.ToLower(r))
		}
	}
	return b.String()
}

func slugStripped(r rune) bool {
	lo, hi := 0, len(slugStrip)-1
	for lo <= hi {
		mid := (lo + hi) / 2
		switch {
		case r < slugStrip[mid][0]:
			hi = mid - 1
		case r > slugStrip[mid][1]:
			lo = mid + 1
		default:
			return true
		}
	}
	return false
}

func slugBase(value string) string {
	var b strings.Builder
	for _, r := range jsLowercase(value) {
		switch {
		case r == ' ':
			b.WriteByte('-')
		case slugStripped(r):
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// slugger allocates document-unique Heading Fragments in output order,
// mirroring github-slugger's occurrence counting.
type slugger struct {
	occurrences map[string]int
}

func newSlugger() *slugger {
	return &slugger{occurrences: make(map[string]int)}
}

func (s *slugger) slug(value string) string {
	result := slugBase(value)
	original := result
	for {
		if _, seen := s.occurrences[result]; !seen {
			break
		}
		s.occurrences[original]++
		result = original + "-" + strconv.Itoa(s.occurrences[original])
	}
	s.occurrences[result] = 0
	return result
}
