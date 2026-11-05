import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { type GarminApiClient, GarminApiError } from "./api-client";
import { addDays, localToday } from "./dates";
import { digest } from "./digest";
import { log } from "./log";
import { type Activity, isRunning, mondayOf } from "./page/calc";
import { workoutOf } from "./page/running";
import {
  type GarminTools,
  MODEL_ONLY,
  SEARCH_PAGE,
  firstArray,
  sleepSummary,
  summarize,
  writeAtomically,
} from "./tools";

type Json = Record<string, unknown>;
/** An inclusive date range, yyyy-MM-dd. */
type Range = [string, string];

const DEFAULT_WEEKS = 12;
const MAX_WEEKS = 52;
const RECOVERY_DAYS = 14;
/** The rows kept in the cache: the longest period, from a Monday, for each page that shares the cache. */
const RECOVERY_KEEP_DAYS = 7 * MAX_WEEKS + 7;
/** Days in one pair of range requests: Garmin's sleep range refuses more than 32. */
const RECOVERY_CHUNK_DAYS = 31;
const SLEEP_RANGE = "/sleep-service/sleep/dailySleepSummariesByDate";
const SUMMARY_RANGE = "/usersummary-service/v2/dailysummaries";
/** The newest sessions of each repeated run name whose laps are downloaded, for the workout trend. */
export const WORKOUT_SESSIONS = 8;

/** The weeks that getDashboardData covers for an asked number: 12 by default, 1 to 52. */
export const weeksCovered = (weeks: number | undefined): number =>
  weeks == null ? DEFAULT_WEEKS : Math.min(Math.max(weeks, 1), MAX_WEEKS);
/**
 * The last days of a cached range are fetched again: a watch can sync days late, and Garmin can still
 * change a session or finish a night's data. 14 days fit one search page, one HRV chunk and one recovery
 * range pair, so the window costs no extra requests.
 */
const REFRESH_DAYS = 14;
/** Bump when summarize keeps a new field, or to mend cached rows that an older rule got wrong: cached rows from before it are fetched again, once. */
const SUMMARY = 3;

/** What one getDashboardData call counts. */
interface Sync {
  calls: number;
  failedDates: string[];
  failedSections: string[];
}

/**
 * All the data of the training dashboard in one call, with a local cache in `<data-dir>/dashboard-cache.json`
 * (keep its format: other servers on the same data dir read it): each call fetches from Garmin only the days
 * it does not have yet, plus the last 14 days, which can still change.
 */
export class GarminDashboard {
  /** Calls run one at a time, so the cache file has one writer. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly tools: GarminTools,
    private readonly api: GarminApiClient,
    private readonly dataDir: string,
  ) {}

  /**
   * `workouts` adds the laps of the last sessions of each repeated run name, for the workout trend.
   * `recoveryHistory` keeps the recovery rows of the whole period; the days before the last 14 are short.
   */
  getDashboardData(weeks?: number, workouts = false, recoveryHistory = false): Promise<string> {
    const run = this.#queue.then(() => this.#build(weeks, workouts, recoveryHistory));
    this.#queue = run.catch(() => {});
    return run;
  }

  async #build(
    weeks: number | undefined,
    workouts: boolean,
    recoveryHistory: boolean,
  ): Promise<string> {
    const w = weeksCovered(weeks);
    const today = localToday();
    const start = mondayOf(addDays(today, -7 * w));
    // one extra week before: the dashboard shows whole Monday-Sunday weeks
    const prevStart = addDays(start, -7 * (w + 1));
    const recentFrom = addDays(today, -(RECOVERY_DAYS - 1));
    const recoveryFrom = recoveryHistory && start < recentFrom ? start : recentFrom;
    const sync: Sync = { calls: 0, failedDates: [], failedSections: [] };

    const cache = await this.load();
    const before = new Set(Object.keys(objectAt(cache, "activities")));
    await this.#syncActivities(cache, prevStart, today, sync);
    await this.#syncHrv(cache, start, today, sync);
    await this.#syncRecovery(cache, recoveryFrom, today, sync);
    cache.syncedAt = new Date().toISOString();
    await writeAtomically(this.#file(), JSON.stringify(cache));

    const [newZones, fitnessAge, settings] = await Promise.all([
      optional(sync, "zones", () => this.tools.getHeartRateZones()),
      optional(sync, "fitnessAge", () => this.tools.getFitnessAge(today)),
      optional(sync, "units", () => this.api.getJson("/userprofile-service/userprofile/settings")),
    ]);
    // a failed call keeps the last good answer: one rate limit must not turn a page in miles into km
    if (newZones !== null) cache.zones = newZones;
    if (isObject(settings)) {
      // Garmin answers in metric whatever this setting says: it only tells the page what to show
      cache.units = settings.measurementSystem;
      // Garmin writes a locale as pt_BR; the page keeps the built-in language that matches it
      cache.locale = String(settings.preferredLocale).replace("_", "-");
    }
    await writeAtomically(this.#file(), JSON.stringify(cache));
    const { units, locale } = cache;
    const out: Json = {
      generated: today,
      weeks: w,
      start,
      end: today,
      prevStart,
      prevEnd: addDays(start, -1),
      zones: cache.zones ?? null,
      fitnessAge,
      ...(typeof units === "string" && UNITS.includes(units) ? { units } : {}),
      ...(typeof locale === "string" && /^[a-z]{2,3}(-[A-Z]{2})?$/.test(locale) ? { locale } : {}),
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
    const rows = objectAt(cache, "recovery");
    out.recovery = [
      ...between(rows, recoveryFrom, addDays(recentFrom, -1)).map(trendRow),
      ...between(rows, recentFrom, today),
    ];
    const activities = activitiesBetween(cache, start, today).map((a) => structuredClone(a));
    synced.fitDownloads = await this.#attachDetails(activities, workouts);
    out.activities = activities;
    out.previousActivities = activitiesBetween(cache, prevStart, addDays(start, -1)).map(compact);
    return jsonByLines(out);
  }

  // ------------------------------------------------------------------ sync

  async #syncActivities(cache: Json, from: string, to: string, sync: Sync): Promise<void> {
    const byId = objectAt(cache, "activities");
    // rows written before a summary field (SUMMARY) or the sport field, or by another server: fetch them again.
    // shortcut: a row that Garmin sends without sportTypeId repeats this on every call; mark rows if that happens
    if (
      cache.activitiesSummary !== SUMMARY ||
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
      for (let page = 0; ; page += SEARCH_PAGE) {
        sync.calls++;
        const json = await this.api.getJson("/activitylist-service/activities/search/activities", {
          start: String(page),
          limit: String(SEARCH_PAGE),
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
        if (list.length < SEARCH_PAGE) {
          break;
        }
      }
    }
    setCovered(cache, "activitiesFrom", "activitiesTo", covered(cachedFrom, cachedTo, from, to));
    cache.activitiesSummary = SUMMARY;
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
    const needed: string[] = [];
    for (let day = from; day <= to; day = addDays(day, 1)) {
      if (!(day in byDate) || day >= refreshFrom) needed.push(day);
    }
    const recentFrom = addDays(to, -(RECOVERY_DAYS - 1));
    const failedDays: string[] = [];
    let stopped = false;
    // the newest first: if Garmin stops answering, the days that a reader looks at first are saved
    for (const [start, end] of recoveryChunks(needed).toReversed()) {
      const days = needed.filter((day) => day >= start && day <= end);
      if (stopped) {
        failedDays.push(...days);
        continue;
      }
      try {
        const { nights, summaries } = await this.#recoveryRanges(start, end, sync);
        for (const day of days) {
          byDate[day] = mergedRow(
            byDate[day],
            recoveryRow(day, nights.get(day), summaries.get(day)),
          );
        }
      } catch (e) {
        if (!(e instanceof GarminApiError)) throw e;
        log("WARN", `Recovery data of ${start} to ${end} not fetched: ${e.message}`);
        // no more requests for what they cannot mend: the network, the key, a rate limit
        stopped = e.status === undefined || e.status === 429;
        for (const day of days) {
          if (stopped || day < recentFrom) {
            failedDays.push(day);
            continue;
          }
          try {
            const [sleep, summary] = await Promise.all([
              call(sync, () => this.tools.getSleep(day, true)),
              call(sync, () => this.tools.getDailySummary(day)),
            ]);
            byDate[day] = mergedRow(byDate[day], recoveryRow(day, sleep, summary));
          } catch (dayError) {
            if (!(dayError instanceof GarminApiError)) throw dayError;
            failedDays.push(day);
            log("WARN", `Recovery data of ${day} not fetched: ${dayError.message}`);
          }
        }
      }
    }
    failedDays.sort();
    sync.failedDates.push(...failedDays);
    // the old rows stay; recoveryTo stops at the first of them, so the next call fetches it again
    cache.recoveryTo = failedDays.find((day) => day in byDate) ?? to;
    // the cache keeps what a dashboard of any period can show
    const keepFrom = addDays(to, -RECOVERY_KEEP_DAYS);
    for (const day of Object.keys(byDate)) {
      // a key that is not a date is dropped too
      if (date(day) === undefined || day < keepFrom) {
        delete byDate[day];
      }
    }
  }

  /** A day's night and summary, by date. Garmin leaves out a day without data. */
  async #recoveryRanges(
    from: string,
    to: string,
    sync: Sync,
  ): Promise<{ nights: Map<unknown, unknown>; summaries: Map<unknown, Json> }> {
    const query = { startDate: from, endDate: to };
    // getJson answers parsed JSON: `call` would parse a bare string answer again
    const ask = (path: string): Promise<unknown> => {
      sync.calls++;
      return this.api.getJson(path, query);
    };
    const [nights, summaries] = await Promise.all([ask(SLEEP_RANGE), ask(SUMMARY_RANGE)]);
    const rows = field(summaries, "data");
    if (!Array.isArray(nights) || !Array.isArray(rows)) {
      throw new GarminApiError("The recovery ranges did not answer a list", 200);
    }
    return {
      nights: new Map(nights.map((n: unknown) => [sleepSummary(n).date, n])),
      summaries: new Map(rows.map((r: unknown) => [field(r, "calendarDate"), rangeSummary(r)])),
    };
  }

  // ------------------------------------------------------------------ output

  /**
   * Strength sets for the 30 most recent strength sessions and every older one whose .FIT file is saved;
   * laps for the 3 most recent activities, races and runs over 15 km. With `workouts`, also the laps of the runs of each name that repeats (the
   * sessions of a plan, compared across weeks): the newest WORKOUT_SESSIONS, downloaded when needed, and
   * every older one whose .FIT file is saved, which costs no download.
   */
  async #attachDetails(acts: Json[], workouts: boolean): Promise<number> {
    const isRun = (a: Json) => isRunning(a as Activity);
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
        if (type.includes("strength") && (strength++ < 30 || (await this.tools.hasFit(id)))) {
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
  // the part before the cached range is its own range: the two never overlap
  if (tail < cachedFrom) {
    tail = cachedFrom;
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

/** Spans of at most RECOVERY_CHUNK_DAYS days over the given days, which are in date order. */
export function recoveryChunks(days: string[]): Range[] {
  const spans: Range[] = [];
  for (const day of days) {
    const last = spans.at(-1);
    if (last !== undefined && day <= addDays(last[0], RECOVERY_CHUNK_DAYS - 1)) last[1] = day;
    else spans.push([day, day]);
  }
  return spans;
}

/** A row of the summary range with the names of a single-day summary, for recoveryRow. */
export function rangeSummary(row: unknown): Json {
  const steps = field(field(row, "movement"), "steps");
  return {
    restingHeartRate: field(field(row, "heartRate"), "restingValue"),
    bodyBatteryHighestValue: field(field(row, "bodyBattery"), "maxValue"),
    bodyBatteryLowestValue: field(field(row, "bodyBattery"), "minValue"),
    averageStressLevel: field(field(row, "stress"), "avgLevel"),
    totalSteps: field(steps, "value"),
    dailyStepGoal: field(steps, "goal"),
    floorsAscended: field(field(field(row, "movement"), "floorsAscended"), "value"),
  };
}

/** A row older than the last 14 days has only what a weekly trend shows: a shared page holds less. */
function trendRow(row: unknown): Json {
  const r: Json = {};
  for (const name of ["date", "sleepH", "sleepScore", "rhr"]) copy(row, r, name, name);
  return r;
}

/** A refreshed row over the cached one: what Garmin leaves out now does not erase what the cache has. */
function mergedRow(old: unknown, row: Json): Json {
  return { ...(isObject(old) ? old : {}), ...row };
}

/** One compact row per day: sleep, sleep need, bedtime, resting HR, body battery, stress, steps. */
export function recoveryRow(day: string, sleep: unknown, summary: unknown): Json {
  const r: Json = { date: day };
  // the cache keeps its own names, so the fields come from getSleep's summary renamed
  const s = sleepSummary(sleep);
  copy(s, r, "sleepH", "sleepH");
  copy(s, r, "deepH", "deep");
  copy(s, r, "lightH", "light");
  copy(s, r, "remH", "rem");
  copy(s, r, "awakeH", "awake");
  copy(s, r, "sleepScore", "sleepScore");
  copy(s, r, "needH", "needH");
  if (typeof s.bedtime === "string") {
    r.bedMin = Number(s.bedtime.slice(0, 2)) * 60 + Number(s.bedtime.slice(3));
  }
  copy(summary, r, "restingHeartRate", "rhr");
  copy(summary, r, "bodyBatteryHighestValue", "bbHigh");
  copy(summary, r, "bodyBatteryLowestValue", "bbLow");
  copy(summary, r, "averageStressLevel", "stress");
  copy(summary, r, "totalSteps", "steps");
  copy(summary, r, "dailyStepGoal", "stepGoal");
  const floors = field(summary, "floorsAscended");
  if (typeof floors === "number") {
    // a single-day answer is a fraction; Garmin's own whole number, in the range, is rounded down
    r.floors = Math.floor(floors);
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

/** The fields that the period comparison, the boards and the load of a previous session need. */
function compact(a: Json): Json {
  const o: Json = {};
  for (const f of [
    "id",
    "start",
    "type",
    "sport",
    "km",
    "duration",
    "elapsed",
    "avgHR",
    "trainingLoad",
  ]) {
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
      _meta: MODEL_ONLY,
      description: [
        "All the data of the training dashboard in one call: HR zones, fitness age, the activities of the",
        "last `weeks` weeks (compact summaries, with strength sets and laps where they apply), the activities",
        "of the weeks before for the period comparison, daily HRV, the last 14 days of sleep and daily",
        "summaries (with `recoveryHistory`, also short rows of the older days: date, sleep hours, sleep",
        "score and resting HR), and `units`: the measurement system of the Garmin profile (metric, statute_us or",
        "statute_uk) that the page shows; the data itself is always metric; `locale`: the language of",
        "the Garmin profile, e.g. it or pt-BR. Keeps a local cache and",
        "fetches from Garmin only what is new since the last call, so a rebuild or an update needs few",
        "calls. `sync` in the result says what was fetched: Garmin calls, .FIT files downloaded",
        "(fitDownloads) and new activities.",
        "`digest`, first in the result: the server's totals for the whole period and for each",
        "Monday-Sunday week (sessions, km, hours, load), the training load of the last 7 and 28 days,",
        "best efforts, races and strength top sets, the long runs with their half split and HR drift, the",
        "longest run and the race predictions (Riegel), the page's readiness verdict for today with its",
        "inputs (`readiness`), and today's fitness, fatigue and form (`fitnessFatigue`); quote them",
        "instead of your own sums. For another date range, use the activities: each one is on its own",
        "line. A load is null (n/a) when the sessions have none; estimatedLoads counts the loads that",
        "are estimates from heart rate. A week with partial: true starts before the period. Without HRV",
        "and sleep data the digest has no `readiness`: give the verdict as n/a.",
      ].join("\n"),
      inputSchema: z.object({
        weeks: z.number().int().describe("Weeks to cover, default 12, max 52").optional(),
        workouts: z
          .boolean()
          .describe(
            `Also the laps of the runs of each run name that repeats, to compare a workout across weeks: the last ${WORKOUT_SESSIONS} (downloaded once) and older ones whose .FIT file is saved; default false`,
          )
          .optional(),
        recoveryHistory: z
          .boolean()
          .describe(
            "Also the sleep and resting HR rows of the whole period, not only the last 14 days",
          )
          .optional(),
      }),
    },
    async (a) => {
      const data = JSON.parse(
        await dashboard.getDashboardData(a.weeks, a.workouts, a.recoveryHistory),
      ) as Json;
      // only in the tool result: the page data and the widgets' ctx.data stay without it
      return {
        content: [{ type: "text" as const, text: jsonByLines({ digest: digest(data), ...data }) }],
      };
    },
  );
}
