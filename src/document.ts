/**
 * Internal representation shared by both entry points.
 *
 * Both `convertJsonValue` and `convertJsonText` normalise their input into this
 * form so that a single renderer produces the Output Document. A number keeps
 * its Numeric Lexeme as text: the serialized path stores the original token, the
 * parsed path stores the caller's value formatted by the host.
 */
export type DocNode =
  | { readonly kind: "null" }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "number"; readonly lexeme: string }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "array"; readonly items: readonly DocNode[] }
  | { readonly kind: "object"; readonly entries: readonly (readonly [string, DocNode])[] };

export const NULL_NODE: DocNode = { kind: "null" };
export const TRUE_NODE: DocNode = { kind: "boolean", value: true };
export const FALSE_NODE: DocNode = { kind: "boolean", value: false };

export function isContainer(node: DocNode): boolean {
  return node.kind === "array" || node.kind === "object";
}

export function isEmptyContainer(node: DocNode): boolean {
  return (
    (node.kind === "array" && node.items.length === 0) ||
    (node.kind === "object" && node.entries.length === 0)
  );
}

/** A value shown inline (as a paragraph or list-item scalar) rather than as its own structure. */
export function rendersInline(node: DocNode): boolean {
  return !isContainer(node) || isEmptyContainer(node);
}

/** Zero-padded four-digit hex for a `\uXXXX` escape. */
export function hex4(code: number): string {
  return code.toString(16).padStart(4, "0");
}

/** RFC 6901 pointer segment escaping. */
export function pointerSegment(name: string): string {
  return name.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function childPointer(pointer: string, name: string): string {
  return `${pointer}/${pointerSegment(name)}`;
}
