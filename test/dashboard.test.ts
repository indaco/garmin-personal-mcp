import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Profile } from "@garmin/fitsdk";
import { asServer } from "../scripts/fill-dashboard-fixture.mjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GarminApiError, type GarminApiClient } from "../src/api-client";
import {
  covered,
  GarminDashboard,
  jsonByLines,
  recoveryRefreshFrom,
  recoveryRow,
  toFetch,
} from "../src/dashboard";
import { GarminTools, writeAtomically } from "../src/tools";
import { fitFile } from "./fit-file";

vi.mock("../src/log", () => ({ log: vi.fn() }));

const FROM = "2026-08-03";
const TO = "2026-10-26";
const ranges = (r: [string, string][]) => r.map(([a, b]) => `${a}..${b}`);

describe("toFetch and covered", () => {
  it("fetches the whole range when the cache is empty", () => {
    expect(ranges(toFetch(undefined, undefined, FROM, TO))).toEqual(["2026-08-03..2026-10-26"]);
  });

  it("fetches only the last two cached days and the new ones", () => {
    // last sync on 20 Oct: refetch 19-20 Oct (they could still change) and everything after
    expect(ranges(toFetch(FROM, "2026-10-20", FROM, TO))).toEqual(["2026-10-19..2026-10-26"]);
    expect(ranges(toFetch(FROM, TO, FROM, TO))).toEqual(["2026-10-25..2026-10-26"]);
  });

  it("also fetches the missing start of a longer window", () => {
    expect(ranges(toFetch(FROM, TO, "2026-05-04", TO))).toEqual([
      "2026-05-04..2026-08-02",
      "2026-10-25..2026-10-26",
    ]);
  });

  it("ignores a cached range outside the window", () => {
    expect(ranges(toFetch("2025-01-01", "2025-03-01", FROM, TO))).toEqual([
      "2026-08-03..2026-10-26",
    ]);
  });

  it("never counts days that were not fetched as covered", () => {
    // three weeks without calls, then a 1-week window: only the new range is fetched and covered
    const from = "2026-11-16";
    const to = "2026-11-23";
    expect(ranges(toFetch(FROM, TO, from, to))).toEqual(["2026-11-16..2026-11-23"]);
    const c = covered(FROM, TO, from, to);
    expect(c).toEqual(["2026-11-16", "2026-11-23"]);
    // a later, longer window fetches the gap instead of trusting it
    expect(ranges(toFetch(c[0], c[1], "2026-10-01", to))).toEqual([
      "2026-10-01..2026-11-15",
      "2026-11-22..2026-11-23",
    ]);
  });

  it("joins touching and overlapping ranges", () => {
    expect(covered(FROM, TO, "2026-10-27", "2026-11-02")).toEqual(["2026-08-03", "2026-11-02"]);
    expect(covered(FROM, TO, "2026-07-01", TO)).toEqual(["2026-07-01", "2026-10-26"]);
    expect(covered(undefined, undefined, FROM, TO)).toEqual(["2026-08-03", "2026-10-26"]);
  });

  it("refreshes recovery from the last sync, not from today", () => {
    // last call on Monday 19 Oct, next on Monday 26 Oct: 18 and 19 Oct may be incomplete
    expect(recoveryRefreshFrom("2026-10-19", TO)).toBe("2026-10-18");
    expect(recoveryRefreshFrom(undefined, TO)).toBe("2026-10-25");
    expect(recoveryRefreshFrom("2026-10-31", TO)).toBe("2026-10-25");
  });
});

describe("cache file", () => {
  it("starts again from an empty cache when the file has the wrong shape", async () => {
    const dir = mkdtempSync(join(tmpdir(), "garmin-dash-"));
    const d = new GarminDashboard({} as GarminTools, {} as GarminApiClient, dir);
    writeFileSync(join(dir, "dashboard-cache.json"), '{"activities":[1,2],"activitiesFrom":"x"}');
    expect(await d.load()).toEqual({});
    writeFileSync(join(dir, "dashboard-cache.json"), '{"activities":{},"recoveryTo":"2026-10-26"}');
    expect((await d.load()).recoveryTo).toBe("2026-10-26");
    writeFileSync(join(dir, "dashboard-cache.json"), "{not json");
    expect(await d.load()).toEqual({});
  });

  it("writes the file atomically and leaves no temp file", async () => {
    const f = join(mkdtempSync(join(tmpdir(), "garmin-dash-")), "sub", "a.fit");
    await writeAtomically(f, new Uint8Array([1, 2, 3]));
    await writeAtomically(f, new Uint8Array([4]));
    expect(statSync(f).size).toBe(1);
    expect(readdirSync(join(f, ".."))).toEqual(["a.fit"]);
  });
});

describe("recoveryRow", () => {
  it("keeps the dashboard fields of sleep and the daily summary", () => {
    const row = recoveryRow(
      "2026-10-25",
      {
        sleepTimeSeconds: 21240,
        deepSleepSeconds: 6000,
        remSleepSeconds: 840,
        sleepScores: { overall: { value: 44 } },
        sleepNeed: { actual: 450 },
        sleepStartTimestampLocal: 1792885868000,
      },
      {
        restingHeartRate: 49,
        bodyBatteryHighestValue: 53,
        bodyBatteryLowestValue: 12,
        totalSteps: 15037,
        dailyStepGoal: 14520,
        floorsAscended: 93.14501,
      },
    );
    expect(JSON.stringify(row)).toBe(
      '{"date":"2026-10-25","sleepH":5.9,"deep":1.67,"rem":0.23,"sleepScore":44,' +
        '"needH":7.5,"bedMin":1431,"rhr":49,"bbHigh":53,"bbLow":12,"steps":15037,' +
        '"stepGoal":14520,"floors":93}',
    );
  });

  it("skips fields that are missing, null or not numbers", () => {
    expect(
      recoveryRow(
        "2026-10-25",
        { sleepTimeSeconds: "21240", sleepScores: { overall: { value: null } } },
        null,
      ),
    ).toEqual({ date: "2026-10-25" });
  });
});

// ------------------------------------------------------------------ getDashboardData

const api = { getJson: vi.fn(), getBytes: vi.fn(), getExerciseCatalogue: vi.fn() };
let dataDir: string;
let dashboard: GarminDashboard;
/** Activities Garmin has, as listActivities rows; each test sets its own. */
let garminActivities: Record<string, unknown>[];
/** Days whose sleep call fails. */
let failingSleep: Set<string>;
/** Path prefixes whose calls fail. */
let failing: Set<string>;
/** The measurementSystem and preferredLocale of the profile settings. */
let units: unknown;
let locale: unknown;

const cacheFile = () => join(dataDir, "dashboard-cache.json");
const readCache = () => JSON.parse(readFileSync(cacheFile(), "utf8"));
const activity = (
  id: number,
  day: string,
  type = "running",
  extra: Record<string, unknown> = {},
) => ({
  activityId: id,
  activityName: `A${id}`,
  startTimeLocal: `${day} 07:00:00`,
  activityType: { typeKey: type },
  sportTypeId: 1,
  distance: 5000,
  movingDuration: 1500,
  ...extra,
});
/** The ids of the activities that have laps. */
const withLaps = (out: { activities: Record<string, unknown>[] }) =>
  out.activities.filter((a) => a.laps).map((a) => a.id);
const callsTo = (prefix: string) =>
  api.getJson.mock.calls.filter(([path]) => String(path).startsWith(prefix));

function fakeGarmin(path: string, q: Record<string, string>) {
  if ([...failing].some((p) => path.startsWith(p)))
    throw new GarminApiError(`GET ${path} -> HTTP 500: down`);
  if (path === "/activitylist-service/activities/search/activities") {
    const rows = garminActivities.filter((a) => {
      const day = String(a.startTimeLocal).slice(0, 10);
      return day >= q.startDate && day <= q.endDate;
    });
    return rows.slice(Number(q.start), Number(q.start) + Number(q.limit));
  }
  if (path.startsWith("/hrv-service/hrv/daily/")) {
    const [from, to] = path.split("/").slice(-2);
    const days = [];
    for (
      let d = from;
      d <= to;
      d = new Date(Date.parse(d) + 86400_000).toISOString().slice(0, 10)
    ) {
      days.push({
        calendarDate: d,
        lastNightAvg: 60,
        weeklyAvg: 58,
        status: "BALANCED",
        baseline: { balancedLow: 50, balancedUpper: 70 },
      });
    }
    return { hrvSummaries: days };
  }
  if (path === "/sleep-service/sleep/dailySleep") {
    if (failingSleep.has(q.date)) throw new GarminApiError(`GET ${path} -> HTTP 500: down`);
    return { sleepTimeSeconds: 27000 };
  }
  if (path === "/usersummary-service/usersummary/daily") return { restingHeartRate: 50 };
  if (path === "/biometric-service/heartRateZones/v2") return [{ zone: 1 }];
  if (path.startsWith("/fitnessage-service/fitnessage/v2/")) return { fitnessAge: 40 };
  if (path === "/userprofile-service/userprofile/settings")
    return { measurementSystem: units, preferredLocale: locale };
  throw new Error(`unexpected path ${path}`);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ now: new Date(2026, 9, 26, 12), toFake: ["Date"] });
  dataDir = mkdtempSync(join(tmpdir(), "garmin-dash-"));
  garminActivities = [];
  failingSleep = new Set();
  failing = new Set();
  units = "metric";
  locale = "en";
  api.getJson.mockImplementation(async (path, q) => fakeGarmin(path, q));
  api.getBytes.mockResolvedValue(
    fitFile(
      [
        Profile.MesgNum.SET,
        {
          setType: 1,
          repetitions: 5,
          weight: 60,
          duration: 20,
          category: [28],
          categorySubtype: [6],
        },
      ],
      [Profile.MesgNum.LAP, { totalDistance: 1000, totalTimerTime: 300 }],
    ),
  );
  api.getExerciseCatalogue.mockRejectedValue(new GarminApiError("offline"));
  const client = api as unknown as GarminApiClient;
  dashboard = new GarminDashboard(new GarminTools(client, dataDir), client, dataDir);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("jsonByLines", () => {
  it("is the same JSON value as JSON.stringify, with one row on each line", () => {
    const value = {
      a: 1,
      gone: undefined,
      empty: [],
      rows: [{ x: 1 }, { x: [2, 3] }],
      o: { y: null },
    };
    const text = jsonByLines(value);
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(value)));
    expect(text).toBe(
      '{\n"a":1,\n"empty":[],\n"rows":[\n{"x":1},\n{"x":[2,3]}\n],\n"o":{"y":null}\n}',
    );
  });
});

describe("getDashboardData", () => {
  it("fetches everything on the first call and keeps it in the cache", async () => {
    garminActivities = [
      activity(1, "2026-10-20"),
      activity(2, "2026-08-01"),
      activity(3, "2026-05-01"),
    ];
    const out = JSON.parse(await dashboard.getDashboardData(2));

    expect(out).toMatchObject({
      generated: "2026-10-26",
      weeks: 2,
      start: "2026-10-12",
      end: "2026-10-26",
      prevStart: "2026-09-21",
      prevEnd: "2026-10-11",
      zones: [{ zone: 1 }],
      fitnessAge: { fitnessAge: 40 },
      units: "metric",
    });
    expect(out.activities.map((a: { id: number }) => a.id)).toEqual([1]);
    expect(out.previousActivities).toEqual([]);
    expect(out.hrv).toHaveLength(15);
    expect(out.hrv[0]).toEqual({
      date: "2026-10-12",
      hrv: 60,
      weeklyAvg: 58,
      status: "BALANCED",
      low: 50,
      high: 70,
    });
    expect(out.recovery).toHaveLength(14);
    expect(out.recovery[0]).toEqual({ date: "2026-10-13", sleepH: 7.5, rhr: 50 });
    // 1 activity page + 1 HRV range + 14 days x 2 recovery calls + zones + fitness age + settings
    expect(out.sync).toEqual({
      garminCalls: 33,
      newActivities: 1,
      failedDays: 0,
      failedDates: [],
      failedSections: [],
      cachedActivities: 1,
    });

    const cache = readCache();
    expect(cache).toMatchObject({
      activitiesFrom: "2026-09-21",
      activitiesTo: "2026-10-26",
      hrvFrom: "2026-10-12",
      hrvTo: "2026-10-26",
      recoveryTo: "2026-10-26",
    });
    expect(Object.keys(cache.activities)).toEqual(["1"]);
    expect(cache.activities["1"]).not.toHaveProperty("laps");
  });

  it("gives the small parts first and each activity on its own line", async () => {
    garminActivities = [activity(1, "2026-10-20"), activity(2, "2026-10-19")];
    const text = await dashboard.getDashboardData(2);
    const lines = text.split("\n");
    // the digest is only in the tool result: this text is also the page data
    expect(JSON.parse(text)).not.toHaveProperty("digest");

    expect(Object.keys(JSON.parse(text)).slice(-5)).toEqual([
      "sync",
      "hrv",
      "recovery",
      "activities",
      "previousActivities",
    ]);
    const first = lines.indexOf('"activities":[');
    expect(JSON.parse(lines[first + 1].replace(/,$/, ""))).toMatchObject({ id: 1 });
    expect(JSON.parse(lines[first + 2])).toMatchObject({ id: 2 });
    expect(lines[first + 3]).toBe("],");
  });

  it("asks Garmin only for the last two days on the next call", async () => {
    garminActivities = [activity(1, "2026-10-20")];
    await dashboard.getDashboardData(2);
    api.getJson.mockClear();
    garminActivities.push(activity(4, "2026-10-26"));

    const out = JSON.parse(await dashboard.getDashboardData(2));
    expect(callsTo("/activitylist").map(([, q]) => [q.startDate, q.endDate])).toEqual([
      ["2026-10-25", "2026-10-26"],
    ]);
    expect(callsTo("/hrv-service").map(([p]) => p)).toEqual([
      "/hrv-service/hrv/daily/2026-10-25/2026-10-26",
    ]);
    expect(callsTo("/sleep-service").map(([, q]) => q.date)).toEqual(["2026-10-25", "2026-10-26"]);
    expect(out.activities.map((a: { id: number }) => a.id)).toEqual([4, 1]);
    expect(out.sync).toMatchObject({ garminCalls: 9, newActivities: 1, cachedActivities: 2 });
  });

  it("fetches the activities again when the cache has rows without a sport", async () => {
    garminActivities = [activity(1, "2026-10-20"), activity(2, "2026-01-05")];
    await dashboard.getDashboardData(2);
    const cache = readCache();
    delete cache.activities["1"].sport;
    cache.activities["2"] = { id: 2, type: "running", start: "2026-01-05 07:00:00" };
    writeFileSync(cacheFile(), JSON.stringify(cache));
    api.getJson.mockClear();

    const out = JSON.parse(await dashboard.getDashboardData(2));
    expect(callsTo("/activitylist").map(([, q]) => [q.startDate, q.endDate])).toEqual([
      ["2026-09-21", "2026-10-26"],
    ]);
    expect(out.activities[0].sport).toBe("running");
    // the old row outside the window goes too, so the next call is a normal one
    expect(Object.keys(readCache().activities)).toEqual(["1"]);
  });

  it("drops a cached activity that Garmin no longer has in a refetched day", async () => {
    garminActivities = [activity(1, "2026-10-26"), activity(2, "2026-10-20")];
    await dashboard.getDashboardData(2);
    garminActivities = [activity(2, "2026-10-20")];
    const out = JSON.parse(await dashboard.getDashboardData(2));
    expect(out.activities.map((a: { id: number }) => a.id)).toEqual([2]);
    expect(Object.keys(readCache().activities)).toEqual(["2"]);
  });

  it("reads the activity list in pages of 200", async () => {
    garminActivities = Array.from({ length: 450 }, (_, i) => activity(1000 + i, "2026-10-20"));
    const out = JSON.parse(await dashboard.getDashboardData(1));
    expect(callsTo("/activitylist").map(([, q]) => q.start)).toEqual(["0", "200", "400"]);
    expect(out.sync.cachedActivities).toBe(450);
  });

  it("asks for the sleep and the summary of a day together", async () => {
    const log: string[] = [];
    api.getJson.mockImplementation(async (path, q) => {
      log.push(`start ${path}`);
      await Promise.resolve();
      log.push(`end ${path}`);
      return fakeGarmin(path, q);
    });
    await dashboard.getDashboardData(1);
    const sleep = log.indexOf("start /sleep-service/sleep/dailySleep");
    expect(log[sleep + 1]).toBe("start /usersummary-service/usersummary/daily");
  });

  it("keeps the old recovery row of a day that fails and reports the day", async () => {
    await dashboard.getDashboardData(1);
    failingSleep.add("2026-10-26");
    const out = JSON.parse(await dashboard.getDashboardData(1));
    expect(out.sync).toMatchObject({ failedDays: 1, failedDates: ["2026-10-26"] });
    expect(out.recovery.at(-1)).toEqual({ date: "2026-10-26", sleepH: 7.5, rhr: 50 });
  });

  it("fetches a failed recovery day again although it kept its old row", async () => {
    vi.setSystemTime(new Date(2026, 9, 20, 12));
    await dashboard.getDashboardData(1);
    vi.setSystemTime(new Date(2026, 9, 26, 12));
    failingSleep.add("2026-10-19");
    const out = JSON.parse(await dashboard.getDashboardData(1));
    expect(out.sync.failedDates).toEqual(["2026-10-19"]);
    expect(readCache().recoveryTo).toBe("2026-10-19");
    failingSleep.clear();
    api.getJson.mockClear();
    await dashboard.getDashboardData(1);
    expect(callsTo("/sleep-service").map(([, q]) => q.date)).toContain("2026-10-19");
    expect(readCache().recoveryTo).toBe("2026-10-26");
  });

  it("builds the dashboard without zones and fitness age when they fail", async () => {
    failing.add("/biometric-service/heartRateZones");
    failing.add("/fitnessage-service/");
    const out = JSON.parse(await dashboard.getDashboardData(2));
    expect(out.zones).toBeNull();
    expect(out.fitnessAge).toBeNull();
    expect(out.sync.failedSections).toEqual(["zones", "fitnessAge"]);
    expect(Array.isArray(out.activities)).toBe(true);
  });

  it("passes on the profile locale as a language tag, and leaves out one it cannot read", async () => {
    expect(JSON.parse(await dashboard.getDashboardData(1)).locale).toBe("en");
    locale = "pt_BR";
    expect(JSON.parse(await dashboard.getDashboardData(1)).locale).toBe("pt-BR");
    locale = undefined;
    expect(JSON.parse(await dashboard.getDashboardData(1))).not.toHaveProperty("locale");
    locale = "bad locale";
    expect(JSON.parse(await dashboard.getDashboardData(1))).not.toHaveProperty("locale");
  });

  it("passes on a known measurement system only, and builds without it when the settings fail", async () => {
    units = "statute_uk";
    expect(JSON.parse(await dashboard.getDashboardData(1)).units).toBe("statute_uk");
    units = "nautical";
    expect(JSON.parse(await dashboard.getDashboardData(1))).not.toHaveProperty("units");
    failing.add("/userprofile-service/");
    const out = JSON.parse(await dashboard.getDashboardData(1));
    expect(out).not.toHaveProperty("units");
    expect(out.sync.failedSections).toEqual(["units"]);
    expect(Array.isArray(out.activities)).toBe(true);
  });

  it("builds the dashboard without HRV when a range fails, and fetches it again next time", async () => {
    failing.add("/hrv-service/");
    const out = JSON.parse(await dashboard.getDashboardData(2));
    expect(out.hrv).toEqual([]);
    expect(out.sync.failedSections).toEqual(["hrv"]);
    failing.clear();
    const again = JSON.parse(await dashboard.getDashboardData(2));
    expect(again.hrv.length).toBeGreaterThan(0);
  });

  it("keeps the previous weeks compact, most recent first", async () => {
    garminActivities = [
      activity(5, "2026-09-25", "running", { activityTrainingLoad: 80.26, averageHR: 150 }),
      activity(6, "2026-10-05", "cycling"),
    ];
    const out = JSON.parse(await dashboard.getDashboardData(2));
    expect(out.previousActivities).toEqual([
      { id: 6, start: "2026-10-05 07:00:00", type: "cycling", km: 5, duration: "25:00" },
      {
        id: 5,
        start: "2026-09-25 07:00:00",
        type: "running",
        km: 5,
        duration: "25:00",
        trainingLoad: 80.3,
      },
    ]);
  });

  it("adds strength sets and the laps of recent activities, races and long runs", async () => {
    garminActivities = [
      activity(10, "2026-10-26", "strength_training"),
      activity(11, "2026-10-25"),
      activity(12, "2026-10-24"),
      activity(13, "2026-10-23"),
      activity(14, "2026-10-22", "running", { eventType: { typeKey: "race" } }),
      activity(15, "2026-10-21", "trail_running", { distance: 16000 }),
      activity(16, "2026-10-20", "strength_training"),
    ];
    const out = JSON.parse(await dashboard.getDashboardData(1));
    const details = Object.fromEntries(
      out.activities.map((a: Record<string, unknown>) => [
        a.id,
        [Boolean(a.exercises), Boolean(a.laps)],
      ]),
    );
    expect(details).toEqual({
      10: [true, true],
      11: [false, true],
      12: [false, true],
      13: [false, false],
      14: [false, true],
      15: [false, true],
      16: [true, false],
    });
    expect(out.activities[0].exercises[0].exercise).toBe("Barbell Back Squat");
  });

  it("adds the laps of the last 8 sessions of each repeated run name, only when asked", async () => {
    garminActivities = [
      activity(30, "2026-10-26", "cycling"),
      activity(31, "2026-10-25", "cycling"),
      activity(32, "2026-10-24", "cycling"),
      ...Array.from({ length: 10 }, (_, i) =>
        activity(40 + i, `2026-10-${String(23 - i).padStart(2, "0")}`, "running", {
          activityName: "Tempo",
        }),
      ),
      activity(60, "2026-10-12", "running", { activityName: "Easy" }),
      activity(61, "2026-10-11", "cycling", { activityName: "Easy" }),
    ];
    // off by default: the 3 most recent only
    expect(withLaps(JSON.parse(await dashboard.getDashboardData(3)))).toEqual([30, 31, 32]);
    // the 8 most recent Tempo runs; one Easy run and a ride do not make a repeat
    expect(withLaps(JSON.parse(await dashboard.getDashboardData(3, true)))).toEqual([
      30, 31, 32, 40, 41, 42, 43, 44, 45, 46, 47,
    ]);
  });

  it("also gives laps to an older session of a workout whose .FIT file is saved, without a download", async () => {
    garminActivities = Array.from({ length: 10 }, (_, i) =>
      activity(40 + i, `2026-10-${String(23 - i).padStart(2, "0")}`, "running", {
        activityName: "Tempo",
      }),
    );
    // the oldest session was downloaded before, for example when it was one of the newest
    const client = api as unknown as GarminApiClient;
    await new GarminTools(client, dataDir).fetchFit(49);
    api.getBytes.mockClear();
    const out = JSON.parse(await dashboard.getDashboardData(3, true));
    expect(withLaps(out)).toEqual([40, 41, 42, 43, 44, 45, 46, 47, 49]);
    // the 8 newest are downloaded, the saved one is read from the data folder
    expect(api.getBytes).toHaveBeenCalledTimes(8);
  });

  it("gives laps to the same activities as the demo scripts, which show what the server gives", async () => {
    garminActivities = [
      activity(70, "2026-10-26", "cycling"),
      activity(71, "2026-10-25", "strength_training"),
      activity(72, "2026-10-24", "cycling"),
      activity(73, "2026-10-23", "running", { eventType: { typeKey: "race" } }),
      activity(74, "2026-10-22", "trail_running", { distance: 16000 }),
      activity(75, "2026-10-21", "cycling", { distance: 40000 }),
      ...Array.from({ length: 9 }, (_, i) =>
        activity(80 + i, `2026-10-${String(20 - i).padStart(2, "0")}`, "running", {
          // one workout, run in two places
          activityName: i % 2 ? "Hillview - Tempo" : "Riverside - Tempo",
        }),
      ),
    ];
    for (const workouts of [false, true]) {
      const out = JSON.parse(await dashboard.getDashboardData(3, workouts));
      const demo = asServer(
        out.activities.map((a: Record<string, unknown>) => ({ ...a, laps: [] })),
        workouts,
      );
      expect([workouts, withLaps({ activities: demo })]).toEqual([workouts, withLaps(out)]);
    }
    // one workout in two places: its 8 newest sessions, not the 9 of both names
    expect(withLaps(JSON.parse(await dashboard.getDashboardData(3, true)))).toEqual([
      70, 71, 72, 73, 74, 80, 81, 82, 83, 84, 85, 86, 87,
    ]);
    // a page updated for months has every .FIT file saved: also the oldest session has its laps
    await new GarminTools(api as unknown as GarminApiClient, dataDir).fetchFit(88);
    const saved = JSON.parse(await dashboard.getDashboardData(3, true));
    const demo = asServer(
      saved.activities.map((a: Record<string, unknown>) => ({ ...a, laps: [] })),
      true,
      true,
    );
    expect(withLaps({ activities: demo })).toEqual(withLaps(saved));
    expect(withLaps(saved)).toContain(88);
  });

  it("reports a detail that cannot be read on the activity", async () => {
    garminActivities = [activity(20, "2026-10-26", "strength_training")];
    api.getBytes.mockRejectedValue(
      new GarminApiError("GET /download-service/files/activity/20 -> HTTP 404: gone"),
    );
    const out = JSON.parse(await dashboard.getDashboardData(1));
    expect(out.activities[0].detailError).toBe(
      "GET /download-service/files/activity/20 -> HTTP 404: gone",
    );
  });

  it("keeps the cache file unchanged when the activity list answer is unexpected", async () => {
    garminActivities = [activity(1, "2026-10-26")];
    await dashboard.getDashboardData(1);
    const before = readFileSync(cacheFile(), "utf8");
    api.getJson.mockImplementation(async (path, q) =>
      path.startsWith("/activitylist") ? { message: "maintenance" } : fakeGarmin(path, q),
    );
    await expect(dashboard.getDashboardData(1)).rejects.toThrow(
      'Unexpected activity list response: {"message":"maintenance"}',
    );
    expect(readFileSync(cacheFile(), "utf8")).toBe(before);
  });

  it.each([
    [undefined, 12],
    [0, 1],
    [60, 52],
  ])("clamps weeks %s to %s", async (weeks, expected) => {
    expect(JSON.parse(await dashboard.getDashboardData(weeks)).weeks).toBe(expected);
  });

  it("runs one call at a time, so two calls never write the cache together", async () => {
    garminActivities = [activity(1, "2026-10-26")];
    const [a, b] = await Promise.all([
      dashboard.getDashboardData(1),
      dashboard.getDashboardData(1),
    ]);
    expect(JSON.parse(a).sync.newActivities).toBe(1);
    expect(JSON.parse(b).sync.newActivities).toBe(0);
    expect(existsSync(`${cacheFile()}.tmp`)).toBe(false);
  });

  it("skips HRV entries without a valid date", async () => {
    api.getJson.mockImplementation(async (path, q) =>
      path.startsWith("/hrv-service")
        ? {
            hrvSummaries: [
              { lastNightAvg: 1 },
              { calendarDate: "2026-13-01", lastNightAvg: 2 },
              { calendarDate: "2026-10-26", lastNightAvg: 3 },
            ],
          }
        : fakeGarmin(path, q),
    );
    const out = JSON.parse(await dashboard.getDashboardData(1));
    expect(out.hrv).toEqual([{ date: "2026-10-26", hrv: 3 }]);
    expect(Object.keys(readCache().hrv)).toEqual(["2026-10-26"]);
  });

  it("drops recovery rows older than the window from the cache", async () => {
    const old = { date: "2026-09-01", sleepH: 1 };
    writeFileSync(
      cacheFile(),
      JSON.stringify({ recovery: { "2026-09-01": old, "2026-10-01": old } }),
    );
    await dashboard.getDashboardData(1);
    expect(Object.keys(readCache().recovery)).not.toContain("2026-09-01");
    expect(Object.keys(readCache().recovery)).toContain("2026-10-01");
  });
});
