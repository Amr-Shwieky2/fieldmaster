import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}", "scripts/**/*.{test,spec}.{mjs,ts}"],
    server: {
      deps: {
        // next-intl is ESM and imports `next/navigation` (extensionless); let
        // Vite resolve it instead of Node's strict ESM loader.
        inline: ["next-intl", "use-intl"],
      },
    },
  },
  resolve: {
    alias: {
      // Tests run against the TypeScript source of the shared enums so a stale
      // `dist/` build can never hide a missing enum or label.
      "@fieldmaster/shared-types": path.resolve(__dirname, "../../packages/shared-types/src/index.ts"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
