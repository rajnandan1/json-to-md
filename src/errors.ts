export type JsonToMarkdownErrorCode =
  | "INVALID_JSON_SYNTAX"
  | "DUPLICATE_MEMBER_NAME"
  | "INVALID_PARSED_VALUE"
  | "CYCLIC_REFERENCE"
  | "SPARSE_ARRAY";

export interface SourceLocation {
  /** Zero-based UTF-16 code-unit index. */
  readonly offset: number;
  /** One-based line number. */
  readonly line: number;
  /** One-based UTF-16 code-unit position within the line. */
  readonly column: number;
}

export interface JsonToMarkdownErrorDetails {
  readonly pointer?: string;
  readonly location?: SourceLocation;
  /** First occurrence of a member name reported as DUPLICATE_MEMBER_NAME. */
  readonly firstLocation?: SourceLocation;
}

export class JsonToMarkdownError extends Error {
  readonly code: JsonToMarkdownErrorCode;
  readonly pointer: string | undefined;
  readonly location: SourceLocation | undefined;
  readonly firstLocation: SourceLocation | undefined;

  constructor(
    code: JsonToMarkdownErrorCode,
    message: string,
    details: JsonToMarkdownErrorDetails = {},
  ) {
    super(message);
    this.name = "JsonToMarkdownError";
    this.code = code;
    this.pointer = details.pointer;
    this.location = details.location;
    this.firstLocation = details.firstLocation;
    // Keep `instanceof` working when compiled down and when subclassed.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
