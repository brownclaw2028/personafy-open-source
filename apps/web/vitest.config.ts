import { defineConfig } from "vitest/config";

const enforceCoverageThresholds = process.env.VITEST_ENFORCE_COVERAGE === "1";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
    coverage: {
      provider: "v8",
      ...(enforceCoverageThresholds
        ? {
            thresholds: {
              statements: 85,
              branches: 75,
            },
          }
        : {}),
    },
  },
});
