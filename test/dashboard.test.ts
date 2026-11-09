import {
  existsSync,
  mkdirSync,
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
import { GarminApiError, KeyRefusedError, type GarminApiClient } from "../src/api-client";
import {
  covered,
  GarminDashboard,
  jsonByLines,
  rangeSummary,
  recoveryChunks,
  recoveryRefreshFrom,
  recoveryRow,
  toFetch,
} from "../src/dashboard";
import { filterData } from "../src/dashboard-page";
import { addDays } from "../src/dates";
import { digest } from "../src/digest";
import { log as logMock } from "../src/log";
import { groupOf } from "../src/analytics/calc";
import { periodWindow } from "../src/analytics/metrics";
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

  it("fetches only the refresh window of the cached days and the new ones", () => {
    // last sync on 20 Oct: refetch 7-20 Oct (they could still change) and everything after
    expect(ranges(toFetch(FROM, "2026-10-20", FROM, TO))).toEqual(["2026-10-07..2026-10-26"]);
    expect(ranges(toFetch(FROM, TO, FROM, TO))).toEqual(["2026-10-13..2026-10-26"]);
  });

  it("starts the refresh at the window when the cache ends on its first day", () => {
    expect(ranges(toFetch("2026-07-01", FROM, FROM, TO))).toEqual(["2026-08-03..2026-10-26"]);
  });

  it("also fetches the missing start of a longer window", () => {
    expect(ranges(toFetch(FROM, TO, "2026-05-04", TO))).toEqual([
      "2026-05-04..2026-08-02",
      "2026-10-13..2026-10-26",
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
      "2026-11-16..2026-11-23",
    ]);
  });

  it("never starts the refresh before the cached range, so the two ranges do not overlap", () => {
    expect(ranges(toFetch("2026-11-16", "2026-11-23", "2026-10-01", "2026-11-23"))).toEqual([
      "2026-10-01..2026-11-15",
      "2026-11-16..2026-11-23",
    ]);
  });

  it("joins touching and overlapping ranges", () => {
    expect(covered(FROM, TO, "2026-10-27", "2026-11-02")).toEqual(["2026-08-03", "2026-11-02"]);
    expect(covered(FROM, TO, "2026-07-01", TO)).toEqual(["2026-07-01", "2026-10-26"]);
    expect(covered(undefined, undefined, FROM, TO)).toEqual(["2026-08-03", "2026-10-26"]);
  });

  it("refreshes recovery from the last sync, not from today", () => {
    // last call on Monday 19 Oct, next on Monday 26 Oct: 6 to 19 Oct may be incomplete
    expect(recoveryRefreshFrom("2026-10-19", TO)).toBe("2026-10-06");
    expect(recoveryRefreshFrom(undefined, TO)).toBe("2026-10-13");
    expect(recoveryRefreshFrom("2026-10-31", TO)).toBe("2026-10-13");
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

  it("removes its temp file and passes on the error when the move fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "garmin-dash-"));
    // a folder with a file in it cannot be replaced by a file
    const target = join(dir, "a.fit");
    mkdirSync(target);
    writeFileSync(join(target, "x"), "");
    await expect(writeAtomically(target, "data")).rejects.toThrow();
    expect(readdirSync(dir)).toEqual(["a.fit"]);
  });
});

const SLEEP_RANGE = "/sleep-service/sleep/dailySleepSummariesByDate";
const SUMMARY_RANGE = "/usersummary-service/v2/dailysummaries";
const daysOf = (from: string, to: string) => {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
};

const spans = (days: string[]) => recoveryChunks(days).map(([a, b]) => `${a}..${b}`);
const run = (n: number) => daysOf("2026-01-01", addDays("2026-01-01", n - 1));

describe("recoveryChunks", () => {
  it("gives no span for no day, and one span for one day", () => {
    expect(spans([])).toEqual([]);
    expect(spans(["2026-10-26"])).toEqual(["2026-10-26..2026-10-26"]);
  });

  it("cuts a span after 31 days", () => {
    expect(spans(run(31))).toEqual(["2026-01-01..2026-01-31"]);
    expect(spans(run(32))).toEqual(["2026-01-01..2026-01-31", "2026-02-01..2026-02-01"]);
    expect(spans(run(63))).toHaveLength(3);
  });

  it("joins days that are 30 days apart and cuts 31 days apart", () => {
    expect(spans(["2026-01-01", "2026-01-31"])).toEqual(["2026-01-01..2026-01-31"]);
    expect(spans(["2026-01-01", "2026-02-01"])).toHaveLength(2);
    expect(spans(["2026-01-01", "2026-02-10"])).toHaveLength(2);
  });
});

describe("rangeSummary", () => {
  it("gives the names of a single-day summary", () => {
    const row = rangeSummary({
      calendarDate: "2026-10-25",
      heartRate: { restingValue: 49 },
      bodyBattery: { maxValue: 53, minValue: 12 },
      stress: { avgLevel: 31 },
      movement: { steps: { value: 15037, goal: 14520 }, floorsAscended: { value: 93 } },
    });
    expect(recoveryRow("2026-10-25", null, row)).toEqual({
      date: "2026-10-25",
      rhr: 49,
      bbHigh: 53,
      bbLow: 12,
      stress: 31,
      steps: 15037,
      stepGoal: 14520,
      floors: 93,
    });
  });

  it.each([null, 7, {}, { heartRate: 3, movement: { steps: null } }])(
    "gives a row of the date only for %j",
    (row) => {
      expect(recoveryRow("2026-10-25", null, rangeSummary(row))).toEqual({ date: "2026-10-25" });
    },
  );
});

describe("recoveryRow", () => {
  it("keeps the dashboard fields of sleep and the daily summary", () => {
    const row = recoveryRow(
      "2026-10-25",
      {
        sleepTimeSeconds: 21240,
        deepSleepSeconds: 6000,
        lightSleepSeconds: 13500,
        awakeSleepSeconds: 600,
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
      '{"date":"2026-10-25","sleepH":5.9,"deep":1.67,"light":3.75,"rem":0.23,"awake":0.17,' +
        '"sleepScore":44,' +
        '"needH":7.5,"bedMin":1431,"rhr":49,"bbHigh":53,"bbLow":12,"steps":15037,' +
        '"stepGoal":14520,"floors":93}',
    );
  });

  it("rounds the floors down, as Garmin does in its ranges", () => {
    expect(recoveryRow("2026-10-25", null, { floorsAscended: 93.9 }).floors).toBe(93);
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
const get = async () => JSON.parse(await dashboard.getDashboardData(1));
const profile = async () => {
  units = "statute_us";
  locale = "pt_BR";
  return get();
};
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
  // a ride is sportTypeId 2 in Garmin's data; the run check reads the sport
  sportTypeId: type === "cycling" ? 2 : 1,
  distance: 5000,
  movingDuration: 1500,
  ...extra,
});
/** The ids of the activities that have laps. */
const withLaps = (out: { activities: Record<string, unknown>[] }) =>
  out.activities.filter((a) => a.laps).map((a) => a.id);
/** One run and one ride in the weeks before the period. */
const previous = async () => {
  garminActivities = [
    activity(5, "2026-09-25", "running", { averageHR: 150 }),
    activity(6, "2026-10-05", "cycling", { sportTypeId: 2 }),
  ];
  return JSON.parse(await dashboard.getDashboardData(2));
};

const callsTo = (prefix: string) =>
  api.getJson.mock.calls.filter(([path]) => String(path).startsWith(prefix));

const RECOVERY_PATHS = [
  SLEEP_RANGE,
  SUMMARY_RANGE,
  "/sleep-service/sleep/dailySleep",
  "/usersummary-service/usersummary/daily",
];
/** The recovery calls, by path and query. */
const recoveryCalls = () =>
  api.getJson.mock.calls.filter(([path]) => RECOVERY_PATHS.includes(String(path)));

/** Makes the given paths answer their own way. */
const answer = (overrides: Record<string, (q: Record<string, string>) => unknown>) =>
  api.getJson.mockImplementation(async (path, q) =>
    path in overrides ? overrides[path](q) : fakeGarmin(path, q),
  );
const recoveryByDay = (out: { recovery: Record<string, unknown>[] }) =>
  Object.fromEntries(out.recovery.map((r) => [r.date, r]));
const recoveryPaths = () => recoveryCalls().map(([p]) => p);

const rateLimit = () => new GarminApiError("GET /x -> HTTP 429: slow down", 429);
const fiveSessions = () => [
  activity(1, "2026-10-26", "strength_training"),
  activity(2, "2026-10-25", "strength_training"),
  activity(3, "2026-10-24", "strength_training"),
  activity(4, "2026-10-23", "strength_training"),
  activity(5, "2026-10-22", "strength_training"),
];

const refuse = () => {
  throw new GarminApiError("GET range -> HTTP 400: no", 400);
};

function fakeGarmin(path: string, q: Record<string, string>) {
  if ([...failing].some((p) => path.startsWith(p)))
    throw new GarminApiError(`GET ${path} -> HTTP 500: down`, 500);
  if (path === "/activitylist-service/activities/search/activities") {
    const rows = garminActivities.filter((a) => {
      const day = String(a.startTimeLocal).slice(0, 10);
      return day >= q.startDate && day <= q.endDate;
    });
    // as Garmin: a page of about 190 or more activities answers HTTP 500
    if (rows.length - Number(q.start) >= 190 && Number(q.limit) >= 190)
      throw new GarminApiError(`GET ${path} -> HTTP 500: too many`, 500);
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
  if (path === SLEEP_RANGE) {
    const days = daysOf(q.startDate, q.endDate);
    if (days.some((d) => failingSleep.has(d)))
      throw new GarminApiError(`GET ${path} -> HTTP 500: down`, 500);
    return days.map((calendarDate) => ({ calendarDate, sleepTimeSeconds: 27000 }));
  }
  if (path === SUMMARY_RANGE) {
    return {
      data: daysOf(q.startDate, q.endDate).map((calendarDate) => ({
        calendarDate,
        heartRate: { restingValue: 50 },
      })),
    };
  }
  if (path === "/sleep-service/sleep/dailySleep") {
    if (failingSleep.has(q.date)) throw new GarminApiError(`GET ${path} -> HTTP 500: down`, 500);
    return { sleepTimeSeconds: 27000 };
  }
  if (path === "/usersummary-service/usersummary/daily") return { restingHeartRate: 50 };
  if (path === "/biometric-service/heartRateZones/v2") return [{ zone: 1 }];
  if (path.startsWith("/fitnessage-service/fitnessage/v2/")) return { fitnessAge: 40 };
  if (path === "/userprofile-service/userprofile/settings")
    return { measurementSystem: units, preferredLocale: locale };
  throw new Error(`unexpected path ${path}`);
}

/** A cached recovery row with only a date and a sleep time. */
const oneRow = (date: string) => ({ date, sleepH: 1 });
/** Range answers with every field of a recovery row, and no sleep score on 2026-01-05. */
const rich = () =>
  answer({
    [SLEEP_RANGE]: (q) =>
      daysOf(q.startDate, q.endDate).map((calendarDate) => ({
        calendarDate,
        sleepTimeSeconds: 27000,
        deepSleepSeconds: 6000,
        sleepScores: { overall: { value: calendarDate === "2026-01-05" ? null : 80 } },
        sleepNeed: { actual: 450 },
        sleepStartTimestampLocal: 1792885868000,
      })),
    [SUMMARY_RANGE]: (q) => ({
      data: daysOf(q.startDate, q.endDate).map((calendarDate) => ({
        calendarDate,
        heartRate: { restingValue: 50 },
        bodyBattery: { maxValue: 53, minValue: 12 },
        stress: { avgLevel: 31 },
        movement: { steps: { value: 9000, goal: 10000 } },
      })),
    }),
  });
/** The spans that the sleep range was asked for, in the order of the requests. */
const sleepSpans = () =>
  recoveryCalls()
    .filter(([p]) => p === SLEEP_RANGE)
    .map(([, q]): [string, string] => [q.startDate, q.endDate]);
const warns = () =>
  vi
    .mocked(logMock)
    .mock.calls.filter(
      ([level, message]) => level === "WARN" && message.startsWith("Recovery data"),
    )
    .map(([, message]) => message);
const restore = () => api.getJson.mockImplementation(async (path, q) => fakeGarmin(path, q));

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

describe("the period", () => {
  it.each([
    ["Monday", new Date(2026, 9, 26, 12)],
    ["Wednesday", new Date(2026, 9, 28, 12)],
    ["Sunday", new Date(2026, 10, 1, 12)],
  ])("starts on a Monday when today is a %s", async (_day, now) => {
    vi.setSystemTime(now);
    const out = JSON.parse(await dashboard.getDashboardData(2));
    expect(out).toMatchObject({
      start: "2026-10-12",
      prevEnd: "2026-10-11",
      prevStart: "2026-09-21",
    });
  });

  it.each([
    [1, "2026-10-19", 1],
    [undefined, "2026-08-03", 12],
    [52, "2025-10-27", 52],
    [100, "2025-10-27", 52],
  ])("starts on a Monday for weeks %s", async (weeks, start, count) => {
    vi.setSystemTime(new Date(2026, 9, 28, 12));
    const out = JSON.parse(await dashboard.getDashboardData(weeks));
    expect(out.start).toBe(start);
    expect(out.weeks).toBe(count);
  });

  it.each([
    [new Date(2027, 0, 3, 12), "2026-12-14", "2026-12-13", "2026-11-23"],
    [new Date(2026, 9, 25, 12), "2026-10-05", "2026-10-04", "2026-09-14"],
    [new Date(2027, 2, 28, 12), "2027-03-08", "2027-03-07", "2027-02-15"],
  ])(
    "keeps the Monday across a new year and a time change, case %#",
    async (now, start, prevEnd, prevStart) => {
      vi.setSystemTime(now);
      const out = JSON.parse(await dashboard.getDashboardData(2));
      expect(out).toMatchObject({ start, prevEnd, prevStart });
    },
  );

  it("asks for the HRV from the Monday", async () => {
    vi.setSystemTime(new Date(2026, 9, 28, 12));
    await dashboard.getDashboardData(2);
    expect(String(callsTo("/hrv-service/hrv/daily/")[0][0])).toContain("/2026-10-12/");
  });

  it("moves the cache of a server that started on a Wednesday back to the Monday", async () => {
    vi.setSystemTime(new Date(2026, 9, 28, 12));
    await dashboard.getDashboardData(2);
    const cache = readCache();
    cache.activitiesFrom = "2026-09-23";
    cache.hrvFrom = "2026-10-14";
    writeFileSync(cacheFile(), JSON.stringify(cache));
    api.getJson.mockClear();
    garminActivities = [activity(3, "2026-09-22")];
    const out = JSON.parse(await dashboard.getDashboardData(2));
    expect(readCache().activitiesFrom).toBe("2026-09-21");
    expect(readCache().hrvFrom).toBe("2026-10-12");
    expect(String(callsTo("/hrv-service/hrv/daily/")[0][0])).toContain("/2026-10-12/");
    expect(out.previousActivities.map((a: { id: number }) => a.id)).toEqual([3]);
  });

  it("splits the activities at the Monday and has no partial week", async () => {
    vi.setSystemTime(new Date(2026, 9, 28, 12));
    garminActivities = [activity(1, "2026-10-12"), activity(2, "2026-10-11")];
    const out = JSON.parse(await dashboard.getDashboardData(2));
    expect(out.activities.map((a: { id: number }) => a.id)).toEqual([1]);
    expect(out.previousActivities.map((a: { id: number }) => a.id)).toEqual([2]);
    expect(periodWindow(out.start, out.end, out.prevStart).partial).toBe(false);
    expect(Object.values(digest(out).weekly).some((w) => w.partial)).toBe(false);
  });
});

describe("the period comparison", () => {
  it.each([
    ["Monday", new Date(2026, 9, 26, 12)],
    ["Tuesday", new Date(2026, 9, 27, 12)],
    ["Wednesday", new Date(2026, 9, 28, 12)],
    ["Thursday", new Date(2026, 9, 29, 12)],
    ["Friday", new Date(2026, 9, 30, 12)],
    ["Saturday", new Date(2026, 9, 31, 12)],
    ["Sunday", new Date(2026, 10, 1, 12)],
  ])("has the dates of the digest when today is a %s", async (_day, now) => {
    vi.setSystemTime(now);
    const out = JSON.parse(await dashboard.getDashboardData(2));
    const { from, to } = digest(out).period.previousPeriod as { from: string; to: string };
    expect(periodWindow(out.start, out.end, out.prevStart)).toMatchObject({ from, to });
  });
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

/**
 * How many of 32 strength sessions with sets keep them, and their plan verdicts, in a demo, on a first
 * build or with every file saved.
 */
const keptSets = (saved: boolean) => {
  const out = asServer(
    Array.from({ length: 32 }, (_, i) => ({
      id: i,
      type: "strength_training",
      exercises: [],
      planVerdicts: null,
    })),
    false,
    saved,
  );
  return [out.filter((a) => a.exercises).length, out.filter((a) => "planVerdicts" in a).length];
};

const ids = (out: { activities: { id: number }[] }) => out.activities.map((a) => a.id).toSorted();
/** Range answers without any day. */
const empty = { [SLEEP_RANGE]: () => [], [SUMMARY_RANGE]: () => ({ data: [] }) };
/** The sleep range fails, so days are read one by one; each day's sleep answer is the given one. */
const oneByOne = (sleep: unknown) =>
  answer({
    [SLEEP_RANGE]: () => {
      throw new GarminApiError("GET range -> HTTP 500: down", 500);
    },
    "/sleep-service/sleep/dailySleep": () => sleep,
    "/usersummary-service/usersummary/daily": () => ({}),
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
    // 1 activity page + 1 HRV range + 2 recovery ranges + zones + fitness age + settings
    expect(out.sync).toEqual({
      garminCalls: 7,
      // the laps of the one activity
      fitDownloads: 1,
      newActivities: 1,
      failedDays: 0,
      failedDates: [],
      failedSections: [],
      failedDetails: 0,
      stoppedEarly: false,
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

  it("asks Garmin only for the last 14 days on the next call", async () => {
    garminActivities = [activity(1, "2026-10-20")];
    await dashboard.getDashboardData(2);
    api.getJson.mockClear();
    garminActivities.push(activity(4, "2026-10-26"));

    const out = JSON.parse(await dashboard.getDashboardData(2));
    expect(callsTo("/activitylist").map(([, q]) => [q.startDate, q.endDate])).toEqual([
      ["2026-10-13", "2026-10-26"],
    ]);
    expect(callsTo("/hrv-service").map(([p]) => p)).toEqual([
      "/hrv-service/hrv/daily/2026-10-13/2026-10-26",
    ]);
    expect(recoveryCalls().map(([p, q]) => [p, q.startDate, q.endDate])).toEqual([
      [SLEEP_RANGE, "2026-10-13", "2026-10-26"],
      [SUMMARY_RANGE, "2026-10-13", "2026-10-26"],
    ]);
    expect(out.activities.map((a: { id: number }) => a.id)).toEqual([4, 1]);
    expect(out.sync).toMatchObject({ garminCalls: 7, newActivities: 1, cachedActivities: 2 });
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

  it("fetches the activities again, once, when the cache is from before a new summary field", async () => {
    garminActivities = [activity(1, "2026-10-20")];
    await dashboard.getDashboardData(2);
    const cache = readCache();
    delete cache.activitiesSummary;
    writeFileSync(cacheFile(), JSON.stringify(cache));
    api.getJson.mockClear();

    await dashboard.getDashboardData(2);
    expect(callsTo("/activitylist").map(([, q]) => [q.startDate, q.endDate])).toEqual([
      ["2026-09-21", "2026-10-26"],
    ]);
    api.getJson.mockClear();
    await dashboard.getDashboardData(2);
    expect(callsTo("/activitylist").map(([, q]) => [q.startDate, q.endDate])).toEqual([
      ["2026-10-13", "2026-10-26"],
    ]);
  });

  it("fetches the whole activity period once for a cache of the previous summary version", async () => {
    garminActivities = [activity(1, "2026-10-20")];
    await dashboard.getDashboardData(2);
    expect(readCache().activitiesSummary).toBe(3);
    // a session that the old two-day window lost: it is in Garmin, not in the cache
    garminActivities.push(activity(2, "2026-10-01"));
    writeFileSync(cacheFile(), JSON.stringify({ ...readCache(), activitiesSummary: 2 }));
    api.getJson.mockClear();

    await dashboard.getDashboardData(2);
    expect(callsTo("/activitylist").map(([, q]) => [q.startDate, q.endDate])).toEqual([
      ["2026-09-21", "2026-10-26"],
    ]);
    expect(Object.keys(readCache().activities).toSorted()).toEqual(["1", "2"]);
    api.getJson.mockClear();
    await dashboard.getDashboardData(2);
    expect(callsTo("/activitylist").map(([, q]) => [q.startDate, q.endDate])).toEqual([
      ["2026-10-13", "2026-10-26"],
    ]);
  });

  describe("data that reaches Garmin late", () => {
    it("adds an activity of 5 days ago that Garmin gets after the last update", async () => {
      garminActivities = [activity(1, "2026-10-20")];
      await dashboard.getDashboardData(2);
      garminActivities.push(activity(2, "2026-10-21"));
      const out = JSON.parse(await dashboard.getDashboardData(2));
      expect(ids(out)).toEqual([1, 2]);
      expect(out.sync.newActivities).toBe(1);
    });

    it("shows a rename and a deletion on the first day of the window", async () => {
      garminActivities = [
        activity(1, "2026-10-13"),
        activity(2, "2026-10-13"),
        activity(3, "2026-10-20"),
      ];
      await dashboard.getDashboardData(2);
      garminActivities = [
        activity(1, "2026-10-13", "running", { activityName: "Renamed" }),
        activity(3, "2026-10-20"),
      ];
      const out = JSON.parse(await dashboard.getDashboardData(2));
      expect(ids(out)).toEqual([1, 3]);
      expect(out.activities.find((a: { id: number }) => a.id === 1).name).toBe("Renamed");
    });

    it("does not look for an activity of 14 days ago that appears late", async () => {
      garminActivities = [activity(1, "2026-10-20")];
      await dashboard.getDashboardData(2);
      garminActivities.push(activity(2, "2026-10-12"));
      const out = JSON.parse(await dashboard.getDashboardData(2));
      expect(ids(out)).toEqual([1]);
    });

    it("fills in a recovery day that was empty at the last update", async () => {
      answer(empty);
      let r = recoveryByDay(JSON.parse(await dashboard.getDashboardData(1)));
      expect(r["2026-10-20"]).toEqual({ date: "2026-10-20" });
      restore();
      r = recoveryByDay(JSON.parse(await dashboard.getDashboardData(1)));
      expect(r["2026-10-20"]).toEqual({ date: "2026-10-20", sleepH: 7.5, rhr: 50 });
    });

    it("keeps the values of a cached day that a later range leaves out, and updates the fields it has", async () => {
      await dashboard.getDashboardData(1);
      answer(empty);
      let r = recoveryByDay(JSON.parse(await dashboard.getDashboardData(1)));
      expect(r["2026-10-20"]).toEqual({ date: "2026-10-20", sleepH: 7.5, rhr: 50 });
      // only the sleep is in the answer: its new value wins and the resting heart rate stays
      answer({
        ...empty,
        [SLEEP_RANGE]: (q) =>
          daysOf(q.startDate, q.endDate).map((calendarDate) => ({
            calendarDate,
            sleepTimeSeconds: 3600,
          })),
      });
      r = recoveryByDay(JSON.parse(await dashboard.getDashboardData(1)));
      expect(r["2026-10-20"]).toEqual({ date: "2026-10-20", sleepH: 1, rhr: 50 });
    });

    it("does the same when the days are read one by one", async () => {
      await dashboard.getDashboardData(1);
      oneByOne({});
      let r = recoveryByDay(JSON.parse(await dashboard.getDashboardData(1)));
      expect(r["2026-10-20"]).toEqual({ date: "2026-10-20", sleepH: 7.5, rhr: 50 });
      oneByOne({ sleepTimeSeconds: 3600 });
      r = recoveryByDay(JSON.parse(await dashboard.getDashboardData(1)));
      expect(r["2026-10-20"]).toEqual({ date: "2026-10-20", sleepH: 1, rhr: 50 });
    });
  });

  it("drops a cached activity that Garmin no longer has in a refetched day", async () => {
    garminActivities = [activity(1, "2026-10-26"), activity(2, "2026-10-20")];
    await dashboard.getDashboardData(2);
    garminActivities = [activity(2, "2026-10-20")];
    const out = JSON.parse(await dashboard.getDashboardData(2));
    expect(out.activities.map((a: { id: number }) => a.id)).toEqual([2]);
    expect(Object.keys(readCache().activities)).toEqual(["2"]);
  });

  it("reads the activity list in pages of 100", async () => {
    garminActivities = Array.from({ length: 450 }, (_, i) => activity(1000 + i, "2026-10-20"));
    const out = JSON.parse(await dashboard.getDashboardData(1));
    expect(callsTo("/activitylist").map(([, q]) => q.start)).toEqual([
      "0",
      "100",
      "200",
      "300",
      "400",
    ]);
    expect(out.sync.cachedActivities).toBe(450);
  });

  it("asks for the sleep range and the summary range together", async () => {
    const log: string[] = [];
    api.getJson.mockImplementation(async (path, q) => {
      log.push(`start ${path}`);
      await Promise.resolve();
      log.push(`end ${path}`);
      return fakeGarmin(path, q);
    });
    await dashboard.getDashboardData(1);
    const sleep = log.indexOf(`start ${SLEEP_RANGE}`);
    expect(log[sleep + 1]).toBe(`start ${SUMMARY_RANGE}`);
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
    expect(recoveryCalls().map(([, q]) => q.startDate)).toEqual(["2026-10-13", "2026-10-13"]);
    expect(readCache().recoveryTo).toBe("2026-10-26");
  });

  describe("recovery from ranges", () => {
    it("asks each range once for the window, and no single day", async () => {
      await dashboard.getDashboardData(1);
      expect(recoveryCalls().map(([p, q]) => [p, q.startDate, q.endDate])).toEqual([
        [SLEEP_RANGE, "2026-10-13", "2026-10-26"],
        [SUMMARY_RANGE, "2026-10-13", "2026-10-26"],
      ]);
    });

    it("leaves the rows before the refresh day as they are", async () => {
      await dashboard.getDashboardData(52, false, true);
      answer({
        [SLEEP_RANGE]: (q) =>
          daysOf(q.startDate, q.endDate).map((calendarDate) => ({
            calendarDate,
            sleepTimeSeconds: 3600,
          })),
      });
      api.getJson.mockClear();
      const r = recoveryByDay(JSON.parse(await dashboard.getDashboardData(52, false, true)));
      expect(r["2026-10-12"]).toMatchObject({ sleepH: 7.5 });
      expect(r["2026-10-13"]).toMatchObject({ sleepH: 1 });
      expect(recoveryCalls().map(([, q]) => q.startDate)).toEqual(["2026-10-13", "2026-10-13"]);
    });

    it("keeps the row of a cached day between two needed days", async () => {
      await dashboard.getDashboardData(52, false, true);
      const cache = readCache();
      cache.recovery["2026-10-08"] = { date: "2026-10-08", rhr: 99 };
      delete cache.recovery["2026-10-05"];
      writeFileSync(cacheFile(), JSON.stringify(cache));
      api.getJson.mockClear();
      const r = recoveryByDay(JSON.parse(await dashboard.getDashboardData(52, false, true)));
      expect(recoveryCalls().map(([, q]) => [q.startDate, q.endDate])[0]).toEqual([
        "2026-10-05",
        "2026-10-26",
      ]);
      expect(r["2026-10-05"]).toMatchObject({ sleepH: 7.5, rhr: 50 });
      expect(r["2026-10-08"]).toEqual({ date: "2026-10-08", rhr: 99 });
    });

    it("gives a day left out of both answers a row of the date, and keeps what one answer has", async () => {
      answer({
        [SLEEP_RANGE]: (q) =>
          daysOf(q.startDate, q.endDate)
            .filter((d) => d !== "2026-10-20" && d !== "2026-10-21")
            .map((calendarDate) => ({ calendarDate, sleepTimeSeconds: 27000 })),
        [SUMMARY_RANGE]: (q) => ({
          data: daysOf(q.startDate, q.endDate)
            .filter((d) => d !== "2026-10-20" && d !== "2026-10-22")
            .map((calendarDate) => ({ calendarDate, heartRate: { restingValue: 50 } })),
        }),
      });
      const out = JSON.parse(await dashboard.getDashboardData(1));
      const r = recoveryByDay(out);
      expect(r["2026-10-20"]).toEqual({ date: "2026-10-20" });
      expect(r["2026-10-21"]).toEqual({ date: "2026-10-21", rhr: 50 });
      expect(r["2026-10-22"]).toEqual({ date: "2026-10-22", sleepH: 7.5 });
      expect(out.sync.failedDays).toBe(0);
    });

    it("puts a night without a date on the day of its sleep need", async () => {
      answer({
        [SLEEP_RANGE]: () => [{ sleepNeed: { calendarDate: "2026-10-24", actual: 480 } }],
      });
      const r = recoveryByDay(JSON.parse(await dashboard.getDashboardData(1)));
      expect(r["2026-10-24"]).toEqual({ date: "2026-10-24", needH: 8, rhr: 50 });
    });

    it("adds nothing for a row without a date, outside the window, null or named __proto__", async () => {
      answer({
        [SLEEP_RANGE]: () => [
          { sleepTimeSeconds: 3600 },
          { calendarDate: "2026-01-01", sleepTimeSeconds: 3600 },
          null,
          { calendarDate: "__proto__", sleepTimeSeconds: 3600 },
        ],
        [SUMMARY_RANGE]: () => ({
          data: [
            { heartRate: { restingValue: 1 } },
            { calendarDate: "2026-01-01", heartRate: { restingValue: 1 } },
            null,
            { calendarDate: "__proto__", heartRate: { restingValue: 1 } },
          ],
        }),
      });
      const out = JSON.parse(await dashboard.getDashboardData(1));
      expect(out.recovery).toHaveLength(14);
      for (const r of out.recovery) expect(Object.keys(r)).toEqual(["date"]);
      expect(Object.keys(readCache().recovery)).not.toContain("__proto__");
      expect(Object.keys(readCache().recovery)).not.toContain("2026-01-01");
      expect(({} as Record<string, unknown>).sleepH).toBeUndefined();
      expect(({} as Record<string, unknown>).rhr).toBeUndefined();
    });

    it("keeps the old row, writes nothing from the other range, and fetches again when a range and its days fail", async () => {
      await dashboard.getDashboardData(1);
      answer({
        [SUMMARY_RANGE]: (q) => ({
          data: daysOf(q.startDate, q.endDate).map((calendarDate) => ({
            calendarDate,
            heartRate: { restingValue: 77 },
          })),
        }),
      });
      failingSleep.add("2026-10-25");
      failingSleep.add("2026-10-26");
      const out = JSON.parse(await dashboard.getDashboardData(1));
      expect(out.sync.failedDates).toEqual(["2026-10-25", "2026-10-26"]);
      expect(recoveryByDay(out)["2026-10-26"]).toEqual({
        date: "2026-10-26",
        sleepH: 7.5,
        rhr: 50,
      });
      expect(readCache().recoveryTo).toBe("2026-10-25");
      failingSleep.clear();
      const again = JSON.parse(await dashboard.getDashboardData(1));
      expect(again.sync.failedDates).toEqual([]);
      expect(recoveryByDay(again)["2026-10-26"]).toMatchObject({ rhr: 77 });
      expect(readCache().recoveryTo).toBe("2026-10-26");
    });

    it("reads the days one by one when the ranges answer HTTP 400", async () => {
      answer({ [SLEEP_RANGE]: refuse, [SUMMARY_RANGE]: refuse });
      failingSleep.add("2026-10-26");
      const out = JSON.parse(await dashboard.getDashboardData(1));
      expect(out.sync.failedDates).toEqual(["2026-10-26"]);
      expect(out.recovery).toHaveLength(13);
      expect(out.recovery[0]).toEqual({ date: "2026-10-13", sleepH: 7.5, rhr: 50 });
      expect(recoveryPaths()).toHaveLength(2 + 14 * 2);
    });

    it.each([
      ["a sleep range that is an object", { [SLEEP_RANGE]: () => ({}) }],
      ["a summary range that is a list", { [SUMMARY_RANGE]: () => [] }],
      ["a sleep range that is null", { [SLEEP_RANGE]: () => null }],
      ["a summary range that is null", { [SUMMARY_RANGE]: () => null }],
      ["a summary range with data null", { [SUMMARY_RANGE]: () => ({ data: null }) }],
      ["a summary range with data an empty object", { [SUMMARY_RANGE]: () => ({ data: {} }) }],
      ["a summary range that is an empty object", { [SUMMARY_RANGE]: () => ({}) }],
    ])("reads the days one by one for %s", async (_, over) => {
      answer(over);
      const out = JSON.parse(await dashboard.getDashboardData(1));
      expect(out.sync.failedDates).toEqual([]);
      expect(out.recovery).toHaveLength(14);
      expect(out.recovery[0]).toEqual({ date: "2026-10-13", sleepH: 7.5, rhr: 50 });
      expect(recoveryPaths()).toContain("/sleep-service/sleep/dailySleep");
    });

    it.each([
      ["sleep", SLEEP_RANGE],
      ["summary", SUMMARY_RANGE],
    ])("reads the days one by one when the %s range answers a bare string", async (_, path) => {
      answer({ [path]: () => "oops" });
      const out = JSON.parse(await dashboard.getDashboardData(1));
      expect(out.sync.failedDates).toEqual([]);
      expect(out.recovery).toHaveLength(14);
      expect(out.recovery[0]).toEqual({ date: "2026-10-13", sleepH: 7.5, rhr: 50 });
      expect(recoveryPaths()).toContain("/sleep-service/sleep/dailySleep");
    });

    it.each([
      ["a network failure", new GarminApiError("Network error calling /x: down")],
      ["a refused key", new KeyRefusedError("key refused")],
      ["HTTP 429", new GarminApiError("GET /x -> HTTP 429: slow down", 429)],
    ])("does not read the days one by one after %s", async (_, error) => {
      answer({
        [SLEEP_RANGE]: () => {
          throw error;
        },
      });
      const out = JSON.parse(await dashboard.getDashboardData(1));
      expect(recoveryCalls()).toHaveLength(2);
      expect(out.sync.failedDates).toEqual(daysOf("2026-10-13", "2026-10-26"));
      expect(out.recovery).toEqual([]);
    });

    it.each([
      ["sleep", SLEEP_RANGE, 403],
      ["sleep", SLEEP_RANGE, 404],
      ["sleep", SLEEP_RANGE, 500],
      ["sleep", SLEEP_RANGE, 503],
      ["summary", SUMMARY_RANGE, 500],
    ])("reads the days one by one when the %s range answers HTTP %i", async (_, path, status) => {
      answer({
        [path]: () => {
          throw new GarminApiError(`GET range -> HTTP ${status}: no`, status);
        },
      });
      const out = JSON.parse(await dashboard.getDashboardData(1));
      expect(out.sync.failedDates).toEqual([]);
      expect(out.recovery).toHaveLength(14);
      expect(out.recovery[0]).toEqual({ date: "2026-10-13", sleepH: 7.5, rhr: 50 });
      expect(recoveryPaths()).toHaveLength(2 + 14 * 2);
    });

    it.each([
      ["a network failure", new GarminApiError("Network error calling /x: down")],
      ["a refused key", new KeyRefusedError("key refused")],
      ["HTTP 429", new GarminApiError("GET /x -> HTTP 429: slow down", 429)],
    ])("does not read the days one by one after %s on the summary range", async (_, error) => {
      answer({
        [SUMMARY_RANGE]: () => {
          throw error;
        },
      });
      const out = JSON.parse(await dashboard.getDashboardData(1));
      expect(recoveryCalls()).toHaveLength(2);
      expect(recoveryPaths()).toEqual([SLEEP_RANGE, SUMMARY_RANGE]);
      expect(out.sync.failedDates).toEqual(daysOf("2026-10-13", "2026-10-26"));
      expect(out.recovery).toEqual([]);
    });

    it("gives a row of the date to each day when both ranges answer lists with no row", async () => {
      answer({ [SLEEP_RANGE]: () => [], [SUMMARY_RANGE]: () => ({ data: [] }) });
      const out = JSON.parse(await dashboard.getDashboardData(1));
      expect(out.recovery).toEqual(daysOf("2026-10-13", "2026-10-26").map((date) => ({ date })));
      expect(out.sync.failedDates).toEqual([]);
      expect(recoveryCalls()).toHaveLength(2);
    });

    it("passes on an error that is not a Garmin error from a day read after a range fails", async () => {
      answer({
        [SLEEP_RANGE]: () => {
          throw new GarminApiError("GET range -> HTTP 500: down", 500);
        },
        "/sleep-service/sleep/dailySleep": () => {
          throw new TypeError("bug in a day");
        },
      });
      await expect(dashboard.getDashboardData(1)).rejects.toThrow("bug in a day");
    });
  });

  describe("recovery history", () => {
    // today is Monday 2026-10-26: 52 weeks start on 2025-10-27, 365 days, 12 spans of at most 31 days
    // (11 of 31 days and the newest of 24, from 2026-10-03), so 24 range requests
    const FIRST = "2025-10-27";
    const NEWEST = "2026-10-03";
    it("asks for the last 14 days only, and keeps whole rows, without the setting", async () => {
      rich();
      const out = JSON.parse(await dashboard.getDashboardData(52));
      expect(recoveryCalls().map(([p, q]) => [p, q.startDate, q.endDate])).toEqual([
        [SLEEP_RANGE, "2026-10-13", "2026-10-26"],
        [SUMMARY_RANGE, "2026-10-13", "2026-10-26"],
      ]);
      expect(out.recovery).toHaveLength(14);
      for (const r of out.recovery) {
        expect(r).toEqual(readCache().recovery[r.date]);
        expect(r).toHaveProperty("bbHigh", 53);
      }
    });

    it("asks for every span of the period, the newest first, and gives a row for each day", async () => {
      const out = JSON.parse(await dashboard.getDashboardData(52, false, true));
      const asked = sleepSpans();
      expect(recoveryCalls()).toHaveLength(24);
      expect(asked).toHaveLength(12);
      expect(asked[0]).toEqual([NEWEST, "2026-10-26"]);
      const starts = asked.map(([start]) => start);
      expect(starts).toEqual(starts.toSorted().toReversed());
      const oldestFirst = asked.toReversed();
      expect(oldestFirst[0][0]).toBe(FIRST);
      oldestFirst.forEach(([start, end], i) => {
        expect(daysOf(start, end).length).toBeLessThanOrEqual(31);
        if (i > 0) expect(start).toBe(addDays(oldestFirst[i - 1][1], 1));
      });
      expect(oldestFirst.at(-1)![1]).toBe("2026-10-26");
      const summaries = recoveryCalls().filter(([p]) => p === SUMMARY_RANGE);
      expect(summaries.map(([, q]) => [q.startDate, q.endDate])).toEqual(asked);
      expect(out.recovery.map((r: { date: string }) => r.date)).toEqual(
        daysOf(FIRST, "2026-10-26"),
      );
      expect(out.recovery).toHaveLength(365);
    });

    it("keeps whole rows for the last 14 days and short rows for the older days, and whole rows in the cache", async () => {
      rich();
      const out = JSON.parse(await dashboard.getDashboardData(52, false, true));
      const rows = recoveryByDay(out);
      const cache = readCache().recovery;
      expect(rows["2026-10-20"]).toEqual(cache["2026-10-20"]);
      expect(rows["2026-10-13"]).toHaveProperty("bbHigh", 53);
      expect(rows["2026-10-12"]).toEqual({
        date: "2026-10-12",
        sleepH: 7.5,
        sleepScore: 80,
        rhr: 50,
      });
      // a field that the day does not have is not in the short row either
      expect(rows["2026-01-05"]).toEqual({ date: "2026-01-05", sleepH: 7.5, rhr: 50 });
      expect(Object.keys(cache["2026-01-05"]).toSorted()).toEqual(
        [
          "bbHigh",
          "bbLow",
          "bedMin",
          "date",
          "deep",
          "needH",
          "rhr",
          "sleepH",
          "stepGoal",
          "steps",
          "stress",
        ].toSorted(),
      );
      expect(cache["2026-01-06"]).toMatchObject({ deep: 1.67, bbHigh: 53, needH: 7.5, stress: 31 });
    });

    it("keeps 14 rows for a period shorter than 14 days", async () => {
      const out = JSON.parse(await dashboard.getDashboardData(1, false, true));
      expect(out.recovery).toHaveLength(14);
      expect(out.recovery[0].date).toBe("2026-10-13");
      expect(sleepSpans()).toEqual([["2026-10-13", "2026-10-26"]]);
    });

    it("keeps the cache of a long page in a 14-day update, and the next long update asks for 14 days", async () => {
      await dashboard.getDashboardData(52, false, true);
      await dashboard.getDashboardData(1);
      expect(Object.keys(readCache().recovery)).toHaveLength(365);
      api.getJson.mockClear();
      const out = JSON.parse(await dashboard.getDashboardData(52, false, true));
      expect(recoveryCalls()).toHaveLength(2);
      expect(sleepSpans()).toEqual([["2026-10-13", "2026-10-26"]]);
      expect(out.recovery).toHaveLength(365);
    });

    it.each([
      ["HTTP 429", new GarminApiError("GET /x -> HTTP 429: slow down", 429)],
      ["a network failure", new GarminApiError("Network error calling /x: down")],
    ])(
      "stops after %s, keeps the saved rows and fetches only the rest next time",
      async (_, error) => {
        let pairs = 0;
        answer({
          [SLEEP_RANGE]: (q) => {
            if (++pairs === 2) throw error;
            return fakeGarmin(SLEEP_RANGE, q);
          },
        });
        const out = JSON.parse(await dashboard.getDashboardData(52, false, true));
        // the second pair failed: no more request after it
        expect(recoveryCalls()).toHaveLength(4);
        expect(warns()).toEqual([
          expect.stringMatching(/^Recovery data of 2026-09-02 to 2026-10-02 not fetched/),
        ]);
        expect(out.recovery.map((r: { date: string }) => r.date)).toEqual(
          daysOf(NEWEST, "2026-10-26"),
        );
        const failed = daysOf(FIRST, "2026-10-02");
        expect(out.sync.failedDates).toEqual(failed);
        expect(out.sync.failedDays).toBe(341);
        restore();
        api.getJson.mockClear();
        const again = JSON.parse(await dashboard.getDashboardData(52, false, true));
        const days = sleepSpans().flatMap(([a, b]) => daysOf(a, b));
        expect(days.toSorted()).toEqual([...failed, ...daysOf("2026-10-13", "2026-10-26")]);
        expect(again.sync.failedDates).toEqual([]);
        expect(again.recovery).toHaveLength(365);
      },
    );

    it("reads only the last 14 days one by one when the ranges answer HTTP 400, and leaves the older days to the next update", async () => {
      answer({ [SLEEP_RANGE]: refuse, [SUMMARY_RANGE]: refuse });
      const out = JSON.parse(await dashboard.getDashboardData(52, false, true));
      const rangeCalls = recoveryCalls().filter(([p]) => p === SLEEP_RANGE || p === SUMMARY_RANGE);
      expect(rangeCalls).toHaveLength(24);
      expect(recoveryCalls()).toHaveLength(24 + 28);
      const week = daysOf("2026-10-13", "2026-10-26");
      const days = (path: string, key: string) =>
        recoveryCalls()
          .filter(([p]) => p === path)
          .map(([, q]) => q[key]);
      expect(days("/sleep-service/sleep/dailySleep", "date")).toEqual(week);
      expect(days("/usersummary-service/usersummary/daily", "calendarDate")).toEqual(week);
      expect(out.recovery).toHaveLength(14);
      for (const r of out.recovery) {
        expect(r).toEqual({ date: r.date, sleepH: 7.5, rhr: 50 });
        expect(r).toEqual(readCache().recovery[r.date]);
      }
      expect(out.sync.failedDates).toEqual(daysOf(FIRST, "2026-10-12"));
      // one line for each failed span, none for each day
      expect(warns()).toHaveLength(12);
      expect(warns()[0]).toMatch(/^Recovery data of 2026-10-03 to 2026-10-26 not fetched/);
    });

    it.each([
      ["HTTP 429", new GarminApiError("GET /x -> HTTP 429: slow down", 429), 365],
      ["HTTP 500", new GarminApiError("GET /x -> HTTP 500: down", 500), 351],
    ])(
      "restarts from the earliest failed day that has a row after %s",
      async (_, error, failedDays) => {
        mkdirSync(dataDir, { recursive: true });
        writeFileSync(
          cacheFile(),
          JSON.stringify({
            recoveryTo: "2025-12-01",
            recovery: { "2026-02-01": oneRow("2026-02-01"), "2026-10-19": oneRow("2026-10-19") },
          }),
        );
        answer({
          [SLEEP_RANGE]: () => {
            throw error;
          },
        });
        const out = JSON.parse(await dashboard.getDashboardData(52, false, true));
        // the earliest failed day has no row, and the newest span fails first
        expect(out.sync.failedDays).toBe(failedDays);
        expect(out.sync.failedDates[0]).toBe(FIRST);
        expect(readCache().recoveryTo).toBe("2026-02-01");
      },
    );

    it("gives 14 whole rows in an update without the setting that follows one with it, and keeps the cache", async () => {
      rich();
      await dashboard.getDashboardData(52, false, true);
      const out = JSON.parse(await dashboard.getDashboardData(52));
      expect(out.recovery).toHaveLength(14);
      for (const r of out.recovery) {
        expect(r).toEqual(readCache().recovery[r.date]);
        expect(r).toHaveProperty("bbHigh", 53);
      }
      expect(Object.keys(readCache().recovery)).toHaveLength(365);
    });

    it("keeps whole rows for the last 14 days, fails the older days and asks for them again, after HTTP 400 and then HTTP 429", async () => {
      let pairs = 0;
      answer({
        [SLEEP_RANGE]: (q) => {
          pairs++;
          if (pairs === 1) throw new GarminApiError("GET range -> HTTP 400: no", 400);
          if (pairs === 2) throw new GarminApiError("GET range -> HTTP 429: slow down", 429);
          return fakeGarmin(SLEEP_RANGE, q);
        },
      });
      const out = JSON.parse(await dashboard.getDashboardData(52, false, true));
      expect(
        recoveryCalls().filter(([p]) => p === SLEEP_RANGE || p === SUMMARY_RANGE),
      ).toHaveLength(4);
      expect(out.recovery.map((r: { date: string }) => r.date)).toEqual(
        daysOf("2026-10-13", "2026-10-26"),
      );
      for (const r of out.recovery) expect(r).toEqual({ date: r.date, sleepH: 7.5, rhr: 50 });
      const failed = daysOf(FIRST, "2026-10-12");
      expect(out.sync.failedDates).toEqual(failed);
      expect(new Set(out.sync.failedDates).size).toBe(failed.length);
      restore();
      api.getJson.mockClear();
      const again = JSON.parse(await dashboard.getDashboardData(52, false, true));
      const days = sleepSpans().flatMap(([a, b]) => daysOf(a, b));
      // a span may cover a day that has its row: every failed day is asked for again
      expect(failed.filter((day) => !days.includes(day))).toEqual([]);
      expect(again.sync.failedDates).toEqual([]);
      expect(again.recovery).toHaveLength(365);
    });

    it("saves the older rows and fails only the days of the newest span when only the newest span fails", async () => {
      for (const day of daysOf(NEWEST, "2026-10-26")) failingSleep.add(day);
      const out = JSON.parse(await dashboard.getDashboardData(52, false, true));
      expect(out.sync.failedDates).toEqual(daysOf(NEWEST, "2026-10-26"));
      expect(out.recovery.map((r: { date: string }) => r.date)).toEqual(
        daysOf(FIRST, "2026-10-02"),
      );
      expect(Object.keys(readCache().recovery)).toHaveLength(341);
      expect(readCache().recovery["2026-10-02"]).toMatchObject({ sleepH: 7.5 });
    });

    it.each([["oops"], [null], [7]])(
      "does not throw for a cached older row that is %j, and keeps the whole row beside it short",
      async (broken) => {
        mkdirSync(dataDir, { recursive: true });
        writeFileSync(
          cacheFile(),
          JSON.stringify({
            recoveryTo: "2026-10-26",
            recovery: {
              "2026-02-01": broken,
              "2026-02-02": { date: "2026-02-02", sleepH: 6, rhr: 49, bbHigh: 80 },
            },
          }),
        );
        const out = JSON.parse(await dashboard.getDashboardData(52, false, true));
        const rows = recoveryByDay(out);
        expect(rows["2026-02-02"]).toEqual({ date: "2026-02-02", sleepH: 6, rhr: 49 });
        // the broken row gives an empty short row, which has no date
        expect(out.recovery).toContainEqual({});
      },
    );

    it("keeps a row with no recovery field as a row of its date", async () => {
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(
        cacheFile(),
        JSON.stringify({
          recoveryTo: "2026-10-26",
          recovery: { "2026-02-03": { date: "2026-02-03" } },
        }),
      );
      const out = JSON.parse(await dashboard.getDashboardData(52, false, true));
      expect(recoveryByDay(out)["2026-02-03"]).toEqual({ date: "2026-02-03" });
    });

    it("keeps its own line for a day that fails after a failed range", async () => {
      answer({ [SLEEP_RANGE]: refuse, [SUMMARY_RANGE]: refuse });
      failingSleep.add("2026-10-26");
      await dashboard.getDashboardData(1);
      expect(warns()).toEqual([
        expect.stringMatching(/^Recovery data of 2026-10-13 to 2026-10-26 not fetched/),
        expect.stringMatching(/^Recovery data of 2026-10-26 not fetched/),
      ]);
    });
  });

  it("passes on an error that is not a Garmin error, in the recovery days and the optional parts", async () => {
    for (const prefix of ["/sleep-service", "/biometric-service/heartRateZones"]) {
      api.getJson.mockImplementation(async (path, q) => {
        if (path.startsWith(prefix)) throw new TypeError(`bug in ${prefix}`);
        return fakeGarmin(path, q);
      });
      await expect(dashboard.getDashboardData(1)).rejects.toThrow(`bug in ${prefix}`);
    }
  });

  it("reads an activity id that Garmin sends as a string of digits", async () => {
    garminActivities = [{ ...activity(1, "2026-10-20", "strength_training"), activityId: "77" }];
    await dashboard.getDashboardData(1);
    expect(api.getBytes.mock.calls.map(([path]) => path)).toContain(
      "/download-service/files/activity/77",
    );
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

  describe("a failed call keeps the last good profile values", () => {
    it("keeps the zones of the last good update when the zones call fails", async () => {
      const first = await get();
      failing.add("/biometric-service/heartRateZones");
      const out = await get();
      expect(out.zones).toEqual(first.zones);
      expect(out.zones).toEqual([{ zone: 1 }]);
      expect(out.sync.failedSections).toContain("zones");
    });

    it("keeps the units and the language when the settings call fails", async () => {
      await profile();
      failing.add("/userprofile-service/");
      const out = await get();
      expect(out.units).toBe("statute_us");
      expect(out.locale).toBe("pt-BR");
      expect(out.sync.failedSections).toEqual(["units"]);
    });

    it("gives no fitness age when its call fails after a good one", async () => {
      expect((await get()).fitnessAge).toEqual({ fitnessAge: 40 });
      failing.add("/fitnessage-service/");
      const out = await get();
      expect(out.fitnessAge).toBeNull();
      expect(out.sync.failedSections).toContain("fitnessAge");
    });

    it("saves the values in the cache and reads them in a new dashboard", async () => {
      await profile();
      expect(readCache()).toMatchObject({
        units: "statute_us",
        locale: "pt-BR",
        zones: [{ zone: 1 }],
      });
      failing.add("/userprofile-service/");
      failing.add("/biometric-service/heartRateZones");
      const client = api as unknown as GarminApiClient;
      dashboard = new GarminDashboard(new GarminTools(client, dataDir), client, dataDir);
      const out = await get();
      expect(out).toMatchObject({ units: "statute_us", locale: "pt-BR", zones: [{ zone: 1 }] });
    });

    it("keeps only the units and the language of the settings answer", async () => {
      api.getJson.mockImplementation(async (path, q) =>
        path === "/userprofile-service/userprofile/settings"
          ? { measurementSystem: "metric", preferredLocale: "en", birthDate: "1900-02-03" }
          : fakeGarmin(path, q),
      );
      await get();
      expect(JSON.stringify(readCache())).not.toContain("1900-02-03");
    });

    it("does not bring back an old unit after a settings answer without a valid one", async () => {
      await profile();
      units = "nautical";
      expect(await get()).not.toHaveProperty("units");
      failing.add("/userprofile-service/");
      const out = await get();
      expect(out).not.toHaveProperty("units");
      expect(out.locale).toBe("pt-BR");
    });

    it("leaves out damaged cached values when the settings call fails", async () => {
      writeFileSync(cacheFile(), JSON.stringify({ units: 5, locale: "bad locale" }));
      failing.add("/userprofile-service/");
      const out = await get();
      expect(out).not.toHaveProperty("units");
      expect(out).not.toHaveProperty("locale");
    });

    it("leaves out a cached locale that is not a string", async () => {
      writeFileSync(cacheFile(), JSON.stringify({ locale: 5 }));
      failing.add("/userprofile-service/");
      expect(await get()).not.toHaveProperty("locale");
    });

    it("keeps the cached zones when Garmin answers null, and adds no failed section", async () => {
      await get();
      api.getJson.mockImplementation(async (path, q) =>
        path === "/biometric-service/heartRateZones/v2" ? null : fakeGarmin(path, q),
      );
      const out = await get();
      expect(out.zones).toEqual([{ zone: 1 }]);
      expect(out.sync.failedSections).not.toContain("zones");
    });
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
      activity(6, "2026-10-05", "cycling", { sportTypeId: 2 }),
    ];
    const out = JSON.parse(await dashboard.getDashboardData(2));
    expect(out.previousActivities).toEqual([
      {
        id: 6,
        start: "2026-10-05 07:00:00",
        name: "A6",
        type: "cycling",
        sport: "cycling",
        km: 5,
        duration: "25:00",
      },
      {
        id: 5,
        start: "2026-09-25 07:00:00",
        name: "A5",
        type: "running",
        sport: "running",
        km: 5,
        duration: "25:00",
        avgHR: 150,
        trainingLoad: 80.3,
      },
    ]);
  });

  it("keeps the name of a previous row, and no name when the activity has none", async () => {
    garminActivities = [
      activity(5, "2026-09-25"),
      { ...activity(6, "2026-09-26"), activityName: undefined },
    ];
    const out = JSON.parse(await dashboard.getDashboardData(2));
    const byId = (id: number) => out.previousActivities.find((r: { id: number }) => r.id === id);
    expect(byId(5).name).toBe("A5");
    expect(byId(6)).not.toHaveProperty("name");
  });

  describe("a rate limit or a network failure stops the requests", () => {
    const HRV = "/hrv-service/hrv/daily/";
    const ZONES = "/biometric-service/heartRateZones/v2";
    const SETTINGS = "/userprofile-service/userprofile/settings";
    /** The paths of the calls after the activity search, apart from the recovery ones. */
    const optionalCalls = () =>
      [ZONES, SETTINGS].flatMap((p) => callsTo(p)).concat(callsTo("/fitnessage-service"));

    it.each([
      ["HTTP 429", rateLimit()],
      ["a network failure", new GarminApiError("Network error calling /x: down")],
    ])("asks for nothing more after %s on the first HRV chunk", async (_, error) => {
      api.getJson.mockImplementation(async (path, q) => {
        if (String(path).startsWith(HRV)) throw error;
        return fakeGarmin(path, q);
      });
      const out = JSON.parse(await dashboard.getDashboardData(52));
      // 52 weeks are 14 chunks of 4 weeks: only the first is asked for
      expect(callsTo(HRV)).toHaveLength(1);
      expect(recoveryCalls()).toHaveLength(0);
      expect(optionalCalls()).toHaveLength(0);
      expect(out.sync.failedSections).toEqual(["hrv", "zones", "fitnessAge", "units"]);
      expect(out.sync.failedDates).toEqual(daysOf("2026-10-13", "2026-10-26"));
      expect(out.sync.stoppedEarly).toBe(true);
      // 1 activity page + 1 HRV chunk
      expect(out.sync.garminCalls).toBe(2);
    });

    it("goes on after HTTP 500 on the first HRV chunk", async () => {
      failing = new Set([HRV]);
      const out = JSON.parse(await dashboard.getDashboardData(52));
      expect(callsTo(HRV)).toHaveLength(14);
      expect(recoveryCalls().length).toBeGreaterThan(0);
      expect(optionalCalls()).toHaveLength(3);
      expect(out.sync.failedSections).toEqual(["hrv"]);
      expect(out.sync.stoppedEarly).toBe(false);
    });

    it("asks for no zones, fitness age, settings or .FIT file after HTTP 429 on a recovery range", async () => {
      garminActivities = [activity(1, "2026-10-26", "strength_training")];
      answer({
        [SLEEP_RANGE]: () => {
          throw rateLimit();
        },
      });
      const out = JSON.parse(await dashboard.getDashboardData(1));
      expect(optionalCalls()).toHaveLength(0);
      expect(api.getBytes).not.toHaveBeenCalled();
      expect(out.sync).toMatchObject({
        stoppedEarly: true,
        failedDetails: 1,
        failedSections: ["zones", "fitnessAge", "units"],
      });
      expect(out.activities[0].detailError).toBe("Not downloaded: Garmin stopped answering");
    });

    it("asks for no later day after HTTP 429 on one day read after a range failed", async () => {
      let sleeps = 0;
      answer({
        [SLEEP_RANGE]: () => {
          throw new GarminApiError("GET range -> HTTP 500: down", 500);
        },
        "/sleep-service/sleep/dailySleep": (q) => {
          if (++sleeps === 3) throw rateLimit();
          return fakeGarmin("/sleep-service/sleep/dailySleep", q);
        },
      });
      const out = JSON.parse(await dashboard.getDashboardData(1));
      expect(sleeps).toBe(3);
      expect(out.sync.failedDates).toEqual(daysOf("2026-10-15", "2026-10-26"));
      expect(out.sync.stoppedEarly).toBe(true);
      expect(optionalCalls()).toHaveLength(0);
    });

    describe("in the details of the sessions", () => {
      it("stops downloading after HTTP 429 on the third file, and reports the sessions without details", async () => {
        garminActivities = fiveSessions();
        const ok = await api.getBytes();
        api.getBytes.mockClear();
        api.getBytes
          .mockResolvedValueOnce(ok)
          .mockResolvedValueOnce(ok)
          .mockRejectedValueOnce(rateLimit());
        const out = JSON.parse(await dashboard.getDashboardData(1));
        expect(api.getBytes).toHaveBeenCalledTimes(3);
        expect(out.sync).toMatchObject({ failedDetails: 3, stoppedEarly: true });
        expect(out.activities.map((a: { detailError?: string }) => !!a.detailError)).toEqual([
          false,
          false,
          true,
          true,
          true,
        ]);
        // the refused attempt counts too: it was a request
        expect(out.sync.fitDownloads).toBe(3);
      });

      it("still reads a .FIT file that is saved after the stop", async () => {
        garminActivities = [activity(101, "2026-10-26"), activity(102, "2026-10-25")];
        const tools = new GarminTools(api as unknown as GarminApiClient, dataDir);
        await tools.fetchFit(102);
        api.getBytes.mockClear();
        api.getBytes.mockRejectedValue(rateLimit());
        const out = JSON.parse(await dashboard.getDashboardData(1));
        expect(api.getBytes).toHaveBeenCalledTimes(1);
        const [first, second] = out.activities;
        expect(first.detailError).toMatch(/HTTP 429/);
        expect(second.laps).toHaveLength(1);
        expect(second).not.toHaveProperty("detailError");
        expect(out.sync).toMatchObject({ failedDetails: 1, stoppedEarly: true });
      });

      it("goes on after HTTP 404 on one file", async () => {
        garminActivities = fiveSessions().slice(0, 3);
        const ok = await api.getBytes();
        api.getBytes.mockClear();
        api.getBytes
          .mockRejectedValueOnce(new GarminApiError("GET /x -> HTTP 404: gone", 404))
          .mockResolvedValue(ok);
        const out = JSON.parse(await dashboard.getDashboardData(1));
        expect(api.getBytes).toHaveBeenCalledTimes(3);
        expect(out.sync).toMatchObject({ failedDetails: 1, stoppedEarly: false });
        expect(out.activities[0].detailError).toMatch(/HTTP 404/);
        expect(out.activities[1].exercises).toHaveLength(1);
      });

      it("goes on after a download that is not a .FIT file", async () => {
        garminActivities = fiveSessions().slice(0, 3);
        const ok = await api.getBytes();
        api.getBytes.mockClear();
        api.getBytes.mockResolvedValueOnce(new Uint8Array(3)).mockResolvedValue(ok);
        const out = JSON.parse(await dashboard.getDashboardData(1));
        expect(api.getBytes).toHaveBeenCalledTimes(3);
        expect(out.sync).toMatchObject({ failedDetails: 1, stoppedEarly: false });
        expect(out.activities[0].detailError).toMatch(/is not a \.FIT file/);
        expect(out.activities[1].exercises).toHaveLength(1);
        expect(out.activities[2].exercises).toHaveLength(1);
      });

      it("goes on after a saved file that does not decode, on every update", async () => {
        garminActivities = fiveSessions().slice(0, 3);
        const ok = await api.getBytes();
        // a valid header and a wrong CRC
        mkdirSync(join(dataDir, "fit"), { recursive: true });
        writeFileSync(
          join(dataDir, "fit", "1.fit"),
          ok.map((v: number, i: number) => (i === ok.length - 1 ? v ^ 0xff : v)),
        );
        api.getBytes.mockClear();
        const first = JSON.parse(await dashboard.getDashboardData(1));
        // sessions 2 and 3 download
        expect(api.getBytes).toHaveBeenCalledTimes(2);
        expect(first.sync).toMatchObject({ failedDetails: 1, stoppedEarly: false });
        expect(first.activities[0].detailError).toMatch(/^Cannot decode the \.FIT file of 1/);
        expect(first.activities[2].exercises).toHaveLength(1);
        api.getBytes.mockClear();
        const second = JSON.parse(await dashboard.getDashboardData(1));
        expect(api.getBytes).not.toHaveBeenCalled();
        expect(second.sync).toMatchObject({ failedDetails: 1, stoppedEarly: false });
        expect(second.activities[1].exercises).toHaveLength(1);
      });

      it("counts an error that is no Garmin error as a failed detail and does not stop the others", async () => {
        garminActivities = fiveSessions().slice(0, 2);
        const ok = await api.getBytes();
        api.getBytes.mockClear();
        api.getBytes.mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(ok);
        const out = JSON.parse(await dashboard.getDashboardData(1));
        expect(api.getBytes).toHaveBeenCalledTimes(2);
        expect(out.sync).toMatchObject({ failedDetails: 1, stoppedEarly: false });
        expect(out.activities[0].detailError).toEqual(expect.any(String));
        expect(out.activities[1]).not.toHaveProperty("detailError");
        // sets not read: no plan verdicts, not even null
        expect(out.activities[0]).not.toHaveProperty("planVerdicts");
        expect(out.activities[1].planVerdicts).toBeNull();
      });

      it("gives each strength session the verdicts of its plan, from the file it has", async () => {
        garminActivities = fiveSessions().slice(0, 2);
        const ok = await api.getBytes();
        const M = Profile.MesgNum;
        const squat = { category: [28], categorySubtype: [6], wktStepIndex: 1 };
        const planned = fitFile(
          [M.WORKOUT, { wktName: "Legs" }],
          // a warm-up (no verdict), 2 sets of 5 back squats, then 1 set of bench press
          [
            M.WORKOUT_STEP,
            { messageIndex: 0, intensity: 2, durationType: 5, exerciseCategory: 28 },
          ],
          [
            M.WORKOUT_STEP,
            {
              messageIndex: 1,
              intensity: 0,
              durationType: 29,
              durationValue: 5,
              exerciseCategory: 28,
              exerciseName: 6,
            },
          ],
          [M.WORKOUT_STEP, { messageIndex: 2, durationType: 6, durationValue: 1, targetValue: 2 }],
          [
            M.WORKOUT_STEP,
            {
              messageIndex: 3,
              intensity: 0,
              durationType: 29,
              durationValue: 10,
              exerciseCategory: 0,
            },
          ],
          [M.SET, { setType: 1, repetitions: 5, weight: 60, ...squat }],
          [M.SET, { setType: 1, repetitions: 5, weight: 60, ...squat }],
          // the lap of the default file, so both sessions have the same fields
          [M.LAP, { totalDistance: 1000, totalTimerTime: 300 }],
        );
        api.getBytes.mockClear();
        api.getBytes.mockResolvedValueOnce(planned).mockResolvedValue(ok);
        const out = JSON.parse(await dashboard.getDashboardData(1));
        const [withPlan, without] = out.activities;
        expect(withPlan.planVerdicts).toEqual([
          { exercise: "Barbell Back Squat", verdict: "hit", why: [] },
          { exercise: "Bench Press", verdict: "miss", why: ["sets"] },
        ]);
        expect(without.planVerdicts).toBeNull();
        // the sets are as in getActivitySets, and only the new field is added
        const tools = new GarminTools(api as unknown as GarminApiClient, dataDir);
        expect(withPlan.exercises).toEqual(JSON.parse(await tools.getActivitySets(1)).exercises);
        expect(Object.keys(withPlan).toSorted()).toEqual(Object.keys(without).toSorted());
        // like the sets, the verdicts are read again on each update, never cached
        expect(readFileSync(join(dataDir, "dashboard-cache.json"), "utf8")).not.toContain(
          "planVerdicts",
        );
      });
    });

    it("does not throw when Garmin answers a bare string for the HRV or the settings path", async () => {
      api.getJson.mockImplementation(async (path, q) =>
        String(path).startsWith(HRV) || path === SETTINGS ? "oops" : fakeGarmin(path, q),
      );
      const out = JSON.parse(await dashboard.getDashboardData(1));
      expect(out.hrv).toEqual([]);
      expect(out).not.toHaveProperty("units");
      expect(out.sync.failedSections).toEqual([]);
      expect(out.sync.stoppedEarly).toBe(false);
    });

    it("keeps the units and the language of an earlier update when the settings are skipped", async () => {
      expect(await profile()).toMatchObject({ units: "statute_us", locale: "pt-BR" });
      api.getJson.mockImplementation(async (path, q) => {
        if (String(path).startsWith(HRV)) throw rateLimit();
        return fakeGarmin(path, q);
      });
      const out = await get();
      expect(out.sync.failedSections).toContain("units");
      expect(out).toMatchObject({ units: "statute_us", locale: "pt-BR" });
    });
  });

  describe("previous rows", () => {
    it("gives the previous rows the board of their sport", async () => {
      const out = await previous();
      expect(out.previousActivities.map(groupOf)).toEqual(["cycling", "running"]);
    });

    it("keeps the previous runs of a page that shows only running", async () => {
      const out = await previous();
      const kept = filterData(out, { sports: ["running"] });
      expect((kept.previousActivities as { id: number }[]).map((a) => a.id)).toEqual([5]);
    });

    it("gives a previous session its estimated load from the heart rate", async () => {
      garminActivities = [activity(5, "2026-10-05", "running", { averageHR: 150 })];
      const out = JSON.parse(await dashboard.getDashboardData(2));
      expect(out.previousActivities.find((a: { id: number }) => a.id === 5).avgHR).toBe(150);
      const zones = [{ sport: "DEFAULT", maxHeartRateUsed: 190 }];
      const withZones = digest({ ...out, zones }).previousPeriodTotals.running;
      expect(withZones.estimatedLoads).toBe(1);
      expect(withZones.load).toBeCloseTo((25 * 150) / 190, 0);
      expect(digest(out).previousPeriodTotals.running.load).toBeNull();
    });

    it.each([
      ["strength_training", 1, "strengthTraining"],
      ["pickleball", 1, "racket"],
      ["mountain_biking", 2, "cycling"],
    ])("gives a previous %s row the board %s", async (type, sportTypeId, group) => {
      garminActivities = [activity(8, "2026-09-25", type, { sportTypeId })];
      const out = JSON.parse(await dashboard.getDashboardData(2));
      expect(groupOf(out.previousActivities[0])).toBe(group);
    });

    it("gives a previous row of an unknown sport the generic board, and a running page drops it", async () => {
      garminActivities = [activity(9, "2026-09-25", "running", { sportTypeId: 999 })];
      const out = JSON.parse(await dashboard.getDashboardData(2));
      expect(groupOf(out.previousActivities[0])).toBe("generic");
      expect(filterData(out, { sports: ["running"] }).previousActivities).toEqual([]);
    });

    it("the fixture's previous rows have only fields that the server writes", async () => {
      garminActivities = [
        activity(7, "2026-09-25", "running", {
          activityTrainingLoad: 80,
          averageHR: 150,
          duration: 1800,
        }),
      ];
      const out = JSON.parse(await dashboard.getDashboardData(2));
      const server = new Set(Object.keys(out.previousActivities[0]));
      const fixture = JSON.parse(
        readFileSync(join(__dirname, "fixtures/dashboard-data.json"), "utf8"),
      );
      for (const row of fixture.previousActivities) {
        for (const k of Object.keys(row)) expect(server.has(k), k).toBe(true);
      }
    });
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

  it("also gives sets to a strength session past the 30 newest whose .FIT file is saved", async () => {
    garminActivities = Array.from({ length: 32 }, (_, i) =>
      activity(100 + i, addDays("2026-10-26", -i), "strength_training"),
    );
    await new GarminTools(api as unknown as GarminApiClient, dataDir).fetchFit(131);
    api.getBytes.mockClear();
    const out = JSON.parse(await dashboard.getDashboardData(5));
    const withSets = out.activities.filter((a: Record<string, unknown>) => a.exercises);
    expect(withSets.map((a: Record<string, unknown>) => a.id)).toEqual([
      ...Array.from({ length: 30 }, (_, i) => 100 + i),
      131,
    ]);
    // the 30 newest are downloaded, the saved one is read from the data folder
    expect(api.getBytes).toHaveBeenCalledTimes(30);
  });

  it("keeps in the demos the sets that the server gives: the 30 newest, all once every file is saved", () => {
    expect([keptSets(false), keptSets(true)]).toEqual([
      [30, 30],
      [32, 32],
    ]);
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

  it("gives laps to the repeated runs of a type key that does not end in running, by their sport", async () => {
    garminActivities = Array.from({ length: 4 }, (_, i) =>
      activity(70 + i, `2026-10-${String(23 - i).padStart(2, "0")}`, "virtual_run", {
        activityName: "Tempo",
        sportTypeId: 1,
      }),
    );
    expect(withLaps(JSON.parse(await dashboard.getDashboardData(1, true)))).toEqual([
      70, 71, 72, 73,
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

  it("counts the .FIT files that an update downloads", async () => {
    garminActivities = [
      activity(90, "2026-10-26", "strength_training"),
      activity(91, "2026-10-25"),
      activity(92, "2026-10-24"),
    ];
    // sets and laps of the strength session come from one file
    expect(JSON.parse(await dashboard.getDashboardData(1)).sync.fitDownloads).toBe(3);
    expect(JSON.parse(await dashboard.getDashboardData(1)).sync.fitDownloads).toBe(0);
  });

  it("leaves out the laps of an activity whose file has none", async () => {
    garminActivities = [activity(93, "2026-10-26", "strength_training")];
    api.getBytes.mockResolvedValueOnce(
      fitFile([Profile.MesgNum.SET, { setType: 1, repetitions: 5, weight: 60, duration: 20 }]),
    );
    const [a] = JSON.parse(await dashboard.getDashboardData(1)).activities;
    expect(a.exercises).toHaveLength(1);
    expect(a).not.toHaveProperty("laps");
  });

  it("reports a detail that cannot be read on the activity", async () => {
    garminActivities = [activity(20, "2026-10-26", "strength_training")];
    api.getBytes.mockRejectedValue(
      new GarminApiError("GET /download-service/files/activity/20 -> HTTP 404: gone", 404),
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

  it("keeps the recovery rows of the last 371 days in the cache, and drops older ones and keys that are no date", async () => {
    // 365 days back is 2025-10-26: 371 days back is Monday 2025-10-20
    const edge = addDays(TO, -371);
    expect(edge).toBe("2025-10-20");
    writeFileSync(
      cacheFile(),
      JSON.stringify({
        recovery: {
          [edge]: oneRow(edge),
          [addDays(edge, -1)]: oneRow(addDays(edge, -1)),
          "not a date": oneRow("x"),
        },
      }),
    );
    await dashboard.getDashboardData(1);
    expect(Object.keys(readCache().recovery)).toContain(edge);
    expect(Object.keys(readCache().recovery)).not.toContain("2025-10-19");
    expect(Object.keys(readCache().recovery)).not.toContain("not a date");
  });
});
