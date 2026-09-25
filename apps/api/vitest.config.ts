import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Coverage only counts where the money and the mail are. The thresholds are a floor that
    // `pnpm test:coverage` enforces, not a target: what they catch is a module that lost its tests.
    coverage: {
      provider: "v8",
      include: ["src/pipeline/**/*.ts", "src/mail/**/*.ts", "src/subscriber/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "src/pipeline/fixtures/**",
        "src/pipeline/scheduler.ts",
        "src/pipeline/pipeline.controller.ts",
      ],
      reporter: ["text-summary", "text"],
      thresholds: { lines: 70, functions: 70 },
    },
  },
});
