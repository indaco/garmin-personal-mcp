// Fills the built page template with dashboard data, like writeDashboard does, for screenshots and
// manual checks: `node scripts/fill-dashboard-fixture.mjs dist/dashboard.html test/fixtures/dashboard-data.json out.html`
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// the block format of writeBlock in src/dashboard-page.ts
export const fill = (page, block, value) =>
  page.replace(
    new RegExp(
      `/\\*\\s*garmin-${block}:start\\s*\\*/[\\s\\S]*?/\\*\\s*garmin-${block}:end\\s*\\*/`,
    ),
    () =>
      `/* garmin-${block}:start */${JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("*", "\\u002a")}/* garmin-${block}:end */`,
  );

/** The template with every block filled; the layout defaults to the preset. */
export function fillPage(template, data, layout = null) {
  let page = fill(template, "data", data);
  page = fill(page, "layout", layout);
  page = fill(page, "widgets", []);
  return fill(page, "i18n", {});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [template, data, out] = process.argv.slice(2);
  if (!template || !data || !out) {
    console.error(
      "usage: node scripts/fill-dashboard-fixture.mjs <template.html> <data.json> <out.html>",
    );
    process.exit(2);
  }
  const page = fillPage(readFileSync(template, "utf8"), JSON.parse(readFileSync(data, "utf8")));
  writeFileSync(out, page);
  console.log(`${out} written`);
}
