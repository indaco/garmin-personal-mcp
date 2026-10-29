import { defineConfig } from "tsdown";

// The site script: scripts/build-site.mjs puts it into dist-site/index.html.
export default defineConfig({
  entry: { site: "site/main.ts" },
  format: ["iife"],
  platform: "browser",
  outDir: "dist-site/.script",
  dts: false,
  minify: true,
});
