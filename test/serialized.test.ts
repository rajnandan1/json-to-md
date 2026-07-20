import { describe, expect, it } from "vitest";
import { parseSerialized } from "../src/serialized.js";
import { JsonToMarkdownError } from "../src/errors.js";

function err(fn: () => unknown): JsonToMarkdownError {
  try {
    fn();
  } catch (e) {
    if (e instanceof JsonToMarkdownError) return e;
    throw e;
  }
  throw new Error("expected throw");
}

describe("parseSerialized values", () => {
  it("parses scalars", () => {
    expect(parseSerialized("null")).toEqual({ kind: "null" });
    expect(parseSerialized("true")).toEqual({ kind: "boolean", value: true });
    expect(parseSerialized("false")).toEqual({ kind: "boolean", value: false });
    expect(parseSerialized('"hi"')).toEqual({ kind: "string", value: "hi" });
  });

  it("preserves numeric lexemes exactly", () => {
    expect(parseSerialized("1.00")).toEqual({ kind: "number", lexeme: "1.00" });
    expect(parseSerialized("9007199254740993")).toEqual({ kind: "number", lexeme: "9007199254740993" });
    expect(parseSerialized("-0")).toEqual({ kind: "number", lexeme: "-0" });
    expect(parseSerialized("1.5e+10")).toEqual({ kind: "number", lexeme: "1.5e+10" });
    expect(parseSerialized("1E-7")).toEqual({ kind: "number", lexeme: "1E-7" });
  });

  it("decodes string escapes", () => {
    expect(parseSerialized('"a\\nb"')).toEqual({ kind: "string", value: "a\nb" });
    expect(parseSerialized('"\\u0041\\t\\"\\\\"')).toEqual({ kind: "string", value: 'A\t"\\' });
    expect(parseSerialized('"\\ud83c\\udf89"')).toEqual({ kind: "string", value: "🎉" });
  });

  it("preserves object and array order", () => {
    expect(parseSerialized('{"b":1,"a":2}')).toEqual({
      kind: "object",
      entries: [
        ["b", { kind: "number", lexeme: "1" }],
        ["a", { kind: "number", lexeme: "2" }],
      ],
    });
    expect(parseSerialized("[1,2,3]")).toEqual({
      kind: "array",
      items: [
        { kind: "number", lexeme: "1" },
        { kind: "number", lexeme: "2" },
        { kind: "number", lexeme: "3" },
      ],
    });
  });

  it("parses empty containers and ignores insignificant whitespace", () => {
    expect(parseSerialized("  {}  ")).toEqual({ kind: "object", entries: [] });
    expect(parseSerialized("[ ]")).toEqual({ kind: "array", items: [] });
    expect(parseSerialized('{\n  "a" : [ 1 , 2 ]\n}')).toEqual({
      kind: "object",
      entries: [["a", { kind: "array", items: [{ kind: "number", lexeme: "1" }, { kind: "number", lexeme: "2" }] }]],
    });
  });

  it("parses deeply nested arrays without a stack overflow", () => {
    const depth = 100_000;
    const src = "[".repeat(depth) + "]".repeat(depth);
    expect(() => parseSerialized(src)).not.toThrow();
  });
});

describe("parseSerialized errors", () => {
  it("rejects duplicate member names with both locations", () => {
    const e = err(() => parseSerialized('{"name":"first","name":"second"}'));
    expect(e.code).toBe("DUPLICATE_MEMBER_NAME");
    expect(e.location?.offset).toBe(16);
    expect(e.firstLocation?.offset).toBe(1);
  });

  it("rejects trailing content", () => {
    expect(err(() => parseSerialized("1 2")).code).toBe("INVALID_JSON_SYNTAX");
    expect(err(() => parseSerialized("{} {}")).code).toBe("INVALID_JSON_SYNTAX");
  });

  it("rejects empty and malformed input", () => {
    expect(err(() => parseSerialized("")).code).toBe("INVALID_JSON_SYNTAX");
    expect(err(() => parseSerialized("   ")).code).toBe("INVALID_JSON_SYNTAX");
    expect(err(() => parseSerialized("{")).code).toBe("INVALID_JSON_SYNTAX");
    expect(err(() => parseSerialized("[1,]")).code).toBe("INVALID_JSON_SYNTAX");
    expect(err(() => parseSerialized('{"a"}')).code).toBe("INVALID_JSON_SYNTAX");
    expect(err(() => parseSerialized("01")).code).toBe("INVALID_JSON_SYNTAX");
    expect(err(() => parseSerialized("1.")).code).toBe("INVALID_JSON_SYNTAX");
    expect(err(() => parseSerialized('"a')).code).toBe("INVALID_JSON_SYNTAX");
    expect(err(() => parseSerialized('"a\nb"')).code).toBe("INVALID_JSON_SYNTAX");
  });

  it("reports line and column for a syntax error", () => {
    const e = err(() => parseSerialized('{\n  "a": bad\n}'));
    expect(e.code).toBe("INVALID_JSON_SYNTAX");
    expect(e.location?.line).toBe(2);
    expect(e.location?.column).toBe(8);
  });
});
