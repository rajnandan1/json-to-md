import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { convertJsonText, JsonToMarkdownError, type ConvertOptions } from "../src/index.js";

const root = join(__dirname, "..", "corpus");

interface ErrorFixture {
  code: string;
  pointer?: string;
  location?: { offset: number; line: number; column: number };
  firstLocation?: { offset: number; line: number; column: number };
}

function collectCases(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectCases(path));
    else if (entry.name.endsWith(".input.json")) out.push(path.slice(0, -".input.json".length));
  }
  return out;
}

describe("parity corpus", () => {
  const bases = collectCases(root);
  it("has cases", () => {
    expect(bases.length).toBeGreaterThan(0);
  });

  for (const base of bases) {
    const name = base.slice(root.length + 1);
    const input = readFileSync(`${base}.input.json`, "utf8");
    const options: ConvertOptions | undefined = existsSync(`${base}.options.json`)
      ? (JSON.parse(readFileSync(`${base}.options.json`, "utf8")) as ConvertOptions)
      : undefined;

    if (existsSync(`${base}.expected.md`)) {
      it(name, () => {
        expect(convertJsonText(input, options)).toBe(readFileSync(`${base}.expected.md`, "utf8"));
      });
    } else {
      const fixture = JSON.parse(readFileSync(`${base}.error.json`, "utf8")) as ErrorFixture;
      it(name, () => {
        let caught: unknown;
        try {
          convertJsonText(input, options);
        } catch (e) {
          caught = e;
        }
        expect(caught).toBeInstanceOf(JsonToMarkdownError);
        const err = caught as JsonToMarkdownError;
        expect(err.code).toBe(fixture.code);
        expect(err.pointer).toEqual(fixture.pointer);
        expect(err.location).toEqual(fixture.location);
        expect(err.firstLocation).toEqual(fixture.firstLocation);
      });
    }
  }
});
