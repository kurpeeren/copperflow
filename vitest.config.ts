import { configDefaults, defineConfig } from "vitest/config"

/** Speed tests run on their own, one file at a time (`npm run test:perf`), so nothing else competes for the machine. */
const SPEED_TESTS = "test/**/*.perf.ts"

export default defineConfig(({ mode }) => ({
  test: {
    include: mode === "perf" ? [SPEED_TESTS] : ["test/**/*.test.ts"],
    exclude: mode === "perf" ? configDefaults.exclude : [...configDefaults.exclude, SPEED_TESTS],
    // Tests that build the real engine take well under a second alone, but in the full parallel run one has been
    // measured at 26 s while the long router tests ran beside it; 5 s failed tests that were only waiting.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts", "src/engine/engine-worker.ts", "src/studio/router-worker.ts"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
}))
