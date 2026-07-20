import { normalizeParsed } from "./parsed.js";
import { renderDocument } from "./render.js";
import { parseSerialized } from "./serialized.js";

export { JsonToMarkdownError } from "./errors.js";
export type { JsonToMarkdownErrorCode, SourceLocation } from "./errors.js";

export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonArray = readonly JsonValue[];
export type JsonValue = null | boolean | number | string | JsonObject | JsonArray;

/**
 * Convert caller-trusted parsed JSON data into a deterministic GFM Output Document.
 * Validates the value at runtime and throws {@link JsonToMarkdownError} on invalid input.
 */
export function convertJsonValue(value: unknown): string {
  return renderDocument(normalizeParsed(value));
}

/**
 * Convert untrusted Serialized JSON Text into a deterministic GFM Output Document.
 * Parses without executing caller code, preserves numeric lexemes losslessly, and
 * throws {@link JsonToMarkdownError} on invalid input.
 */
export function convertJsonText(source: string): string {
  return renderDocument(parseSerialized(source));
}
