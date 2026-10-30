import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { type GarminApiClient, GarminApiError } from "./api-client";
import { addDays, localToday } from "./dates";
import { digest } from "./digest";
import { log } from "./log";
import { workoutOf } from "./page/running";
import { type GarminTools, firstArray, summarize, writeAtomically } from "./tools";

type Json = Record<string, unknown>;
/** An inclusive date range, yyyy-MM-dd. */
type Range = [string, string];

const DEFAULT_WEEKS = 12;
const MAX_WEEKS = 52;
const RECOVERY_DAYS = 14;
/** The newest sessions of each repeated run name whose laps are downloaded, for the workout trend. */
export const WORKOUT_SESSIONS = 8;

/** The weeks that getDashboardData covers for an asked number: 12 by default, 1 to 52. */
export const weeksCovered = (weeks: number | undefined): number =>
  weeks == null ? DEFAULT_WEEKS : Math.min(Math.max(weeks, 1), MAX_WEEKS);
/** The last days of a cached range are fetched again: Garmin can still add activities or finish a night's data. */
const REFRESH_DAYS = 2;
const PAGE = 200;

/** What one getDashboardData call counts. */
interface Sync {
  calls: number;
  failedDates: string[];
  failedSections: string[];
}

/**
 * All the data of the training dashboard in one call, with a local cache in `<data-dir>/dashboard-cache.json`
 * (keep its format: other servers on the same data dir read it): each call fetches from Garmin only the days
 * it does not have yet, plus the last two days, which can still change.
 */
export class GarminDashboard {
  /** Calls run one at a time, so the cache file has one writer. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly tools: GarminTools,
    private readonly api: GarminApiClient,
    private readonly dataDir: string,
  ) {}

  /** `workouts` adds the laps of the last sessions of each repeated run name, for the workout trend. */
  getDashboardData(weeks?: number, workouts = false): Promise<string> {
    const run = this.#queue.then(() => this.#build(weeks, workouts));
    this.#queue = run.catch(() => {});
    return run;
  }

  async #build(weeks: number | undefined, workouts: boolean): Promise<string> {
    const w = weeksCovered(weeks);
    const today = localToday();
    const start = addDays(today, -7 * w);
    // one extra week before: the dashboard shows whole Monday-Sunday weeks
    const prevStart = addDays(start, -7 * (w + 1));
    const sync: Sync = { calls: 0, failedDates: [], failedSections: [] };

    const cache = await this.load();
    const before = new Set(Object.keys(objectAt(cache, "activities")));
    await this.#syncActivities(cache, prevStart, today, sync);
    await this.#syncHrv(cache, start, today, sync);
    await this.#syncRecovery(cache, addDays(today, -(RECOVERY_DAYS - 1)), today, sync);
    cache.syncedAt = new Date().toISOString();
    await writeAtomically(this.#file(), JSON.stringify(cache));

    const [zones, fitnessAge, settings] = await Promise.all([
      optional(sync, "zones", () => this.tools.getHeartRateZones()),
      optional(sync, "fitnessAge", () => this.tools.getFitnessAge(today)),
      optional(sync, "units", () => this.api.getJson("/userprofile-service/userprofile/settings")),
    ]);
    // Garmin answers in metric whatever this setting says: it only tells the page what to show
    const units = isObject(settings) ? settings.measurementSystem : undefined;
    // Garmin writes a locale as pt_BR; the page keeps the built-in language that matches it
    const locale = isObject(settings) ? String(settings.preferredLocale).replace("_", "-") : "";
    const out: Json = {
      generated: today,
      weeks: w,
      start,
      end: today,
      prevStart,
      prevEnd: addDays(start, -1),
      zones,
      fitnessAge,
      ...(typeof units === "string" && UNITS.includes(units) ? { units } : {}),
      ...(/^[a-z]{2,3}(-[A-Z]{2})?$/.test(locale) ? { locale } : {}),
    };
    const cached = Object.keys(objectAt(cache, "activities"));
    // the small parts first: a reader that stops early still sees them
    const synced: Json = {
      garminCalls: sync.calls, // the .FIT downloads are in fitDownloads
      fitDownloads: 0,
      newActivities: cached.filter((id) => !before.has(id)).length,
      failedDays: sync.failedDates.length,
      failedDates: sync.failedDates,
      failedSections: sync.failedSections,
      cachedActivities: cached.length,
    };
    out.sync = synced;
    out.hrv = between(objectAt(cache, "hrv"), start, today);
    out.recovery = between(
      objectAt(cache, "recovery"),
      addDays(today, -(RECOVERY_DAYS - 1)),
      today,
    );
    const activities = activitiesBetween(cache, start, today).map((a) => structuredClone(a));
    synced.fitDownloads = await this.#attachDetails(activities, workouts);
    out.activities = activities;
    out.previousActivities = activitiesBetween(cache, prevStart, addDays(start, -1)).map(compact);
    return jsonByLines(out);
  }

  // ------------------------------------------------------------------ sync

  async #syncActivities(cache: Json, from: string, to: string, sync: Sync): Promise<void> {
    const byId = objectAt(cache, "activities");
    // rows written before the sport field, or by another server: fetch the activities again.
    // shortcut: a row that Garmin sends without sportTypeId repeats this on every call; mark rows if that happens
    if (
      Object.values(byId).some((a) => isObject(a) && a.type !== undefined && a.sport === undefined)
    ) {
      for (const id of Object.keys(byId)) delete byId[id];
      delete cache.activitiesFrom;
      delete cache.activitiesTo;
    }
    const cachedFrom = date(cache.activitiesFrom);
    const cachedTo = date(cache.activitiesTo);
    for (const [rFrom, rTo] of toFetch(cachedFrom, cachedTo, from, to)) {
      // refetched days replace what the cache has, so a deleted or edited activity disappears too
      for (const [id, a] of Object.entries(byId)) {
        const d = dayOf(a);
        if (d !== undefined && d >= rFrom && d <= rTo) {
          delete byId[id];
        }
      }
      for (let page = 0; ; page += PAGE) {
        sync.calls++;
        const json = await this.api.getJson("/activitylist-service/activities/search/activities", {
          start: String(page),
          limit: String(PAGE),
          startDate: rFrom,
          endDate: rTo,
        });
        const list = Array.isArray(json) ? json : firstArray(json);
        if (!list) {
          // abort before the cache is saved: the days of this range are already removed from it
          throw new GarminApiError(
            `Unexpected activity list response: ${JSON.stringify(json).slice(0, 200)}`,
          );
        }
        for (const a of list) {
          const activity = isObject(a) ? a : {};
          byId[asString(activity.activityId)] = summarize(activity);
        }
        if (list.length < PAGE) {
          break;
        }
      }
    }
    setCovered(cache, "activitiesFrom", "activitiesTo", covered(cachedFrom, cachedTo, from, to));
  }

  async #syncHrv(cache: Json, from: string, to: string, sync: Sync): Promise<void> {
    const byDate = objectAt(cache, "hrv");
    const cachedFrom = date(cache.hrvFrom);
    const cachedTo = date(cache.hrvTo);
    let failed = false;
    for (const [rFrom, rTo] of toFetch(cachedFrom, cachedTo, from, to)) {
      // Garmin may reject long ranges: ask 4 weeks at a time
      for (let a = rFrom; a <= rTo; a = addDays(a, 28)) {
        const end = addDays(a, 27) > rTo ? rTo : addDays(a, 27);
        const path = `/hrv-service/hrv/daily/${a}/${end}`;
        const json = await optional(sync, "hrv", () => this.api.getJson(path, {}));
        if (json === null) {
          failed = true;
          continue;
        }
        const summaries = field(json, "hrvSummaries");
        for (const h of Array.isArray(summaries) ? summaries : []) {
          const day = date(field(h, "calendarDate"));
          if (day === undefined) {
            continue;
          }
          const o: Json = { date: day };
          copy(h, o, "lastNightAvg", "hrv");
          copy(h, o, "weeklyAvg", "weeklyAvg");
          copy(h, o, "status", "status");
          copy(field(h, "baseline"), o, "balancedLow", "low");
          copy(field(h, "baseline"), o, "balancedUpper", "high");
          byDate[day] = o;
        }
      }
    }
    // a failed range stays uncovered: it is fetched again next time
    if (!failed) setCovered(cache, "hrvFrom", "hrvTo", covered(cachedFrom, cachedTo, from, to));
  }

  async #syncRecovery(cache: Json, from: string, to: string, sync: Sync): Promise<void> {
    const byDate = objectAt(cache, "recovery");
    const refreshFrom = recoveryRefreshFrom(date(cache.recoveryTo), to);
    let stale: string | undefined;
    for (let day = from; day <= to; day = addDays(day, 1)) {
      if (day in byDate && day < refreshFrom) {
        continue;
      }
      try {
        const [sleep, summary] = await Promise.all([
          call(sync, () => this.tools.getSleep(day)),
          call(sync, () => this.tools.getDailySummary(day)),
        ]);
        byDate[day] = recoveryRow(day, sleep, summary);
      } catch (e) {
        if (!(e instanceof GarminApiError)) throw e;
        // the old row stays; recoveryTo stops at this day, so the next call fetches it again
        if (day in byDate) stale ??= day;
        sync.failedDates.push(day);
        log("WARN", `Recovery data of ${day} not fetched: ${e.message}`);
      }
    }
    cache.recoveryTo = stale ?? to;
    // the cache keeps only what a dashboard can show
    const keepFrom = addDays(from, -RECOVERY_DAYS);
    for (const day of Object.keys(byDate)) {
      // a key that is not a date is dropped too
      if (date(day) === undefined || day < keepFrom) {
        delete byDate[day];
      }
    }
  }

  // ------------------------------------------------------------------ output

  /**
   * Strength sets for every strength session (30 most recent); laps for the 3 most recent activities,
   * races and runs over 15 km. With `workouts`, also the laps of the runs of each name that repeats (the
   * sessions of a plan, compared across weeks): the newest WORKOUT_SESSIONS, downloaded when needed, and
   * every older one whose .FIT file is saved, which costs no download.
   */
  async #attachDetails(acts: Json[], workouts: boolean): Promise<number> {
    const isRun = (a: Json) => typeof a.type === "string" && a.type.endsWith("running");
    // runs of one workout share it, whatever place Garmin puts in their name
    const workout = (a: Json) => (typeof a.name === "string" ? workoutOf(a.name) : undefined);
    const runNames = new Map<unknown, number>();
    for (const a of acts.filter(isRun))
      runNames.set(workout(a), (runNames.get(workout(a)) ?? 0) + 1);
    // the activities come most recent first
    const lapped = new Map<unknown, number>();
    let strength = 0;
    let downloads = 0;
    // the sets and the laps of an activity come from one .FIT file: count it once, when it is not saved
    const fit = async <T>(id: number, read: (id: number) => Promise<T>): Promise<T> => {
      if (!(await this.tools.hasFit(id))) downloads++;
      return read(id);
    };
    for (const [i, a] of acts.entries()) {
      const id = asLong(a.id);
      const type = typeof a.type === "string" ? a.type : "";
      try {
        if (type.includes("strength") && strength++ < 30) {
          a.exercises = JSON.parse(await fit(id, (n) => this.tools.getActivitySets(n))).exercises;
        }
        const longRun = isRun(a) && typeof a.km === "number" && a.km > 15;
        let repeated = false;
        const w = workout(a);
        if (workouts && isRun(a) && w !== undefined && runNames.get(w)! > 1) {
          const newer = lapped.get(w) ?? 0;
          lapped.set(w, newer + 1);
          repeated = newer < WORKOUT_SESSIONS || (await this.tools.hasFit(id));
        }
        if (i < 3 || a.race === true || longRun || repeated) {
          const laps = JSON.parse(await fit(id, (n) => this.tools.getActivityLaps(n))).laps;
          // a file without laps (a strength session) gives none, not an empty list
          if (Array.isArray(laps) && laps.length > 0) a.laps = laps;
        }
      } catch (e) {
        a.detailError = (e as Error).message;
      }
    }
    return downloads;
  }

  // ------------------------------------------------------------------ cache file

  #file(): string {
    return join(this.dataDir, "dashboard-cache.json");
  }

  /** The cache, or an empty one when the file is missing, unreadable or has the wrong shape. */
  async load(): Promise<Json> {
    try {
      if ((await stat(this.#file()).catch(() => undefined))?.isFile()) {
        const o: unknown = JSON.parse(await readFile(this.#file(), "utf8"));
        if (
          isObject(o) &&
          ["activities", "hrv", "recovery"].every((f) => o[f] === undefined || isObject(o[f]))
        ) {
          return o;
        }
      }
    } catch (e) {
      log("WARN", `Dashboard cache unreadable, starting again: ${(e as Error).message}`);
    }
    return {};
  }
}

// ------------------------------------------------------------------ date ranges

/**
 * Date ranges to fetch so the cache covers [from, to]: the part before the cached range, and from
 * the last REFRESH_DAYS cached days to `to`. An empty cache fetches all of [from, to].
 */
export function toFetch(
  cachedFrom: string | undefined,
  cachedTo: string | undefined,
  from: string,
  to: string,
): Range[] {
  if (cachedFrom === undefined || cachedTo === undefined || cachedTo < from || cachedFrom > to) {
    return [[from, to]];
  }
  const out: Range[] = [];
  if (from < cachedFrom) {
    out.push([from, addDays(cachedFrom, -1)]);
  }
  let tail = addDays(cachedTo, -(REFRESH_DAYS - 1));
  if (tail < from) {
    tail = from;
  }
  if (tail <= to) {
    out.push([tail, to]);
  }
  return out;
}

/**
 * The range that the cache covers after fetching toFetch's ranges: the union when the old and the
 * new range touch or overlap, else only [from, to], because the days between them were never fetched.
 */
export function covered(
  cachedFrom: string | undefined,
  cachedTo: string | undefined,
  from: string,
  to: string,
): Range {
  if (
    cachedFrom === undefined ||
    cachedTo === undefined ||
    addDays(cachedTo, 1) < from ||
    cachedFrom > addDays(to, 1)
  ) {
    return [from, to];
  }
  return [cachedFrom < from ? cachedFrom : from, cachedTo > to ? cachedTo : to];
}

/** Recovery rows from the last REFRESH_DAYS days before the last sync on are fetched again. */
export function recoveryRefreshFrom(lastSync: string | undefined, today: string): string {
  const last = lastSync === undefined || lastSync > today ? today : lastSync;
  return addDays(last, -(REFRESH_DAYS - 1));
}

/** One compact row per day: sleep, sleep need, bedtime, resting HR, body battery, stress, steps. */
export function recoveryRow(day: string, sleep: unknown, summary: unknown): Json {
  const r: Json = { date: day };
  hours(sleep, r, "sleepTimeSeconds", "sleepH");
  hours(sleep, r, "deepSleepSeconds", "deep");
  hours(sleep, r, "lightSleepSeconds", "light");
  hours(sleep, r, "remSleepSeconds", "rem");
  hours(sleep, r, "awakeSleepSeconds", "awake");
  copy(field(field(sleep, "sleepScores"), "overall"), r, "value", "sleepScore");
  const need = field(field(sleep, "sleepNeed"), "actual");
  if (typeof need === "number") {
    r.needH = round2(need / 60);
  }
  const bed = field(sleep, "sleepStartTimestampLocal");
  if (typeof bed === "number") {
    // the *Local timestamp is local wall time encoded as epoch ms: read it as UTC
    const t = new Date(Math.trunc(bed));
    r.bedMin = t.getUTCHours() * 60 + t.getUTCMinutes();
  }
  copy(summary, r, "restingHeartRate", "rhr");
  copy(summary, r, "bodyBatteryHighestValue", "bbHigh");
  copy(summary, r, "bodyBatteryLowestValue", "bbLow");
  copy(summary, r, "averageStressLevel", "stress");
  copy(summary, r, "totalSteps", "steps");
  copy(summary, r, "dailyStepGoal", "stepGoal");
  const floors = field(summary, "floorsAscended");
  if (typeof floors === "number") {
    r.floors = Math.round(floors);
  }
  return r;
}

// ------------------------------------------------------------------ helpers

/** Counts the Garmin call and parses a tool's JSON string. */
async function call(sync: Sync, f: () => Promise<unknown>): Promise<unknown> {
  sync.calls++;
  const r = await f();
  return typeof r === "string" ? JSON.parse(r) : r;
}

/** A section the dashboard can do without: a Garmin error gives null and is reported in sync. */
async function optional(sync: Sync, section: string, f: () => Promise<unknown>): Promise<unknown> {
  try {
    return await call(sync, f);
  } catch (e) {
    if (!(e instanceof GarminApiError)) throw e;
    if (!sync.failedSections.includes(section)) sync.failedSections.push(section);
    log("WARN", `${section} not fetched: ${e.message}`);
    return null;
  }
}

/** Most recent first, as listActivities returns them. */
function activitiesBetween(cache: Json, from: string, to: string): Json[] {
  return Object.values(objectAt(cache, "activities"))
    .filter((a): a is Json => {
      const d = dayOf(a);
      return d !== undefined && d >= from && d <= to;
    })
    .toSorted((a, b) => {
      const x = typeof a.start === "string" ? a.start : "";
      const y = typeof b.start === "string" ? b.start : "";
      return x < y ? 1 : x > y ? -1 : 0;
    });
}

/** The fields the period comparison needs. */
function compact(a: Json): Json {
  const o: Json = {};
  for (const f of ["id", "start", "type", "km", "duration", "elapsed", "trainingLoad"]) {
    copy(a, o, f, f);
  }
  return o;
}

function between(byDate: Json, from: string, to: string): unknown[] {
  const out: unknown[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (d in byDate) {
      out.push(byDate[d]);
    }
  }
  return out;
}

/** The object at `key`, created when missing. */
function objectAt(o: Json, key: string): Json {
  if (!isObject(o[key])) {
    o[key] = {};
  }
  return o[key] as Json;
}

function setCovered(cache: Json, fromField: string, toField: string, [from, to]: Range): void {
  cache[fromField] = from;
  cache[toField] = to;
}

function dayOf(a: unknown): string | undefined {
  const s = field(a, "start");
  return typeof s === "string" && s.length >= 10 ? date(s.slice(0, 10)) : undefined;
}

/** A yyyy-MM-dd date; undefined when missing or not a real date, so the range is fetched again. */
function date(v: unknown): string | undefined {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(v) ? v : undefined;
}

function copy(from: unknown, to: Json, name: string, as: string): void {
  const v = field(from, name);
  if (v !== undefined && v !== null) {
    to[as] = v;
  }
}

function hours(from: unknown, to: Json, name: string, as: string): void {
  const v = field(from, name);
  if (typeof v === "number") {
    to[as] = round2(v / 3600);
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function field(v: unknown, name: string): unknown {
  return isObject(v) ? v[name] : undefined;
}

/** Text, or a number as text; "" for anything else. */
function asString(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

/** A number without decimals, or text of digits; 0 otherwise. */
function asLong(v: unknown): number {
  if (typeof v === "number") return Math.trunc(v);
  return typeof v === "string" && /^[+-]?\d+$/.test(v) ? Number(v) : 0;
}

/** One key and one list row on each line, so a reader that pages by lines can read it all. */
export function jsonByLines(out: Json): string {
  const entries = Object.entries(out).filter(([, v]) => v !== undefined);
  return `{\n${entries.map(keyLine).join(",\n")}\n}`;
}

function keyLine([k, v]: [string, unknown]): string {
  return Array.isArray(v) && v.length > 0
    ? `${JSON.stringify(k)}:[\n${v.map((x) => JSON.stringify(x)).join(",\n")}\n]`
    : `${JSON.stringify(k)}:${JSON.stringify(v)}`;
}

// ------------------------------------------------------------------ MCP registration

/** The measurement systems of a Garmin profile. */
const UNITS = ["metric", "statute_us", "statute_uk"];

/** Registers getDashboardData. */
export function registerDashboard(server: McpServer, dashboard: GarminDashboard): void {
  server.registerTool(
    "getDashboardData",
    {
      description: [
        "All the data of the training dashboard in one call: HR zones, fitness age, the activities of the",
        "last `weeks` weeks (compact summaries, with strength sets and laps where they apply), the activities",
        "of the weeks before for the period comparison, daily HRV, and the last 14 days of sleep and daily",
        "summaries, and `units`: the measurement system of the Garmin profile (metric, statute_us or",
        "statute_uk) that the page shows; the data itself is always metric; `locale`: the language of",
        "the Garmin profile, e.g. it or pt-BR. Keeps a local cache and",
        "fetches from Garmin only what is new since the last call, so a rebuild or an update needs few",
        "calls. `sync` in the result says what was fetched: Garmin calls, .FIT files downloaded",
        "(fitDownloads) and new activities.",
        "`digest`, first in the result: the server's totals for the whole period and for each",
        "Monday-Sunday week (sessions, km, hours, load), the training load of the last 7 and 28 days,",
        "best efforts, races and strength top sets; quote them instead of your own sums. For another",
        "date range, use the activities: each one is on its own line.",
      ].join("\n"),
      inputSchema: z.object({
        weeks: z.number().int().describe("Weeks to cover, default 12, max 52").optional(),
        workouts: z
          .boolean()
          .describe(
            `Also the laps of the runs of each run name that repeats, to compare a workout across weeks: the last ${WORKOUT_SESSIONS} (downloaded once) and older ones whose .FIT file is saved; default false`,
          )
          .optional(),
      }),
    },
    async (a) => {
      const data = JSON.parse(await dashboard.getDashboardData(a.weeks, a.workouts)) as Json;
      // only in the tool result: the page data and the widgets' ctx.data stay without it
      return {
        content: [{ type: "text" as const, text: jsonByLines({ digest: digest(data), ...data }) }],
      };
    },
  );
}
