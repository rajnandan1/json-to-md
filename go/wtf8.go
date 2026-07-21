package jsontomd

import "unicode/utf8"

// The TypeScript implementation works on JS strings — sequences of UTF-16
// code units that may contain lone surrogates. Go strings are bytes, so the
// port carries string values as WTF-8: standard UTF-8 plus 3-byte encodings
// of lone surrogates (ED A0..BF 80..BF). Valid \uXXXX surrogate pairs are
// combined into supplementary runes at parse time, exactly as adjacent UTF-16
// units join in a JS string.

const (
	surrMin rune = 0xd800
	surrMax rune = 0xdfff
)

func isSurrogate(r rune) bool { return r >= surrMin && r <= surrMax }

// appendWTF8 appends r, which may be a lone surrogate, to dst.
func appendWTF8(dst []byte, r rune) []byte {
	if isSurrogate(r) {
		return append(dst, 0xe0|byte(r>>12), 0x80|byte(r>>6)&0x3f, 0x80|byte(r)&0x3f)
	}
	return utf8.AppendRune(dst, r)
}

// decodeWTF8 returns the next rune of a WTF-8 string, decoding lone-surrogate
// encodings that utf8.DecodeRuneInString rejects. Invalid bytes decode as one
// utf8.RuneError of size 1 (unreachable from the TS input space, which cannot
// hold invalid UTF-8).
func decodeWTF8(s string) (rune, int) {
	if len(s) >= 3 && s[0] == 0xed && s[1] >= 0xa0 && s[1] <= 0xbf && s[2] >= 0x80 && s[2] <= 0xbf {
		return rune(s[0]&0x0f)<<12 | rune(s[1]&0x3f)<<6 | rune(s[2]&0x3f), 3
	}
	return utf8.DecodeRuneInString(s)
}

// utf16Len is how many UTF-16 code units r occupies in a JS string.
func utf16Len(r rune) int {
	if r > 0xffff {
		return 2
	}
	return 1
}

// utf16Location converts a byte offset in raw input text into the parity
// contract's SourceLocation: offset and column in UTF-16 code units, lines
// split on LF only. Computed lazily — only when an error is being built.
func utf16Location(src []byte, byteOffset int) *SourceLocation {
	offset, line, column := 0, 1, 1
	for i := 0; i < byteOffset && i < len(src); {
		r, size := utf8.DecodeRune(src[i:])
		if r == utf8.RuneError && size == 1 {
			// Invalid byte: count as one unit (unreachable from TS inputs).
			offset++
			column++
			i++
			continue
		}
		units := utf16Len(r)
		offset += units
		if r == '\n' {
			line++
			column = 1
		} else {
			column += units
		}
		i += size
	}
	return &SourceLocation{Offset: offset, Line: line, Column: column}
}
