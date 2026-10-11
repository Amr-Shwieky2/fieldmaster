import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
  resolve: {
    alias: {
      // Run against the TypeScript source of the shared enums so a stale dist/ never hides a missing label.
      "@fieldmaster/shared-types": path.resolve(__dirname, "../shared-types/src/index.ts"),
    },
  },
});
