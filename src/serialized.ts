import { FALSE_NODE, NULL_NODE, TRUE_NODE, type DocNode } from "./document.js";
import { JsonToMarkdownError, type SourceLocation } from "./errors.js";

function locationAt(src: string, offset: number): SourceLocation {
  let line = 1;
  let column = 1;
  const end = Math.min(offset, src.length);
  for (let i = 0; i < end; i++) {
    if (src.charCodeAt(i) === 0x0a) {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { offset, line, column };
}

function syntaxError(src: string, message: string, offset: number): never {
  throw new JsonToMarkdownError("INVALID_JSON_SYNTAX", message, { location: locationAt(src, offset) });
}

function isWs(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function skipWs(src: string, pos: number): number {
  const n = src.length;
  while (pos < n && isWs(src.charCodeAt(pos))) pos++;
  return pos;
}

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

interface Scanned {
  readonly node: DocNode;
  readonly end: number;
}

function parseString(src: string, pos: number): { value: string; end: number } {
  const n = src.length;
  let i = pos + 1;
  let start = i;
  let out = "";

  while (i < n) {
    const c = src.charCodeAt(i);
    if (c === 0x22 /* " */) {
      return { value: out + src.slice(start, i), end: i + 1 };
    }
    if (c === 0x5c /* \ */) {
      out += src.slice(start, i);
      i++;
      const e = src[i];
      switch (e) {
        case '"':
          out += '"';
          break;
        case "\\":
          out += "\\";
          break;
        case "/":
          out += "/";
          break;
        case "b":
          out += "\b";
          break;
        case "f":
          out += "\f";
          break;
        case "n":
          out += "\n";
          break;
        case "r":
          out += "\r";
          break;
        case "t":
          out += "\t";
          break;
        case "u": {
          const hex = src.slice(i + 1, i + 5);
          if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
            syntaxError(src, "Invalid \\u escape in string", i - 1);
          }
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
          break;
        }
        default:
          syntaxError(src, "Invalid escape sequence in string", i - 1);
      }
      i++;
      start = i;
      continue;
    }
    if (c < 0x20) {
      syntaxError(src, "Unescaped control character in string", i);
    }
    i++;
  }
  return syntaxError(src, "Unterminated string", pos);
}

function parseNumber(src: string, pos: number): Scanned {
  const n = src.length;
  let i = pos;
  if (src.charCodeAt(i) === 0x2d /* - */) i++;

  const first = src.charCodeAt(i);
  if (first === 0x30 /* 0 */) {
    i++;
  } else if (first >= 0x31 && first <= 0x39) {
    i++;
    while (i < n && isDigit(src.charCodeAt(i))) i++;
  } else {
    syntaxError(src, "Invalid number", pos);
  }

  if (i < n && src.charCodeAt(i) === 0x2e /* . */) {
    i++;
    if (!(i < n && isDigit(src.charCodeAt(i)))) syntaxError(src, "Invalid number: missing fraction digits", i);
    while (i < n && isDigit(src.charCodeAt(i))) i++;
  }

  const exp = i < n ? src.charCodeAt(i) : 0;
  if (exp === 0x65 || exp === 0x45 /* e E */) {
    i++;
    const sign = i < n ? src.charCodeAt(i) : 0;
    if (sign === 0x2b || sign === 0x2d) i++;
    if (!(i < n && isDigit(src.charCodeAt(i)))) syntaxError(src, "Invalid number: missing exponent digits", i);
    while (i < n && isDigit(src.charCodeAt(i))) i++;
  }

  return { node: { kind: "number", lexeme: src.slice(pos, i) }, end: i };
}

function parseScalar(src: string, pos: number): Scanned {
  const c = src.charCodeAt(pos);
  if (c === 0x22) {
    const s = parseString(src, pos);
    return { node: { kind: "string", value: s.value }, end: s.end };
  }
  if (c === 0x2d || isDigit(c)) return parseNumber(src, pos);
  if (src.startsWith("true", pos)) return { node: TRUE_NODE, end: pos + 4 };
  if (src.startsWith("false", pos)) return { node: FALSE_NODE, end: pos + 5 };
  if (src.startsWith("null", pos)) return { node: NULL_NODE, end: pos + 4 };
  return syntaxError(src, "Unexpected token; expected a JSON value", pos);
}

type ObjFrame = {
  readonly type: "obj";
  readonly entries: [string, DocNode][];
  readonly seen: Map<string, number>;
  state: "start" | "value" | "comma";
  key: string;
};
type ArrFrame = {
  readonly type: "arr";
  readonly items: DocNode[];
  state: "start" | "value";
};
type Frame = ObjFrame | ArrFrame;

/**
 * Parse exactly one JSON document into a DocNode without executing caller code.
 * Iterative to satisfy the no-nesting-limit ADR; preserves numeric lexemes,
 * member encounter order, and rejects duplicate member names.
 */
export function parseSerialized(source: string): DocNode {
  const n = source.length;
  const stack: Frame[] = [];
  let pending: DocNode | null = null;
  let hasPending = false;
  let pos = skipWs(source, 0);

  if (pos >= n) syntaxError(source, "Unexpected end of input; expected a JSON value", pos);

  // Read the leading value (opens a frame or produces a pending scalar).
  pos = startValue();

  for (;;) {
    const frame = stack[stack.length - 1];

    if (frame === undefined) {
      // Root value complete.
      pos = skipWs(source, pos);
      if (pos !== n) syntaxError(source, "Unexpected trailing content after JSON value", pos);
      return pending!;
    }

    if (frame.type === "arr") {
      if (hasPending) {
        frame.items.push(pending!);
        hasPending = false;
        pending = null;
        frame.state = "value";
        continue;
      }
      pos = skipWs(source, pos);
      const c = source.charCodeAt(pos);
      if (frame.state === "start") {
        if (c === 0x5d /* ] */) {
          pos++;
          closeFrame();
          continue;
        }
        pos = startValue();
        continue;
      }
      // state === "value"
      if (c === 0x2c /* , */) {
        pos = startValue(pos + 1);
        continue;
      }
      if (c === 0x5d) {
        pos++;
        closeFrame();
        continue;
      }
      syntaxError(source, "Expected ',' or ']' in array", pos);
    } else {
      if (hasPending) {
        frame.entries.push([frame.key, pending!]);
        hasPending = false;
        pending = null;
        frame.state = "value";
        continue;
      }
      pos = skipWs(source, pos);
      const c = source.charCodeAt(pos);
      if (frame.state === "start") {
        if (c === 0x7d /* } */) {
          pos++;
          closeFrame();
          continue;
        }
        pos = readMember(frame);
        continue;
      }
      if (frame.state === "value") {
        if (c === 0x2c /* , */) {
          frame.state = "comma";
          pos++;
          continue;
        }
        if (c === 0x7d) {
          pos++;
          closeFrame();
          continue;
        }
        syntaxError(source, "Expected ',' or '}' in object", pos);
      }
      // state === "comma": expect the next member key.
      pos = readMember(frame);
    }
  }

  function startValue(from = pos): number {
    let p = skipWs(source, from);
    if (p >= n) syntaxError(source, "Unexpected end of input; expected a JSON value", p);
    const c = source.charCodeAt(p);
    if (c === 0x7b /* { */) {
      stack.push({ type: "obj", entries: [], seen: new Map(), state: "start", key: "" });
      return p + 1;
    }
    if (c === 0x5b /* [ */) {
      stack.push({ type: "arr", items: [], state: "start" });
      return p + 1;
    }
    const scanned = parseScalar(source, p);
    pending = scanned.node;
    hasPending = true;
    return scanned.end;
  }

  function closeFrame(): void {
    const frame = stack.pop()!;
    pending = frame.type === "arr" ? { kind: "array", items: frame.items } : { kind: "object", entries: frame.entries };
    hasPending = true;
  }

  function readMember(frame: ObjFrame): number {
    let p = skipWs(source, pos);
    if (source.charCodeAt(p) !== 0x22 /* " */) syntaxError(source, "Expected a string object key", p);
    const keyStart = p;
    const key = parseString(source, p);
    const prev = frame.seen.get(key.value);
    if (prev !== undefined) {
      throw new JsonToMarkdownError("DUPLICATE_MEMBER_NAME", `Duplicate object member name ${JSON.stringify(key.value)}.`, {
        location: locationAt(source, keyStart),
        firstLocation: locationAt(source, prev),
      });
    }
    frame.seen.set(key.value, keyStart);
    frame.key = key.value;
    p = skipWs(source, key.end);
    if (source.charCodeAt(p) !== 0x3a /* : */) syntaxError(source, "Expected ':' after object key", p);
    return startValue(p + 1);
  }
}
