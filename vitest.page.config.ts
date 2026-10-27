import { defineConfig } from "vitest/config";

// The dashboard page in headless Chromium. Needs `pnpm build` first, and the browser:
// `pnpm exec playwright-core install --only-shell chromium`.
export default defineConfig({
  test: {
    include: ["test/e2e/**/*.e2e.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
