import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { type GarminApiClient, GarminApiError } from "./api-client";
import { type Catalogue, decodeFit, hms, lapsOf, round, setsOf, unzipFit } from "./fit";
import { log } from "./log";

type Json = Record<string, unknown>;

const DAY_MS = 24 * 3600_000;

/**
 * MCP tools over the Garmin Connect Personal API (read-only). Every tool returns a JSON string.
 * Endpoints from the official Swagger: https://developer.garmin.com/gc-developer-program/personal/swagger-docs/
 */
export class GarminTools {
  #catalogue: Catalogue | undefined;
  #catalogueRetryAt = 0;

  constructor(
    private readonly api: GarminApiClient,
    private readonly dataDir: string,
  ) {}

  // ------------------------------------------------------------------ activities

  async listActivities(
    startDate?: string,
    endDate?: string,
    activityType?: string,
    limit?: number,
    raw?: boolean,
  ): Promise<string> {
    const json = await this.api.getJson("/activitylist-service/activities/search/activities", {
      start: "0",
      limit: String(limit == null || limit <= 0 ? 20 : Math.min(limit, 200)),
      startDate,
      endDate,
      activityType,
    });
    if (raw === true) {
      return JSON.stringify(json);
    }
    const list = Array.isArray(json) ? json : firstArray(json);
    if (!list) {
      return JSON.stringify(json);
    }
    return JSON.stringify(list.map((a) => summarize(isObject(a) ? a : {})));
  }

  async getActivity(activityId: number): Promise<string> {
    return JSON.stringify(await this.api.getJson(`/activity-service/activity/${activityId}`, {}));
  }

  async downloadActivityFit(activityId: number): Promise<string> {
    const fit = await this.fetchFit(activityId);
    return JSON.stringify({ path: resolve(fit), bytes: (await stat(fit)).size });
  }

  async getActivityLaps(activityId: number): Promise<string> {
    return JSON.stringify(lapsOf(await this.#decodeFit(activityId), activityId));
  }

  async getActivitySets(activityId: number): Promise<string> {
    const fit = await this.#decodeFit(activityId);
    return JSON.stringify(setsOf(fit, activityId, await this.#exerciseCatalogue()));
  }

  // ------------------------------------------------------------------ health

  async getHrvRange(fromDate: string, toDate: string): Promise<string> {
    return JSON.stringify(
      await this.api.getJson(`/hrv-service/hrv/daily/${fromDate}/${toDate}`, {}),
    );
  }

  async getDailyHeartRate(date: string): Promise<string> {
    return JSON.stringify(
      await this.api.getJson("/wellness-service/wellness/dailyHeartRate", { date }),
    );
  }

  async getSleep(date: string): Promise<string> {
    return JSON.stringify(await this.api.getJson("/sleep-service/sleep/dailySleep", { date }));
  }

  async getHeartRateZones(): Promise<string> {
    return JSON.stringify(await this.api.getJson("/biometric-service/heartRateZones/v2", {}));
  }

  async getFitnessAge(date: string): Promise<string> {
    return JSON.stringify(await this.api.getJson(`/fitnessage-service/fitnessage/v2/${date}`, {}));
  }

  async getDailySummary(date: string): Promise<string> {
    return JSON.stringify(
      await this.api.getJson("/usersummary-service/usersummary/daily", { calendarDate: date }),
    );
  }

  // ------------------------------------------------------------------ generic

  async garminGet(path: string, query?: string): Promise<string> {
    const q: Record<string, string> = {};
    if (query?.trim()) {
      for (const pair of query.split("&")) {
        const i = pair.indexOf("=");
        if (i > 0) {
          q[pair.slice(0, i)] = pair.slice(i + 1);
        }
      }
    }
    return JSON.stringify(await this.api.getJson(path, q));
  }

  // ------------------------------------------------------------------ FIT

  /** Downloads the original .FIT file once and keeps it in `<data-dir>/fit`. */
  async fetchFit(activityId: number): Promise<string> {
    const target = join(this.dataDir, "fit", `${activityId}.fit`);
    const cached = await stat(target).catch(() => undefined);
    if (cached?.isFile() && cached.size > 0) {
      return target;
    }
    const data = await this.api.getBytes(`/download-service/files/activity/${activityId}`, {});
    await writeAtomically(target, unzipFit(data, activityId));
    return target;
  }

  async #decodeFit(activityId: number) {
    return decodeFit(await readFile(await this.fetchFit(activityId)), activityId);
  }

  /**
   * Garmin's exercise catalogue, cached in `<data-dir>/exercises.json` and refreshed after 30 days.
   * Undefined when there is no copy at all: sets still work, without muscles.
   */
  async #exerciseCatalogue(): Promise<Catalogue | undefined> {
    if (this.#catalogue) {
      return this.#catalogue;
    }
    const file = join(this.dataDir, "exercises.json");
    try {
      const cached = await stat(file).catch(() => undefined);
      const fresh = cached?.isFile() && cached.mtimeMs > Date.now() - 30 * DAY_MS;
      if (!fresh && Date.now() > this.#catalogueRetryAt) {
        try {
          const data = await this.api.getExerciseCatalogue();
          if (!isObject((JSON.parse(new TextDecoder().decode(data)) as Json | null)?.categories)) {
            throw new GarminApiError("the exercise catalogue has no categories");
          }
          await writeAtomically(file, data);
        } catch (e) {
          if (!(e instanceof GarminApiError || e instanceof SyntaxError)) throw e;
          // a failed download is tried again only after a pause, not on every strength session
          this.#catalogueRetryAt = Date.now() + 10 * 60_000;
          log(
            "WARN",
            `Exercise catalogue not refreshed (${e.message}); ${cached?.isFile() ? "using the cached copy" : "sets will have no muscles"}`,
          );
        }
      }
      if ((await stat(file).catch(() => undefined))?.isFile()) {
        const categories = (JSON.parse(await readFile(file, "utf8")) as Json | null)?.categories;
        this.#catalogue = isObject(categories) ? (categories as Catalogue) : undefined;
      }
    } catch (e) {
      log("WARN", `Cannot read the exercise catalogue: ${(e as Error).message}`);
    }
    return this.#catalogue;
  }
}

// ------------------------------------------------------------------ summary

/** The compact activity summary of listActivities and the dashboard. */
export function summarize(a: Json): Json {
  const o: Json = {};
  copy(a, o, "activityId", "id");
  copy(a, o, "activityName", "name");
  if ("activityType" in a) {
    o.type = asString(field(a.activityType, "typeKey"));
  }
  copy(a, o, "startTimeLocal", "start");
  const distM = asDouble(a.distance, 0);
  const durS = asDouble(a.movingDuration, asDouble(a.duration, 0));
  if (distM > 0) {
    o.km = round(distM / 1000, 2);
  }
  if (durS > 0) {
    o.duration = hms(durS);
  }
  if (distM > 0 && durS > 0) {
    o.pace = `${hms(durS / (distM / 1000))}/km`;
  }
  copy(a, o, "averageHR", "avgHR");
  copy(a, o, "maxHR", "maxHR");
  copy(a, o, "averageRunningCadenceInStepsPerMinute", "cadenceSpm");
  copy(a, o, "elevationGain", "ascentM");

  // moving time is near zero for padel or strength: the elapsed time is the session length
  const elapsedS = asDouble(a.duration, 0);
  if (elapsedS - durS >= 60) {
    o.elapsed = hms(elapsedS);
  }
  if (asString(field(a.eventType, "typeKey")) === "race") {
    o.race = true;
  }
  putRounded(a, o, "activityTrainingLoad", "trainingLoad", 1);
  putRounded(a, o, "aerobicTrainingEffect", "aerobicTE", 1);
  putRounded(a, o, "anaerobicTrainingEffect", "anaerobicTE", 1);
  if (a.trainingEffectLabel != null) {
    o.teLabel = String(a.trainingEffectLabel).toLowerCase();
  }
  if ("hrTimeInZone_1" in a) {
    o.hrZonesSec = [1, 2, 3, 4, 5].map((n) => Math.round(asDouble(a[`hrTimeInZone_${n}`], 0)));
  }
  putRounded(a, o, "calories", "calories", 0);
  copy(a, o, "moderateIntensityMinutes", "moderateMinutes");
  copy(a, o, "vigorousIntensityMinutes", "vigorousMinutes");
  putRounded(a, o, "averageSwolf", "swolf", 0);
  const pool = asDouble(a.poolLength, 0);
  if (pool > 0) {
    // shortcut: assumes Garmin's centimetres (2500 = 25 m); unconfirmed on a real swim, check unitOfPoolLength if wrong
    o.poolLengthM = round(pool / 100, 1);
  }
  copy(a, o, "activeLengths", "lengths");
  putRounded(a, o, "strokes", "strokes", 0);
  copy(a, o, "differenceBodyBattery", "bodyBatteryDelta");
  copy(a, o, "steps", "steps");
  putRounded(a, o, "avgPower", "avgPowerW", 0);
  putRounded(a, o, "normPower", "normPowerW", 0);
  putRounded(a, o, "avgStrideLength", "strideCm", 1);
  putRounded(a, o, "avgGroundContactTime", "gctMs", 0);
  putRounded(a, o, "avgVerticalOscillation", "vertOscCm", 1);
  putRounded(a, o, "avgVerticalRatio", "vertRatioPct", 1);
  const gap = asDouble(a.avgGradeAdjustedSpeed, 0);
  if (gap > 0) {
    o.gap = `${hms(1000 / gap)}/km`;
  }

  const best: Json = {};
  for (const [m, name] of [
    ["1000", "1k"],
    ["1609", "mile"],
    ["5000", "5k"],
    ["10000", "10k"],
    ["21098", "half"],
    ["42195", "marathon"],
  ]) {
    const s = asDouble(a[`fastestSplit_${m}`], 0);
    if (s > 0) {
      best[name] = hms(s);
    }
  }
  if (Object.keys(best).length > 0) {
    o.best = best;
  }

  // Run Walk Run sessions: pace of the run segments only, and the time spent walking
  for (const split of Array.isArray(a.splitSummaries) ? a.splitSummaries : []) {
    const type = asString(field(split, "splitType")) ?? "";
    const speed = asDouble(field(split, "averageSpeed"), 0);
    if (type === "RWD_RUN" && speed > 0) {
      const runWalk = (o.runWalk ??= {}) as Json;
      runWalk.runPace = `${hms(1000 / speed)}/km`;
      runWalk.runKm = round(asDouble(field(split, "distance"), 0) / 1000, 2);
    } else if (type === "RWD_WALK") {
      ((o.runWalk ??= {}) as Json).walkTime = hms(asDouble(field(split, "duration"), 0));
    }
  }
  return o;
}

/** The activity list inside Garmin's answer when it is not a bare array. */
export function firstArray(json: unknown): unknown[] | undefined {
  if (!isObject(json)) return undefined;
  for (const k of ["activityList", "activities", "items", "data"]) {
    const v = json[k];
    if (Array.isArray(v)) return v;
  }
  return undefined;
}

/** Writes a temp file and moves it into place, so a stopped process never leaves a half-written file. */
export async function writeAtomically(target: string, data: Uint8Array | string): Promise<void> {
  await mkdir(dirname(resolve(target)), { recursive: true });
  const tmp = `${target}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, target);
}

function putRounded(from: Json, to: Json, name: string, as: string, decimals: number): void {
  const v = from[name];
  if (typeof v === "number") {
    to[as] = decimals === 0 ? Math.round(v) : round(v, decimals);
  }
}

function copy(from: Json, to: Json, name: string, as: string): void {
  const v = from[name];
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

/** Jackson's asDouble(default): a number, or text holding one; the default otherwise (null too). */
function asDouble(v: unknown, d: number): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(v)) return Number(v);
  return d;
}

/** Jackson's asString(null): text, or a number as text; null otherwise. */
function asString(v: unknown): string | null {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : null;
}

// ------------------------------------------------------------------ MCP registration

const activityId = z.number().int().describe("Garmin activity id");
const date = z.string().describe("Date yyyy-MM-dd");
const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

/** Registers the tools with the names, descriptions and parameters of the Java server. */
export function registerTools(server: McpServer, tools: GarminTools): void {
  server.registerTool(
    "listActivities",
    {
      description: [
        "List the user's Garmin activities (most recent first) as a compact summary: id, name, type,",
        "local start time, distance (km), moving duration, average pace, average/max heart rate,",
        "cadence, ascent; when Garmin has them: elapsed time (if longer than moving time), race flag,",
        "Garmin training load, aerobic/anaerobic training effect and label, seconds in HR zones 1-5,",
        "calories, moderate/vigorous intensity minutes, body battery change, steps, swim SWOLF, pool",
        "length, lengths and strokes, power, running form (stride, ground contact, vertical",
        "oscillation and ratio), grade-adjusted pace, best efforts (1k, mile, 5k, 10k, half,",
        "marathon) and run/walk segments. Dates are yyyy-MM-dd. Set raw=true for Garmin's full JSON.",
      ].join("\n"),
      inputSchema: z.object({
        startDate: z.string().describe("Start date yyyy-MM-dd (optional)").optional(),
        endDate: z.string().describe("End date yyyy-MM-dd (optional)").optional(),
        activityType: z.string().describe("Activity type key, e.g. running (optional)").optional(),
        limit: z.number().int().describe("Max number of activities, default 20").optional(),
        raw: z.boolean().describe("Return Garmin's raw JSON instead of the summary").optional(),
      }),
    },
    async (a) =>
      text(await tools.listActivities(a.startDate, a.endDate, a.activityType, a.limit, a.raw)),
  );
  server.registerTool(
    "getActivity",
    {
      description: "Get the full detail of one activity (summary, metadata, splits/laps) as JSON.",
      inputSchema: z.object({ activityId }),
    },
    async (a) => text(await tools.getActivity(a.activityId)),
  );
  server.registerTool(
    "downloadActivityFit",
    {
      description: [
        "Download the ORIGINAL .FIT file of an activity and save it on the user's computer.",
        "Returns the absolute path of the saved .fit file (second-by-second HR, cadence, speed, laps).",
      ].join("\n"),
      inputSchema: z.object({ activityId }),
    },
    async (a) => text(await tools.downloadActivityFit(a.activityId)),
  );
  server.registerTool(
    "getActivityLaps",
    {
      description: [
        "Laps of an activity as recorded by the watch (manual laps, auto-lap every km, or workout",
        "steps), read from the original .FIT file. One row per lap: distance (km), timer time,",
        "pace (min/km, foot sports) or speed (km/h), average/max HR, cadence (spm for running),",
        "ascent/descent, average power, intensity (active/rest/warmup/cooldown) and lap trigger.",
        "Use it for intervals and per-km splits; getActivity does not have them.",
      ].join("\n"),
      inputSchema: z.object({ activityId }),
    },
    async (a) => text(await tools.getActivityLaps(a.activityId)),
  );
  server.registerTool(
    "getActivitySets",
    {
      description: [
        "Strength training sets of an activity, read from the original .FIT file. One entry per",
        "exercise, in the order first done, with its movement category, its primary and secondary",
        "muscles (from Garmin's exercise catalogue) and its active sets: reps,",
        "weight (kg, absent when none was recorded), set time in seconds and the rest after the set",
        "(restSec). Exercise names are stable across sessions, so they can be used for per-exercise",
        "trends. Edits made later in Garmin Connect (renamed exercises, corrected reps or weights)",
        "are not in the .FIT file.",
      ].join("\n"),
      inputSchema: z.object({ activityId }),
    },
    async (a) => text(await tools.getActivitySets(a.activityId)),
  );
  server.registerTool(
    "getHrvRange",
    {
      description: "Daily HRV (overnight) summaries for a date range, yyyy-MM-dd.",
      inputSchema: z.object({
        fromDate: z.string().describe("From date yyyy-MM-dd"),
        toDate: z.string().describe("To date yyyy-MM-dd"),
      }),
    },
    async (a) => text(await tools.getHrvRange(a.fromDate, a.toDate)),
  );
  server.registerTool(
    "getDailyHeartRate",
    {
      description: "Daily heart rate for one date (includes resting heart rate), yyyy-MM-dd.",
      inputSchema: z.object({ date }),
    },
    async (a) => text(await tools.getDailyHeartRate(a.date)),
  );
  server.registerTool(
    "getSleep",
    {
      description: "Sleep data for one night, yyyy-MM-dd (the date of the morning you woke up).",
      inputSchema: z.object({ date }),
    },
    async (a) => text(await tools.getSleep(a.date)),
  );
  server.registerTool(
    "getHeartRateZones",
    {
      description: "Heart rate zones currently configured in Garmin Connect.",
      inputSchema: z.object({}),
    },
    async () => text(await tools.getHeartRateZones()),
  );
  server.registerTool(
    "getFitnessAge",
    {
      description: [
        "Garmin fitness age for a date, yyyy-MM-dd: fitness age vs chronological age, the achievable",
        "fitness age, and its components (body fat, vigorous days and minutes per week, resting HR)",
        "with the targets Garmin suggests.",
      ].join("\n"),
      inputSchema: z.object({ date }),
    },
    async (a) => text(await tools.getFitnessAge(a.date)),
  );
  server.registerTool(
    "getDailySummary",
    {
      description:
        "Daily user summary for one date (steps, calories, stress, body battery, resting HR), yyyy-MM-dd.",
      inputSchema: z.object({ date }),
    },
    async (a) => text(await tools.getDailySummary(a.date)),
  );
  server.registerTool(
    "garminGet",
    {
      description: [
        "Generic read-only GET on the Garmin Connect Personal API, for endpoints not covered by the",
        "other tools or when a query parameter name has to be adjusted. 'path' is relative and starts",
        "with '/', e.g. /fitnessage-service/fitnessage/v2/2026-10-25 . 'query' is an optional",
        "URL query string without '?', e.g. date=2026-10-25&foo=bar .",
      ].join("\n"),
      inputSchema: z.object({
        path: z.string().describe("Relative API path starting with /"),
        query: z.string().describe("Query string, e.g. a=1&b=2").optional(),
      }),
    },
    async (a) => text(await tools.garminGet(a.path, a.query)),
  );
}
