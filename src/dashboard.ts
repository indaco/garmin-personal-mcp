import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { type GarminApiClient, GarminApiError } from "./api-client";
import { log } from "./log";
import { type GarminTools, firstArray, summarize, writeAtomically } from "./tools";

type Json = Record<string, unknown>;
/** An inclusive date range, yyyy-MM-dd. */
type Range = [string, string];

const DEFAULT_WEEKS = 12;
const MAX_WEEKS = 52;
const RECOVERY_DAYS = 14;
/** The last days of a cached range are fetched again: Garmin can still add activities or finish a night's data. */
const REFRESH_DAYS = 2;
const PAGE = 200;
const DAY_MS = 24 * 3600_000;

/** What one getDashboardData call counts. */
interface Sync {
  calls: number;
  failedDates: string[];
}

/**
 * All the data of the training dashboard in one call, with a local cache in `<data-dir>/dashboard-cache.json`
 * (the Java server's format, so both can share one data dir): each call fetches from Garmin only the days it
 * does not have yet, plus the last two days, which can still change.
 */
export class GarminDashboard {
  /** Calls run one at a time, like the Java server's synchronized method, so the cache file has one writer. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly tools: GarminTools,
    private readonly api: GarminApiClient,
    private readonly dataDir: string,
  ) {}

  getDashboardData(weeks?: number): Promise<string> {
    const run = this.#queue.then(() => this.#build(weeks));
    this.#queue = run.catch(() => {});
    return run;
  }

  async #build(weeks: number | undefined): Promise<string> {
    const w = weeks == null ? DEFAULT_WEEKS : Math.min(Math.max(weeks, 1), MAX_WEEKS);
    const today = localToday();
    const start = addDays(today, -7 * w);
    // one extra week before: the dashboard shows whole Monday-Sunday weeks
    const prevStart = addDays(start, -7 * (w + 1));
    const sync: Sync = { calls: 0, failedDates: [] };

    const cache = await this.load();
    const before = new Set(Object.keys(objectAt(cache, "activities")));
    await this.#syncActivities(cache, prevStart, today, sync);
    await this.#syncHrv(cache, start, today, sync);
    await this.#syncRecovery(cache, addDays(today, -(RECOVERY_DAYS - 1)), today, sync);
    cache.syncedAt = new Date().toISOString();
    await writeAtomically(this.#file(), JSON.stringify(cache));

    const out: Json = {
      generated: today,
      weeks: w,
      start,
      end: today,
      prevStart,
      prevEnd: addDays(start, -1),
      zones: await call(sync, () => this.tools.getHeartRateZones()),
      fitnessAge: await call(sync, () => this.tools.getFitnessAge(today)),
    };
    const activities = activitiesBetween(cache, start, today).map((a) => structuredClone(a));
    await this.#attachDetails(activities);
    out.activities = activities;
    out.previousActivities = activitiesBetween(cache, prevStart, addDays(start, -1)).map(compact);
    out.hrv = between(objectAt(cache, "hrv"), start, today);
    out.recovery = between(
      objectAt(cache, "recovery"),
      addDays(today, -(RECOVERY_DAYS - 1)),
      today,
    );
    const cached = Object.keys(objectAt(cache, "activities"));
    out.sync = {
      garminCalls: sync.calls, // one-time .FIT downloads for new sets and laps not included
      newActivities: cached.filter((id) => !before.has(id)).length,
      failedDays: sync.failedDates.length,
      failedDates: sync.failedDates,
      cachedActivities: cached.length,
    };
    return JSON.stringify(out);
  }

  // ------------------------------------------------------------------ sync

  async #syncActivities(cache: Json, from: string, to: string, sync: Sync): Promise<void> {
    const byId = objectAt(cache, "activities");
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
    for (const [rFrom, rTo] of toFetch(cachedFrom, cachedTo, from, to)) {
      // Garmin may reject long ranges: ask 4 weeks at a time
      for (let a = rFrom; a <= rTo; a = addDays(a, 28)) {
        const end = addDays(a, 27) > rTo ? rTo : addDays(a, 27);
        const path = `/hrv-service/hrv/daily/${a}/${end}`;
        const json = await call(sync, () => this.api.getJson(path, {}));
        const summaries = field(json, "hrvSummaries");
        for (const h of Array.isArray(summaries) ? summaries : []) {
          const o: Json = { date: asString(field(h, "calendarDate")) };
          copy(h, o, "lastNightAvg", "hrv");
          copy(h, o, "weeklyAvg", "weeklyAvg");
          copy(h, o, "status", "status");
          copy(field(h, "baseline"), o, "balancedLow", "low");
          copy(field(h, "baseline"), o, "balancedUpper", "high");
          byDate[o.date as string] = o;
        }
      }
    }
    setCovered(cache, "hrvFrom", "hrvTo", covered(cachedFrom, cachedTo, from, to));
  }

  async #syncRecovery(cache: Json, from: string, to: string, sync: Sync): Promise<void> {
    const byDate = objectAt(cache, "recovery");
    const refreshFrom = recoveryRefreshFrom(date(cache.recoveryTo), to);
    for (let day = from; day <= to; day = addDays(day, 1)) {
      if (day in byDate && day < refreshFrom) {
        continue;
      }
      try {
        const sleep = await call(sync, () => this.tools.getSleep(day));
        const summary = await call(sync, () => this.tools.getDailySummary(day));
        byDate[day] = recoveryRow(day, sleep, summary);
      } catch (e) {
        if (!(e instanceof GarminApiError)) throw e;
        // keep the old row, if any; the day is fetched again on the next call
        sync.failedDates.push(day);
        log("WARN", `Recovery data of ${day} not fetched: ${e.message}`);
      }
    }
    cache.recoveryTo = to;
    // the cache keeps only what a dashboard can show
    const keepFrom = addDays(from, -RECOVERY_DAYS);
    for (const day of Object.keys(byDate)) {
      // intentional difference: Java fails the whole call on a key that is not a date; here the key is dropped
      if (date(day) === undefined || day < keepFrom) {
        delete byDate[day];
      }
    }
  }

  // ------------------------------------------------------------------ output

  /** Strength sets for every strength session (30 most recent), laps for the 3 most recent activities, races and runs over 15 km. */
  async #attachDetails(acts: Json[]): Promise<void> {
    let strength = 0;
    for (const [i, a] of acts.entries()) {
      const id = asLong(a.id);
      const type = typeof a.type === "string" ? a.type : "";
      try {
        if (type.includes("strength") && strength++ < 30) {
          a.exercises = JSON.parse(await this.tools.getActivitySets(id)).exercises;
        }
        const longRun = type.endsWith("running") && typeof a.km === "number" && a.km > 15;
        if (i < 3 || a.race === true || longRun) {
          a.laps = JSON.parse(await this.tools.getActivityLaps(id)).laps;
        }
      } catch (e) {
        a.detailError = (e as Error).message;
      }
    }
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

/** The object at `key`, created when missing (Jackson's withObjectProperty). */
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

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Today in the system time zone, like Java's LocalDate.now(). */
function localToday(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
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

/** Jackson's asString(): text, or a number as text; "" for anything else. */
function asString(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

/** Jackson's asLong(): a number without decimals, or text of digits; 0 otherwise. */
function asLong(v: unknown): number {
  if (typeof v === "number") return Math.trunc(v);
  return typeof v === "string" && /^[+-]?\d+$/.test(v) ? Number(v) : 0;
}

// ------------------------------------------------------------------ MCP registration

/** Registers getDashboardData with the Java server's name, description and parameter. */
export function registerDashboard(server: McpServer, dashboard: GarminDashboard): void {
  server.registerTool(
    "getDashboardData",
    {
      description: [
        "All the data of the training dashboard in one call: HR zones, fitness age, the activities of the",
        "last `weeks` weeks (compact summaries, with strength sets and laps where they apply), the activities",
        "of the weeks before for the period comparison, daily HRV, and the last 14 days of sleep and daily",
        "summaries. Keeps a local cache and fetches from Garmin only what is new since the last call, so a",
        "rebuild or an update needs few calls. `sync` in the result says what was fetched.",
      ].join("\n"),
      inputSchema: z.object({
        weeks: z.number().int().describe("Weeks to cover, default 12, max 52").optional(),
      }),
    },
    async (a) => ({
      content: [{ type: "text" as const, text: await dashboard.getDashboardData(a.weeks) }],
    }),
  );
}
