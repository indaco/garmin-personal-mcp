// Fills the built page template with dashboard data, for screenshots and manual checks: data, layout,
// widgets, i18n and settings. Languages keep the template default (English only), and the settings
// only reach the settings block, not the title or the CSS: plain node cannot import
// src/dashboard-page.ts, whose withData and styled are what writeDashboard uses.
// `node scripts/fill-dashboard-fixture.mjs dist/dashboard.html test/fixtures/dashboard-data.json out.html`
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// the server version and write time that withData adds, so the footer shows them as on a page the
// server wrote
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// the block format of writeBlock in src/dashboard-page.ts
export const fill = (page, block, value) =>
  page.replace(
    new RegExp(
      `/\\*\\s*garmin-${block}:start\\s*\\*/[\\s\\S]*?/\\*\\s*garmin-${block}:end\\s*\\*/`,
    ),
    () =>
      `/* garmin-${block}:start */${JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("*", "\\u002a")}/* garmin-${block}:end */`,
  );

const isRun = (a) => typeof a.type === "string" && a.type.endsWith("running");
// workoutOf of src/page/running.ts: the run name without the place that Garmin puts before " - "
const workoutOf = (name) => {
  const i = name.indexOf(" - ");
  return (i > 0 ? name.slice(i + 3).trim() : "") || name;
};
const workout = (a) => (typeof a.name === "string" ? workoutOf(a.name) : undefined);

/**
 * Removes the details that getDashboardData does not attach (src/dashboard.ts attachDetails), so a demo
 * shows what the server gives. With `saved`, every .FIT file is saved, as on a page that has updated
 * for months; without, it is a first build. `activities` come newest first. Laps stay for the 3 newest activities,
 * races, runs over 15 km and, with `workouts`, the 8 newest runs of each run name that repeats; sets
 * stay for the 30 newest strength sessions, and for all of them when every file is saved.
 */
export function asServer(activities, workouts = false, saved = false) {
  const runNames = new Map();
  for (const a of activities.filter(isRun))
    runNames.set(workout(a), (runNames.get(workout(a)) ?? 0) + 1);
  const lapped = new Map();
  let strength = 0;
  activities.forEach((a, i) => {
    if (a.type?.includes("strength") && strength++ >= 30 && !saved) delete a.exercises;
    const longRun = isRun(a) && typeof a.km === "number" && a.km > 15;
    const w = workout(a);
    const repeated =
      workouts &&
      isRun(a) &&
      w !== undefined &&
      runNames.get(w) > 1 &&
      ((lapped.get(w) ?? 0) < 8 || saved);
    if (repeated) lapped.set(w, (lapped.get(w) ?? 0) + 1);
    if (!(i < 3 || a.race === true || longRun || repeated)) delete a.laps;
  });
  return activities;
}

/** The template with every block filled; the layout defaults to the preset, the settings to none. */
export function fillPage(template, data, layout = null, settings = null) {
  let page = fill(template, "data", {
    updated: new Date().toISOString(),
    ...data,
    server: version,
  });
  page = fill(page, "layout", layout);
  page = fill(page, "widgets", []);
  page = fill(page, "settings", settings);
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
