package jsontomd

import (
	"fmt"
	"strings"
)

// Internal representation shared by both entry points, mirroring the
// TypeScript DocNode. A number keeps its Numeric Lexeme as text; an object
// keeps its members as an ordered slice — a Go map would lose Encounter
// Order. String values and member names are carried as WTF-8 so that lone
// UTF-16 surrogates parsed from \uXXXX escapes survive to render as visible
// escapes.
type nodeKind uint8

const (
	kindNull nodeKind = iota
	kindBool
	kindNumber
	kindString
	kindArray
	kindObject
)

type member struct {
	name  string
	value node
}

type node struct {
	kind    nodeKind
	boolVal bool
	lexeme  string // kindNumber: exact source spelling
	str     string // kindString: WTF-8 value
	items   []node
	entries []member
}

var (
	nullNode  = node{kind: kindNull}
	trueNode  = node{kind: kindBool, boolVal: true}
	falseNode = node{kind: kindBool}
)

func isContainer(n node) bool {
	return n.kind == kindArray || n.kind == kindObject
}

func isEmptyContainer(n node) bool {
	return (n.kind == kindArray && len(n.items) == 0) ||
		(n.kind == kindObject && len(n.entries) == 0)
}

// rendersInline reports a value shown inline (as a paragraph or list-item
// scalar) rather than as its own structure.
func rendersInline(n node) bool {
	return !isContainer(n) || isEmptyContainer(n)
}

// hex4 is the zero-padded four-digit hex used by \uXXXX escapes.
func hex4(code rune) string {
	return fmt.Sprintf("%04x", code)
}

// pointerSegment applies RFC 6901 escaping to one path segment.
func pointerSegment(name string) string {
	name = strings.ReplaceAll(name, "~", "~0")
	return strings.ReplaceAll(name, "/", "~1")
}

func childPointer(pointer, name string) string {
	return pointer + "/" + pointerSegment(name)
}
