import GithubSlugger from "github-slugger";
import { childPointer, isEmptyContainer, rendersInline, type DocNode } from "./document.js";
import { JsonToMarkdownError } from "./errors.js";
import { annotationSuffix, annotationType, escapeInline, keyLabel, scalarText, type AnnotationType } from "./text.js";

const MAX_HEADING_LEVEL = 6;

export interface ConvertOptions {
  /**
   * Document Heading text. A string replaces the default `"Results"` (rendered
   * as plain text, never raw Markdown); `null` omits the H1 entirely without
   * shifting body heading levels. An empty string is INVALID_OPTION.
   */
  readonly heading?: string | null;
  /** Emit Type Annotations (` *(integer)*` …) after annotatable values. Default false. */
  readonly showTypes?: boolean;
}

interface ResolvedOptions {
  readonly heading: string | null;
  readonly showTypes: boolean;
}

function resolveOptions(options: ConvertOptions): ResolvedOptions {
  const heading = options.heading === undefined ? "Results" : options.heading;
  if (heading !== null && typeof heading !== "string") {
    throw new JsonToMarkdownError("INVALID_OPTION", "heading must be a string or null");
  }
  if (heading === "") {
    throw new JsonToMarkdownError("INVALID_OPTION", "heading must not be empty; pass null to omit it");
  }
  const showTypes = options.showTypes === undefined ? false : options.showTypes;
  if (typeof showTypes !== "boolean") {
    throw new JsonToMarkdownError("INVALID_OPTION", "showTypes must be a boolean");
  }
  return { heading, showTypes };
}

/**
 * The inline text of a value plus its Type Annotation. The `*(type)*` token is
 * unforgeable: a literal `*` in user data is always escaped, so italics here can
 * only come from the renderer.
 */
function annotatedText(node: DocNode, showTypes: boolean): string {
  const text = scalarText(node);
  if (!showTypes) return text;
  const type = annotationType(node);
  return type === null ? text : text + annotationSuffix(type);
}

/** Push tasks so they run in given order under a LIFO stack. */
function pushReversed(stack: Task[], tasks: readonly Task[]): void {
  for (let i = tasks.length - 1; i >= 0; i--) stack.push(tasks[i]!);
}

type ScalarCell = { readonly t: "scalar"; readonly text: string };
type LinkCell = { readonly t: "link"; readonly pointer: string; readonly label: string };
type Cell = ScalarCell | LinkCell;

type TableData = { readonly headers: readonly string[]; readonly rows: readonly (readonly Cell[])[] };

// A list block is a run of lines that may embed indented tables (a Tabular Array
// nested inside a list still renders as a table, per ADR-0003).
type ListPart =
  | { readonly kind: "line"; readonly text: string }
  | { readonly kind: "table"; readonly indent: number; readonly table: TableData };

type Block =
  | { kind: "heading"; level: number; text: string; detailPointer?: string; fragment?: string }
  | { kind: "text"; text: string }
  | { kind: "hr" }
  | { kind: "table"; table: TableData }
  | { kind: "list"; parts: readonly ListPart[] };

type Task =
  | { t: "value"; node: DocNode; pointer: string; level: number }
  | { t: "emit"; block: Block };

function isObjectNode(node: DocNode): node is Extract<DocNode, { kind: "object" }> {
  return node.kind === "object";
}

/** Detect a Tabular Array: non-empty, every item an object, union of keys is non-empty. */
function tableColumns(items: readonly DocNode[]): string[] | null {
  if (items.length === 0) return null;
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!isObjectNode(item)) return null;
    for (const [key] of item.entries) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return columns.length > 0 ? columns : null;
}

/** Build a table's rows plus the Detail-cell tasks it spawns, in row-major order. */
function buildTableData(
  items: readonly DocNode[],
  columns: readonly string[],
  pointer: string,
  detailLevel: number,
  detailSubLevel: number,
  showTypes: boolean,
): { table: TableData; details: Task[] } {
  const rows: Cell[][] = [];
  const details: Task[] = [];
  // Per column: undefined = no present cell seen yet, "bare" = not a Uniform
  // Column (mixed types, or a link / Self-Describing cell), else its one type.
  const colTypes: (AnnotationType | "bare" | undefined)[] = columns.map(() => undefined);

  for (let r = 0; r < items.length; r++) {
    const item = items[r]! as Extract<DocNode, { kind: "object" }>;
    const rowPointer = childPointer(pointer, String(r));
    const byKey = new Map<string, DocNode>(item.entries);
    const row: Cell[] = [];
    for (let c = 0; c < columns.length; c++) {
      const col = columns[c]!;
      const value = byKey.get(col);
      if (value === undefined) {
        row.push({ t: "scalar", text: "" }); // Missing Property: empty cell.
        continue;
      }
      const type = annotationType(value);
      if (colTypes[c] !== "bare") {
        if (type === null) colTypes[c] = "bare";
        else if (colTypes[c] === undefined) colTypes[c] = type;
        else if (colTypes[c] !== type) colTypes[c] = "bare";
      }
      if (value.kind === "object" || value.kind === "array") {
        if (isEmptyContainer(value)) {
          row.push({ t: "scalar", text: scalarText(value) });
        } else {
          const cellPointer = childPointer(rowPointer, col);
          // The link label and the Detail Heading text must stay byte-identical.
          const label = escapeInline(cellPointer);
          row.push({ t: "link", pointer: cellPointer, label });
          // A thematic break precedes every Detail Heading (and appears nowhere else).
          details.push({ t: "emit", block: { kind: "hr" } });
          details.push({
            t: "emit",
            block: {
              kind: "heading",
              level: detailLevel,
              text: label,
              detailPointer: cellPointer,
            },
          });
          details.push({ t: "value", node: value, pointer: cellPointer, level: detailSubLevel });
        }
      } else {
        row.push({ t: "scalar", text: scalarText(value) });
      }
    }
    rows.push(row);
  }

  const headers = columns.map((col, c) => {
    const type = colTypes[c];
    const label = keyLabel(col);
    return showTypes && type !== undefined && type !== "bare" ? label + annotationSuffix(type) : label;
  });

  return { table: { headers, rows }, details };
}

/**
 * Build the list block for a non-empty container in list position. A child that is
 * a Tabular Array is rendered as an indented table (ADR-0003) and its Detail Sections
 * are returned to be emitted at block level after the list. Iterative: an explicit
 * heap stack keeps arbitrarily deep nesting off the call stack.
 */
function buildListBlock(
  root: DocNode,
  rootPointer: string,
  blockLevel: number,
  showTypes: boolean,
): { parts: ListPart[]; details: Task[] } {
  const detailLevel = Math.min(blockLevel, MAX_HEADING_LEVEL);
  const detailSubLevel = Math.min(detailLevel + 1, MAX_HEADING_LEVEL);
  const parts: ListPart[] = [];
  const details: Task[] = [];

  interface ListFrame {
    node: DocNode;
    pointer: string;
    indent: number;
    index: number;
  }
  const stack: ListFrame[] = [{ node: root, pointer: rootPointer, indent: 0, index: 0 }];

  // Emit a non-inline container child: an indented table if Tabular, else a nested list.
  const handleContainer = (child: DocNode, childPtr: string, indent: number, lead: string): void => {
    if (child.kind === "array") {
      const columns = tableColumns(child.items);
      if (columns !== null) {
        parts.push({ kind: "line", text: lead });
        const built = buildTableData(child.items, columns, childPtr, detailLevel, detailSubLevel, showTypes);
        parts.push({ kind: "table", indent, table: built.table });
        for (const task of built.details) details.push(task);
        return;
      }
    }
    parts.push({ kind: "line", text: lead });
    stack.push({ node: child, pointer: childPtr, indent, index: 0 });
  };

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    const node = frame.node;
    const pad = "  ".repeat(frame.indent);

    if (node.kind === "object") {
      if (frame.index >= node.entries.length) {
        stack.pop();
        continue;
      }
      const [key, child] = node.entries[frame.index++]!;
      const label = keyLabel(key);
      const childPtr = childPointer(frame.pointer, key);
      if (rendersInline(child)) {
        parts.push({ kind: "line", text: `${pad}- **${label}:** ${annotatedText(child, showTypes)}` });
      } else {
        handleContainer(child, childPtr, frame.indent + 1, `${pad}- **${label}**`);
      }
    } else if (node.kind === "array") {
      if (frame.index >= node.items.length) {
        stack.pop();
        continue;
      }
      const i = frame.index++;
      const child = node.items[i]!;
      const childPtr = childPointer(frame.pointer, String(i));
      if (rendersInline(child)) {
        parts.push({ kind: "line", text: `${pad}- ${annotatedText(child, showTypes)}` });
      } else {
        handleContainer(child, childPtr, frame.indent + 1, `${pad}-`);
      }
    } else {
      // A scalar can only appear as the root of a list when misused; guard anyway.
      parts.push({ kind: "line", text: `${pad}- ${annotatedText(node, showTypes)}` });
      stack.pop();
    }
  }

  return { parts, details };
}

/** Walk the document (iteratively) into an ordered list of blocks. */
function layout(root: DocNode, opts: ResolvedOptions): Block[] {
  const blocks: Block[] = [];
  if (opts.heading !== null) {
    blocks.push({ kind: "heading", level: 1, text: escapeInline(opts.heading) });
  }
  const stack: Task[] = [{ t: "value", node: root, pointer: "", level: 2 }];

  while (stack.length > 0) {
    const task = stack.pop()!;

    if (task.t === "emit") {
      blocks.push(task.block);
      continue;
    }

    const { node, pointer, level } = task;

    if (rendersInline(node)) {
      blocks.push({ kind: "text", text: annotatedText(node, opts.showTypes) });
      continue;
    }

    if (node.kind === "object") {
      if (level > MAX_HEADING_LEVEL) {
        const { parts, details } = buildListBlock(node, pointer, level, opts.showTypes);
        blocks.push({ kind: "list", parts });
        pushReversed(stack, details);
        continue;
      }
      // Expand members: heading then value, in order.
      const expansion: Task[] = [];
      for (const [key, child] of node.entries) {
        expansion.push({ t: "emit", block: { kind: "heading", level, text: keyLabel(key) } });
        expansion.push({ t: "value", node: child, pointer: childPointer(pointer, key), level: level + 1 });
      }
      pushReversed(stack, expansion);
      continue;
    }

    // Array (rendersInline already excluded scalars and empty containers).
    if (node.kind !== "array") continue;
    const columns = tableColumns(node.items);
    if (columns === null) {
      const { parts, details } = buildListBlock(node, pointer, level, opts.showTypes);
      blocks.push({ kind: "list", parts });
      pushReversed(stack, details);
      continue;
    }
    const detailLevel = Math.min(level, MAX_HEADING_LEVEL);
    const detailSubLevel = Math.min(detailLevel + 1, MAX_HEADING_LEVEL);
    const { table, details } = buildTableData(node.items, columns, pointer, detailLevel, detailSubLevel, opts.showTypes);
    pushReversed(stack, [{ t: "emit", block: { kind: "table", table } }, ...details]);
  }

  return blocks;
}

/** Render a table cell. Scalar text is already table-safe (`scalarText` escapes pipes). */
function tableCell(cell: Cell, fragments: Map<string, string>): string {
  if (cell.t === "scalar") return cell.text;
  const fragment = fragments.get(cell.pointer) ?? "";
  return `[${cell.label}](#${fragment})`;
}

function serializeTable(table: TableData, indent: number, fragments: Map<string, string>): string {
  const pad = "  ".repeat(indent);
  const header = `${pad}| ${table.headers.join(" | ")} |`;
  const delimiter = `${pad}| ${table.headers.map(() => "---").join(" | ")} |`;
  const rows = table.rows.map((row) => `${pad}| ${row.map((c) => tableCell(c, fragments)).join(" | ")} |`);
  return [header, delimiter, ...rows].join("\n");
}

function serializeList(parts: readonly ListPart[], fragments: Map<string, string>): string {
  return parts.map((p) => (p.kind === "line" ? p.text : serializeTable(p.table, p.indent, fragments))).join("\n");
}

export function renderDocument(root: DocNode, options: ConvertOptions = {}): string {
  const blocks = layout(root, resolveOptions(options));

  // Allocate heading fragments in final document order; map detail pointers to them.
  const slugger = new GithubSlugger();
  const fragments = new Map<string, string>();
  for (const block of blocks) {
    if (block.kind === "heading") {
      block.fragment = slugger.slug(block.text);
      if (block.detailPointer !== undefined) fragments.set(block.detailPointer, block.fragment);
    }
  }

  const rendered: string[] = [];
  for (const block of blocks) {
    if (block.kind === "heading") {
      rendered.push(`${"#".repeat(block.level)} ${block.text}`);
    } else if (block.kind === "text") {
      rendered.push(block.text);
    } else if (block.kind === "hr") {
      rendered.push("---");
    } else if (block.kind === "table") {
      rendered.push(serializeTable(block.table, 0, fragments));
    } else {
      rendered.push(serializeList(block.parts, fragments));
    }
  }

  return rendered.join("\n\n") + "\n";
}
