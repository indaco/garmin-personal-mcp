import { defineConfig } from "tsdown";

// One self-contained file: npx installs nothing but this package.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  dts: false,
  fixedExtension: false,
  deps: { alwaysBundle: [/.*/] },
});
