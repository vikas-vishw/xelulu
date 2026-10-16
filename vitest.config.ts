import { defineConfig } from "vitest/config";

// Root Vitest config: repo checks in tooling/ plus package-local tests.
export default defineConfig({
  test: {
    include: [
      "tooling/test/**/*.test.ts",
      "services/*/test/**/*.test.ts",
      "packages/*/test/**/*.test.ts",
      // Admin console tests; DOM tests opt in per file with `// @vitest-environment jsdom`.
      "apps/admin/test/**/*.test.{ts,tsx}",
    ],
    exclude: ["**/node_modules/**", "**/.git/**", "**/dist/**", ".tools/**"],
    environment: "node",
    testTimeout: 30000,
    // Cap the worker pool. `services/*/test/start.test.ts` asserts that a misconfigured service
    // exits within 5 s of wall-clock time, and that 5 s is a product contract (Req 1.3, 22.3), not
    // a test tunable. With one worker per CPU, the two start tests run beside five other files and
    // each spawn 28 child processes of their own, so the first cold `node dist/index.js` spawn
    // measured ~6.1 s - the machine's scheduling, not the service's start-up. Four workers keep the
    // measurement about the program rather than about the oversubscription, so the contract can be
    // asserted at its real value instead of being relaxed.
    maxWorkers: 4,
  },
});
