import { defineConfig } from "vitest/config";

// Root Vitest config: repo checks in tooling/ plus package-local tests.
export default defineConfig({
  test: {
    include: [
      "tooling/test/**/*.test.ts",
      "services/*/test/**/*.test.ts",
      "packages/*/test/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/.git/**", "**/dist/**", ".tools/**"],
    environment: "node",
    testTimeout: 30000,
  },
});
