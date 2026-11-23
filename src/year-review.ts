import type { CallToolResult, InputRequiredResult, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { Activity } from "./analytics/calc";
import { type YearSummary, yearSummary } from "./analytics/year";
import { confirm } from "./confirm";
import { type CachedRows, FILL_CAP, type FillResult, type GarminDashboard } from "./dashboard";
import { type DashboardWriter, filterData } from "./dashboard-page";
import { FIRST_YEAR, localToday, reviewYear } from "./dates";
import type { Settings } from "./page/settings";
import { isObject, MODEL_ONLY } from "./tools";

const thisYear = () => Number(localToday().slice(0, 4));
const yearError = () => `Give a whole year from ${FIRST_YEAR} to ${thisYear()}`;

/** What the tool did for the missing days. */
interface Fill extends FillResult {
  readonly asked: "notNeeded" | "tooLarge" | "yes" | "no" | "unasked";
  /** About how many requests the missing days need. */
  readonly estimate: number;
}

// no field of a row is sure in a cache file: yearSummary checks each one that it reads
const isRow = (v: unknown): v is Activity & Record<string, unknown> => isObject(v);
const rowsOf = (v: unknown) => (Array.isArray(v) ? v.filter(isRow) : []);

/** The recap of a year from the cached rows, without what the page settings leave out. */
export function yearOf(
  cached: CachedRows,
  settings: Settings,
  year: number,
  today: string,
): YearSummary {
  const { activities, hrv, recovery, zones, coverage } = cached;
  const kept = filterData({ activities, hrv, recovery, zones }, settings);
  return yearSummary(
    {
      activities: rowsOf(kept.activities),
      hrv: rowsOf(kept.hrv),
      recovery: rowsOf(kept.recovery),
      zones: kept.zones,
      coverage,
    },
    year,
    today,
  );
}

/** The recap that a page with these settings shows: the default year of getYearReview, with no Garmin call. */
export async function pageYear(
  dashboard: Pick<GarminDashboard, "readCached">,
  settings: Settings,
): Promise<YearSummary> {
  const today = localToday();
  const year = reviewYear(today);
  return yearOf(await dashboard.readCached(`${year}-01-01`, today), settings, year, today);
}

/** Registers getYearReview. */
export function registerYearReview(
  server: McpServer,
  dashboard: GarminDashboard,
  writer: DashboardWriter,
): void {
  server.registerTool(
    "getYearReview",
    {
      _meta: MODEL_ONLY,
      description: [
        "The recap of a calendar year from the local cache: totals (sessions, active days, km, hours,",
        "ascent in metres, calories, load), sports, months, the biggest month and week, the best 4 weeks,",
        "the most consistent month, streaks, the longest and the biggest session, the progression of the",
        "best efforts, weekdays, time of day, and HRV and resting HR by month. Use it for a year in review;",
        "for the last weeks, use `getDashboardData`. `year.coverage.missing` lists the days that the cache",
        "does not have. With a day before today in it, the tool asks the user first, in a form, and only",
        "after a yes it fetches the activity list of these days, and of other days that the cache needs",
        "(no HRV, no resting HR). `fill.asked` says what came of it: notNeeded (no day before today is",
        "missing), yes, no, unasked (this client has no form), or tooLarge (about `estimate` requests, over",
        `${FILL_CAP}: for a year before this year, say to review a newer year first, then this one,`,
        "which works only in a client with a form). Only yes fetches; `fill.error` says why a fetch failed.",
        "With `lastDayOpen` true, the last cached day, `year.coverage.activities.to`, can lack",
        "sessions that came after that day's update: say so. When `fill.asked` is notNeeded and the year",
        "is the year of today, say also that a dashboard update adds them.",
        "null is n/a, never 0.",
      ].join("\n"),
      inputSchema: z.object({
        year: z
          .number({ error: yearError })
          .int()
          .min(FIRST_YEAR)
          .refine((y) => y <= thisYear())
          .describe(
            `Calendar year, ${FIRST_YEAR} to this year; default this year (the year before until 14 January)`,
          )
          .optional(),
        path: z
          .string()
          .describe(
            "The dashboard page whose sports and excluded data apply; it must exist; relative paths are inside the data dir; default: the page garmin-dashboard.html, when there is one",
          )
          .optional(),
      }),
    },
    async function review(a, ctx): Promise<CallToolResult | InputRequiredResult> {
      const today = localToday();
      const year = a.year ?? reviewYear(today);
      // to today, also for an earlier year: the cache keeps one range, with no hole in it
      const from = `${year}-01-01`;
      const settings = await writer.settings(a.path);
      const cached = await dashboard.readCached(from, today);
      const reply = (asked: Fill["asked"], estimate: number, rows = cached, done?: FillResult) => {
        const fill: Fill = { asked, estimate, garminCalls: 0, ...done };
        const recap = yearOf(rows, settings, year, today);
        // the rows go to today: the same end means that the cache has no day after the year
        const last = recap.coverage.activities?.to;
        const lastDayOpen = last !== undefined && last === rows.coverage.activities?.to;
        const { sports, exclude } = settings;
        const out = { year: recap, fill, lastDayOpen, settings: { sports, exclude } };
        return { content: [{ type: "text" as const, text: JSON.stringify(out) }] };
      };
      const { missing } = yearOf(cached, settings, year, today).coverage;
      // today alone is missing on most days of the year in progress: no reason to ask each time
      if (missing.every((r) => r.from === today)) return reply("notNeeded", 0);
      const estimate = cached.fillRequests;
      if (estimate > FILL_CAP) return reply("tooLarge", estimate);
      const drops = cached.fillDrops
        ? ` The cache then no longer covers ${cached.fillDrops.from} to ${cached.fillDrops.to}: a review of those days must fetch them again.`
        : "";
      const question = `Fetch the activity list from Garmin for ${cached.fillStart} to ${today}, about ${estimate} request${estimate === 1 ? "" : "s"}?${drops} HRV and resting HR are not fetched. Confirm?`;
      // the question is the key: a yes to another question is no answer to this one, so a cache that
      // changed while the form was open makes a new form
      const c = confirm(server, ctx, question, question);
      if ("ask" in c) return c.ask;
      // the other tools do on "unasked" what the user told them to do: here the user asked for a
      // recap, not for a fetch that can use a fifth of Garmin's request limit
      if (c.answer !== "yes") return reply(c.answer, estimate);
      const done = await dashboard.fillActivities(from, today, cached);
      // the cache changed since the yes: the days can be there now, or the form must show the new fetch
      if (!done) return review(a, ctx);
      return reply("yes", estimate, await dashboard.readCached(from, today), done);
    },
  );
}
