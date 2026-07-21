package jsontomd

import (
	"bytes"
	"fmt"
	"unicode/utf8"
)

// Port of the TS iterative parser (src/serialized.ts): parses exactly one
// JSON document into a node without recursion, preserving numeric lexemes and
// member encounter order, and rejecting duplicate member names with both
// occurrences located. Positions are byte offsets; they become UTF-16
// SourceLocations lazily, only when an error is built.

func isWsByte(c byte) bool {
	return c == 0x20 || c == 0x09 || c == 0x0a || c == 0x0d
}

func skipWs(src []byte, pos int) int {
	for pos < len(src) && isWsByte(src[pos]) {
		pos++
	}
	return pos
}

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

const (
	frameStart uint8 = iota
	frameValue
	frameComma
)

type frame struct {
	isObj   bool
	entries []member
	seen    map[string]int // member name -> key start (byte offset)
	state   uint8
	key     string
	items   []node
}

type parser struct {
	src        []byte
	pos        int
	stack      []frame
	pending    node
	hasPending bool
}

func (p *parser) syntaxErr(message string, offset int) error {
	return &Error{
		Code:     ErrInvalidJSONSyntax,
		Message:  message,
		Location: utf16Location(p.src, offset),
	}
}

// byteAt is charCodeAt with a 0 sentinel past the end: 0 matches none of the
// structural bytes callers test, so out-of-range positions fall through to
// the same syntax errors as the TS NaN comparisons.
func (p *parser) byteAt(pos int) byte {
	if pos < len(p.src) {
		return p.src[pos]
	}
	return 0
}

func isHexDigit(c byte) bool {
	return isDigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
}

func hexVal(c byte) rune {
	switch {
	case c <= '9':
		return rune(c - '0')
	case c >= 'a':
		return rune(c-'a') + 10
	default:
		return rune(c-'A') + 10
	}
}

// parseString scans the string starting at the opening quote. The value is
// built as WTF-8: \uXXXX escapes append UTF-16 code units, with adjacent
// high+low escape pairs combining into one supplementary rune exactly as the
// units would join in a JS string, and lone surrogates surviving.
func (p *parser) parseString(pos int) (value string, end int, err error) {
	src := p.src
	n := len(src)
	i := pos + 1
	start := i
	var out []byte
	pendingHigh := rune(-1)

	flushPending := func() {
		if pendingHigh >= 0 {
			out = appendWTF8(out, pendingHigh)
			pendingHigh = -1
		}
	}

	for i < n {
		c := src[i]
		if c == '"' {
			flushPending()
			if out == nil {
				return string(src[start:i]), i + 1, nil
			}
			return string(append(out, src[start:i]...)), i + 1, nil
		}
		if c == '\\' {
			// A raw run and a pending high cannot coexist (any raw byte after
			// an escape flushes below), so append order here is safe.
			out = append(out, src[start:i]...)
			i++
			var e byte
			if i < n {
				e = src[i]
			}
			if e == 'u' {
				if i+4 >= n || !isHexDigit(src[i+1]) || !isHexDigit(src[i+2]) || !isHexDigit(src[i+3]) || !isHexDigit(src[i+4]) {
					return "", 0, p.syntaxErr(`invalid \u escape in string`, i-1)
				}
				unit := hexVal(src[i+1])<<12 | hexVal(src[i+2])<<8 | hexVal(src[i+3])<<4 | hexVal(src[i+4])
				switch {
				case unit >= 0xdc00 && unit <= 0xdfff:
					if pendingHigh >= 0 {
						// Adjacent high+low escapes join into one rune, as the
						// UTF-16 units would join in a JS string.
						out = utf8.AppendRune(out, (pendingHigh-0xd800)<<10|(unit-0xdc00)+0x10000)
						pendingHigh = -1
					} else {
						out = appendWTF8(out, unit)
					}
				case unit >= 0xd800 && unit <= 0xdbff:
					flushPending()
					pendingHigh = unit
				default:
					flushPending()
					out = utf8.AppendRune(out, unit)
				}
				i += 4
			} else {
				flushPending()
				switch e {
				case '"', '\\', '/':
					out = append(out, e)
				case 'b':
					out = append(out, '\b')
				case 'f':
					out = append(out, '\f')
				case 'n':
					out = append(out, '\n')
				case 'r':
					out = append(out, '\r')
				case 't':
					out = append(out, '\t')
				default:
					return "", 0, p.syntaxErr("invalid escape sequence in string", i-1)
				}
			}
			i++
			start = i
			// A pending high survives only into an immediately following
			// escape; a raw byte or the closing quote fixes it as lone.
			if pendingHigh >= 0 && (i >= n || src[i] != '\\') {
				flushPending()
			}
			continue
		}
		if c < 0x20 {
			return "", 0, p.syntaxErr("unescaped control character in string", i)
		}
		i++
	}
	return "", 0, p.syntaxErr("unterminated string", pos)
}

func (p *parser) parseNumber(pos int) (node, int, error) {
	src := p.src
	n := len(src)
	i := pos
	if p.byteAt(i) == '-' {
		i++
	}

	first := p.byteAt(i)
	if first == '0' {
		i++
	} else if first >= '1' && first <= '9' {
		i++
		for i < n && isDigit(src[i]) {
			i++
		}
	} else {
		return node{}, 0, p.syntaxErr("invalid number", pos)
	}

	if i < n && src[i] == '.' {
		i++
		if !(i < n && isDigit(src[i])) {
			return node{}, 0, p.syntaxErr("invalid number: missing fraction digits", i)
		}
		for i < n && isDigit(src[i]) {
			i++
		}
	}

	if e := p.byteAt(i); e == 'e' || e == 'E' {
		i++
		if s := p.byteAt(i); s == '+' || s == '-' {
			i++
		}
		if !(i < n && isDigit(src[i])) {
			return node{}, 0, p.syntaxErr("invalid number: missing exponent digits", i)
		}
		for i < n && isDigit(src[i]) {
			i++
		}
	}

	return node{kind: kindNumber, lexeme: string(src[pos:i])}, i, nil
}

func (p *parser) parseScalar(pos int) (node, int, error) {
	c := p.byteAt(pos)
	if c == '"' {
		value, end, err := p.parseString(pos)
		if err != nil {
			return node{}, 0, err
		}
		return node{kind: kindString, str: value}, end, nil
	}
	if c == '-' || isDigit(c) {
		return p.parseNumber(pos)
	}
	rest := p.src[pos:]
	if bytes.HasPrefix(rest, []byte("true")) {
		return trueNode, pos + 4, nil
	}
	if bytes.HasPrefix(rest, []byte("false")) {
		return falseNode, pos + 5, nil
	}
	if bytes.HasPrefix(rest, []byte("null")) {
		return nullNode, pos + 4, nil
	}
	return node{}, 0, p.syntaxErr("unexpected token; expected a JSON value", pos)
}

// startValue reads the next value beginning at or after `from`: it opens a
// container frame or produces a pending scalar, leaving p.pos after it.
func (p *parser) startValue(from int) error {
	pos := skipWs(p.src, from)
	if pos >= len(p.src) {
		return p.syntaxErr("unexpected end of input; expected a JSON value", pos)
	}
	switch p.src[pos] {
	case '{':
		p.stack = append(p.stack, frame{isObj: true, seen: make(map[string]int)})
		p.pos = pos + 1
		return nil
	case '[':
		p.stack = append(p.stack, frame{})
		p.pos = pos + 1
		return nil
	}
	scanned, end, err := p.parseScalar(pos)
	if err != nil {
		return err
	}
	p.pending = scanned
	p.hasPending = true
	p.pos = end
	return nil
}

func (p *parser) closeFrame() {
	f := p.stack[len(p.stack)-1]
	p.stack = p.stack[:len(p.stack)-1]
	if f.isObj {
		p.pending = node{kind: kindObject, entries: f.entries}
	} else {
		p.pending = node{kind: kindArray, items: f.items}
	}
	p.hasPending = true
}

func (p *parser) readMember(f *frame) error {
	pos := skipWs(p.src, p.pos)
	if p.byteAt(pos) != '"' {
		return p.syntaxErr("expected a string object key", pos)
	}
	keyStart := pos
	key, end, err := p.parseString(pos)
	if err != nil {
		return err
	}
	if prev, dup := f.seen[key]; dup {
		return &Error{
			Code:          ErrDuplicateMemberName,
			Message:       fmt.Sprintf("duplicate object member name %q", key),
			Location:      utf16Location(p.src, keyStart),
			FirstLocation: utf16Location(p.src, prev),
		}
	}
	f.seen[key] = keyStart
	f.key = key
	pos = skipWs(p.src, end)
	if p.byteAt(pos) != ':' {
		return p.syntaxErr("expected ':' after object key", pos)
	}
	return p.startValue(pos + 1)
}

// parseSerialized parses exactly one JSON document without executing caller
// code, per the semantics shared with the TS implementation.
func parseSerialized(src []byte) (node, error) {
	p := &parser{src: src}
	p.pos = skipWs(src, 0)
	if p.pos >= len(src) {
		return node{}, p.syntaxErr("unexpected end of input; expected a JSON value", p.pos)
	}
	if err := p.startValue(p.pos); err != nil {
		return node{}, err
	}

	for {
		if len(p.stack) == 0 {
			p.pos = skipWs(src, p.pos)
			if p.pos != len(src) {
				return node{}, p.syntaxErr("unexpected trailing content after JSON value", p.pos)
			}
			return p.pending, nil
		}
		f := &p.stack[len(p.stack)-1]

		if !f.isObj {
			if p.hasPending {
				f.items = append(f.items, p.pending)
				p.hasPending = false
				p.pending = node{}
				f.state = frameValue
				continue
			}
			p.pos = skipWs(src, p.pos)
			c := p.byteAt(p.pos)
			if f.state == frameStart {
				if c == ']' {
					p.pos++
					p.closeFrame()
					continue
				}
				if err := p.startValue(p.pos); err != nil {
					return node{}, err
				}
				continue
			}
			if c == ',' {
				if err := p.startValue(p.pos + 1); err != nil {
					return node{}, err
				}
				continue
			}
			if c == ']' {
				p.pos++
				p.closeFrame()
				continue
			}
			return node{}, p.syntaxErr("expected ',' or ']' in array", p.pos)
		}

		if p.hasPending {
			f.entries = append(f.entries, member{name: f.key, value: p.pending})
			p.hasPending = false
			p.pending = node{}
			f.state = frameValue
			continue
		}
		p.pos = skipWs(src, p.pos)
		c := p.byteAt(p.pos)
		if f.state == frameStart {
			if c == '}' {
				p.pos++
				p.closeFrame()
				continue
			}
			if err := p.readMember(f); err != nil {
				return node{}, err
			}
			continue
		}
		if f.state == frameValue {
			if c == ',' {
				f.state = frameComma
				p.pos++
				continue
			}
			if c == '}' {
				p.pos++
				p.closeFrame()
				continue
			}
			return node{}, p.syntaxErr("expected ',' or '}' in object", p.pos)
		}
		// frameComma: expect the next member key.
		if err := p.readMember(f); err != nil {
			return node{}, err
		}
	}
}
