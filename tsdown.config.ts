import { defineConfig } from "tsdown";

export default defineConfig([
  // One self-contained file: npx installs nothing but this package.
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    platform: "node",
    dts: false,
    fixedExtension: false,
    deps: { alwaysBundle: [/.*/] },
  },
  // The dashboard page script, with Chart.js inside: scripts/build-template.mjs puts it into dist/dashboard.html.
  {
    entry: { page: "src/page/main.ts" },
    format: ["iife"],
    platform: "browser",
    outDir: "dist/page",
    dts: false,
    deps: { alwaysBundle: [/.*/] },
  },
]);
