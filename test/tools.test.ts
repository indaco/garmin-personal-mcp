import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Profile } from "@garmin/fitsdk";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GarminApiError, type GarminApiClient } from "../src/api-client";
import { registerDashboard, type GarminDashboard } from "../src/dashboard";
import { registerDashboardWriter, type DashboardWriter } from "../src/dashboard-page";
import { createServer } from "../src/server";
import { firstArray, GarminTools, registerTools, summarize } from "../src/tools";
import { log } from "../src/log";
import { fitFile } from "./fit-file";
import toolList from "./fixtures/tool-list.json";

vi.mock("../src/log", () => ({ log: vi.fn() }));

const api = {
  getJson: vi.fn(),
  getBytes: vi.fn(),
  getExerciseCatalogue: vi.fn(),
};
let dataDir: string;
let tools: GarminTools;

beforeEach(() => {
  vi.resetAllMocks();
  dataDir = mkdtempSync(join(tmpdir(), "garmin-data-"));
  tools = new GarminTools(api as unknown as GarminApiClient, dataDir);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("summarize", () => {
  it("shows the elapsed time when the moving time is short", () => {
    const s = summarize({
      activityId: 1,
      activityName: "Padel",
      startTimeLocal: "2026-10-08 17:34:51",
      activityType: { typeKey: "paddelball" },
      eventType: { typeKey: "uncategorized" },
      distance: 81.85,
      duration: 1040.11,
      movingDuration: 77.0,
      averageHR: 96.0,
      maxHR: 138.0,
      calories: 96.0,
      aerobicTrainingEffect: 0.4000000059604645,
      anaerobicTrainingEffect: 0.0,
      trainingEffectLabel: "RECOVERY",
      activityTrainingLoad: 5.1422882080078125,
      differenceBodyBattery: -1,
      splitSummaries: [],
      hrTimeInZone_1: 596.769,
      hrTimeInZone_2: 25.005,
      hrTimeInZone_3: 9.998,
      hrTimeInZone_4: 0.0,
      hrTimeInZone_5: 0.0,
    });
    expect(s.duration).toBe("1:17");
    expect(s.elapsed).toBe("17:20");
    expect(s.hrZonesSec).toEqual([597, 25, 10, 0, 0]);
    expect(s.trainingLoad).toBe(5.1);
    expect(s.aerobicTE).toBe(0.4);
    expect(s.teLabel).toBe("recovery");
    expect(s.bodyBatteryDelta).toBe(-1);
    expect(s).not.toHaveProperty("race");
    expect(s).not.toHaveProperty("best");
    expect(s).not.toHaveProperty("runWalk");
  });

  it("gives a race its best efforts and run/walk segments", () => {
    const s = summarize({
      activityId: 2,
      activityName: "Half Marathon",
      startTimeLocal: "2026-10-18 08:11:58",
      activityType: { typeKey: "running" },
      eventType: { typeKey: "race" },
      distance: 21363.42,
      duration: 7849.83,
      movingDuration: 7845.71,
      averageHR: 162.0,
      avgPower: 306.0,
      normPower: 316.0,
      avgStrideLength: 102.5,
      avgGroundContactTime: 294.8,
      avgVerticalOscillation: 8.86,
      avgVerticalRatio: 8.64,
      avgGradeAdjustedSpeed: 2.72,
      fastestSplit_1000: 330.3,
      fastestSplit_5000: 1679.05,
      fastestSplit_21098: 7748.61,
      splitSummaries: [
        { splitType: "RWD_WALK", duration: 837.0, distance: 1549.85, averageSpeed: 1.852 },
        {
          splitType: "INTERVAL_ACTIVE",
          duration: 7849.83,
          distance: 21363.45,
          averageSpeed: 2.722,
        },
        { splitType: "RWD_RUN", duration: 7012.75, distance: 19813.57, averageSpeed: 2.825 },
      ],
    });
    expect(s.race).toBe(true);
    expect(s).not.toHaveProperty("elapsed");
    expect(JSON.stringify(s.best)).toBe('{"1k":"5:30","5k":"27:59","half":"2:09:09"}');
    expect(JSON.stringify(s.runWalk)).toBe(
      '{"walkTime":"13:57","runPace":"5:54/km","runKm":19.81}',
    );
    expect(s.gap).toBe("6:08/km");
    expect(s.avgPowerW).toBe(306);
    expect(s.gctMs).toBe(295);
    expect(s.vertOscCm).toBe(8.9);
  });

  it("has intensity minutes and swim fields", () => {
    const s = summarize({
      activityId: 3,
      activityType: { typeKey: "lap_swimming" },
      distance: 1500.0,
      duration: 2100.0,
      movingDuration: 2050.0,
      moderateIntensityMinutes: 20,
      vigorousIntensityMinutes: 15,
      averageSwolf: 38.4,
      poolLength: 2500.0,
      activeLengths: 60,
      strokes: 980.0,
    });
    expect(s.moderateMinutes).toBe(20);
    expect(s.vigorousMinutes).toBe(15);
    expect(s.swolf).toBe(38);
    expect(s.poolLengthM).toBe(25);
    expect(s.lengths).toBe(60);
    expect(s.strokes).toBe(980);
  });

  // numeric text counts as a number, also with spaces around it, but not hex, NaN or Infinity
  it.each([
    ["5000", 5],
    ["+5000", 5],
    ["5e3", 5],
    ["5000.", 5],
    [" 5000 ", 5],
    ["0x1388", undefined],
    ["Infinity", undefined],
    ["NaN", undefined],
    [true, undefined],
  ])("reads the distance %j", (distance, km) => {
    expect(summarize({ distance }).km).toBe(km);
  });

  it.each([
    [1, "running"],
    [4, "fitnessEquipment"],
    [10, "training"],
    [13, "alpineSkiing"],
    [64, "racket"],
  ])("names the SDK sport of sportTypeId %i", (sportTypeId, sport) => {
    expect(summarize({ sportTypeId }).sport).toBe(sport);
  });

  it("leaves the sport out when Garmin gives no known sport id", () => {
    for (const sportTypeId of [undefined, null, "1", 1.5, 9999])
      expect(summarize({ activityId: 1, sportTypeId })).toEqual({ id: 1 });
  });

  it("leaves the type out when Garmin gives no type key", () => {
    expect(summarize({ activityId: 1, activityType: { typeId: 3 } })).toEqual({ id: 1 });
    expect(summarize({ activityId: 1, activityType: null })).toEqual({ id: 1 });
  });

  it("keeps the summary fields in a fixed order", () => {
    const s = summarize({
      activityId: 4,
      activityName: "Run",
      activityType: { typeKey: "running" },
      startTimeLocal: "2026-10-01 07:00:00",
      distance: 5000,
      movingDuration: 1500,
      averageHR: 150,
    });
    expect(Object.keys(s)).toEqual([
      "id",
      "name",
      "type",
      "start",
      "km",
      "duration",
      "pace",
      "avgHR",
    ]);
    expect(s.pace).toBe("5:00/km");
  });
});

const refused = () =>
  new GarminApiError("GET /activitylist-service/activities/search/activities -> HTTP 400: bad");

const namedIds = async (limit?: number, raw?: boolean) =>
  JSON.parse(
    await tools.listActivities("2026-09-01", "2026-10-27", undefined, limit, raw, [
      "tempo",
      "long RUN",
    ]),
  ).map((r: { id?: number; activityId?: number }) => r.id ?? r.activityId);

/** n activities named Drill, with ids from `from`. */
const drills = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ activityId: from + i, activityName: "Drill" }));

/** One part of Garmin's sleepScores. */
const score = (value?: number) => ({ value, qualifierKey: "GOOD", optimalStart: 1, optimalEnd: 2 });

/** Garmin's answer for a night without sleep data: nulls, and the sleep need of that night. */
const emptyNight = (date: string) => ({
  calendarDate: null,
  sleepTimeSeconds: null,
  deepSleepSeconds: null,
  sleepStartTimestampLocal: null,
  avgHeartRate: null,
  deviceRemCapable: true,
  sleepNeed: { calendarDate: date, baseline: 480, actual: 490 },
  nextSleepNeed: null,
});

/** A synthetic night in Garmin's sleep JSON: 23:10 to 07:05 local, 7.5 h of sleep. */
const night = (date: string) => {
  const wake = Date.parse(`${date}T07:05:00Z`);
  const bed = wake - (7 * 60 + 55) * 60_000;
  return {
    id: 1761000000000,
    userProfilePK: 1,
    calendarDate: date,
    sleepTimeSeconds: 27000,
    napTimeSeconds: 0,
    sleepStartTimestampGMT: bed - 3600_000,
    sleepEndTimestampGMT: wake - 3600_000,
    sleepStartTimestampLocal: bed,
    sleepEndTimestampLocal: wake,
    autoSleepStartTimestampGMT: null,
    deepSleepSeconds: 5400,
    lightSleepSeconds: 15300,
    remSleepSeconds: 6300,
    awakeSleepSeconds: 900,
    averageSpO2Value: 95,
    lowestSpO2Value: 88,
    highestSpO2Value: 99,
    averageRespirationValue: 14.27,
    lowestRespirationValue: 9,
    awakeCount: 2,
    avgSleepStress: 12.43,
    ageGroup: "ADULT",
    avgHeartRate: 52.2,
    sleepScoreFeedback: "POSITIVE_LONG_AND_DEEP",
    sleepScoreInsight: "NONE",
    sleepScores: {
      overall: { value: 82, qualifierKey: "GOOD" },
      totalDuration: score(),
      stress: score(),
      remPercentage: score(23),
      lightPercentage: score(57),
      deepPercentage: score(20),
    },
    sleepNeed: {
      userProfilePk: 1,
      calendarDate: date,
      deviceId: 2,
      baseline: 480,
      actual: 480,
      feedback: "NO_CHANGE",
    },
  };
};

describe("activities", () => {
  it("lists activities as summaries, limit 20 by default and 200 at most", async () => {
    api.getJson.mockResolvedValue([
      { activityId: 1, activityName: "A", distance: 1000, duration: 300 },
    ]);
    expect(JSON.parse(await tools.listActivities())).toEqual([
      { id: 1, name: "A", km: 1, duration: "5:00", pace: "5:00/km" },
    ]);
    expect(api.getJson).toHaveBeenLastCalledWith(
      "/activitylist-service/activities/search/activities",
      {
        start: "0",
        limit: "20",
        startDate: undefined,
        endDate: undefined,
        activityType: undefined,
      },
    );
    await tools.listActivities("2026-10-01", "2026-10-27", "running", 500);
    expect(api.getJson.mock.lastCall?.[1]).toMatchObject({
      limit: "100",
      startDate: "2026-10-01",
      endDate: "2026-10-27",
      activityType: "running",
    });
    await tools.listActivities(undefined, undefined, undefined, 0);
    expect(api.getJson.mock.lastCall?.[1]).toMatchObject({ limit: "20" });
  });

  it("asks in pages of 100: Garmin answers HTTP 500 to one page of about 200 activities", async () => {
    api.getJson.mockResolvedValueOnce(drills(0, 100)).mockResolvedValueOnce(drills(100, 40));
    const rows = JSON.parse(
      await tools.listActivities(undefined, undefined, undefined, 5, false, ["drill"]),
    );
    expect(rows).toHaveLength(5);
    expect(api.getJson.mock.calls.map(([, q]) => [q.start, q.limit])).toEqual([
      ["0", "100"],
      ["100", "100"],
    ]);
    // a short page is the end: no third page
    api.getJson.mockClear();
    api.getJson.mockResolvedValueOnce(drills(0, 30));
    await tools.listActivities(undefined, undefined, undefined, 200);
    expect(api.getJson).toHaveBeenCalledTimes(1);
  });

  it("asks again with activitySubType when Garmin refuses a subtype as activityType", async () => {
    api.getJson
      .mockRejectedValueOnce(refused())
      .mockResolvedValueOnce([{ activityId: 5, activityType: { typeKey: "trail_running" } }]);
    const rows = JSON.parse(await tools.listActivities(undefined, undefined, "trail_running", 5));
    expect(rows.map((r: { id: number }) => r.id)).toEqual([5]);
    expect(api.getJson).toHaveBeenCalledTimes(2);
    expect(api.getJson.mock.lastCall?.[1]).toMatchObject({
      activityType: undefined,
      activitySubType: "trail_running",
      limit: "5",
    });
  });

  it("filters by type itself when Garmin refuses activityType and activitySubType", async () => {
    api.getJson
      .mockRejectedValueOnce(refused())
      .mockRejectedValueOnce(refused())
      .mockResolvedValueOnce([
        { activityId: 1, activityType: { typeKey: "running" } },
        { activityId: 2, activityType: { typeKey: "cycling" } },
        { activityId: 3, activityType: { typeKey: "running" } },
      ]);
    const rows = JSON.parse(await tools.listActivities(undefined, undefined, "running", 1));
    expect(rows.map((r: { id: number }) => r.id)).toEqual([1]);
    expect(api.getJson).toHaveBeenCalledTimes(3);
    expect(api.getJson.mock.lastCall?.[1]).toMatchObject({
      activityType: undefined,
      activitySubType: undefined,
      limit: "100",
    });
  });

  it("keeps the activities whose name contains one of the names, ignoring case", async () => {
    api.getJson.mockResolvedValue([
      { activityId: 1, activityName: "Tempo 5k" },
      { activityId: 2, activityName: "Padel" },
      { activityId: 3, activityName: "Long run Z2" },
      { activityId: 4 },
      { activityId: 5, activityName: "TEMPO 5k" },
    ]);
    expect(await namedIds()).toEqual([1, 3, 5]);
    expect(api.getJson.mock.lastCall?.[1]).toMatchObject({
      limit: "100",
      startDate: "2026-09-01",
      endDate: "2026-10-27",
    });
    expect(await namedIds(2)).toEqual([1, 3]);
    expect(await namedIds(undefined, true)).toEqual([1, 3, 5]);
  });

  it("filters by name and by type together when Garmin refuses the type", async () => {
    api.getJson
      .mockRejectedValueOnce(refused())
      .mockRejectedValueOnce(refused())
      .mockResolvedValueOnce([
        { activityId: 1, activityName: "Tempo", activityType: { typeKey: "cycling" } },
        { activityId: 2, activityName: "Tempo", activityType: { typeKey: "running" } },
        { activityId: 3, activityName: "Easy", activityType: { typeKey: "running" } },
      ]);
    const rows = JSON.parse(
      await tools.listActivities(undefined, undefined, "running", 5, false, ["tempo"]),
    );
    expect(rows.map((r: { id: number }) => r.id)).toEqual([2]);
  });

  it("skips a list item that is not an object", async () => {
    api.getJson.mockResolvedValueOnce([null, { activityId: 1, activityName: "Tempo" }]);
    const named = await tools.listActivities(undefined, undefined, undefined, 5, false, ["tempo"]);
    expect(JSON.parse(named)).toEqual([{ id: 1, name: "Tempo" }]);
    api.getJson
      .mockRejectedValueOnce(refused())
      .mockRejectedValueOnce(refused())
      .mockResolvedValueOnce([null, { activityId: 2, activityType: { typeKey: "running" } }]);
    const typed = await tools.listActivities(undefined, undefined, "running", 5);
    expect(JSON.parse(typed)).toEqual([{ id: 2, type: "running" }]);
    api.getJson.mockResolvedValueOnce([null]);
    expect(JSON.parse(await tools.listActivities())).toEqual([{}]);
  });

  it("does not filter for an empty list of names", async () => {
    api.getJson.mockResolvedValue([{ activityId: 1, activityName: "A" }]);
    const rows = JSON.parse(
      await tools.listActivities(undefined, undefined, undefined, 5, false, [""]),
    );
    expect(rows.map((r: { id: number }) => r.id)).toEqual([1]);
    expect(api.getJson.mock.lastCall?.[1]).toMatchObject({ limit: "5" });
  });

  it("does not ask again for an error that is not a 400", async () => {
    api.getJson
      .mockRejectedValueOnce(refused())
      .mockRejectedValueOnce(
        new GarminApiError("GET /activitylist-service/activities/search/activities -> HTTP 500: x"),
      );
    await expect(tools.listActivities(undefined, undefined, "running")).rejects.toThrow(/HTTP 500/);
    expect(api.getJson).toHaveBeenCalledTimes(2);
  });

  it("does not hide other errors", async () => {
    api.getJson.mockRejectedValueOnce(
      new GarminApiError("GET /activitylist-service/activities/search/activities -> HTTP 500: x"),
    );
    await expect(tools.listActivities(undefined, undefined, "running")).rejects.toThrow(/HTTP 500/);
    expect(api.getJson).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 400 without activityType", async () => {
    api.getJson.mockRejectedValueOnce(refused());
    await expect(tools.listActivities()).rejects.toThrow(/HTTP 400/);
    expect(api.getJson).toHaveBeenCalledTimes(1);
  });

  it("returns Garmin's raw JSON with raw=true", async () => {
    api.getJson.mockResolvedValue([{ activityId: 1, anything: { x: 1 } }]);
    expect(await tools.listActivities(undefined, undefined, undefined, undefined, true)).toBe(
      '[{"activityId":1,"anything":{"x":1}}]',
    );
  });

  it("finds the list inside a wrapping object, else returns the JSON as is", async () => {
    api.getJson.mockResolvedValueOnce({ activityList: [{ activityId: 5 }] });
    expect(JSON.parse(await tools.listActivities())).toEqual([{ id: 5 }]);
    api.getJson.mockResolvedValueOnce({ message: "nothing" });
    expect(await tools.listActivities()).toBe('{"message":"nothing"}');
  });

  it.each([
    ["getActivity", [42], "/activity-service/activity/42", {}],
    [
      "getHrvRange",
      ["2026-10-01", "2026-10-27"],
      "/hrv-service/hrv/daily/2026-10-01/2026-10-27",
      {},
    ],
    [
      "getDailyHeartRate",
      ["2026-10-27"],
      "/wellness-service/wellness/dailyHeartRate",
      { date: "2026-10-27" },
    ],
    ["getSleep", ["2026-10-27", true], "/sleep-service/sleep/dailySleep", { date: "2026-10-27" }],
    [
      "getWeight",
      ["2026-07-01", "2026-10-27"],
      "/weight-service/weight/range/2026-07-01/2026-10-27",
      { includeAll: undefined },
    ],
    [
      "getBodyBattery",
      ["2026-10-21", "2026-10-27"],
      "/wellness-service/wellness/bodyBattery/reports/daily",
      { startDate: "2026-10-21", endDate: "2026-10-27" },
    ],
    ["getHeartRateZones", [], "/biometric-service/heartRateZones/v2", {}],
    ["getFitnessAge", ["2026-10-27"], "/fitnessage-service/fitnessage/v2/2026-10-27", {}],
    [
      "getDailySummary",
      ["2026-10-27"],
      "/usersummary-service/usersummary/daily",
      { calendarDate: "2026-10-27" },
    ],
  ] as const)("%s calls %s", async (tool, args, path, query) => {
    api.getJson.mockResolvedValue({ ok: 1 });
    const call = tools[tool] as (...a: unknown[]) => Promise<string>;
    expect(await call.apply(tools, [...args])).toBe('{"ok":1}');
    expect(api.getJson).toHaveBeenCalledWith(path, query);
  });

  it("garminGet leaves out the record id of a night, and keeps the other ids", async () => {
    api.getJson.mockResolvedValue({ id: 1, calendarDate: "2026-10-27" });
    expect(await tools.garminGet("/sleep-service/sleep/dailySleep")).toBe(
      '{"calendarDate":"2026-10-27"}',
    );
    api.getJson.mockResolvedValue({ id: 1, name: "Easy run" });
    expect(await tools.garminGet("/activity-service/activity/1")).toBe(
      '{"id":1,"name":"Easy run"}',
    );
  });

  it("garminGet decodes the query string into parameters", async () => {
    api.getJson.mockResolvedValue([]);
    await tools.garminGet("/x", "?a=1&b=2=3&=skip&noValue&a=4&c=&name=a%20b+c&d%C3%A9j%C3%A0=vu");
    expect(api.getJson).toHaveBeenCalledWith("/x", {
      a: "4",
      b: "2=3",
      noValue: "",
      c: "",
      name: "a b c",
      "d\u00e9j\u00e0": "vu",
    });
    await tools.garminGet("/y");
    expect(api.getJson).toHaveBeenLastCalledWith("/y", {});
  });

  it("getActivityWorkouts leaves out the null fields and keeps the rest", async () => {
    api.getJson.mockResolvedValue([
      {
        workoutName: "Drills",
        multisportSet: null,
        steps: [
          { stepIndex: 0, intensity: "WARMUP", durationValue: 600, targetValueLow: null },
          { stepIndex: 1, intensity: "ACTIVE", targetType: "CADENCE", targetValue: 0, notes: "" },
        ],
      },
    ]);
    expect(JSON.parse(await tools.getActivityWorkouts(42))).toEqual([
      {
        workoutName: "Drills",
        steps: [
          { stepIndex: 0, intensity: "WARMUP", durationValue: 600 },
          { stepIndex: 1, intensity: "ACTIVE", targetType: "CADENCE", targetValue: 0, notes: "" },
        ],
      },
    ]);
    expect(api.getJson).toHaveBeenCalledWith("/activity-service/activity/42/workouts", {});
  });

  it.each([
    ["getActivity", [42]],
    ["getActivityWorkouts", [42]],
    ["getHrvRange", ["2026-10-21", "2026-10-27"]],
    ["getDailyHeartRate", ["2026-10-27"]],
    ["getSleep", ["2026-10-27", true]],
    ["getSleepRange", ["2026-10-21", "2026-10-27", true]],
    ["getWeight", ["2026-10-21", "2026-10-27"]],
    ["getBodyBattery", ["2026-10-21", "2026-10-27"]],
    ["getHeartRateZones", []],
    ["getFitnessAge", ["2026-10-27"]],
    ["getDailySummary", ["2026-10-27"]],
    ["getDailySummaryRange", ["2026-10-21", "2026-10-27"]],
    ["listActivities", [undefined, undefined, undefined, 1, true]],
    ["garminGet", ["/x"]],
  ] as const)(
    "%s leaves out the ids of the user, the device and the record",
    async (tool, args) => {
      const record = {
        activityId: 7,
        typeId: 1,
        calendarDate: "2026-10-27",
        userProfilePK: 1,
        userProfilePk: 2,
        userProfileId: 3,
        userId: 4,
        profileId: 5,
        ownerId: 6,
        ownerDisplayName: "a",
        ownerFullName: "b",
        ownerProfileImageUrlSmall: "c",
        displayName: "d",
        fullName: "e",
        deviceId: 8,
        userDailySummaryId: 9,
        uuid: "f",
        samplePk: 10,
        activityUUID: { uuid: "g" },
        wrapperDTO: { inner: { uuid: "h" } },
        emptyDTO: {},
        metadataDTO: { fileFormat: { formatId: 1 }, userInfoDto: { userProfilePk: 1 } },
        sleepNeed: { userProfilePk: 1, deviceId: 2, actual: 450 },
        data: [{ userProfilePk: 1, totalSteps: 100 }],
      };
      api.getJson.mockResolvedValue([record]);
      const call = tools[tool] as (...a: unknown[]) => Promise<string>;
      expect(JSON.parse(await call.apply(tools, [...args]))).toEqual([
        {
          activityId: 7,
          typeId: 1,
          calendarDate: "2026-10-27",
          emptyDTO: {},
          metadataDTO: { fileFormat: { formatId: 1 } },
          sleepNeed: { actual: 450 },
          data: [{ totalSteps: 100 }],
        },
      ]);
    },
  );

  it("getSleep answers one compact row for the night", async () => {
    api.getJson.mockResolvedValue(night("2026-10-27"));
    expect(await tools.getSleep("2026-10-27")).toBe(
      '{"date":"2026-10-27","bedtime":"23:10","wake":"07:05","sleepH":7.5,"deepH":1.5,' +
        '"lightH":4.25,"remH":1.75,"awakeH":0.25,"sleepScore":82,"sleepQuality":"GOOD",' +
        '"needH":8,"avgHR":52,"avgSpO2":95,"lowestSpO2":88,"avgRespiration":14.3,' +
        '"awakeCount":2,"avgSleepStress":12.4,"feedback":"POSITIVE_LONG_AND_DEEP"}',
    );
  });

  it("getSleep leaves out what Garmin has not measured, and keeps the asked date", async () => {
    api.getJson.mockResolvedValue({
      sleepTimeSeconds: null,
      sleepStartTimestampLocal: 1e20,
      sleepScores: { overall: { value: null } },
      sleepNeed: null,
      avgSleepStress: "12",
    });
    expect(JSON.parse(await tools.getSleep("2026-10-27"))).toEqual({ date: "2026-10-27" });
    api.getJson.mockResolvedValue(null);
    expect(JSON.parse(await tools.getSleep("2026-10-27"))).toEqual({ date: "2026-10-27" });
  });

  it("getSleep answers only the date for a night without sleep, even with a sleep need", async () => {
    api.getJson.mockResolvedValue(emptyNight("2026-10-28"));
    expect(await tools.getSleep("2026-10-28")).toBe('{"date":"2026-10-28"}');
  });

  it("getSleep with raw gives Garmin's JSON without the record and user ids", async () => {
    api.getJson.mockResolvedValue(night("2026-10-27"));
    const raw = JSON.parse(await tools.getSleep("2026-10-27", true));
    const { id: _id, userProfilePK: _pk, ...rest } = night("2026-10-27");
    expect(raw).toEqual({
      ...rest,
      sleepNeed: { calendarDate: "2026-10-27", baseline: 480, actual: 480, feedback: "NO_CHANGE" },
    });
  });

  it("getSleepRange answers one row per night asked, with only the date when there is no sleep", async () => {
    // Garmin leaves out some nights, and answers the next night with a sleep need and no date
    api.getJson.mockResolvedValue([{}, night("2026-10-26"), emptyNight("2026-10-28")]);
    const rows = JSON.parse(await tools.getSleepRange("2026-10-25", "2026-10-29"));
    expect(rows).toEqual([
      { date: "2026-10-25" },
      expect.objectContaining({ date: "2026-10-26", sleepH: 7.5, sleepScore: 82 }),
      { date: "2026-10-27" },
      { date: "2026-10-28" },
      { date: "2026-10-29" },
    ]);
    expect(api.getJson).toHaveBeenCalledOnce();
    expect(api.getJson).toHaveBeenCalledWith("/sleep-service/sleep/dailySleepSummariesByDate", {
      startDate: "2026-10-25",
      endDate: "2026-10-29",
    });
  });

  it("getSleepRange answers 14 nights in under 8,000 characters", async () => {
    const days = Array.from({ length: 14 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
    api.getJson.mockResolvedValue(days.map(night));
    const raw = await tools.getSleepRange("2026-10-01", "2026-10-14", true);
    const compact = await tools.getSleepRange("2026-10-01", "2026-10-14");
    expect(JSON.parse(compact)).toHaveLength(14);
    expect(compact.length).toBeLessThan(8000);
    expect(compact.length).toBeLessThan(raw.length / 3);
  });

  it("getSleepRange gives Garmin's answer as it is when it is not a list of nights", async () => {
    api.getJson.mockResolvedValue({ message: "nothing" });
    expect(await tools.getSleepRange("2026-10-21", "2026-10-27")).toBe('{"message":"nothing"}');
    expect(api.getJson).toHaveBeenCalledWith("/sleep-service/sleep/dailySleepSummariesByDate", {
      startDate: "2026-10-21",
      endDate: "2026-10-27",
    });
  });

  it("getWeight takes a range of months but refuses a date that is not real, without a request", async () => {
    api.getJson.mockResolvedValue({});
    await tools.getWeight("2025-10-28", "2026-10-27");
    expect(api.getJson).toHaveBeenCalledOnce();
    for (const [from, to] of [
      ["2026-02-31", "2026-03-01"],
      ["2026-10-27", "2026-10-01"],
      ["../x", "2026-10-01"],
    ]) {
      await expect(tools.getWeight(from, to)).rejects.toThrow(/real dates/);
    }
    expect(api.getJson).toHaveBeenCalledOnce();
  });

  it("getBodyBattery accepts 14 days and refuses 15", async () => {
    api.getJson.mockResolvedValue([]);
    await tools.getBodyBattery("2026-10-01", "2026-10-14");
    expect(api.getJson).toHaveBeenCalledOnce();
    await expect(tools.getBodyBattery("2026-10-01", "2026-10-15")).rejects.toThrow(
      /at most 14 days/,
    );
    expect(api.getJson).toHaveBeenCalledOnce();
  });

  it("getSleepRange accepts 14 days and refuses 15", async () => {
    api.getJson.mockResolvedValue([]);
    await tools.getSleepRange("2026-10-01", "2026-10-14");
    expect(api.getJson).toHaveBeenCalledOnce();
    await expect(tools.getSleepRange("2026-10-01", "2026-10-15")).rejects.toThrow(
      /at most 14 days/,
    );
    expect(api.getJson).toHaveBeenCalledOnce();
  });

  it("getDailySummaryRange asks for the days between two dates in one request", async () => {
    api.getJson.mockResolvedValue({ summaries: [] });
    expect(await tools.getDailySummaryRange("2026-10-01", "2026-10-14")).toBe('{"summaries":[]}');
    expect(api.getJson).toHaveBeenCalledOnce();
    expect(api.getJson).toHaveBeenCalledWith("/usersummary-service/v2/dailysummaries", {
      startDate: "2026-10-01",
      endDate: "2026-10-14",
    });
  });

  it("getDailySummaryRange accepts 14 days and refuses 15", async () => {
    api.getJson.mockResolvedValue({});
    await tools.getDailySummaryRange("2026-10-01", "2026-10-14");
    expect(api.getJson).toHaveBeenCalledOnce();
    await expect(tools.getDailySummaryRange("2026-10-01", "2026-10-15")).rejects.toThrow(
      /at most 14 days/,
    );
    expect(api.getJson).toHaveBeenCalledOnce();
  });

  it("a range refuses a date that does not exist, without a request", async () => {
    await expect(tools.getSleepRange("2026-02-27", "2026-02-31")).rejects.toThrow(/yyyy-MM-dd/);
    await expect(tools.getDailySummaryRange("2026-13-01", "2026-13-02")).rejects.toThrow(
      /yyyy-MM-dd/,
    );
    expect(api.getJson).not.toHaveBeenCalled();
  });

  it.each([
    ["from after to", "2026-10-27", "2026-10-01"],
    ["a bad from date", "27-10-2026", "2026-10-27"],
    ["a bad to date", "2026-10-01", "2026-10-27T00:00"],
  ])("range calls refuse %s without a request", async (_name, from, to) => {
    const message = "fromDate and toDate must be real dates yyyy-MM-dd with fromDate <= toDate";
    await expect(tools.getSleepRange(from, to)).rejects.toThrow(message);
    await expect(tools.getDailySummaryRange(from, to)).rejects.toThrow(message);
    expect(api.getJson).not.toHaveBeenCalled();
  });
});

const strengthFit = () =>
  fitFile([
    Profile.MesgNum.SET,
    { setType: 1, repetitions: 5, weight: 60, duration: 20, category: [28], categorySubtype: [6] },
  ]);

describe("FIT tools", () => {
  it("downloads the FIT file once and keeps it in <data-dir>/fit", async () => {
    const fit = strengthFit();
    api.getBytes.mockResolvedValue(zipSync({ "77_ACTIVITY.fit": fit }));
    const first = JSON.parse(await tools.downloadActivityFit(77));
    const path = join(dataDir, "fit", "77.fit");
    expect(first).toEqual({ path, bytes: fit.length });
    expect(readFileSync(path)).toEqual(Buffer.from(fit));
    expect(api.getBytes).toHaveBeenCalledWith("/download-service/files/activity/77", {});

    await tools.getActivitySets(77);
    await tools.getActivityLaps(77);
    expect(api.getBytes).toHaveBeenCalledTimes(1);
  });

  it("shares one download between parallel calls for the same activity", async () => {
    api.getBytes.mockResolvedValue(strengthFit());
    api.getExerciseCatalogue.mockRejectedValue(new GarminApiError("offline"));
    await Promise.all([
      tools.getActivityLaps(80),
      tools.getActivitySets(80),
      tools.downloadActivityFit(80),
    ]);
    expect(api.getBytes).toHaveBeenCalledTimes(1);
  });

  it("refuses a download that is not a .FIT file and caches nothing", async () => {
    api.getBytes.mockResolvedValue(new TextEncoder().encode("<html>maintenance</html>"));
    await expect(tools.getActivityLaps(81)).rejects.toThrow(/is not a \.FIT file/);
    expect(existsSync(join(dataDir, "fit", "81.fit"))).toBe(false);
    api.getBytes.mockResolvedValue(strengthFit());
    await expect(tools.getActivityLaps(81)).resolves.toBeDefined();
  });

  it("lets a new call download again after a failed download", async () => {
    api.getBytes.mockRejectedValueOnce(new GarminApiError("down"));
    await expect(tools.getActivityLaps(82)).rejects.toThrow("down");
    api.getBytes.mockResolvedValue(strengthFit());
    await expect(tools.getActivityLaps(82)).resolves.toBeDefined();
    expect(api.getBytes).toHaveBeenCalledTimes(2);
  });

  it("downloads again when the cached file is empty", async () => {
    await mkdir(join(dataDir, "fit"), { recursive: true });
    writeFileSync(join(dataDir, "fit", "78.fit"), "");
    api.getBytes.mockResolvedValue(strengthFit());
    await tools.getActivityLaps(78);
    expect(api.getBytes).toHaveBeenCalledTimes(1);
  });

  it("reads the sets with muscles from the exercise catalogue", async () => {
    api.getBytes.mockResolvedValue(strengthFit());
    api.getExerciseCatalogue.mockResolvedValue(
      new TextEncoder().encode(
        JSON.stringify({
          categories: {
            SQUAT: {
              exercises: {
                BARBELL_BACK_SQUAT: { primaryMuscles: ["QUADS"], secondaryMuscles: [] },
              },
            },
          },
        }),
      ),
    );
    expect(JSON.parse(await tools.getActivitySets(79))).toEqual({
      activityId: 79,
      exercises: [
        {
          exercise: "Barbell Back Squat",
          category: "Squat",
          primaryMuscles: ["Quads"],
          secondaryMuscles: [],
          sets: [{ reps: 5, kg: 60, seconds: 20 }],
        },
      ],
    });
    expect(readFileSync(join(dataDir, "exercises.json"), "utf8")).toContain("BARBELL_BACK_SQUAT");
  });
});

const catalogueFile = () => join(dataDir, "exercises.json");

describe("exercise catalogue", () => {
  const squat = {
    categories: { SQUAT: { exercises: { BARBELL_BACK_SQUAT: { primaryMuscles: ["GLUTES"] } } } },
  };

  beforeEach(() => {
    api.getBytes.mockResolvedValue(strengthFit());
  });

  it("uses a copy younger than 30 days without downloading", async () => {
    writeFileSync(catalogueFile(), JSON.stringify(squat));
    const out = JSON.parse(await tools.getActivitySets(1));
    expect(out.exercises[0].primaryMuscles).toEqual(["Glutes"]);
    expect(api.getExerciseCatalogue).not.toHaveBeenCalled();
  });

  it("keeps using an old copy when the refresh fails, and waits 10 minutes to retry", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 27), toFake: ["Date"] });
    writeFileSync(catalogueFile(), JSON.stringify(squat));
    const old = new Date(Date.UTC(2026, 8, 1));
    utimesSync(catalogueFile(), old, old);
    api.getExerciseCatalogue.mockRejectedValue(
      new GarminApiError("GET exercise catalogue -> HTTP 503"),
    );

    const out = JSON.parse(await tools.getActivitySets(1));
    expect(out.exercises[0].primaryMuscles).toEqual(["Glutes"]);
    expect(statSync(catalogueFile()).mtime).toEqual(old);
    expect(api.getExerciseCatalogue).toHaveBeenCalledTimes(1);
  });

  it("retries a failed download only after 10 minutes", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 27), toFake: ["Date"] });
    api.getExerciseCatalogue.mockRejectedValue(new GarminApiError("down"));
    await tools.getActivitySets(1);
    vi.setSystemTime(Date.UTC(2026, 9, 27, 0, 9));
    await tools.getActivitySets(1);
    expect(api.getExerciseCatalogue).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.UTC(2026, 9, 27, 0, 10, 1));
    await tools.getActivitySets(1);
    expect(api.getExerciseCatalogue).toHaveBeenCalledTimes(2);
  });

  it("keeps the catalogue in memory after the first read", async () => {
    writeFileSync(catalogueFile(), JSON.stringify(squat));
    await tools.getActivitySets(1);
    rmSync(catalogueFile());
    const out = JSON.parse(await tools.getActivitySets(1));
    expect(out.exercises[0].primaryMuscles).toEqual(["Glutes"]);
    expect(api.getExerciseCatalogue).not.toHaveBeenCalled();
  });

  it("gives sets without muscles when the catalogue cannot be read, and logs why", async () => {
    // not a Garmin error and not bad JSON: the download step passes it on, the reader logs it
    api.getExerciseCatalogue.mockRejectedValue(new TypeError("boom"));
    const out = JSON.parse(await tools.getActivitySets(1));
    expect(out.exercises[0]).not.toHaveProperty("primaryMuscles");
    expect(log).toHaveBeenCalledWith("WARN", "Cannot read the exercise catalogue: boom");
  });

  it("gives sets without muscles when there is no catalogue at all", async () => {
    api.getExerciseCatalogue.mockResolvedValue(new TextEncoder().encode('{"no":"categories"}'));
    const out = JSON.parse(await tools.getActivitySets(1));
    expect(out.exercises[0]).not.toHaveProperty("primaryMuscles");
  });
});

describe("firstArray", () => {
  it("finds the activity list under the names Garmin uses, else none", () => {
    expect(firstArray({ items: [1] })).toEqual([1]);
    expect(firstArray({ data: [2], activityList: [1] })).toEqual([1]);
    expect(firstArray({ activities: "not a list" })).toBeUndefined();
    expect(firstArray("text")).toBeUndefined();
    expect(firstArray(null)).toBeUndefined();
  });
});

async function connect() {
  const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
  const server = createServer({ baseUrl: "https://api.test", apiKeyFile: "/none", dataDir });
  const client = new Client({ name: "test", version: "1" });
  await server.connect(serverEnd);
  await client.connect(clientEnd);
  return client;
}

/** A client on the tool handlers, with the mocked API, a mocked dashboard and a mocked page writer. */
async function connectHandlers(
  writer: Partial<DashboardWriter> = {},
  dashboard: Partial<GarminDashboard> = {},
) {
  const server = new McpServer({ name: "test", version: "1" });
  registerTools(server, tools);
  registerDashboard(server, dashboard as GarminDashboard);
  registerDashboardWriter(server, writer as DashboardWriter);
  const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await server.connect(serverEnd);
  await client.connect(clientEnd);
  return client;
}

/** The text of a tool result. */
const textOf = (r: unknown) => (r as { content: { text: string }[] }).content[0].text;

// zod bounds integers to the safe range; the reference list declares a plain integer
const unbounded = (properties: unknown) =>
  JSON.parse(
    JSON.stringify(properties, (k, v) =>
      (k === "minimum" || k === "maximum") && Math.abs(v) === Number.MAX_SAFE_INTEGER
        ? undefined
        : v,
    ),
  );

/** What the reference tool list and this server must agree on for each tool. */
const shape = (t: {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}) => ({
  name: t.name,
  description: t.description,
  properties: unbounded(t.inputSchema.properties),
  required: ((t.inputSchema.required as string[]) ?? []).toSorted(),
});

describe("MCP tools", () => {
  it("has the names, descriptions and parameters of the reference tool list", async () => {
    const { tools: listed } = await (await connect()).listTools();
    const expected = toolList.map(shape);
    expect(listed.map(shape).toSorted((a, b) => a.name.localeCompare(b.name))).toEqual(expected);
  });

  it("lets only the model call each tool, never the page in the chat", async () => {
    const { tools: listed } = await (await connect()).listTools();
    expect(listed).toHaveLength(toolList.length);
    for (const t of listed) {
      // MCP Apps: without visibility a tool is ["model", "app"], so code in the page could call it
      expect(t, t.name).toMatchObject({ _meta: { ui: { visibility: ["model"] } } });
    }
  });

  it("returns the tool result as JSON text, and errors as tool errors", async () => {
    const client = await connect();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "k");
    const result = await client.callTool({ name: "getHeartRateZones", arguments: {} });
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "Network error obtaining token: fetch failed" }],
    });
  });

  it.each([
    ["getActivity", { activityId: 42 }, "/activity-service/activity/42", {}],
    ["getActivityWorkouts", { activityId: 42 }, "/activity-service/activity/42/workouts", {}],
    [
      "getHrvRange",
      { fromDate: "2026-10-01", toDate: "2026-10-27" },
      "/hrv-service/hrv/daily/2026-10-01/2026-10-27",
      {},
    ],
    [
      "getDailyHeartRate",
      { date: "2026-10-27" },
      "/wellness-service/wellness/dailyHeartRate",
      { date: "2026-10-27" },
    ],
    [
      "getSleep",
      { date: "2026-10-27", raw: true },
      "/sleep-service/sleep/dailySleep",
      { date: "2026-10-27" },
    ],
    [
      "getWeight",
      { fromDate: "2026-10-01", toDate: "2026-10-27", includeAll: true },
      "/weight-service/weight/range/2026-10-01/2026-10-27",
      { includeAll: "true" },
    ],
    [
      "getBodyBattery",
      { fromDate: "2026-10-21", toDate: "2026-10-27" },
      "/wellness-service/wellness/bodyBattery/reports/daily",
      { startDate: "2026-10-21", endDate: "2026-10-27" },
    ],
    ["getHeartRateZones", {}, "/biometric-service/heartRateZones/v2", {}],
    ["getFitnessAge", { date: "2026-10-27" }, "/fitnessage-service/fitnessage/v2/2026-10-27", {}],
    [
      "getDailySummary",
      { date: "2026-10-27" },
      "/usersummary-service/usersummary/daily",
      { calendarDate: "2026-10-27" },
    ],
    ["garminGet", { path: "/x", query: "a=1" }, "/x", { a: "1" }],
  ])("%s passes its arguments to the Garmin path", async (tool, args, path, query) => {
    api.getJson.mockResolvedValue({ ok: 1 });
    const client = await connectHandlers();
    const result = await client.callTool({ name: tool, arguments: args });
    expect(textOf(result)).toBe('{"ok":1}');
    expect(api.getJson).toHaveBeenCalledWith(path, query);
  });

  it.each([
    ["getSleep", "/sleep-service/sleep/dailySleepSummariesByDate"],
    ["getDailySummary", "/usersummary-service/v2/dailysummaries"],
  ])("%s with fromDate and toDate takes the range path", async (tool, path) => {
    api.getJson.mockResolvedValue({ ok: 1 });
    const client = await connectHandlers();
    const result = await client.callTool({
      name: tool,
      arguments: { fromDate: "2026-10-21", toDate: "2026-10-27" },
    });
    expect(textOf(result)).toBe('{"ok":1}');
    expect(api.getJson).toHaveBeenCalledWith(path, {
      startDate: "2026-10-21",
      endDate: "2026-10-27",
    });
  });

  it.each(["getSleep", "getDailySummary"])(
    "%s refuses a date together with a range, or neither, without a request",
    async (tool) => {
      const client = await connectHandlers();
      for (const args of [
        { date: "2026-10-27", fromDate: "2026-10-21", toDate: "2026-10-27" },
        { date: "2026-10-27", toDate: "2026-10-27" },
        { fromDate: "2026-10-21" },
        {},
      ]) {
        const result = await client.callTool({ name: tool, arguments: args });
        expect(result).toMatchObject({ isError: true });
        expect(textOf(result)).toBe("Give date, or fromDate and toDate");
      }
      expect(api.getJson).not.toHaveBeenCalled();
    },
  );

  it("listActivities passes the dates, the type, the limit and raw in their places", async () => {
    api.getJson.mockResolvedValue([{ activityId: 9 }]);
    const client = await connectHandlers();
    const result = await client.callTool({
      name: "listActivities",
      arguments: {
        startDate: "2026-10-01",
        endDate: "2026-10-27",
        activityType: "running",
        limit: 5,
        raw: true,
      },
    });
    expect(api.getJson).toHaveBeenCalledWith("/activitylist-service/activities/search/activities", {
      start: "0",
      limit: "5",
      startDate: "2026-10-01",
      endDate: "2026-10-27",
      activityType: "running",
    });
    expect(textOf(result)).toBe('[{"activityId":9}]');
  });

  it("listActivities passes the names", async () => {
    api.getJson.mockResolvedValue([
      { activityId: 1, activityName: "Tempo" },
      { activityId: 2, activityName: "Easy" },
    ]);
    const client = await connectHandlers();
    const result = await client.callTool({
      name: "listActivities",
      arguments: { names: ["tempo"] },
    });
    expect(JSON.parse(textOf(result))).toEqual([{ id: 1, name: "Tempo" }]);
  });

  it("the FIT tools read the activity id from their arguments", async () => {
    api.getBytes.mockResolvedValue(zipSync({ "77_ACTIVITY.fit": strengthFit() }));
    const client = await connectHandlers();
    const download = await client.callTool({
      name: "downloadActivityFit",
      arguments: { activityId: 77 },
    });
    const laps = await client.callTool({ name: "getActivityLaps", arguments: { activityId: 77 } });
    const sets = await client.callTool({ name: "getActivitySets", arguments: { activityId: 77 } });
    expect(JSON.parse(textOf(download)).path).toBe(join(dataDir, "fit", "77.fit"));
    expect(api.getBytes).toHaveBeenCalledTimes(1);
    expect(api.getBytes).toHaveBeenCalledWith("/download-service/files/activity/77", {});
    expect(() => JSON.parse(textOf(laps))).not.toThrow();
    expect(JSON.parse(textOf(sets)).exercises[0].sets[0]).toMatchObject({ reps: 5 });
  });

  describe("dashboard tools", () => {
    const writer = { write: vi.fn(), preview: vi.fn(), edit: vi.fn() };
    const dashboard = { getDashboardData: vi.fn() };
    beforeEach(() => {
      writer.write.mockResolvedValue({ wrote: 1 });
      writer.preview.mockResolvedValue({ previewed: 1 });
      writer.edit.mockResolvedValue({ edited: 1 });
      dashboard.getDashboardData.mockResolvedValue('{"end":"2026-10-26"}');
    });

    it("getDashboardData passes weeks and workouts", async () => {
      const client = await connectHandlers(writer, dashboard);
      const result = await client.callTool({ name: "getDashboardData", arguments: { weeks: 8 } });
      expect(dashboard.getDashboardData).toHaveBeenCalledWith(8, undefined);
      await client.callTool({ name: "getDashboardData", arguments: { workouts: true } });
      expect(dashboard.getDashboardData).toHaveBeenLastCalledWith(undefined, true);
      expect(JSON.parse(textOf(result))).toMatchObject({ end: "2026-10-26" });
    });

    it("getDashboardData gives the server's digest first, then the data as it is", async () => {
      const data = {
        end: "2026-10-26",
        activities: [
          { type: "running", km: 5, trainingLoad: 50, start: "2026-10-20 07:00:00" },
          { type: "running", km: 7.5, trainingLoad: 70, start: "2026-10-22 07:00:00" },
        ],
      };
      dashboard.getDashboardData.mockResolvedValue(JSON.stringify(data));
      const client = await connectHandlers(writer, dashboard);
      const text = textOf(await client.callTool({ name: "getDashboardData", arguments: {} }));
      const { digest, ...rest } = JSON.parse(text);

      expect(text.startsWith('{\n"digest":')).toBe(true);
      expect(digest.totals.running).toMatchObject({ sessions: 2, km: 12.5, load: 120 });
      expect(rest).toEqual(data);
    });

    it("writeDashboard writes with its arguments", async () => {
      const client = await connectHandlers(writer, dashboard);
      const args = { weeks: 4, notes: ["n"], path: "a.html" };
      const result = await client.callTool({ name: "writeDashboard", arguments: args });
      expect(writer.write).toHaveBeenCalledWith(args);
      expect(writer.preview).not.toHaveBeenCalled();
      expect(textOf(result)).toBe('{"wrote":1}');
    });

    it("writeDashboard with preview only previews, without the preview key", async () => {
      const client = await connectHandlers(writer, dashboard);
      const result = await client.callTool({
        name: "writeDashboard",
        arguments: { weeks: 4, preview: true },
      });
      expect(writer.preview).toHaveBeenCalledWith({ weeks: 4 });
      expect(writer.write).not.toHaveBeenCalled();
      expect(textOf(result)).toBe('{"previewed":1}');
    });

    it("editDashboard edits with its arguments", async () => {
      const client = await connectHandlers(writer, dashboard);
      const args = { removeLanguages: ["de"], path: "a.html" };
      const result = await client.callTool({ name: "editDashboard", arguments: args });
      expect(writer.edit).toHaveBeenCalledWith(args);
      expect(textOf(result)).toBe('{"edited":1}');
    });

    it("showDashboard gives the model the digest and the page the blocks", async () => {
      const blocks = { data: { weeks: 4 }, layout: null, widgets: [], languages: {}, i18n: {} };
      const view = vi.fn().mockResolvedValue({
        path: "/d/a.html",
        digest: { totals: {} },
        blocks: { ...blocks, settings: { title: "T" } },
      });
      const client = await connectHandlers({ ...writer, view }, dashboard);
      const result = await client.callTool({
        name: "showDashboard",
        arguments: { weeks: 4, path: "a.html" },
      });
      expect(view).toHaveBeenCalledWith({ weeks: 4, path: "a.html" });
      // the large data stays out of the text that the model reads
      expect(JSON.parse(textOf(result))).toEqual({
        path: "/d/a.html",
        digest: { totals: {} },
        settings: { title: "T" },
      });
      expect(result.structuredContent).toEqual({ ...blocks, settings: { title: "T" } });
    });

    it("links showDashboard to the page resource, served as an MCP App", async () => {
      const template = vi.fn().mockResolvedValue("<html>page</html>");
      const client = await connectHandlers({ ...writer, template }, dashboard);
      const { tools: listed } = await client.listTools();
      const uri = "ui://garmin-personal/dashboard.html";
      expect(listed.find((t) => t.name === "showDashboard")).toMatchObject({
        _meta: { ui: { resourceUri: uri, visibility: ["model"] } },
      });
      expect((await client.readResource({ uri })).contents).toEqual([
        { uri, mimeType: "text/html;profile=mcp-app", text: "<html>page</html>" },
      ]);
    });
  });
});
