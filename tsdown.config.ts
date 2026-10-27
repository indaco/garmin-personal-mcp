import { defineConfig } from "tsdown";

/** Writes modules.json: the files in the page bundle. The minified bundle has no paths for the notices. */
const moduleList = {
  name: "module-list",
  generateBundle(_: unknown, bundle: Record<string, { type: string; moduleIds?: string[] }>) {
    const ids = Object.values(bundle).flatMap((c) =>
      c.type === "chunk" ? (c.moduleIds ?? []) : [],
    );
    (this as unknown as { emitFile(f: object): void }).emitFile({
      type: "asset",
      fileName: "modules.json",
      source: JSON.stringify(ids),
    });
  },
};

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
    minify: true,
    // the license banners of the bundled libraries stay in the minified page
    outputOptions: { legalComments: "inline" },
    deps: { alwaysBundle: [/.*/] },
    plugins: [moduleList],
  },
]);
