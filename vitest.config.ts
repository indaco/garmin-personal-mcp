import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // the page code that builds and changes the DOM: only the e2e tests in Chromium run it
      exclude: [
        "src/page/{app,charts,dom,edit-drag,icons,main,registry,theme}.ts",
        "src/page/widgets/**",
      ],
      // lcov for Codecov, text-summary for the terminal and the CI log
      reporter: ["text-summary", "lcov"],
      // a floor at today's numbers: a change that leaves new code untested fails the run.
      // Raise it when coverage goes up, in the same change.
      thresholds: { statements: 100, functions: 100, lines: 100, branches: 96 },
    },
  },
});
