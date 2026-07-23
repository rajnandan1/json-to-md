package jsontomd

import (
	"net/url"
	"strings"
	"unicode/utf8"
)

const emptyStringDisplay = "`\"\"`"

// escapeInlineRune escapes the rune at the start of s for inline, one-line
// display: control characters become visible JSON-style escapes, valid
// surrogate pairs (astral runes) pass through, lone surrogates become
// visible, and Markdown/HTML metacharacters are neutralised. Spaces and
// newlines are handled by callers. Returns the escaped text and bytes read.
func escapeInlineRune(s string) (string, int) {
	r, size := decodeWTF8(s)
	switch r {
	case 0x09:
		return `\t`, size
	case 0x08:
		return `\b`, size
	case 0x0c:
		return `\f`, size
	case 0x0a:
		return `\n`, size
	case 0x0d:
		return `\r`, size
	}
	if r < 0x20 || (r >= 0x7f && r <= 0x9f) || isSurrogate(r) {
		return `\u` + hex4(r), size
	}
	if r == utf8.RuneError && size == 1 {
		return s[:1], 1 // invalid byte: pass through (unreachable from TS inputs)
	}
	switch r {
	case '\\':
		return `\\`, size
	case '`':
		return "\\`", size
	case '*':
		return `\*`, size
	case '_':
		return `\_`, size
	case '[':
		return `\[`, size
	case ']':
		return `\]`, size
	case '|':
		return `\|`, size
	case '~':
		return `\~`, size
	case '&':
		return "&amp;", size
	case '<':
		return "&lt;", size
	case '>':
		return "&gt;", size
	}
	return s[:size], size
}

// appendSpaceRun renders a run of spaces: keep a single interior space,
// protect everything Markdown would collapse (leading, trailing, additional
// repeats) with `&nbsp;`.
func appendSpaceRun(b *strings.Builder, runLen int, interior bool) {
	if interior {
		b.WriteByte(' ')
		runLen--
	}
	for ; runLen > 0; runLen-- {
		b.WriteString("&nbsp;")
	}
}

// renderSegment escapes one line segment of a Literal String. Newlines are
// handled by the caller; this sees text with no LF/CR.
func renderSegment(seg string) string {
	var b strings.Builder
	n := len(seg)
	i := 0
	atStart := true

	for i < n {
		c := seg[i]

		if c == ' ' {
			j := i
			for j < n && seg[j] == ' ' {
				j++
			}
			appendSpaceRun(&b, j-i, i > 0 && j < n)
			i = j
			atStart = false
			continue
		}

		// Block markers only bite at the very start of a segment.
		if atStart {
			if c >= '0' && c <= '9' {
				j := i
				for j < n && seg[j] >= '0' && seg[j] <= '9' {
					j++
				}
				if j < n && (seg[j] == '.' || seg[j] == ')') {
					b.WriteString(seg[i:j])
					b.WriteByte('\\')
					b.WriteByte(seg[j])
					i = j + 1
					atStart = false
					continue
				}
			} else if c == '#' || c == '-' || c == '+' {
				b.WriteByte('\\')
				b.WriteByte(c)
				i++
				atStart = false
				continue
			}
		}

		text, consumed := escapeInlineRune(seg[i:])
		b.WriteString(text)
		i += consumed
		atStart = false
	}

	return b.String()
}

// escapeInline escapes a string for one-line inline display (a Key Label or a
// JSON Pointer): the same space-run and metacharacter handling as a Literal
// String segment, but newlines stay as `\n`/`\r` so the text never leaves its
// line, and no block-start markers are escaped.
func escapeInline(str string) string {
	var b strings.Builder
	n := len(str)
	i := 0
	for i < n {
		if str[i] == ' ' {
			j := i
			for j < n && str[j] == ' ' {
				j++
			}
			appendSpaceRun(&b, j-i, i > 0 && j < n)
			i = j
			continue
		}
		text, consumed := escapeInlineRune(str[i:])
		b.WriteString(text)
		i += consumed
	}
	return b.String()
}

// escapeText renders an untrusted string as visible Literal String text
// (newlines become `<br>`).
func escapeText(value string) string {
	normalized := strings.ReplaceAll(value, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	var b strings.Builder
	for s, segment := range strings.Split(normalized, "\n") {
		if s > 0 {
			b.WriteString("<br>")
		}
		b.WriteString(renderSegment(segment))
	}
	return b.String()
}

// jsWhitespace matches JavaScript's \s character class exactly (which differs
// from unicode.IsSpace: JS includes U+FEFF and excludes U+0085).
func jsWhitespace(r rune) bool {
	switch r {
	case '\t', '\n', 0x0b, '\f', '\r', ' ', 0x00a0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

// isURLString reports whether the whole, unmodified content of value is one
// absolute http(s) URL. The TS oracle uses the WHATWG URL parser; net/url is
// RFC 3986, so a forbidden-host-character check narrows the gap.
// ponytail: WHATWG/RFC divergence possible in exotic corners; the corpus and
// fuzz differ police it — tighten here if a real diff ever surfaces.
func isURLString(value string) bool {
	for _, r := range value {
		if jsWhitespace(r) {
			return false
		}
	}
	rest, ok := cutPrefixFold(value, "http")
	if !ok {
		return false
	}
	if s, has := cutPrefixFold(rest, "s"); has {
		rest = s
	}
	if !strings.HasPrefix(rest, "://") {
		return false
	}
	u, err := url.Parse(value)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return false
	}
	return !strings.ContainsAny(u.Host, "<>\"\\^`{}|")
}

// cutPrefixFold is strings.CutPrefix under ASCII case folding.
func cutPrefixFold(s, prefix string) (string, bool) {
	if len(s) < len(prefix) || !strings.EqualFold(s[:len(prefix)], prefix) {
		return s, false
	}
	return s[len(prefix):], true
}

// escapeDestination escapes a link destination so it survives a table cell.
func escapeDestination(u string) string {
	var b strings.Builder
	for i := 0; i < len(u); i++ {
		switch u[i] {
		case '\\', '(', ')', '|':
			b.WriteByte('\\')
		}
		b.WriteByte(u[i])
	}
	return b.String()
}

// keyLabel is the literal, escaped display of an object member name. Unlike a
// Literal String, a Key Label keeps control characters as visible JSON-style
// escapes so the label stays on one line inside a heading or table header.
func keyLabel(name string) string {
	if name == "" {
		return emptyStringDisplay
	}
	return escapeInline(name)
}

// annotationSuffix is the Type Annotation token appended after a value or a
// Uniform Column header.
func annotationSuffix(t string) string {
	return " *(" + t + ")*"
}

// annotationType is the Annotation Type of a value ("string", "integer",
// "number", "boolean"), or "" for Self-Describing Values (null, `[]`, `{}`)
// which never carry a Type Annotation. A number is an integer when its
// Numeric Lexeme has no fraction or exponent part.
func annotationType(n node) string {
	switch n.kind {
	case kindString:
		return "string"
	case kindBool:
		return "boolean"
	case kindNumber:
		if strings.ContainsAny(n.lexeme, ".eE") {
			return "number"
		}
		return "integer"
	default:
		return ""
	}
}

// scalarText is the inline representation of a Scalar Value, or of an empty
// container shown inline as `[]`/`{}`. Same rendering in every context.
func scalarText(n node) string {
	switch n.kind {
	case kindNull:
		return "`null`"
	case kindBool:
		if n.boolVal {
			return "true"
		}
		return "false"
	case kindNumber:
		return n.lexeme
	case kindString:
		if n.str == "" {
			return emptyStringDisplay
		}
		if isURLString(n.str) {
			return "[" + escapeText(n.str) + "](" + escapeDestination(n.str) + ")"
		}
		return escapeText(n.str)
	case kindArray:
		return "`[]`"
	default:
		return "`{}`"
	}
}
