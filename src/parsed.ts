import { childPointer, FALSE_NODE, NULL_NODE, TRUE_NODE, type DocNode } from "./document.js";
import { JsonToMarkdownError } from "./errors.js";

const hasOwn = Object.prototype.hasOwnProperty;

function invalid(pointer: string, what: string): never {
  throw new JsonToMarkdownError(
    "INVALID_PARSED_VALUE",
    `Value at ${pointer || "the root"} is not JSON-compatible: ${what}.`,
    { pointer },
  );
}

/** Classify a value. Returns a DocNode for scalars, or null when it is a container to descend. */
function tryScalar(value: unknown, pointer: string): DocNode | null {
  if (value === null) return NULL_NODE;
  switch (typeof value) {
    case "boolean":
      return value ? TRUE_NODE : FALSE_NODE;
    case "string":
      return { kind: "string", value };
    case "number":
      if (!Number.isFinite(value)) invalid(pointer, `the number ${String(value)}`);
      return { kind: "number", lexeme: String(value) };
    case "object":
      return null;
    case "undefined":
      invalid(pointer, "undefined");
    // eslint-disable-next-line no-fallthrough
    case "bigint":
      invalid(pointer, "a BigInt");
    // eslint-disable-next-line no-fallthrough
    case "function":
      invalid(pointer, "a function");
    // eslint-disable-next-line no-fallthrough
    case "symbol":
      invalid(pointer, "a symbol");
    // eslint-disable-next-line no-fallthrough
    default:
      invalid(pointer, `a ${typeof value}`);
  }
}

/** Read an own property through its descriptor so getters are never invoked. */
function readOwn(source: object, key: PropertyKey, pointer: string): unknown {
  const d = Object.getOwnPropertyDescriptor(source, key);
  if (d === undefined || !("value" in d)) {
    invalid(pointer, "an accessor property");
  }
  return d.value;
}

function validateArrayShape(source: readonly unknown[], pointer: string): number {
  const length = source.length;
  for (let i = 0; i < length; i++) {
    if (!hasOwn.call(source, i)) {
      const at = childPointer(pointer, String(i));
      throw new JsonToMarkdownError("SPARSE_ARRAY", `Array at ${pointer || "the root"} has a hole at index ${i}.`, {
        pointer: at,
      });
    }
  }
  for (const key of Object.keys(source)) {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx >= length || String(idx) !== key) {
      invalid(pointer, `an array with an extra enumerable property "${key}"`);
    }
  }
  return length;
}

function validateObjectShape(source: object, pointer: string): string[] {
  const proto = Object.getPrototypeOf(source);
  if (proto !== Object.prototype && proto !== null) {
    invalid(pointer, "an object with a non-plain prototype");
  }
  return Object.keys(source);
}

interface Frame {
  source: object;
  pointer: string;
  isArray: boolean;
  keyForParent: string | null;
  index: number;
  length: number;
  keys: readonly string[] | null;
  results: DocNode[];
  entries: [string, DocNode][];
}

function makeFrame(value: object, pointer: string, keyForParent: string | null): Frame {
  if (Array.isArray(value)) {
    const length = validateArrayShape(value, pointer);
    return { source: value, pointer, isArray: true, keyForParent, index: 0, length, keys: null, results: [], entries: [] };
  }
  const keys = validateObjectShape(value, pointer);
  return { source: value, pointer, isArray: false, keyForParent, index: 0, length: keys.length, keys, results: [], entries: [] };
}

/**
 * Validate caller-trusted parsed data and normalise it into a DocNode.
 * Iterative to satisfy the no-nesting-limit ADR: never relies on the call stack.
 */
export function normalizeParsed(root: unknown): DocNode {
  const rootScalar = tryScalar(root, "");
  if (rootScalar !== null) return rootScalar;

  const onPath = new Set<object>();
  onPath.add(root as object);
  const stack: Frame[] = [makeFrame(root as object, "", null)];
  let finished: DocNode | null = null;

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;

    if (frame.index >= frame.length) {
      const node: DocNode = frame.isArray
        ? { kind: "array", items: frame.results }
        : { kind: "object", entries: frame.entries };
      onPath.delete(frame.source);
      stack.pop();
      const parent = stack[stack.length - 1];
      if (parent === undefined) {
        finished = node;
      } else if (parent.isArray) {
        parent.results.push(node);
      } else {
        parent.entries.push([frame.keyForParent!, node]);
      }
      continue;
    }

    const i = frame.index++;
    const key = frame.isArray ? String(i) : frame.keys![i]!;
    const childPtr = childPointer(frame.pointer, key);
    const childValue = readOwn(frame.source, frame.isArray ? i : key, childPtr);

    const scalar = tryScalar(childValue, childPtr);
    if (scalar !== null) {
      if (frame.isArray) frame.results.push(scalar);
      else frame.entries.push([key, scalar]);
      continue;
    }

    const childObj = childValue as object;
    if (onPath.has(childObj)) {
      throw new JsonToMarkdownError("CYCLIC_REFERENCE", `Cyclic reference at ${childPtr}.`, { pointer: childPtr });
    }
    onPath.add(childObj);
    stack.push(makeFrame(childObj, childPtr, frame.isArray ? null : key));
  }

  return finished!;
}
