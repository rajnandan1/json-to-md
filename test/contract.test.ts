import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const distEsm = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const distCjs = fileURLToPath(new URL("../dist/index.cjs", import.meta.url));
const built = existsSync(distEsm) && existsSync(distCjs);

// Runs against the published artifacts; skips when `pnpm build` has not run yet.
describe.skipIf(!built)("build contract (run after `pnpm build`)", () => {
  const expected = "# Results\n\n## a\n\n1 *(integer)*\n";

  it("works as browser/Node ESM with named exports and no default export", async () => {
    const mod = await import(distEsm);
    expect(typeof mod.convertJsonValue).toBe("function");
    expect(typeof mod.convertJsonText).toBe("function");
    expect(typeof mod.JsonToMarkdownError).toBe("function");
    expect(mod.default).toBeUndefined();
    expect(mod.convertJsonValue({ a: 1 })).toBe(expected);
  });

  it("works as Node CommonJS", () => {
    const require = createRequire(import.meta.url);
    const mod = require(distCjs) as typeof import("../src/index.js");
    expect(mod.convertJsonText('{"a":1}')).toBe(expected);
    expect(mod.convertJsonValue([1, 2])).toBe("# Results\n\n- 1 *(integer)*\n- 2 *(integer)*\n");
  });
});
