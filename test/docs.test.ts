import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LONG_RUN_SHARE_WARN } from "../src/analytics/running";
import { yearSummary } from "../src/analytics/year";
import { CATALOGUE } from "../src/page/catalogue";
import { ABOUT } from "../src/page/catalogue-about";
import { en } from "../src/page/i18n/en";
import { PRESET_BOARDS, preset } from "../src/page/presets";
import { WIDGET_API } from "../src/page/widget-api";

/**
 * The parts of the guide that come from the code. `pnpm guide` writes them; this test fails when they are
 * not current, so the guide never drifts from the widgets and the texts.
 */

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
    ...PRESET_BOARDS.map(
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

const flat = (file: string) => readFileSync(file, "utf8").replace(/\s+/g, " ");

/** A run of March 2025 with a value for each field that the year review reads. */
const marchRun = (day: number) => ({
  id: day,
  name: "Run",
  type: "running",
  sport: "running",
  start: `2025-03-${String(day).padStart(2, "0")} 07:00:00`,
  duration: "1:00:00",
  km: 10,
  trainingLoad: 100,
  best: { "5k": "25:00" },
});

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

  it("says what getYearReview asks, fetches and answers", () => {
    const readme = flat("README.md");
    expect(readme).toContain(
      "| `getYearReview` | the recap of a calendar year from the cache; it asks before it fetches the missing days |",
    );
    const section = readme.slice(
      readme.indexOf("## Year review "),
      readme.indexOf("### year-review prompt "),
    );
    expect(section.replace(/-{3,}/g, "---")).toBe(
      "## Year review `getYearReview` gives the recap of a calendar year in the chat. Ask, for example, " +
        '"give me my year in review". The server reads its local cache. A day that the cache does not have ' +
        "is not a rest day: the answer lists it in `coverage.missing`. " +
        "| Argument | Values | Default | | --- | --- | --- | " +
        "| `year` | a year from 2000 to this year | this year; until 14 January, the year before | " +
        "| `path` | a dashboard page: its sports and excluded data apply | `garmin-dashboard.html` in the data folder | " +
        "A `path` to a page that does not exist is an error. " +
        "When a day of the year before today is missing, the server asks you in a form before it fetches " +
        "the activity list. It asks for at most 20 pages of the list, and it does not fetch HRV and " +
        "resting HR. A page that Garmin refuses can be asked for again. The cache keeps one range of " +
        "days, so the first day in the form can be in an earlier year. When the earlier days would need " +
        "more than about 20 requests, the fetch starts in the year itself. The form then names the earlier " +
        "days that the cache no longer covers after the fetch. " +
        "A dashboard update fetches only the days of the dashboard. It can drop the earlier days that a " +
        "review fetched: after an update of the server that changes the cache, or when the dashboard starts " +
        "more than one day after the last cached day. The next review shows the missing days and asks again. " +
        "A page with the [`yearReview` setting](guide/dashboard.md#page-settings) shows the same recap in " +
        "its Year tab. " +
        "In the answer, `fill.asked` tells what it did: " +
        "| `fill.asked` | What the server did | | --- | --- | " +
        "| `notNeeded` | no day before today is missing: no question and no request | " +
        "| `yes` | you said yes: it fetched the list. If this fails, it saves no activity: `fill.error` tells why | " +
        "| `no` | you said no: no request | " +
        "| `unasked` | your client has no form: no request | " +
        "| `tooLarge` | the days need more than about 20 requests: no question and no request | " +
        "A fetch stops at 20 requests and saves no activities when the days need more. `fill.error` then tells " +
        "if another try asks for fewer days, and the form of that try names the days that it drops. " +
        "After `tooLarge` for a year before this year, review a newer year first, then this one. Each yes " +
        "adds earlier days to the cache, so the next review needs fewer requests. This works only in a client with a form. " +
        "When only today is missing, the server does not ask. A workout that came to Garmin after the last " +
        "update of the cache is then not in the recap, and its day can look like a rest day. `lastDayOpen` " +
        "is true in the answer when the last cached day is in the year: a later workout of that day can be " +
        "missing. For a recap of the current year with all workouts, update the dashboard first, but only " +
        "when no day before today is missing. " +
        "Claude Code shows this form (tested with 2.1.331). The MCP Inspector shows the forms of other tools " +
        "(tested with 2.16.0). The form of this tool in the MCP Inspector: not tested. Claude Desktop shows no " +
        "form (tested with 6.6395.1). ",
    );
    expect(flat("guide/tools.md")).toContain(
      "| `getYearReview` | `/activitylist-service/activities/search/activities`, only after a yes | " +
        "the recap of a calendar year (`year`, default this year; until 14 January, the year before) from " +
        "the cache. When days before today are missing, it asks in a form and fetches the activity list after a yes, " +
        "at most 20 pages. For more pages, review a newer year first, then this one, in a client with a form. It never fetches HRV and resting HR. `path` is the dashboard page whose " +
        "sports and excluded data apply; it must exist. `fill.asked` in the answer: see " +
        "[Year review](../README.md#year-review) |",
    );
    expect(flat("guide/tools.md")).toContain(
      "| `dashboard-cache.json` | the dashboard data of the last calls, and the days that `getYearReview` fetched: an update or a later fetch can drop them |",
    );
    expect(flat("guide/dashboard.md")).toContain(
      "The server leaves the excluded data and sports out of the file, and out of the digest for the " +
        "coach notes. `getYearReview` leaves them out of its answer too. The server cannot remove data " +
        "from the chat.",
    );
    expect(flat("guide/dashboard.md")).toContain(
      "Later updates use the local cache and send about 7. An update fetches only the days of the " +
        "dashboard: it can drop the earlier days of a [year review](../README.md#year-review).",
    );
    expect(flat("guide/troubleshooting.md")).toContain(
      "Wait a few minutes and update again: it does not fetch again what it saved. A failed fetch of " +
        "`getYearReview` saves no activities: the next one starts again. |",
    );
    expect(flat("guide/how-it-works.md")).toContain(
      "The next call asks Garmin only for the days after the last call. It also asks again for the last " +
        "14 days, because Garmin can still add data to them.",
    );
    expect(flat("guide/how-it-works.md")).toContain(
      "`getYearReview` reads the same file, and adds activities to it only after a yes.",
    );
    expect(flat("CONTRIBUTING.md")).toContain(
      "| `src/year-review.ts` | `getYearReview`: the recap of a year from the cache, and its fill |",
    );
  });

  it("says what the yearReview setting adds, and how to fill its missing days", () => {
    const guide = flat("guide/dashboard.md");
    expect(guide).toContain(
      "| `yearReview` | adds the Year tab, with the recap of the calendar year | off |",
    );
    expect(guide).toContain(
      "`yearReview` adds the Year tab, with the recap that `getYearReview` gives: of the year of today, " +
        "and until 14 January of the year before. The week window and the activity names do not change " +
        "the Year tab. Each update, also an automatic one, reads it again from the cache, with no more requests to " +
        "Garmin. An update from 1 to 14 January adds the last days of December to the recap of the year " +
        "that ended. " +
        "When it cannot read it, the page has no recap, and only the log of the server says so. " +
        "A custom widget can read it from `ctx.data.year`. It is off by default, because it holds data of " +
        "days before the period of the page, also on a page that you share. `sports` and `exclude` apply " +
        "to it. The first update from 15 January",
    );
    expect(guide).toContain(
      "A page that you share gets no offer. An update asks Garmin for the activities of the weeks of the page and of as many weeks before " +
        "them, so a 12-week page can lack the first months of the year. The Year tab then says so, and the recap " +
        "lists these days in `coverage.missing`. To add them, ask your assistant for a [year " +
        "review](../README.md#year-review) and say yes in the form, then update the page. A client with " +
        "no form fetches none of them. A review fetches no HRV and no resting HR. An update can drop the " +
        "days that a review fetched: ask for the review again. `since` is for a page",
    );
    const readme = flat("README.md");
    expect(readme).toContain(
      "A page can also keep the sleep and resting HR of the whole period (`recoveryHistory`, off by " +
        "default). The assistant also asks whether to add a Year tab with the recap of the calendar year " +
        "(`yearReview`, off by default). A page that has it keeps it, but a page that you share keeps it " +
        "only when you ask for it. The server writes",
    );
  });

  it("says what to do when `answers` need a page from the template", () => {
    expect(flat("guide/troubleshooting.md")).toContain(
      "| `answers` need a page from the template | The assistant designed this page (`freeform`), so it " +
        "has no Year tab. To have the tab, ask for a new page from the template: `layout` = `preset`. The " +
        "new page keeps its settings. A `freeform` page can use the recap: make a new one with " +
        "`yearReview`. |",
    );
  });

  it("says which settings add the settings block to a freeform page", () => {
    expect(flat("guide/dashboard.md")).toContain(
      "The freeform prompt adds that block when the new page has settings: `workouts`, `recoveryHistory` or `yearReview`, or the settings that it keeps from the page that it replaces.",
    );
    expect(flat("guide/troubleshooting.md")).toContain(
      "or a new `freeform` page with `workouts`, `recoveryHistory` or `yearReview`, or in place of a page whose settings it keeps: both add that block.",
    );
  });

  it("says what the freeform layout asks about the settings of the old page", () => {
    expect(flat("guide/dashboard.md")).toContain(
      "With `freeform`, the assistant asks about the sports and the data that the old page leaves out, when it does. It keeps them left out (the default), or uses all sports and all data.",
    );
  });

  it("says how an existing page gets the Year tab", () => {
    const guide = flat("guide/dashboard.md");
    expect(guide.slice(guide.indexOf("## Page settings"))).toContain(
      "A page that has no answer about the Year tab gets the offer one time: `training-dashboard-update` " +
        "asks, and saves the answer. The other settings of the page stay as they are. The automatic refresh and `refresh` ask nothing and do not add the " +
        'tab. You can also ask your assistant, in your own words, for example "add the Year tab to my ' +
        'dashboard and keep its other settings". The layout, the widgets and the languages of the page ' +
        "stay, and the page from before is the `.bak` file. On a page that started with empty boards, " +
        "the Year tab is empty: add its widgets with **Edit layout**. A page that you share gets no offer.",
    );
    const readme = flat("README.md");
    const update = readme.indexOf("### training-dashboard-update");
    expect(readme.slice(update, readme.indexOf("### ", update + 4))).toContain(
      "When the page has no answer about the Year tab, the assistant asks one time whether to add it. " +
        "The default is no. See [Page settings](guide/dashboard.md#page-settings).",
    );
    expect(flat("guide/tools.md")).toContain(
      "the year review and the start day (`since`: the page starts in the week of that day and grows by " +
        "one week at each update, up to 52) of the page; `offers` in the result lists the settings that " +
        "the page has no answer for (`yearReview`); `answers` saves `true` or `false` and keeps the other " +
        "settings, and the answer ends the offer; `preview`",
    );
  });

  // All is the first tab: the text above the table names it
  it.each(PRESET_BOARDS.filter((b) => b !== "all"))("lists the board key %s", (board) => {
    const guide = readFileSync("guide/dashboard.md", "utf8");
    const table = guide.slice(guide.indexOf("| Board key "), guide.indexOf("Two Garmin types"));
    expect(table).toMatch(new RegExp(`^\\| [^|]+ \\| \`${board}\` +\\|`, "m"));
  });

  it("says what happens to an excluded name that the server does not know", () => {
    expect(flat("guide/dashboard.md")).toContain(
      "A page can have a name in `exclude` that your version of the server does not know, for example " +
        "from a newer version. Your version cannot leave out the data of that name: the data is in the " +
        "file until a version that knows the name writes the page. New settings that have `exclude`, " +
        "also as an empty list, keep the name when the settings block is valid JSON. Settings without " +
        "`exclude` remove it, and they also put all the excluded data back in the page. To remove only " +
        "that name, edit `exclude` in the `garmin-settings` block of the file. The file holds only",
    );
  });

  it("tells when the Year tab is there", () => {
    expect(flat("guide/dashboard.md")).toContain(
      "The All and Recovery tabs are always there. The Year tab shows with the `yearReview` setting. It " +
        "has the totals of the calendar year, each month, the sports, the weekdays and times, the " +
        "highlights, the longest streaks, the records of the runs, and HRV and resting HR by month. A " +
        "sport tab shows only when",
    );
    expect(flat("README.md")).toContain(
      "The assistant also asks whether to add a Year tab. The default is no. A yes adds a board with " +
        "the recap of the calendar year, and the file then holds data of days before the period of the " +
        "page. See [Page settings](guide/dashboard.md#page-settings).",
    );
  });

  it("names what a reset leaves out in the dashboard guide", () => {
    expect(readFileSync("guide/dashboard.md", "utf8").replace(/\s+/g, " ")).toContain(
      "It also tells you that a reset adds that data to the page again. Keep the settings (the default), " +
        "or reset them. After a reset, the page has all sports, all data, all themes, and English and the " +
        "language of your Garmin profile. It opens in midnight. It has no workout comparison, no Recovery " +
        'trend and no recap of the calendar year. A reply such as "use the defaults" does not reset: it ' +
        "keeps the settings. You can also type your own choice",
    );
  });

  it("gives the fields of the year review in the widget reference, with its condition", () => {
    const line =
      "- ctx.data.year: the recap of the calendar year, the year object of the getYearReview answer. It " +
      "is there only on a page with the setting yearReview. A null value is n/a. Fields: v (the version " +
      "of this shape), year, from, to, coverage { activities: { from, to }, missing: [{ from, to }], " +
      'complete, hrv, rhr }, measure ("load" or "hours": what biggestMonth, biggestWeek and bestBlock ' +
      "compare), totals { activities, activeDays, km, hours, ascentM, calories, load, estimatedLoads, " +
      "unlikelyTimes }, sports: [{ sport, sessions, km, hours, load }], topSport, months: [{ month " +
      '("yyyy-MM"), covered ("all", "part" or "none"), days (that the cache holds), activeDays, ' +
      "sessions, km, hours, load }], biggestMonth { month, km, hours, load }, biggestWeek { monday, km, " +
      "hours, load }, bestBlock { from, to, value, sessions }, mostConsistentMonth { month, activeDays, " +
      "days (that the cache holds), sharePct }, streaks { days, weeks } (each { from, to, length }), " +
      "longest { date, id, name, sport, hours, km }, biggest { date, id, name, sport, load, estimate }, " +
      'records (by distance, such as "5k": [{ date, id, name, time, previous }], oldest first), rhythm ' +
      "{ weekdays (7 counts, Monday first), topWeekday (0 is Monday), timeOfDay { night, morning, " +
      "afternoon, evening }, topTimeOfDay }, hrv: [{ month, mean, nights }], rhr: [{ month, mean, days " +
      "}]. hrv, rhr, id and name can be absent.";
    expect(WIDGET_API).toContain(`\n${line}\n`);
    expect(readFileSync("guide/custom-widgets.md", "utf8")).toContain(line);
  });

  it("names each field of a whole year review in the widget reference, and no other at the top", () => {
    const all = { from: "2025-01-01", to: "2025-12-31" };
    const days = Array.from({ length: 31 }, (_, i) => i + 1);
    const month = days.map((d) => `2025-03-${String(d).padStart(2, "0")}`);
    const year = yearSummary(
      {
        activities: days.map(marchRun),
        hrv: month.map((date) => ({ date, hrv: 60 })),
        recovery: month.map((date) => ({ date, rhr: 50 })),
        coverage: { activities: { ...all, from: "2025-02-01" }, hrv: all, rhr: all },
      },
      2025,
      "2026-11-23",
    );
    const line = /\n- ctx\.data\.year: (.*)\n/.exec(WIDGET_API)?.[1] ?? "";
    const fields = line.slice(line.indexOf("Fields: ") + 8, line.indexOf(". hrv, rhr, id"));
    const keys = new Set<string>();
    const nulls: string[] = [];
    JSON.stringify(year, (key, v: unknown) => {
      // an index of a list and a distance are no field names
      if (key !== "" && !/^\d/.test(key)) keys.add(key);
      if (v === null) nulls.push(key);
      return v;
    });
    expect([...keys].filter((k) => !new RegExp(`\\b${k}\\b`).test(fields))).toEqual([]);
    // no block is null here, so the walk above reads the fields of each one
    const blocks = ["biggestMonth", "biggestWeek", "bestBlock", "mostConsistentMonth", "longest"];
    expect(nulls.filter((k) => [...blocks, "biggest", "days", "weeks"].includes(k))).toEqual([]);
    let rest = fields.replace(/\([^()]*\)/g, "");
    while (/[{[][^{}[\]]*[}\]]/.test(rest)) rest = rest.replace(/[{[][^{}[\]]*[}\]]/g, "");
    expect(rest.split(",").map((f) => f.replace(":", "").trim())).toEqual(Object.keys(year));
  });

  it("says that a writeDashboard preview writes no page file", () => {
    expect(readFileSync("guide/tools.md", "utf8")).toContain(
      "`settings` set the title, the sports, the data, the languages, the themes, the workout comparison, the recovery history, the year review and the start day (`since`: the page starts in the week of that day and grows by one week at each update, up to 52) of the page; `offers` in the result lists the settings that the page has no answer for (`yearReview`); `answers` saves `true` or `false` and keeps the other settings, and the answer ends the offer; `preview` writes no page file (it updates the data cache, as `getDashboardData` does) and gives the activities of each board, the settings of the page, and whether the page is from the template or designed by the assistant (`pageFrom`).",
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

  it("documents the year-review prompt and its arguments in the README", () => {
    const readme = flat("README.md");
    expect(readme).toContain(
      "| [year-review](#year-review-prompt) | gives the recap of a calendar year | `/mcp__garmin-personal__year-review 2025` |",
    );
    expect(readme).toContain(
      "a review of the week or of the calendar year, a readiness check before a race or a swim event,",
    );
    expect(
      readme.slice(
        readme.indexOf("### year-review prompt "),
        readme.indexOf("## Coach prompts These"),
      ),
    ).toBe(
      "### year-review prompt " +
        "The assistant calls `getYearReview` and gives the year in a fixed order: the totals, the sports, the " +
        "months, the biggest month and week, the best 4 weeks, the most consistent month, the streaks, the " +
        "longest and the biggest session, the new bests of each running distance, the weekdays and the time " +
        "of day, and the HRV and the resting HR of each month. When days are missing, the answer names the " +
        'days that the recap covers, and the other days are "n/a". It says why nothing was fetched, and it ' +
        "offers no other fetch. When `unlikelyTimes` is above 0, it says how many sessions have a time that " +
        "is not likely (over 12 h at under 1 km/h). This time and a load estimate from it do not count. " +
        "The argument `year` is optional: the calendar year, 2000 to this year. The default is this year, and " +
        "until 14 January the year before. A value under 2000 gives 2000, a value over this year gives this " +
        "year. " +
        "The argument `path` is optional: the dashboard page whose sports and excluded data apply, for " +
        "example `/mcp__garmin-personal__year-review 2025 garmin-dashboard-coach.html`. The default page " +
        "applies without it. The name of a page alone, or before the year, works too. Text that is not a year " +
        "is read as the page. When this page does not exist or is not a `.html` file, the answer names it, " +
        "says what the prompt takes, and asks you to correct it. It gives no review before that, so a " +
        "mistyped name does not show the data that the page excludes. After a year, Claude Code cuts a page " +
        "name at its first space: name such a page in the chat. ",
    );
  });

  it("says when an update replaces the recap of a year, and how to keep it", () => {
    expect(flat("guide/dashboard.md")).toContain(
      "The first update from 15 January replaces the recap of the year that ended with the recap of the " +
        "new year. An update that changes only the data makes no `.bak` file. To keep the recap, update " +
        "the page from 1 to 14 January, and then copy the file to another name. Do not update the copy. " +
        "It keeps the recap on any later day, and an automatic refresh does not change it, because it " +
        "updates only the pages that you give it. ",
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
