// The inputs of assets/dashboard.gif: the page sources and the scripts that make the demo. `pnpm demo`
// writes their hash next to the GIF; the site build and the site test refuse a GIF whose inputs changed.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

export const STAMP_FILE = "assets/dashboard.gif.sha256";
const INPUTS = [
  "src/page",
  "scripts/build-template.mjs",
  "scripts/demo-dashboard.mjs",
  "scripts/demo-gif.mjs",
  "scripts/fill-dashboard-fixture.mjs",
];
// the GIF shows the page in English: a change to another language needs no new GIF
const shown = (file) => !file.startsWith("src/page/i18n/locales/") || file.endsWith("/en.json");

// only the files that git tracks: an ignored file in src/page (a tool's session file) is in no other
// checkout, so CI would compute another hash
const tracked = () =>
  execFileSync("git", ["ls-files", "-z", "--", ...INPUTS], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);

/** The hash of every tracked input file, by path and content. */
export function demoStamp() {
  const hash = createHash("sha256");
  for (const file of tracked().filter(shown).toSorted()) {
    hash.update(`${file}\0`).update(readFileSync(file)).update("\0");
  }
  return hash.digest("hex");
}

/** True when the GIF was recorded from the current inputs. */
export const gifIsCurrent = () =>
  existsSync(STAMP_FILE) && readFileSync(STAMP_FILE, "utf8").trim() === demoStamp();
