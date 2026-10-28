import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Profile } from "@garmin/fitsdk";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GarminApiError, type GarminApiClient } from "../src/api-client";
import { createServer } from "../src/server";
import { GarminTools, summarize } from "../src/tools";
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
      limit: "200",
      startDate: "2026-10-01",
      endDate: "2026-10-27",
      activityType: "running",
    });
    await tools.listActivities(undefined, undefined, undefined, 0);
    expect(api.getJson.mock.lastCall?.[1]).toMatchObject({ limit: "20" });
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
    ["getSleep", ["2026-10-27"], "/sleep-service/sleep/dailySleep", { date: "2026-10-27" }],
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

  it("gives sets without muscles when there is no catalogue at all", async () => {
    api.getExerciseCatalogue.mockResolvedValue(new TextEncoder().encode('{"no":"categories"}'));
    const out = JSON.parse(await tools.getActivitySets(1));
    expect(out.exercises[0]).not.toHaveProperty("primaryMuscles");
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
});
