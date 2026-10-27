// Writes THIRD-PARTY-NOTICES.md: the license of every package that tsdown bundled into dist/index.js
// and into the dashboard page. The build runs it last, so the file follows each dependency update.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const bundle = ["dist/index.js", "dist/dashboard.html"]
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

// tsdown marks each bundled module with its path, e.g. node_modules/.pnpm/zod@4.6.7/node_modules/zod/...
const dirs = [
  ...new Set(
    bundle.match(/node_modules\/\.pnpm\/[^/]+\/node_modules\/(?:@[^/]+\/)?[^/\s"']+/g) ?? [],
  ),
];
const packages = dirs
  .map((dir) => {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const files = readdirSync(dir)
      .filter((f) => /^(licen[cs]e|notice|copying)/i.test(f))
      .toSorted();
    if (files.length === 0) {
      throw new Error(`${pkg.name} has no license file: add its notice by hand`);
    }
    const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
    return {
      name: pkg.name,
      version: pkg.version,
      license: pkg.license,
      repo: repo?.replace(/^git\+/, "").replace(/\.git$/, ""),
      texts: files.map((f) => readFileSync(join(dir, f), "utf8").trim()),
    };
  })
  .toSorted((a, b) => a.name.localeCompare(b.name));

// code that a bundled package inlined itself keeps its notice as a /*! ... */ comment
const inlined = [...new Set(bundle.match(/\/\*![\s\S]*?\*\//g) ?? [])].map((c) =>
  c
    .replace(/^\/\*!\s*|\s*\*\/$/g, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, ""))
    .join("\n")
    .trim(),
);

// an inlined notice names its license only; the MIT license asks for its permission text with each copy
const MIT = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const fence = (text) => `\`\`\`text\n${text}\n\`\`\``;
const out = [
  "# Third-party notices",
  "",
  "`dist/index.js` and `dist/dashboard.html` include the packages below. Each package keeps its own license.",
  "The build writes this file (`scripts/third-party-notices.mjs`). Do not edit it by hand.",
  "",
];
for (const p of packages) {
  out.push(`## ${p.name} ${p.version}`, "", `License: ${p.license}`);
  if (p.repo) out.push(`Source: <${p.repo}>`);
  out.push("");
  for (const text of p.texts) out.push(fence(text), "");
}
if (inlined.length > 0) {
  out.push("## Code inlined by the packages above", "");
  for (const text of inlined) {
    out.push(fence(/\bMIT Licensed\b/.test(text) ? `${text}\n\n${MIT}` : text), "");
  }
}
writeFileSync("THIRD-PARTY-NOTICES.md", `${out.join("\n").trimEnd()}\n`);
console.log(
  `THIRD-PARTY-NOTICES.md: ${packages.length} packages, ${inlined.length} inlined notices`,
);
