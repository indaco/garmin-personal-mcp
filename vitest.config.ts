import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      // the page code that builds and changes the DOM: only the e2e tests in Chromium run it
      exclude: [
        "src/page/{app,charts,dom,edit-drag,icons,main,registry,theme}.ts",
        "src/page/widgets/**",
      ],
      // lcov for Codecov, text-summary for the terminal and the CI log
      reporter: ["text-summary", "lcov"],
    },
  },
});
