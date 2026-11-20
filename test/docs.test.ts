import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GROUPS } from "../src/analytics/calc";
import { LONG_RUN_SHARE_WARN } from "../src/analytics/running";
import { CATALOGUE } from "../src/page/catalogue";
import { ABOUT } from "../src/page/catalogue-about";
import { en } from "../src/page/i18n/en";
import { preset } from "../src/page/presets";
import { WIDGET_API } from "../src/page/widget-api";

/**
 * The parts of the guide that come from the code. `pnpm guide` writes them; this test fails when they are
 * not current, so the guide never drifts from the widgets and the texts.
 */

const BOARDS = ["all", ...GROUPS];
const cell = (s: string) => s.replaceAll("|", "\\|").replaceAll("\n", " ");

/** The types of a widget for the table: every type in short, or a list. */
const types = (t?: readonly string[]) =>
  t
    ? t.length > 8
      ? "all and each type"
      : t.map((x) => (x === "all" ? "all" : x)).join(", ")
    : "-";

function widgetsDoc(): string {
  const lines = [
    "# Widget catalogue",
    "",
    "The built-in widgets of the dashboard. `pnpm guide` writes this page from the code: do not change",
    "it by hand.",
    "",
    "| Widget | Id | Shows | Types | Width |",
    "| ------ | -- | ----- | ----- | ----- |",
    ...CATALOGUE.map(
      (c) =>
        `| ${en[c.title]} | \`${c.id}\` | ${cell(ABOUT[c.id])} | ${types(c.types)} | ${c.span} |`,
    ),
    "",
    "_Types_ are the types that the widget can show. A widget without types shows the same thing on",
    "every board. _Width_ is the default width in columns.",
    "",
    "## The preset of each board",
    "",
    "| Board | Widgets, in order |",
    "| ----- | ----------------- |",
    ...BOARDS.map(
      (b) =>
        `| ${b} | ${preset(b)
          .map((i) => `\`${i.widget}\``)
          .join(", ")} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

function keysPart(): string {
  return [
    "| Key | English text |",
    "| --- | ------------ |",
    ...Object.entries(en).map(([k, v]) => `| \`${k}\` | ${cell(v)} |`),
  ].join("\n");
}

/** The file with the text between the two markers replaced. */
function between(file: string, name: string, text: string): string {
  const s = readFileSync(file, "utf8");
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  return `${s.slice(0, s.indexOf(start) + start.length)}\n${text}\n${s.slice(s.indexOf(end))}`;
}

function check(file: string, text: string): void {
  if (process.env.UPDATE_DOCS) writeFileSync(file, text);
  expect(readFileSync(file, "utf8"), `${file} is not current: run pnpm guide`).toBe(text);
}

describe("guide", () => {
  it("says in the tool guide that a ride or a swim has no plan", () => {
    expect(readFileSync("guide/tools.md", "utf8")).toContain(
      "For plan against done, read `plan` of `getActivitySets` (strength) or `getActivityLaps` (runs); a ride or a swim has no `plan`",
    );
  });

  it("says in the tool guide that listActivities gives a ride's numbers", () => {
    expect(readFileSync("guide/tools.md", "utf8")).toContain(
      "a compact summary of each activity: the Garmin type key and the FIT SDK sport name, km, moving and elapsed time, pace, HR, cadence, ascent, HR-zone seconds, Garmin training load and training effect, intensity minutes, race flag, best efforts, power, running form, run/walk segments, swim SWOLF, lengths and strokes, mountain-bike grit and flow, and for a ride: km/h, ascent per hour and the easy and hard zone share.",
    );
  });

  it("says in the tool guide that a rest-pause group is marked", () => {
    expect(readFileSync("guide/tools.md", "utf8")).toContain(
      "strength sets from the .FIT file: exercise, movement category, primary and secondary muscles, reps, weight (kg), set time and the rest after the set; the top set and the e1RM of each exercise; the planned workout that the watch ran, with the planned and done sets and reps and hit or miss of each planned exercise (a rest-pause group is marked, and only the first set of each pass is judged on reps), and the planned rest after each planned exercise. The empty set that the watch adds at the end of a workout is not shown",
    );
  });

  it("says that showDashboard writes no page file but updates the data cache", () => {
    expect(readFileSync("guide/tools.md", "utf8")).toContain(
      "It writes no page file (it updates the data cache, as `getDashboardData` does) and has no coach notes.",
    );
    expect(readFileSync("guide/dashboard.md", "utf8")).toContain(
      "- The server writes no page file (it updates the data cache), and the page has no coach notes.",
    );
    expect(readFileSync("README.md", "utf8")).toContain(
      "The tool reads new data from Garmin and shows your saved page,\nwith its layout, custom widgets, languages and settings. It writes no page file, and the page has no\ncoach notes.",
    );
  });

  it("says that a writeDashboard preview writes no page file", () => {
    expect(readFileSync("guide/tools.md", "utf8")).toContain(
      "`settings` set the title, the sports, the data, the languages, the themes, the workout comparison, the recovery history and the start day (`since`: the page starts in the week of that day and grows by one week at each update, up to 52) of the page; `preview` writes no page file (it updates the data cache, as `getDashboardData` does) and gives the activities of each board and the settings of the page.",
    );
    const readme = readFileSync("README.md", "utf8").replace(/\s+/g, " ");
    const preview =
      "The assistant reads the server's summary of the dashboard data (a `writeDashboard` preview, which writes no page file).";
    // train-today and week-review both say it: toContain alone passes with one
    expect(readme.split(preview).length - 1).toBe(2);
    expect(readme).toContain(
      `${preview} It uses the weeks of your dashboard page, so the numbers are the same as on the page. It gives the verdict of the dashboard's Readiness widget: go easy, normal or ready to push. This verdict is the dashboard's own rule, not Garmin's Training Readiness. A table shows each input and the rule it meets: the HRV status, the sleep score, the resting HR against the average of the 7 days before, and the load ratio of 7 to 28 days. When a value is from an older night, the assistant gives its date. Then it names the days in a row with warning signs, when 2 or more of these were off: the resting HR 5 bpm or more above its 7-day base, last night's HRV under the low end of its range, and a sleep score under 60. One such day is a note; 2 in a row are a warning. Each day comes with its numbers. The signs do not change the verdict and are not a diagnosis. Then it gives your fitness, fatigue and form, and a short coach note.`,
    );
    expect(readme).toContain(
      `${preview} It uses the weeks of your dashboard page, so the numbers are the same as on the page. It compares your last whole week, Monday to Sunday, with up to 4 weeks before it: sessions, hours, km, run km and load, and the load ramp against the week before (above 10% is the page's warning level). Then it gives the load ratio, the monotony and strain of the last 7 days and the form of today. It names the warning-sign days of the week (2 or more of these in one day: the resting HR 5 bpm or more above its 7-day base, last night's HRV under the low end of its range, a sleep score under 60) with their numbers, and the days in a row with signs up to the newest day: 2 in a row are a warning, not a diagnosis. Then it gives the new run bests of the week with the time each one beat. These are bests since the page's first week, not all-time records: a faster run before that week is not counted. It gives the planned strength exercises hit and missed in the week, and the exercises that miss most. These count only the sessions you did: a skipped planned session leaves no file and is not seen. It gives the laps of the week's runs on the planned target and off it, the drills that miss most, and how many runs it could not read (the page setting \`workouts\` reads more of them). It ends with a short coach note. The summary has no split by sport for each week, so the review has none. The prompt has no arguments.`,
    );
    const preview12 =
      "The assistant reads the server's summary of 12 weeks (a `writeDashboard` preview, which writes no page file).";
    // race-readiness and swim-readiness both say it
    expect(readme.split(preview12).length - 1).toBe(2);
    expect(readme).toContain(
      `${preview12} It has the weekly run distance and load, the weekly share of easy and hard zone time (zones 1-2 and 4-5), the share of the longest run in the weekly run distance (above ${LONG_RUN_SHARE_WARN}% is the page's warning level), the long runs with their pace split and HR drift, the aerobic efficiency (distance per heartbeat of the easy runs, last 4 weeks against the first 4) and the race predictions, as the dashboard computes them. The assistant gives the days to the race and these numbers, and tells whether your load drops in the last 2 weeks (the taper). The race prediction uses your best efforts of 5 km or more (Riegel, an estimate: the fastest prediction counts). The assistant compares it with your goal and checks the HRV and sleep of the last 7 nights. It ends with a target pace for each quarter of the race.`,
    );
    expect(readme).toContain(
      `${preview12} It gives the days to the event, the swims and km of each week, the longest swim against the event distance, and your recent pace, with pool and open water in separate tables.`,
    );
    expect(readme).not.toContain("which writes nothing");
  });

  it("documents the block-review prompt and its weeks argument in the README", () => {
    const readme = readFileSync("README.md", "utf8").replace(/\s+/g, " ");
    expect(readme).toContain(
      "| [block-review](#block-review) | reviews your last 4 to 12 whole weeks as one training block | `/mcp__garmin-personal__block-review 8` |",
    );
    expect(readme).toContain(
      '### block-review The assistant reads the server\'s summary of the block (a `writeDashboard` preview, which writes no page file). The block is your last 4 to 12 whole weeks, Monday to Sunday, 8 by default. The week in progress is not in it. The assistant gives a table of the weeks with their sessions, hours, km, load, load ramp against the week before, monotony, strain, and the easy and hard share of the runs and of the rides. It names the weeks that the page flags (a ramp above 10%, a monotony above 2) and the strain of the first and the last week. It compares the easy and hard share of the first and the last week. Then it compares the aerobic efficiency at the start and at the end of the block: the metres per heartbeat of the runs and the normalized power per heartbeat of the rides, both below zone 4. Each end is 4 weeks, or half of a shorter block. The change needs 3 sessions at each end, so in a short block it is often "n/a", with the session count of each end. Both values need your HR zones, and the ride value needs a power meter. It ends with a short coach note. The argument `weeks` is optional (default 8): the number of whole weeks in the block. A value under 4 gives 4, a value over 12 gives 12, and a value that is not a whole number gives 8. ## Configuration',
    );
  });

  it("names the weekly monotony and strain of Load safety in the dashboard guide", () => {
    expect(readFileSync("guide/dashboard.md", "utf8").replace(/\s+/g, " ")).toContain(
      "The All board shows all types. Its Load safety widget has a second chart: the monotony and strain of each week.",
    );
  });

  it("names the ride efficiency of the Bike board in the dashboard guide", () => {
    expect(readFileSync("guide/dashboard.md", "utf8").replace(/\s+/g, " ")).toContain(
      "The server gives it the SDK name, for example `running` or `racket`. The Bike board has a Ride efficiency widget: the normalized power per heartbeat of the rides below zone 4. It needs a power meter.",
    );
  });

  it("names the warning signs on the Recovery board in the dashboard guide", () => {
    expect(readFileSync("guide/dashboard.md", "utf8").replace(/\s+/g, " ")).toContain(
      "The Recovery board shows readiness, fitness age, the warning signs, load against recovery and the 14-day recovery widgets: HRV, resting HR, stress, sleep, sleep need, bedtime and Body Battery.",
    );
  });

  it("lists every widget", () => {
    check("guide/widgets.md", widgetsDoc());
  });

  it("has the widget API that the server sends", () => {
    check(
      "guide/custom-widgets.md",
      between("guide/custom-widgets.md", "widget-api", ["```text", WIDGET_API, "```"].join("\n")),
    );
  });

  it("names the weekly monotony and strain of Load safety in the widget API", () => {
    expect(WIDGET_API).toContain(
      "loadSafety(activities, weeks, end, maxHR, dataStart?) (the Load safety numbers: { load, ramp, flagged, weekLoad, monotony, strain, unknown, weekMonotony, weekStrain }; weekMonotony and weekStrain give each week's monotony and strain, null for a week in progress, a week that starts before dataStart and a week whose loads have no spread; a week in progress has no ramp)",
    );
  });

  it("names the measure of the aerobic trend in the widget API", () => {
    expect(WIDGET_API).toContain(
      "aerobicTrend(activities, weeks, z4, measure?) (the efficiency of the activities below the zone 4 floor z4, by measure(activity), efficiency by default: { weekly, runs, n, first, last, firstRuns, lastRuns, change })",
    );
  });

  it("names the power per heartbeat of a ride in the widget API", () => {
    expect(WIDGET_API).toContain(
      "verticalPerHour(activity), powerPerBeat(activity) (normalized power over average HR, in W per bpm; undefined without both).",
    );
  });

  it("lists every text", () => {
    check("guide/languages.md", between("guide/languages.md", "keys", keysPart()));
  });
});

/** The garmin-personal server of each json block in a Markdown file. */
const servers = (file: string) =>
  [...readFileSync(file, "utf8").matchAll(/```json\n([\s\S]*?)```/g)]
    .filter((m) => m[1].includes('"mcpServers"'))
    .map((m) => JSON.parse(m[1]).mcpServers["garmin-personal"]);

describe("setup steps", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));

  it("names the package of package.json in the setup docs", () => {
    // release notes may name a pinned version, so only the docs that a reader follows
    const files = execFileSync("git", ["ls-files", "README.md", "CONTRIBUTING.md", "guide/*.md"], {
      encoding: "utf8",
    }).split("\n");
    for (const file of files.filter(Boolean))
      for (const [name] of readFileSync(file, "utf8").matchAll(
        /@indaco\/garmin-personal-mcp@[\w.^~-]+/g,
      ))
        expect(name, file).toBe(`${pkg.name}@latest`);
  });

  it("gives the step-by-step page the server of the README, with the key in env", () => {
    const [readme] = servers("README.md");
    const guide = servers("guide/setup-claude-desktop.md");
    expect(guide).toHaveLength(2);
    for (const { env, ...server } of guide) {
      expect(server).toEqual(readme);
      expect(Object.keys(env)).toEqual(["GARMIN_PERSONAL_API_KEY"]);
    }
  });
});

describe("README review texts", () => {
  it("says in the README that a ride is compared with the last 20 activities of its name", () => {
    const readme = readFileSync("README.md", "utf8");
    expect(readme).toContain(
      "It compares the ride\nwith your earlier rides of the same name and a similar distance, among the last 20 activities of that\nname before it, because a hillier route changes speed and climbing at the same fitness.",
    );
    expect(readme).toContain(
      "It ends with\nthe sleep and HRV of the night after the ride, and a short coach note.",
    );
  });
});

describe("SECURITY.md", () => {
  it("says in SECURITY.md that the server creates its data files private", () => {
    const security = readFileSync("SECURITY.md", "utf8");
    for (const sentence of [
      "- **Local data**: the data folder has your .FIT files, the dashboard cache and the page, with your\n  health data.",
      "A .FIT file can have your GPS track.",
      "The server creates these files so that only you\n  can read them: mode 600 in folders of mode 700 on macOS and Linux.",
      "A file that exists keeps its\n  mode.",
      "On Windows, the files get the access of their folder.",
      "On macOS and Linux, a new page with\n  the `shared` setting (a page for your coach) gets mode 644, so that other users of the computer can\n  read it, for example through a shared folder or a web server.",
      "A folder that the server makes stays\n  700, so put the page in a folder that others can already open.",
      "To share another page in this way,\n  give it mode 644 yourself.",
      "`.gitignore` excludes `api-key`,\n  `*.fit` and `*.zip` files.",
    ])
      expect(security).toContain(sentence);
  });
});
