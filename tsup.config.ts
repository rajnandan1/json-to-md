import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  // iife (dist/index.global.js) serves classic <script src> tags as window.jsonToMd.
  format: ["esm", "cjs", "iife"],
  globalName: "jsonToMd",
  target: "es2020",
  dts: true,
  clean: true,
  sourcemap: true,
  // Bundle the ESM-only slugger so the CJS build has no require(ESM) interop and
  // consumers install zero runtime dependencies.
  noExternal: ["github-slugger"],
  outExtension: ({ format }) => ({
    js: format === "cjs" ? ".cjs" : format === "iife" ? ".global.js" : ".js",
  }),
});
