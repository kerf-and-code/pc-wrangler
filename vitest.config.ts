// vitest.config.ts (2026-11-08)
//
// Audit A6: unit tests for the pure maths behind the tabletop and the token maker (no browser, no
// database). Run with `npm test`. The "@/..." imports resolve from the project root, as in tsconfig.

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
