import { defineConfig } from "vite";

// Root is this `demo/` folder; allow importing the built library from `../dist`.
export default defineConfig({
  server: { fs: { allow: [".."] } },
});
