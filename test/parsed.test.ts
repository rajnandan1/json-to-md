import { describe, expect, it } from "vitest";
import { normalizeParsed } from "../src/parsed.js";
import { JsonToMarkdownError } from "../src/errors.js";

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof JsonToMarkdownError) return e.code;
    throw e;
  }
  throw new Error("expected throw");
}

describe("normalizeParsed accepts", () => {
  it("scalars", () => {
    expect(normalizeParsed(null)).toEqual({ kind: "null" });
    expect(normalizeParsed(true)).toEqual({ kind: "boolean", value: true });
    expect(normalizeParsed("hi")).toEqual({ kind: "string", value: "hi" });
    expect(normalizeParsed(1.5)).toEqual({ kind: "number", lexeme: "1.5" });
    expect(normalizeParsed(-0)).toEqual({ kind: "number", lexeme: "0" });
  });

  it("nested objects and arrays in encounter order", () => {
    expect(normalizeParsed({ b: 1, a: [2, "x"] })).toEqual({
      kind: "object",
      entries: [
        ["b", { kind: "number", lexeme: "1" }],
        ["a", { kind: "array", items: [{ kind: "number", lexeme: "2" }, { kind: "string", value: "x" }] }],
      ],
    });
  });

  it("null-prototype objects", () => {
    const o = Object.assign(Object.create(null), { x: 1 });
    expect(normalizeParsed(o)).toEqual({
      kind: "object",
      entries: [["x", { kind: "number", lexeme: "1" }]],
    });
  });

  it("a shared (non-cyclic) reference twice", () => {
    const shared = { v: 1 };
    const out = normalizeParsed([shared, shared]) as { kind: "array"; items: unknown[] };
    expect(out.items).toHaveLength(2);
    expect(out.items[0]).toEqual(out.items[1]);
  });

  it("deep nesting without a stack overflow", () => {
    let deep: unknown = 0;
    for (let i = 0; i < 100_000; i++) deep = { n: deep };
    expect(() => normalizeParsed(deep)).not.toThrow();
  });
});

describe("normalizeParsed rejects", () => {
  it("undefined, bigint, function, symbol", () => {
    expect(code(() => normalizeParsed(undefined))).toBe("INVALID_PARSED_VALUE");
    expect(code(() => normalizeParsed(10n))).toBe("INVALID_PARSED_VALUE");
    expect(code(() => normalizeParsed(() => 1))).toBe("INVALID_PARSED_VALUE");
    expect(code(() => normalizeParsed(Symbol("s")))).toBe("INVALID_PARSED_VALUE");
  });

  it("NaN and infinities", () => {
    expect(code(() => normalizeParsed(NaN))).toBe("INVALID_PARSED_VALUE");
    expect(code(() => normalizeParsed(Infinity))).toBe("INVALID_PARSED_VALUE");
    expect(code(() => normalizeParsed(-Infinity))).toBe("INVALID_PARSED_VALUE");
  });

  it("class instances, Date, Map, Set", () => {
    class Foo {
      x = 1;
    }
    expect(code(() => normalizeParsed(new Foo()))).toBe("INVALID_PARSED_VALUE");
    expect(code(() => normalizeParsed(new Date()))).toBe("INVALID_PARSED_VALUE");
    expect(code(() => normalizeParsed(new Map()))).toBe("INVALID_PARSED_VALUE");
    expect(code(() => normalizeParsed(new Set()))).toBe("INVALID_PARSED_VALUE");
  });

  it("accessors without invoking them", () => {
    let touched = false;
    const o = {};
    Object.defineProperty(o, "x", {
      enumerable: true,
      get() {
        touched = true;
        return 1;
      },
    });
    expect(code(() => normalizeParsed(o))).toBe("INVALID_PARSED_VALUE");
    expect(touched).toBe(false);
  });

  it("sparse arrays", () => {
    // eslint-disable-next-line no-sparse-arrays
    expect(code(() => normalizeParsed([1, , 3]))).toBe("SPARSE_ARRAY");
    const holed = [1, 2];
    holed.length = 4;
    expect(code(() => normalizeParsed(holed))).toBe("SPARSE_ARRAY");
  });

  it("arrays carrying extra enumerable properties", () => {
    const arr: number[] & { extra?: string } = [1, 2];
    arr.extra = "x";
    expect(code(() => normalizeParsed(arr))).toBe("INVALID_PARSED_VALUE");
  });

  it("cycles", () => {
    const o: Record<string, unknown> = {};
    o.self = o;
    expect(code(() => normalizeParsed(o))).toBe("CYCLIC_REFERENCE");
    const a: unknown[] = [];
    a.push(a);
    expect(code(() => normalizeParsed(a))).toBe("CYCLIC_REFERENCE");
  });

  it("reports a pointer for a nested invalid value", () => {
    try {
      normalizeParsed({ a: { b: [undefined] } });
    } catch (e) {
      expect(e).toBeInstanceOf(JsonToMarkdownError);
      expect((e as JsonToMarkdownError).pointer).toBe("/a/b/0");
      return;
    }
    throw new Error("expected throw");
  });
});
