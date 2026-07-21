package jsontomd

import (
	"strconv"
	"strings"
)

// Port of the TS renderer (src/render.ts): lays the document out as ordered
// blocks with an explicit task stack (no recursion, per the no-nesting-limit
// ADR), allocates Heading Fragments in final output order, then serializes
// with canonical spacing.

const maxHeadingLevel = 6

type cell struct {
	link    bool
	text    string // scalar cells
	pointer string // link cells
	label   string
}

type tableData struct {
	headers []string
	rows    [][]cell
}

// A list block is a run of lines that may embed indented tables (a Tabular
// Array nested inside a list still renders as a table, per ADR-0003).
type listPart struct {
	isTable bool
	text    string
	indent  int
	table   tableData
}

type blockKind uint8

const (
	blockHeading blockKind = iota
	blockText
	blockHR
	blockTable
	blockList
)

type block struct {
	kind          blockKind
	level         int
	text          string
	detailPointer string // non-"" marks a Detail Heading
	fragment      string
	table         tableData
	parts         []listPart
}

type task struct {
	emit    bool
	block   block
	node    node
	pointer string
	level   int
}

// pushReversed pushes tasks so they run in the given order under a LIFO stack.
func pushReversed(stack *[]task, tasks []task) {
	for i := len(tasks) - 1; i >= 0; i-- {
		*stack = append(*stack, tasks[i])
	}
}

// tableColumns detects a Tabular Array: non-empty, every item an object,
// union of keys non-empty. Returns nil when the array is not tabular.
func tableColumns(items []node) []string {
	if len(items) == 0 {
		return nil
	}
	var columns []string
	seen := make(map[string]struct{})
	for _, item := range items {
		if item.kind != kindObject {
			return nil
		}
		for _, m := range item.entries {
			if _, ok := seen[m.name]; !ok {
				seen[m.name] = struct{}{}
				columns = append(columns, m.name)
			}
		}
	}
	if len(columns) == 0 {
		return nil
	}
	return columns
}

// buildTableData builds a table's rows plus the Detail-cell tasks it spawns,
// in row-major order.
func buildTableData(items []node, columns []string, pointer string, detailLevel, detailSubLevel int) (tableData, []task) {
	headers := make([]string, len(columns))
	for i, c := range columns {
		headers[i] = keyLabel(c)
	}
	rows := make([][]cell, 0, len(items))
	var details []task

	for r, item := range items {
		rowPointer := childPointer(pointer, strconv.Itoa(r))
		byKey := make(map[string]node, len(item.entries))
		for _, m := range item.entries {
			byKey[m.name] = m.value
		}
		row := make([]cell, 0, len(columns))
		for _, col := range columns {
			value, present := byKey[col]
			if !present {
				row = append(row, cell{text: ""}) // Missing Property: empty cell.
				continue
			}
			if isContainer(value) && !isEmptyContainer(value) {
				cellPointer := childPointer(rowPointer, col)
				// The link label and the Detail Heading text must stay byte-identical.
				label := escapeInline(cellPointer)
				row = append(row, cell{link: true, pointer: cellPointer, label: label})
				// A thematic break precedes every Detail Heading (and appears nowhere else).
				details = append(details, task{emit: true, block: block{kind: blockHR}})
				details = append(details, task{emit: true, block: block{
					kind:          blockHeading,
					level:         detailLevel,
					text:          label,
					detailPointer: cellPointer,
				}})
				details = append(details, task{node: value, pointer: cellPointer, level: detailSubLevel})
			} else {
				row = append(row, cell{text: scalarText(value)})
			}
		}
		rows = append(rows, row)
	}

	return tableData{headers: headers, rows: rows}, details
}

// buildListBlock builds the list block for a non-empty container in list
// position. Iterative: an explicit heap stack keeps arbitrarily deep nesting
// off the call stack.
func buildListBlock(root node, rootPointer string, blockLevel int) ([]listPart, []task) {
	detailLevel := min(blockLevel, maxHeadingLevel)
	detailSubLevel := min(detailLevel+1, maxHeadingLevel)
	var parts []listPart
	var details []task

	type listFrame struct {
		node    node
		pointer string
		indent  int
		index   int
	}
	stack := []listFrame{{node: root, pointer: rootPointer}}

	// Emit a non-inline container child: an indented table if Tabular, else a
	// nested list.
	handleContainer := func(child node, childPtr string, indent int, lead string) {
		if child.kind == kindArray {
			if columns := tableColumns(child.items); columns != nil {
				parts = append(parts, listPart{text: lead})
				table, det := buildTableData(child.items, columns, childPtr, detailLevel, detailSubLevel)
				parts = append(parts, listPart{isTable: true, indent: indent, table: table})
				details = append(details, det...)
				return
			}
		}
		parts = append(parts, listPart{text: lead})
		stack = append(stack, listFrame{node: child, pointer: childPtr, indent: indent})
	}

	for len(stack) > 0 {
		frame := &stack[len(stack)-1]
		n := frame.node
		pad := strings.Repeat("  ", frame.indent)

		switch n.kind {
		case kindObject:
			if frame.index >= len(n.entries) {
				stack = stack[:len(stack)-1]
				continue
			}
			m := n.entries[frame.index]
			frame.index++
			label := keyLabel(m.name)
			childPtr := childPointer(frame.pointer, m.name)
			if rendersInline(m.value) {
				parts = append(parts, listPart{text: pad + "- **" + label + ":** " + scalarText(m.value)})
			} else {
				handleContainer(m.value, childPtr, frame.indent+1, pad+"- **"+label+"**")
			}
		case kindArray:
			if frame.index >= len(n.items) {
				stack = stack[:len(stack)-1]
				continue
			}
			i := frame.index
			frame.index++
			child := n.items[i]
			childPtr := childPointer(frame.pointer, strconv.Itoa(i))
			if rendersInline(child) {
				parts = append(parts, listPart{text: pad + "- " + scalarText(child)})
			} else {
				handleContainer(child, childPtr, frame.indent+1, pad+"-")
			}
		default:
			// A scalar can only appear as the root of a list when misused; guard anyway.
			parts = append(parts, listPart{text: pad + "- " + scalarText(n)})
			stack = stack[:len(stack)-1]
		}
	}

	return parts, details
}

// layout walks the document (iteratively) into an ordered list of blocks.
func layout(root node) []block {
	blocks := []block{{kind: blockHeading, level: 1, text: "Results"}}
	stack := []task{{node: root, pointer: "", level: 2}}

	for len(stack) > 0 {
		t := stack[len(stack)-1]
		stack = stack[:len(stack)-1]

		if t.emit {
			blocks = append(blocks, t.block)
			continue
		}

		n, pointer, level := t.node, t.pointer, t.level

		if rendersInline(n) {
			blocks = append(blocks, block{kind: blockText, text: scalarText(n)})
			continue
		}

		if n.kind == kindObject {
			if level > maxHeadingLevel {
				parts, details := buildListBlock(n, pointer, level)
				blocks = append(blocks, block{kind: blockList, parts: parts})
				pushReversed(&stack, details)
				continue
			}
			// Expand members: heading then value, in order.
			var expansion []task
			for _, m := range n.entries {
				expansion = append(expansion, task{emit: true, block: block{kind: blockHeading, level: level, text: keyLabel(m.name)}})
				expansion = append(expansion, task{node: m.value, pointer: childPointer(pointer, m.name), level: level + 1})
			}
			pushReversed(&stack, expansion)
			continue
		}

		// Array (rendersInline already excluded scalars and empty containers).
		columns := tableColumns(n.items)
		if columns == nil {
			parts, details := buildListBlock(n, pointer, level)
			blocks = append(blocks, block{kind: blockList, parts: parts})
			pushReversed(&stack, details)
			continue
		}
		detailLevel := min(level, maxHeadingLevel)
		detailSubLevel := min(detailLevel+1, maxHeadingLevel)
		table, details := buildTableData(n.items, columns, pointer, detailLevel, detailSubLevel)
		tasks := make([]task, 0, len(details)+1)
		tasks = append(tasks, task{emit: true, block: block{kind: blockTable, table: table}})
		tasks = append(tasks, details...)
		pushReversed(&stack, tasks)
	}

	return blocks
}

// tableCell renders one cell. Scalar text is already table-safe (scalarText
// escapes pipes).
func tableCell(c cell, fragments map[string]string) string {
	if !c.link {
		return c.text
	}
	return "[" + c.label + "](#" + fragments[c.pointer] + ")"
}

func serializeTable(t tableData, indent int, fragments map[string]string) string {
	pad := strings.Repeat("  ", indent)
	var b strings.Builder
	b.WriteString(pad + "| " + strings.Join(t.headers, " | ") + " |\n")
	b.WriteString(pad + "|")
	for range t.headers {
		b.WriteString(" --- |")
	}
	for _, row := range t.rows {
		b.WriteString("\n" + pad + "|")
		for _, c := range row {
			b.WriteString(" " + tableCell(c, fragments) + " |")
		}
	}
	return b.String()
}

func serializeList(parts []listPart, fragments map[string]string) string {
	lines := make([]string, len(parts))
	for i, p := range parts {
		if p.isTable {
			lines[i] = serializeTable(p.table, p.indent, fragments)
		} else {
			lines[i] = p.text
		}
	}
	return strings.Join(lines, "\n")
}

func renderDocument(root node) string {
	blocks := layout(root)

	// Allocate heading fragments in final document order; map detail pointers
	// to them.
	sl := newSlugger()
	fragments := make(map[string]string)
	for i := range blocks {
		if blocks[i].kind == blockHeading {
			blocks[i].fragment = sl.slug(blocks[i].text)
			if blocks[i].detailPointer != "" {
				fragments[blocks[i].detailPointer] = blocks[i].fragment
			}
		}
	}

	rendered := make([]string, 0, len(blocks))
	for _, blk := range blocks {
		switch blk.kind {
		case blockHeading:
			rendered = append(rendered, strings.Repeat("#", blk.level)+" "+blk.text)
		case blockText:
			rendered = append(rendered, blk.text)
		case blockHR:
			rendered = append(rendered, "---")
		case blockTable:
			rendered = append(rendered, serializeTable(blk.table, 0, fragments))
		default:
			rendered = append(rendered, serializeList(blk.parts, fragments))
		}
	}

	return strings.Join(rendered, "\n\n") + "\n"
}
