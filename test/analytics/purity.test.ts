import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The tracked analytics sources: an ignored file of a local tool is in no other checkout. */
const files = execFileSync("git", ["ls-files", "src/analytics/*.ts"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

/** The code without its comments: a comment may say "window." or "fetch(". */
const code = (file: string) =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

// the server and the page share src/analytics: no I/O, no clock, no host globals
const FORBIDDEN = [
  /\bfetch\s*\(/,
  /\bprocess\s*\./,
  /\brequire\s*\(/,
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
  /\bdocument\s*\./,
  /\bwindow\s*\./,
  /\bglobalThis\b/,
  /\bDate\.now\s*\(/,
  /\bnew Date\s*\(\s*\)/,
  /\bimport\s*\(/,
];

describe("src/analytics", () => {
  it("has its files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s imports only its own modules and ../dates", (file) => {
    const from = [...code(file).matchAll(/\b(?:from|import)\s+["']([^"']+)["']/g)].map((m) => m[1]);
    for (const path of from) expect(path, file).toMatch(/^(\.\/[\w-]+|\.\.\/dates)$/);
  });

  it.each(files)("%s uses no I/O, clock or host global", (file) => {
    const src = code(file);
    for (const re of FORBIDDEN) expect(src, `${file}: ${re}`).not.toMatch(re);
  });
});
