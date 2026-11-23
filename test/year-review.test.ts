import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type GarminApiClient, GarminApiError } from "../src/api-client";
import type { YearSummary } from "../src/analytics/year";
import { type CachedRows, GarminDashboard } from "../src/dashboard";
import { DashboardWriter, readBlock } from "../src/dashboard-page";
import { addDays, reviewYear } from "../src/dates";
import { refreshPages } from "../src/schedule";
import { type GarminTools, isObject } from "../src/tools";
import type { Settings } from "../src/page/settings";
import { pageYear, registerYearReview, yearOf } from "../src/year-review";
import { type Answer, closeAll, connect, type Era } from "./elicitation-client";

vi.mock("../src/log", () => ({ log: vi.fn() }));

const YES: Answer = { action: "accept", content: { confirm: true } };
const NO: Answer = { action: "decline" };
const ERAS = ["2025", "2026-07-28"] as const;

let dir: string;
let api: { getJson: ReturnType<typeof vi.fn> };
/** The activities that the fake Garmin has. */
let garmin: { activityId: number; startTimeLocal: string; [k: string]: unknown }[];

/** The day that the server reads as today. */
const setToday = (day: string) => vi.setSystemTime(new Date(`${day}T12:00:00`));
const nextDay = () => setToday("2026-10-27");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "garmin-year-"));
  vi.useFakeTimers({ toFake: ["Date"] });
  setToday("2026-10-26");
  garmin = [];
  api = {
    getJson: vi.fn(async (_path: string, q: Record<string, string>) => {
      const list = garmin.filter((a) => {
        const day = a.startTimeLocal.slice(0, 10);
        return day >= q.startDate && day <= q.endDate;
      });
      return list.slice(Number(q.start), Number(q.start) + Number(q.limit));
    }),
  };
});

afterEach(async () => {
  await closeAll();
  vi.restoreAllMocks();
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

const cacheFile = () => join(dir, "dashboard-cache.json");
const removeCache = () => rmSync(cacheFile());
/** A cached row, as summarize keeps it: a 1-hour run. */
const row = (id: number, day: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Run ${id}`,
  start: `${day} 07:00:00`,
  type: "running",
  sport: "running",
  km: 10,
  duration: "1:00:00",
  ...extra,
});
const byId = (...rows: { id: number }[]) => Object.fromEntries(rows.map((r) => [r.id, r]));
/** Saves a current cache that covers the year 2026 to today. */
const save = (extra: Record<string, unknown> = {}) =>
  writeFileSync(
    cacheFile(),
    JSON.stringify({
      activitiesSummary: 3,
      activitiesFrom: "2026-01-01",
      activitiesTo: "2026-10-26",
      ...extra,
    }),
  );
/** The cache starts on 1 March: January and February are missing. */
const saveFromMarch = () =>
  save({ activitiesFrom: "2026-03-01", activities: byId(row(1, "2026-10-20")) });
const saveFromFebruary = () =>
  save({ activitiesFrom: "2026-02-01", activities: byId(row(1, "2026-10-20")) });
const runAndRide = () => [
  row(1, "2026-03-02"),
  row(2, "2026-03-03", { name: "Ride 2", type: "cycling", sport: "cycling" }),
];
/** An older cache with 2125 days from 2021 to today, 1 session a day: 22 requests; the year alone is 3. */
const saveOldYears = (first = "2021-01-01") => {
  const days: string[] = [];
  for (let d = first; d <= "2026-10-20"; d = addDays(d, 1)) days.push(d);
  const activities = byId(...days.map((d, i) => row(i, d)));
  save({ activitiesSummary: 2, activitiesFrom: days[0], activitiesTo: days.at(-1), activities });
};

/** Two sports, HRV and resting HR, all days covered. */
const saveAllKinds = () =>
  save({
    activities: byId(...runAndRide()),
    hrvFrom: "2026-01-01",
    hrvTo: "2026-10-26",
    hrv: { "2026-03-02": { date: "2026-03-02", hrv: 50 } },
    recovery: { "2026-03-02": { date: "2026-03-02", rhr: 45 } },
  });
const savePage = (settings: string, name = "garmin-dashboard.html") =>
  writeFileSync(
    join(dir, name),
    "<script>window.GARMIN_DATA = /* garmin-data:start */{}/* garmin-data:end */;" +
      `window.GARMIN_SETTINGS = /* garmin-settings:start */${settings}/* garmin-settings:end */;</script>`,
  );
/** An activity of the Garmin list. */
const activity = (id: number, day: string) => ({
  activityId: id,
  activityName: "Run",
  startTimeLocal: `${day} 07:00:00`,
  activityType: { typeKey: "running" },
  sportTypeId: 1,
  distance: 10_000,
  duration: 3600,
  movingDuration: 3600,
});

/** Runs `change` right after the nth read of the cache: after the yes, the fetch can wait in the queue. */
const afterRead = (n: number, change: () => void) => {
  const read = GarminDashboard.prototype.readCached;
  let reads = 0;
  vi.spyOn(GarminDashboard.prototype, "readCached").mockImplementation(async function (
    this: GarminDashboard,
    ...args
  ) {
    const out = await read.apply(this, args);
    if (++reads === n) change();
    return out;
  });
};

/** The first two calls read the same cache: none goes on before both have read it. */
const bothRead = () => {
  let release: (() => void) | undefined;
  const both = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = GarminDashboard.prototype.readCached;
  let reads = 0;
  vi.spyOn(GarminDashboard.prototype, "readCached").mockImplementation(async function (
    this: GarminDashboard,
    ...args
  ) {
    const out = await read.apply(this, args);
    if (++reads === 2) release?.();
    await both;
    return out;
  });
};

/** Answers each form in turn; `first` runs while the first form is open. */
const inTurn = (answers: Answer[], first: () => void): Answer => {
  let form = -1;
  return {
    get action() {
      form += 1;
      if (form === 0) first();
      return answers[form].action;
    },
    get content() {
      return answers[form].content;
    },
  };
};

const answers = (...given: Answer[]) => inTurn(given, () => {});

const open = (era: Era, answer: Answer | undefined) =>
  connect(era, answer, (server) => {
    const dashboard = new GarminDashboard(
      {} as GarminTools,
      api as unknown as GarminApiClient,
      dir,
    );
    const writer = new DashboardWriter(
      async () => "{}",
      dir,
      async () => "",
      undefined,
    );
    registerYearReview(server, dashboard, writer);
  });

async function review(
  args: Record<string, unknown> = {},
  answer: Answer | undefined = undefined,
  era: Era = "2026-07-28",
) {
  const { client, asked } = await open(era, answer);
  const r = await client.callTool({ name: "getYearReview", arguments: args });
  const text = (r.content as { text: string }[])[0].text;
  return {
    asked,
    text,
    isError: r.isError === true,
    reply: r.isError ? undefined : JSON.parse(text),
    messages: asked.map((p) => (p as { message: string }).message),
  };
}

/** Opens a client, for more than one call. */
async function connected(era: Era, answer: Answer) {
  const { client, asked } = await open(era, answer);
  const call = async () => {
    const r = await client.callTool({ name: "getYearReview", arguments: {} });
    return JSON.parse((r.content as { text: string }[])[0].text);
  };
  /** Two calls at the same time, in the order of `fill.asked` and the requests: each can end first. */
  const callTwice = async () => {
    bothRead();
    const replies = await Promise.all([call(), call()]);
    return replies
      .map((r) => r.fill)
      .toSorted((a, b) => a.asked.localeCompare(b.asked) || a.garminCalls - b.garminCalls);
  };
  return { call, callTwice, messages: () => asked.map((p) => (p as { message: string }).message) };
}

/** The keys of a value, at any depth. */
const keysOf = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.flatMap(keysOf)
    : isObject(v)
      ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)])
      : [];
/** The value at a dotted path. */
const at = (root: unknown, name: string) =>
  name.split(".").reduce<unknown>((o, k) => (isObject(o) ? o[k] : undefined), root);

describe("reviewYear", () => {
  it.each([
    ["2026-01-01", 2025],
    ["2026-01-14", 2025],
    ["2026-01-15", 2026],
    ["2026-02-01", 2026],
    ["2026-12-31", 2026],
  ])("on %s is %i", (today, year) => {
    expect(reviewYear(today)).toBe(year);
  });
});

describe("yearOf", () => {
  const cached: CachedRows = {
    activities: runAndRide(),
    hrv: [{ date: "2026-03-02", hrv: 50 }],
    recovery: [{ date: "2026-03-02", rhr: 45 }],
    zones: [{ maxHeartRateUsed: 180 }],
    coverage: {
      activities: { from: "2026-01-01", to: "2026-10-26" },
      hrv: { from: "2026-03-01", to: "2026-03-10" },
      rhr: { from: "2026-03-02", to: "2026-03-02" },
    },
    fillRequests: 1,
    fillStart: "2026-01-01",
    fillDrops: null,
  };

  it("gives the recap of all the rows without settings", () => {
    const y: YearSummary = yearOf(cached, {}, 2026, "2026-10-26");
    expect([y.year, y.from, y.to]).toEqual([2026, "2026-01-01", "2026-10-26"]);
    expect(y.totals.activities).toBe(2);
    expect(y.sports.map((s) => s.sport)).toEqual(["cycling", "running"]);
    expect(y.hrv).toEqual([{ month: "2026-03", mean: null, nights: 1 }]);
    expect(y.rhr).toEqual([{ month: "2026-03", mean: null, days: 1 }]);
    expect(y.coverage).toEqual({
      activities: { from: "2026-01-01", to: "2026-10-26" },
      missing: [],
      complete: true,
      hrv: { from: "2026-03-01", to: "2026-03-10" },
      rhr: { from: "2026-03-02", to: "2026-03-02" },
    });
  });

  it("reads a source that is not a list as no rows", () => {
    const bad: CachedRows = { ...cached, ...JSON.parse('{"hrv":{"hrv":50},"recovery":null}') };
    const y = yearOf(bad, {}, 2026, "2026-10-26");
    expect(y.totals.activities).toBe(2);
    expect(y).not.toHaveProperty("hrv");
    expect(y).not.toHaveProperty("rhr");
  });

  it.each(["hrv", "recovery"])("skips a row of %s that is not an object", (source) => {
    const bad: CachedRows = { ...cached, ...JSON.parse(`{"${source}":[null,5,[]]}`) };
    const key = source === "hrv" ? "hrv" : "rhr";
    expect(yearOf(bad, {}, 2026, "2026-10-26")).not.toHaveProperty(key);
  });

  it("estimates a load from the zones, and not when the page leaves them out", () => {
    const withHR = { ...cached, activities: [row(1, "2026-03-02", { avgHR: 150 })] };
    expect(yearOf(withHR, {}, 2026, "2026-10-26").totals.estimatedLoads).toBe(1);
    const y = yearOf(withHR, { exclude: ["zones"] }, 2026, "2026-10-26");
    expect([y.totals.estimatedLoads, y.totals.load]).toEqual([0, null]);
  });

  it("leaves out the sports, the names and the recovery that the page leaves out", () => {
    const y = yearOf(
      cached,
      { sports: ["running"], exclude: ["recovery", "names"] },
      2026,
      "2026-10-26",
    );
    expect(y.sports.map((s) => s.sport)).toEqual(["running"]);
    expect(y.longest).toEqual({ date: "2026-03-02", id: 1, sport: "running", hours: 1, km: 10 });
    for (const key of ["hrv", "rhr"]) {
      expect(y).not.toHaveProperty(key);
      expect(y.coverage).not.toHaveProperty(key);
    }
  });
});

describe.each<Era>(ERAS)("getYearReview on the %s era", (era) => {
  it("asks and fetches nothing when no day is missing", async () => {
    save({ activities: byId(row(1, "2026-10-20")) });
    const { reply, asked } = await review({}, YES, era);
    expect(asked).toEqual([]);
    expect(api.getJson).not.toHaveBeenCalled();
    expect(reply).toEqual({
      year: expect.objectContaining({ v: 1, year: 2026 }),
      fill: { asked: "notNeeded", estimate: 0, garminCalls: 0 },
      lastDayOpen: true,
      settings: {},
    });
    expect(reply.year.totals.activities).toBe(1);
  });

  it("fetches the activity list after a yes, and gives the year with it", async () => {
    saveFromMarch();
    garmin = [activity(7, "2026-01-05"), activity(8, "2026-02-05")];
    const { reply, messages } = await review({}, YES, era);
    expect(messages).toEqual([
      "Fetch the activity list from Garmin for 2026-01-01 to 2026-10-26, about 2 requests? " +
        "HRV and resting HR are not fetched. Confirm?",
    ]);
    expect(api.getJson).toHaveBeenCalledTimes(2);
    expect(reply.fill).toEqual({ asked: "yes", estimate: 2, garminCalls: 2 });
    // row 1 is in the days that the fill fetches again, and Garmin does not have it any more
    expect(reply.year.totals.activities).toBe(2);
    expect(reply.year.coverage).toMatchObject({ missing: [], complete: true });
  });

  it.each<[string, Answer | undefined, number]>([
    ["no", NO, 1],
    ["no", { action: "cancel" }, 1],
    ["no", { action: "accept", content: { confirm: false } }, 1],
    ["no", { action: "accept", content: { confirm: "true" } }, 1],
    ["no", { action: "accept" }, 1],
    ["unasked", undefined, 0],
  ])("fetches nothing on %s (%j)", async (word, answer, forms) => {
    saveFromMarch();
    const before = readFileSync(cacheFile(), "utf8");
    const { reply, asked } = await review({}, answer, era);
    expect(asked).toHaveLength(forms);
    expect(api.getJson).not.toHaveBeenCalled();
    expect(readFileSync(cacheFile(), "utf8")).toBe(before);
    expect(reply.fill).toEqual({ asked: word, estimate: 2, garminCalls: 0 });
    expect(reply.year.totals.activities).toBe(1);
    expect(reply.year.coverage.missing).toEqual([{ from: "2026-01-01", to: "2026-02-28" }]);
  });

  it("fetches nothing after a yes when an update filled the cache in the meantime", async () => {
    saveFromMarch();
    // the update ends while the form is open
    const late: Answer = {
      get action() {
        save({ activities: byId(row(1, "2026-02-01")) });
        return "accept" as const;
      },
      content: { confirm: true },
    };
    const { reply, asked } = await review({}, late, era);
    expect(asked).toHaveLength(1);
    expect(api.getJson).not.toHaveBeenCalled();
    expect(reply.fill).toEqual({
      asked: "notNeeded",
      estimate: 0,
      garminCalls: 0,
    });
    expect(reply.year.totals.activities).toBe(1);
  });

  describe("when the cache changes while the form is open", () => {
    const drops = "The cache then no longer covers 2021-01-01 to 2025-12-31";

    it("asks again and names the days that the new fetch drops, and a no fetches nothing", async () => {
      saveFromMarch();
      const { reply, messages } = await review({}, inTurn([YES, NO], saveOldYears), era);
      expect(messages).toHaveLength(2);
      expect(messages[0]).not.toContain("no longer covers");
      expect(messages[1]).toContain(drops);
      expect(api.getJson).not.toHaveBeenCalled();
      expect(reply.fill).toEqual({ asked: "no", estimate: 3, garminCalls: 0 });
    });

    it("fetches the days of the second form after a second yes", async () => {
      saveFromMarch();
      garmin = [activity(1, "2026-03-01")];
      const { reply, messages } = await review({}, inTurn([YES, YES], saveOldYears), era);
      expect(messages).toHaveLength(2);
      expect(messages[1]).toContain(drops);
      expect(reply.fill).toEqual({ asked: "yes", estimate: 3, garminCalls: 1 });
    });

    it("asks again when only the days that the new fetch drops change", async () => {
      saveOldYears("2021-01-02");
      const { reply, messages } = await review({}, inTurn([YES, NO], saveOldYears), era);
      expect(messages).toHaveLength(2);
      expect(messages[0].replace("2021-01-02", "2021-01-01")).toBe(messages[1]);
      expect(messages[1]).toContain(drops);
      expect(api.getJson).not.toHaveBeenCalled();
      expect(reply.fill).toEqual({ asked: "no", estimate: 3, garminCalls: 0 });
    });

    it.each([
      [
        "the number of requests",
        // 4 sessions a day: 236 for January and February, and more than 1 page for the last days
        {
          activitiesFrom: "2026-03-01",
          activities: byId(...Array.from({ length: 960 }, (_, i) => row(i, "2026-10-20"))),
        },
        "for 2026-01-01 to 2026-10-26, about 4 requests? HRV",
      ],
      [
        "the first day of the fetch",
        { activitiesFrom: "2026-01-01", activitiesTo: "2026-10-24" },
        "for 2026-10-11 to 2026-10-26, about 1 request? HRV",
      ],
    ])("asks again when the change is %s", async (_what, change, text) => {
      saveFromMarch();
      const { reply, messages } = await review(
        {},
        inTurn([YES, NO], () => save(change)),
        era,
      );
      expect(messages).toHaveLength(2);
      expect(messages[1]).toContain(text);
      expect(api.getJson).not.toHaveBeenCalled();
      expect(reply.fill.asked).toBe("no");
    });

    it("asks once when the change leaves the same question", async () => {
      saveFromMarch();
      garmin = [activity(1, "2026-03-01")];
      const { reply, asked } = await review({}, inTurn([YES], saveFromFebruary), era);
      expect(asked).toHaveLength(1);
      expect(reply.fill).toEqual({ asked: "yes", estimate: 2, garminCalls: 2 });
    });

    it("asks again when the day changes", async () => {
      saveFromMarch();
      const { reply, messages } = await review({}, inTurn([YES, NO], nextDay), era);
      expect(messages).toHaveLength(2);
      expect(messages[1]).toContain("for 2026-01-01 to 2026-10-27,");
      expect(api.getJson).not.toHaveBeenCalled();
      expect(reply.fill.asked).toBe("no");
    });

    it("asks nothing more and fetches nothing when the new fetch is too large", async () => {
      setToday("2026-06-24");
      save({ activitiesFrom: "2021-03-01", activitiesTo: "2026-06-24" });
      const { reply, asked } = await review({ year: 2021 }, inTurn([YES], removeCache), era);
      expect(asked).toHaveLength(1);
      expect(api.getJson).not.toHaveBeenCalled();
      expect(reply.fill).toEqual({ asked: "tooLarge", estimate: 21, garminCalls: 0 });
    });
  });

  // the form opens after read 1, and read 2 sees the same cache: the change comes after the yes
  describe("when the cache changes between the yes and the fetch", () => {
    const drops = "The cache then no longer covers 2021-01-01 to 2025-12-31";

    it("asks again with the new days, and a no fetches nothing", async () => {
      saveFromMarch();
      afterRead(2, saveOldYears);
      const { reply, messages } = await review({}, answers(YES, NO), era);
      expect(messages).toHaveLength(2);
      expect(messages[0]).not.toContain("no longer covers");
      expect(messages[1]).toContain(drops);
      expect(api.getJson).not.toHaveBeenCalled();
      expect(reply.fill).toEqual({ asked: "no", estimate: 3, garminCalls: 0 });
    });

    it("fetches the days of the second form after a second yes", async () => {
      saveFromMarch();
      afterRead(2, saveOldYears);
      garmin = [activity(1, "2026-03-01")];
      const { reply, messages } = await review({}, answers(YES, YES), era);
      expect(messages).toHaveLength(2);
      expect(reply.fill).toEqual({ asked: "yes", estimate: 3, garminCalls: 1 });
      expect(reply.year.totals.activities).toBe(1);
    });

    it("asks a third time after a second change", async () => {
      saveFromMarch();
      afterRead(2, () => {
        saveOldYears();
        vi.mocked(GarminDashboard.prototype.readCached).mockRestore();
        afterRead(2, () => saveOldYears("2021-01-02"));
      });
      const { reply, messages } = await review({}, answers(YES, YES, NO), era);
      expect(messages).toHaveLength(3);
      expect(messages[2]).toContain("no longer covers 2021-01-02 to 2025-12-31");
      expect(api.getJson).not.toHaveBeenCalled();
      expect(reply.fill.asked).toBe("no");
    });

    it("asks nothing more and fetches nothing when no day is missing any more", async () => {
      saveFromMarch();
      afterRead(2, () => save({ activities: byId(row(1, "2026-10-20")) }));
      const { reply, asked } = await review({}, answers(YES), era);
      expect(asked).toHaveLength(1);
      expect(api.getJson).not.toHaveBeenCalled();
      expect(reply.fill).toEqual({ asked: "notNeeded", estimate: 0, garminCalls: 0 });
      expect(reply.year.totals.activities).toBe(1);
    });

    it("asks nothing more and fetches nothing when the new fetch is too large", async () => {
      setToday("2026-06-24");
      save({ activitiesFrom: "2021-03-01", activitiesTo: "2026-06-24" });
      afterRead(2, removeCache);
      const { reply, asked } = await review({ year: 2021 }, answers(YES), era);
      expect(asked).toHaveLength(1);
      expect(api.getJson).not.toHaveBeenCalled();
      expect(reply.fill).toEqual({ asked: "tooLarge", estimate: 21, garminCalls: 0 });
    });

    it("fetches at once when the change leaves the same question", async () => {
      saveFromMarch();
      afterRead(2, saveFromFebruary);
      const { reply, asked } = await review({}, answers(YES), era);
      expect(asked).toHaveLength(1);
      expect(reply.fill).toEqual({ asked: "yes", estimate: 2, garminCalls: 2 });
    });

    it("asks again with the new day when the day changes", async () => {
      saveFromMarch();
      afterRead(2, () => {
        nextDay();
        saveOldYears();
      });
      const { messages } = await review({}, answers(YES, NO), era);
      expect(messages[1]).toContain("for 2026-01-01 to 2026-10-27,");
    });
  });

  it("does not ask when the fill is too large", async () => {
    setToday("2026-06-24"); // 2021 to today is 2001 days, 1 session a day: 21 requests
    const { reply, asked } = await review({ year: 2021 }, YES, era);
    expect(asked).toEqual([]);
    expect(api.getJson).not.toHaveBeenCalled();
    expect(existsSync(cacheFile())).toBe(false);
    expect(reply.fill).toEqual({
      asked: "tooLarge",
      estimate: 21,
      garminCalls: 0,
    });
    expect(reply.year).toMatchObject({ year: 2021, totals: { activities: null } });
  });
});

describe("getYearReview", () => {
  it("says which page's sports and excluded data apply without a path", async () => {
    const { client } = await open("2026-07-28", undefined);
    const tool = (await client.listTools()).tools.find((t) => t.name === "getYearReview");
    expect(tool?.inputSchema.properties?.path).toMatchObject({
      description:
        "The dashboard page whose sports and excluded data apply; it must exist; relative paths are " +
        "inside the data dir; default: the page garmin-dashboard.html, when there is one",
    });
  });

  it("says in the description what to do after tooLarge", async () => {
    const { client } = await open("2026-07-28", undefined);
    const tool = (await client.listTools()).tools.find((t) => t.name === "getYearReview");
    expect(tool?.description?.replace(/\s+/g, " ")).toContain(
      "or tooLarge (about `estimate` requests, over 20: for a year before this year, say to review a " +
        "newer year first, then this one, which works only in a client with a form). Only yes fetches;",
    );
  });

  it("can fetch a year that was too large after a yes for a newer year", async () => {
    setToday("2026-06-24");
    garmin = Array.from({ length: 2001 }, (_, i) => activity(i, addDays("2021-01-01", i)));
    expect((await review({ year: 2021 }, YES)).reply.fill.asked).toBe("tooLarge");
    expect((await review({ year: 2024 }, YES)).reply.fill.asked).toBe("yes");
    const { reply } = await review({ year: 2021 }, YES);
    // 1095 days before 2024 are 11 requests, and the last days 1
    expect(reply.fill).toMatchObject({ asked: "yes", estimate: 12 });
    expect(reply.fill).not.toHaveProperty("error");
    expect(reply.year).toMatchObject({ year: 2021, totals: { activities: 365 } });
  });

  it("cannot fetch a newer year after tooLarge in a client with no form", async () => {
    setToday("2026-06-24");
    expect((await review({ year: 2021 })).reply.fill.asked).toBe("tooLarge");
    expect((await review({ year: 2024 })).reply.fill.asked).toBe("unasked");
    expect((await review({ year: 2021 })).reply.fill.asked).toBe("tooLarge");
    expect(api.getJson).not.toHaveBeenCalled();
    expect(existsSync(cacheFile())).toBe(false);
  });

  it("asks for a fill of exactly the cap", async () => {
    setToday("2026-06-23"); // 2000 days
    const { reply, messages } = await review({ year: 2021 }, NO);
    expect(messages).toEqual([
      "Fetch the activity list from Garmin for 2021-01-01 to 2026-06-23, about 20 requests? " +
        "HRV and resting HR are not fetched. Confirm?",
    ]);
    expect(reply.fill).toMatchObject({ asked: "no", estimate: 20 });
  });

  it("names one request without a plural", async () => {
    save({ activitiesTo: "2026-10-24" });
    const { messages } = await review({}, NO);
    expect(messages).toEqual([
      // from the last cached days that can still change
      "Fetch the activity list from Garmin for 2026-10-11 to 2026-10-26, about 1 request? " +
        "HRV and resting HR are not fetched. Confirm?",
    ]);
  });

  it("names the earlier years that it fetches again from an older cache", async () => {
    save({ activitiesSummary: 2, activitiesFrom: "2024-01-01" });
    const { messages } = await review({}, NO);
    expect(messages).toEqual([
      "Fetch the activity list from Garmin for 2024-01-01 to 2026-10-26, about 1 request? " +
        "HRV and resting HR are not fetched. Confirm?",
    ]);
  });

  it("names the earlier days that the cache no longer covers after the fetch", async () => {
    saveOldYears();
    garmin = [activity(1, "2026-03-01")];
    const { reply, messages } = await review({}, YES);
    expect(messages).toEqual([
      "Fetch the activity list from Garmin for 2026-01-01 to 2026-10-26, about 3 requests? " +
        "The cache then no longer covers 2021-01-01 to 2025-12-31: a review of those days must fetch " +
        "them again. HRV and resting HR are not fetched. Confirm?",
    ]);
    expect(reply.fill).toEqual({ asked: "yes", estimate: 3, garminCalls: 1 });
    expect(reply.year.coverage.complete).toBe(true);
  });

  it.each<[string, Answer | undefined, number]>([
    ["no", NO, 1],
    ["unasked", undefined, 0],
  ])("drops no earlier day on %s", async (word, answer, forms) => {
    saveOldYears();
    const before = readFileSync(cacheFile(), "utf8");
    const { reply, asked } = await review({}, answer);
    expect(asked).toHaveLength(forms);
    expect(reply.fill).toEqual({ asked: word, estimate: 3, garminCalls: 0 });
    expect(readFileSync(cacheFile(), "utf8")).toBe(before);
  });

  it("drops no earlier day when the fetch fails", async () => {
    saveOldYears();
    const before = readFileSync(cacheFile(), "utf8");
    api.getJson.mockRejectedValue(new GarminApiError("GET /x -> HTTP 500: body-SECRET", 500));
    const { reply } = await review({}, YES);
    expect(reply.fill).toEqual({
      asked: "yes",
      estimate: 3,
      garminCalls: 1,
      error: "Garmin answered HTTP 500. Nothing was saved: try again later.",
    });
    expect(readFileSync(cacheFile(), "utf8")).toBe(before);
  });

  it("names the earlier days in a form of one request", async () => {
    setToday("2026-03-01");
    save({
      activitiesFrom: "2020-01-01",
      activitiesTo: "2020-01-10",
      activities: byId(...Array.from({ length: 10 }, (_, i) => row(i, "2020-01-05"))),
    });
    const { messages } = await review({}, NO);
    expect(messages).toEqual([
      // 60 days, 1 session a day; from 2020 on it is over the cap
      "Fetch the activity list from Garmin for 2026-01-01 to 2026-03-01, about 1 request? " +
        "The cache then no longer covers 2020-01-01 to 2020-01-10: a review of those days must fetch " +
        "them again. HRV and resting HR are not fetched. Confirm?",
    ]);
  });

  it("asks and fetches nothing when only today is missing", async () => {
    save({ activitiesTo: "2026-10-25", activities: byId(row(1, "2026-10-20")) });
    const { reply, asked } = await review({}, YES);
    expect(asked).toEqual([]);
    expect(api.getJson).not.toHaveBeenCalled();
    expect(reply.fill).toEqual({
      asked: "notNeeded",
      estimate: 0,
      garminCalls: 0,
    });
    expect(reply.year.totals.activities).toBe(1);
    expect(reply.year.coverage).toMatchObject({
      missing: [{ from: "2026-10-26", to: "2026-10-26" }],
      complete: false,
    });
  });

  it.each([
    ["ends on the last day of the year", 2025, {}, true],
    ["ends in the year", 2025, { activitiesTo: "2025-07-01" }, true],
    ["goes on after the year", 2025, { activitiesTo: "2026-01-01" }, false],
    ["ends before the year", 2025, { activitiesTo: "2024-12-31" }, false],
    [
      "starts after the year",
      2025,
      { activitiesFrom: "2026-01-01", activitiesTo: "2026-02-01" },
      false,
    ],
    ["is not there", 2025, { activitiesTo: undefined }, false],
    ["has an older summary", 2025, { activitiesSummary: 2 }, false],
    ["ends yesterday", 2026, { activitiesTo: "2026-10-25" }, true],
    ["ends today", 2026, { activitiesTo: "2026-10-26" }, true],
    ["ends after today", 2026, { activitiesTo: "2026-10-27" }, true],
  ])(
    "tells if the last day is open when the cache %s (%i)",
    async (_what, year, extra, expected) => {
      save({ activitiesFrom: "2024-01-01", activitiesTo: "2025-12-31", ...extra });
      expect((await review({ year })).reply.lastDayOpen).toBe(expected);
    },
  );

  it("gives the last day as not open after a fill of the days after it", async () => {
    save({ activitiesFrom: "2024-01-01", activitiesTo: "2025-12-30" });
    const { reply } = await review({ year: 2025 }, YES);
    expect(reply.fill.asked).toBe("yes");
    expect(reply.lastDayOpen).toBe(false);
  });

  it("gives the last day as open after a fill up to today", async () => {
    save({ activitiesTo: "2026-10-20" });
    const { reply } = await review({}, YES);
    expect(reply.fill.asked).toBe("yes");
    expect(reply.year.coverage.activities?.to).toBe("2026-10-26");
    expect(reply.lastDayOpen).toBe(true);
  });

  it("tells the assistant that the last cached day can lack a late session", async () => {
    const { client } = await open("2026-07-28", undefined);
    const tool = (await client.listTools()).tools.find((t) => t.name === "getYearReview");
    expect(tool?.description?.replace(/\s+/g, " ")).toContain(
      "With `lastDayOpen` true, the last cached day, `year.coverage.activities.to`, can lack sessions that came after that " +
        "day's update: say so. When `fill.asked` is notNeeded and the year is the year of today, say also that " +
        "a dashboard update adds them.",
    );
  });

  it("tells the assistant that a yes can fetch earlier days too", async () => {
    const { client } = await open("2026-07-28", undefined);
    const tool = (await client.listTools()).tools.find((t) => t.name === "getYearReview");
    expect(tool?.description?.replace(/\s+/g, " ")).toContain(
      "only after a yes it fetches the activity list of these days, and of other days that the cache " +
        "needs (no HRV, no resting HR).",
    );
  });

  it("gives the last cached day, as it can lack a late session", async () => {
    save({ activitiesTo: "2026-10-25" });
    expect((await review()).reply.year.coverage.activities).toEqual({
      from: "2026-01-01",
      to: "2026-10-25",
    });
  });

  it.each([
    ["yesterday and today", { activitiesTo: "2026-10-24" }],
    ["only the first day", { activitiesFrom: "2026-01-02" }],
    ["other days and today", { activitiesFrom: "2026-03-01", activitiesTo: "2026-10-25" }],
  ])("asks when the cache misses %s", async (_what, range) => {
    save(range);
    const { reply, asked } = await review({}, NO);
    expect(asked).toHaveLength(1);
    expect(reply.fill.asked).toBe("no");
  });

  it("fetches from 1 January of an earlier year to today, so the cache stays one range", async () => {
    save();
    garmin = [activity(7, "2025-05-05")];
    const { reply } = await review({ year: 2025 }, YES);
    expect(reply.fill).toEqual({ asked: "yes", estimate: 2, garminCalls: 2 });
    const ranges = api.getJson.mock.calls.map(([, q]) => [q.startDate, q.endDate]);
    expect(ranges).toEqual([
      ["2025-01-01", "2025-12-31"],
      ["2026-10-13", "2026-10-26"],
    ]);
    expect(reply.year).toMatchObject({ year: 2025, to: "2025-12-31", totals: { activities: 1 } });
    expect(JSON.parse(readFileSync(cacheFile(), "utf8"))).toMatchObject({
      activitiesFrom: "2025-01-01",
      activitiesTo: "2026-10-26",
    });
  });

  it("needs no fill for an earlier year that the cache holds, also when today is missing", async () => {
    save({ activitiesFrom: "2025-01-01", activitiesTo: "2026-10-01" });
    const { reply, asked } = await review({ year: 2025 }, YES);
    expect(asked).toEqual([]);
    expect(reply.fill).toMatchObject({ asked: "notNeeded", estimate: 0 });
  });

  it.each([
    ["2026-01-14", 2025, "2025-12-31"],
    ["2026-01-15", 2026, "2026-01-15"],
  ])("reviews on %s the year %i", async (today, year, to) => {
    setToday(today);
    const { reply } = await review();
    expect(reply.year).toMatchObject({ year, to });
  });

  it.each([2000, 2026])("takes the year %i", async (year) => {
    const { reply } = await review({ year });
    expect(reply.year.year).toBe(year);
  });

  it.each([[1999], [2027], [2025.5], ["x"], [null], ["2025"]])(
    "refuses the year %j",
    async (year) => {
      const { text, isError, asked } = await review({ year }, YES);
      expect(isError).toBe(true);
      expect(asked).toEqual([]);
      expect(text).toBe(
        "Input validation error: Invalid arguments for tool getYearReview: year: " +
          "Give a whole year from 2000 to 2026",
      );
      expect(api.getJson).not.toHaveBeenCalled();
    },
  );

  it("takes a year in January that is the year of today", async () => {
    setToday("2026-01-01");
    const { reply, asked } = await review({ year: 2026 }, YES);
    expect(reply.year).toMatchObject({ year: 2026, from: "2026-01-01", to: "2026-01-01" });
    // the one day of the year is today
    expect(asked).toEqual([]);
    expect(reply.fill.asked).toBe("notNeeded");
    expect(reply.year.totals.activities).toBeNull();
  });

  describe("with the settings of a page", () => {
    const coach = { sports: ["running"], exclude: ["recovery", "names"] };

    it("gives only the settings that leave data out", async () => {
      saveAllKinds();
      savePage(JSON.stringify({ ...coach, title: "Coach", shared: true, note: "private" }));
      const { reply, text } = await review();
      expect(reply.settings).toEqual(coach);
      expect(text).not.toMatch(/private|"title"|"shared"/);
    });

    it.each([{}, { sports: ["running"] }, { exclude: ["names"] }])(
      "gives the settings %j as they are",
      async (settings) => {
        saveAllKinds();
        savePage(JSON.stringify(settings));
        expect((await review()).reply.settings).toEqual(settings);
      },
    );

    it("gives no setting for null by hand", async () => {
      saveAllKinds();
      savePage(JSON.stringify({ sports: null, exclude: null }));
      const { reply } = await review();
      expect(reply.settings).toEqual({});
      expect(reply.year.sports.length).toBeGreaterThan(1);
    });

    it("leaves out what the page at path leaves out", async () => {
      saveAllKinds();
      savePage(JSON.stringify(coach), "coach.html");
      const { reply, text } = await review({ path: "coach.html" });
      expect(reply.settings).toEqual(coach);
      expect(reply.year.sports.map((s: { sport: string }) => s.sport)).toEqual(["running"]);
      expect(text).not.toMatch(/cycling|Ride 2|Run 1|"name"|"hrv"|"rhr"/);
    });

    it.each([[{}], [{ path: "" }]])("reads the default page with %j", async (args) => {
      saveAllKinds();
      savePage(JSON.stringify(coach));
      const { reply } = await review(args);
      expect(reply.settings).toEqual(coach);
      expect(reply.year.sports.map((s: { sport: string }) => s.sport)).toEqual(["running"]);
    });

    it("leaves out of the fetched rows what the page leaves out", async () => {
      saveFromMarch();
      savePage(JSON.stringify(coach));
      garmin = [
        activity(7, "2026-01-05"),
        { ...activity(8, "2026-02-05"), activityType: { typeKey: "cycling" }, sportTypeId: 2 },
      ];
      const { reply, text } = await review({}, YES);
      expect(reply.fill).toMatchObject({ asked: "yes", garminCalls: 2 });
      expect(reply.year.totals.activities).toBe(1);
      expect(text).not.toMatch(/cycling|"name"/);
    });

    it.each(["none.html", "garmin-dashboard.html", "my coach.html", "2025 coach.html"])(
      "refuses the page %s that does not exist, and asks and gives nothing",
      async (path) => {
        saveFromMarch();
        savePage(JSON.stringify(coach), "coach.html");
        const { text, isError, asked } = await review({ path }, YES);
        expect(isError).toBe(true);
        expect(text).toBe(
          `${join(dir, path)} does not exist: give the path of a dashboard page, or no path`,
        );
        expect(asked).toEqual([]);
        expect(api.getJson).not.toHaveBeenCalled();
      },
    );

    it("refuses a path that is no text", async () => {
      const { text, isError } = await review({ path: 7 }, YES);
      expect(isError).toBe(true);
      expect(text).toBe(
        "Input validation error: Invalid arguments for tool getYearReview: path: " +
          "Invalid input: expected string, received number",
      );
    });

    it.each([[{}], [{ path: "" }]])(
      "has no settings with %j and no page, and gives all the data",
      async (args) => {
        saveAllKinds();
        const { reply } = await review(args);
        expect(reply.settings).toEqual({});
        expect(reply.year).toMatchObject({
          totals: { activities: 2 },
          hrv: [{ month: "2026-03", nights: 1 }],
          rhr: [{ month: "2026-03", days: 1 }],
        });
      },
    );

    it.each([
      ["no JSON", "{", "The garmin-settings block of the page is not valid JSON"],
      [
        "a list that is no list",
        '{"exclude":"names"}',
        "The garmin-settings block of the page has a bad exclude",
      ],
      ["a list", '["names"]', "The garmin-settings block of the page is not an object"],
    ])("refuses settings with %s, and asks and gives nothing", async (_what, settings, start) => {
      saveFromMarch();
      savePage(settings, "coach.html");
      const { text, isError, asked } = await review({ path: "coach.html" }, YES);
      expect(isError).toBe(true);
      expect(asked).toEqual([]);
      expect(api.getJson).not.toHaveBeenCalled();
      expect(text).toBe(
        `${start} in ${join(dir, "coach.html")}: give new settings, or delete the file`,
      );
    });

    // the names that a mistyped year or page gives: the saved page must not apply, nor no page
    it.each(["coach.txt", "coach", "2025", "20025x", "coach.html 2025", "2025.5"])(
      "refuses the path %j that is no .html file, and asks and gives nothing",
      async (path) => {
        saveFromMarch();
        savePage(JSON.stringify(coach), "coach.html");
        const { text, isError, asked } = await review({ path }, YES);
        expect(isError).toBe(true);
        expect(text).toBe(`The dashboard must be an .html file: ${join(dir, path)}`);
        expect(asked).toEqual([]);
        expect(api.getJson).not.toHaveBeenCalled();
      },
    );

    it("refuses a file that is no dashboard", async () => {
      writeFileSync(join(dir, "other.html"), "<p>x</p>");
      const { text, isError } = await review({ path: "other.html" });
      expect(isError).toBe(true);
      expect(text).toBe(
        `${join(dir, "other.html")} is not a dashboard page (no garmin-data block): it is left as it is`,
      );
    });
  });

  it.each<[string, unknown, string]>([
    [
      "a value that is no error",
      "down",
      "The activity list was not fetched or saved. The log of the server tells more.",
    ],
    [
      "an error with a token in its text",
      new Error("Bearer SECRET"),
      "The activity list was not fetched or saved. The log of the server tells more.",
    ],
    [
      "an HTTP status",
      new GarminApiError("GET /x -> HTTP 500: SECRET", 500),
      "Garmin answered HTTP 500. Nothing was saved: try again later.",
    ],
  ])("gives the cached days after %s", async (_what, thrown, error) => {
    saveFromMarch();
    const before = readFileSync(cacheFile(), "utf8");
    api.getJson.mockRejectedValue(thrown);
    const { reply, text } = await review({}, YES);
    expect(reply.fill).toEqual({
      asked: "yes",
      estimate: 2,
      garminCalls: 1,
      error,
    });
    expect(reply.year.totals.activities).toBe(1);
    expect(reply.year.coverage.complete).toBe(false);
    expect(text).not.toContain("SECRET");
    expect(readFileSync(cacheFile(), "utf8")).toBe(before);
  });

  it("gives every field that the year-review prompt quotes", async () => {
    // weekly runs from March, so each part has a value and January and February are missing
    const runs = Array.from({ length: 12 }, (_, i) =>
      row(i, addDays("2026-03-02", 7 * i), { trainingLoad: 50, best: { "5k": `${30 - i}:00` } }),
    );
    const night = { date: "2026-03-02", hrv: 50, rhr: 45 };
    save({
      activitiesFrom: "2026-03-01",
      activities: byId(...runs),
      hrvFrom: "2026-03-01",
      hrvTo: "2026-10-26",
      hrv: { [night.date]: night },
      recovery: { [night.date]: night },
    });
    savePage('{"sports":["running"],"exclude":["fitnessAge"]}');
    api.getJson.mockRejectedValue(new Error("down"));
    const { reply } = await review({}, YES);
    const keys = new Set([...Object.keys(reply), ...keysOf(reply.year)]);
    const has = (name: string) =>
      name.includes(".") ? (at(reply, name) ?? at(reply.year, name)) !== undefined : keys.has(name);
    // the tool, its other argument, the server and the values of fill.asked
    const noField = new Set(["garmin-personal", "getYearReview", "path", ".html"]);
    const asked = ["notNeeded", "yes", "no", "unasked", "tooLarge"];
    const template = readFileSync(new URL("../prompts/year-review.md", import.meta.url), "utf8");
    const quoted = [...template.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    expect(quoted).toEqual(expect.arrayContaining(asked));
    const fields = quoted.filter((name) => !noField.has(name) && !asked.includes(name));
    expect(fields.length).toBeGreaterThan(60);
    expect(fields.filter((name) => !has(name))).toEqual([]);
  });

  it("stops a fill that needs more requests than its estimate said", async () => {
    // 1 session in the covered days makes a low rate: 1 request for the gap, 1 for the last days
    saveFromMarch();
    garmin = Array.from({ length: 2000 }, (_, i) =>
      activity(100 + i, addDays("2026-01-01", i % 59)),
    );
    const { reply } = await review({}, YES);
    expect(api.getJson).toHaveBeenCalledTimes(20);
    expect(reply.fill).toEqual({
      asked: "yes",
      estimate: 2,
      garminCalls: 20,
      error:
        "The fetch stopped at 20 requests and saved no activities: the days need more. Another try stops too.",
    });
  });
});

describe("getYearReview after a fetch that keeps the cached days and stops at the cap", () => {
  const OLD = "The cache then no longer covers 2022-10-01 to 2023-09-30";

  beforeEach(() => {
    // 20 sessions in the cached year make a low rate; in fact there are 2 a day since: 23 requests
    const days: string[] = [];
    for (let d = "2022-10-01"; d <= "2026-10-26"; d = addDays(d, 1)) days.push(d);
    save({
      activitiesFrom: "2022-10-01",
      activitiesTo: "2023-09-30",
      activities: byId(...days.slice(0, 20).map((d, i) => row(i, d))),
    });
    garmin = days
      .filter((d) => d > "2023-09-30")
      .flatMap((d, i) => [activity(100 + 2 * i, d), activity(101 + 2 * i, d)]);
  });

  it.each(ERAS)("asks for fewer days, and names the days that it drops (%s)", async (era) => {
    const { call, messages } = await connected(era, YES);
    expect((await call()).fill.error).toContain(
      "Another try asks for the days from 2026-01-01 only",
    );
    expect(messages()[0]).not.toContain("no longer covers");

    const second = await call();
    expect(second.fill).toEqual({ asked: "yes", estimate: 3, garminCalls: 6 });
    expect(second.year.coverage.complete).toBe(true);
    expect(second.year.totals.activities).toBe(598);
    expect(messages()[1]).toContain(
      "Fetch the activity list from Garmin for 2026-01-01 to 2026-10-26",
    );
    expect(messages()[1]).toContain(OLD);

    // the cache has the year now: nothing to ask
    expect((await call()).fill.asked).toBe("notNeeded");
    expect(messages()).toHaveLength(2);
  });

  it.each(ERAS)(
    "a second call at the same time drops no day that its form does not name (%s)",
    async (era) => {
      const before = readFileSync(cacheFile(), "utf8");
      const { callTwice, messages } = await connected(era, answers(YES, YES, NO));
      const fills = await callTwice();
      const [first, second, third] = messages();
      expect([first, second].join()).not.toContain("no longer covers");
      expect(third).toContain(OLD);
      expect(messages()).toHaveLength(3);
      expect(fills).toEqual([
        { asked: "no", estimate: 3, garminCalls: 0 },
        expect.objectContaining({ asked: "yes", garminCalls: 20 }),
      ]);
      expect(JSON.parse(readFileSync(cacheFile(), "utf8"))).toMatchObject(JSON.parse(before));
    },
  );

  it.each(ERAS)("a second call at the same time fetches after a second yes (%s)", async (era) => {
    const { callTwice, messages } = await connected(era, YES);
    const [done, stopped] = await callTwice();
    expect(messages()).toHaveLength(3);
    expect(done).toEqual({ asked: "yes", estimate: 3, garminCalls: 6 });
    expect(stopped).toMatchObject({ asked: "yes", garminCalls: 20 });
  });
});

describe("getYearReview twice at the same time", () => {
  it.each(ERAS)("fetches the days once (%s)", async (era) => {
    saveFromMarch();
    garmin = [activity(1, "2026-03-01")];
    const { callTwice, messages } = await connected(era, YES);
    expect((await callTwice()).map((fill) => fill.asked)).toEqual(["notNeeded", "yes"]);
    expect(messages()).toHaveLength(2);
    expect(api.getJson).toHaveBeenCalledTimes(2);
  });
});

describe("pageYear", () => {
  const template =
    '<html><head><meta name="garmin-template" content="0123456789abcdef"></head><script>' +
    ["data", "layout", "widgets", "languages", "i18n", "refresh", "settings"]
      .map((b) => `/* garmin-${b}:start */null/* garmin-${b}:end */`)
      .join(";") +
    "</script></html>";
  /** The server's dashboard and its page writer. */
  const parts = () => {
    const dashboard = new GarminDashboard(
      {} as GarminTools,
      api as unknown as GarminApiClient,
      dir,
    );
    const data = { start: "2026-10-19", end: "2026-10-26", activities: [], previousActivities: [] };
    const writer = new DashboardWriter(
      async () => JSON.stringify(data),
      dir,
      async () => template,
      undefined,
      (s) => pageYear(dashboard, s),
    );
    return { dashboard, writer };
  };
  /** The year in a page that a write with these settings made. */
  const writtenYear = async (settings: Settings) => {
    const { path } = await parts().writer.write({ settings });
    const data = readBlock(readFileSync(path, "utf8"), "data");
    return (data as { year?: YearSummary }).year;
  };

  it.each<[string, Settings]>([
    ["no other setting", {}],
    ["sports and excluded data", { sports: ["running"], exclude: ["recovery", "names"] }],
    ["excluded zones", { exclude: ["zones"] }],
  ])("a page has the same year as getYearReview with %s", async (_, settings) => {
    saveAllKinds();
    const year = await writtenYear({ yearReview: true, ...settings });
    const { reply } = await review();
    expect(year).toEqual(reply.year);
    expect(year?.totals.activities).toBe(settings.sports ? 1 : 2);
  });

  it.each([
    ["2026-01-01", 2025, 1],
    ["2026-01-14", 2025, 1],
    ["2026-01-15", 2026, 2],
  ])("on %s is the year %i, as for getYearReview", async (today, year, activities) => {
    setToday(today);
    save({
      activitiesFrom: "2025-01-01",
      activitiesTo: today,
      activities: byId(
        row(1, "2025-01-01"),
        row(2, "2026-01-01"),
        row(3, "2026-01-02"),
        row(4, "2024-12-31"),
      ),
    });
    const recap = await writtenYear({ yearReview: true });
    expect(recap).toEqual((await review()).reply.year);
    expect(recap).toMatchObject({ year, totals: { activities } });
  });

  it("has the missing days that a review fetched, at the next update", async () => {
    saveFromMarch();
    garmin = [activity(7, "2026-01-10")];
    const before = await writtenYear({ yearReview: true });
    expect(before?.coverage.missing).toEqual([{ from: "2026-01-01", to: "2026-02-28" }]);
    await review({}, YES);
    const after = await writtenYear({ yearReview: true });
    expect(after?.coverage.missing).toEqual([]);
    expect(after?.months[0]).toMatchObject({ covered: "all", sessions: 1 });
  });

  it.each([
    ["recovery", /"(hrv|rhr)"/],
    ["names", /"name"|Run 1|Ride 2/],
  ] as const)("has no %s that the page leaves out", async (item, left) => {
    saveAllKinds();
    const all = JSON.stringify(await writtenYear({ yearReview: true }));
    expect(all).toMatch(left);
    const cut = JSON.stringify(await writtenYear({ yearReview: true, exclude: [item] }));
    expect(cut).toContain('"totals"');
    expect(cut).not.toMatch(left);
  });

  it.each(["sports", "exclude"])("has all the data of a page whose %s is null", async (key) => {
    saveAllKinds();
    const all = await writtenYear({ yearReview: true });
    const { writer } = parts();
    const file = join(dir, "garmin-dashboard.html");
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace('"yearReview":true', `"yearReview":true,"${key}":null`),
    );
    await writer.write({});
    expect(readBlock(readFileSync(file, "utf8"), "data")).toMatchObject({ year: all });
  });

  it("has no activity when the page keeps a sport that the year does not have", async () => {
    saveAllKinds();
    const year = await writtenYear({ yearReview: true, sports: ["swimming"] });
    expect(year).toMatchObject({ totals: { activities: 0 }, sports: [], longest: null });
    expect(year).toEqual((await review()).reply.year);
  });

  it("has the new year from the first write on 15 January", async () => {
    save({
      activitiesFrom: "2025-01-01",
      activitiesTo: "2026-01-20",
      activities: byId(row(1, "2025-06-01"), row(2, "2026-01-03")),
    });
    const { writer } = parts();
    const yearOn = async (today: string) => {
      setToday(today);
      const { path } = await writer.write({ settings: { yearReview: true } });
      return (readBlock(readFileSync(path, "utf8"), "data") as { year: YearSummary }).year.year;
    };
    expect(await yearOn("2026-01-14")).toBe(2025);
    expect(await yearOn("2026-01-15")).toBe(2026);
  });

  it("an update replaces the year from 15 January with no backup, and leaves a copy as it is", async () => {
    save({
      activitiesFrom: "2025-01-01",
      activitiesTo: "2026-01-20",
      activities: byId(row(1, "2025-06-01"), row(2, "2026-01-03")),
    });
    const { writer } = parts();
    setToday("2026-01-04");
    const { path } = await writer.write({ settings: { yearReview: true } });
    const yearAfterRefresh = async (today: string) => {
      setToday(today);
      const { failed } = await refreshPages(writer, [path]);
      expect(failed).toEqual([]);
      return (readBlock(readFileSync(path, "utf8"), "data") as { year: YearSummary }).year.year;
    };
    expect(await yearAfterRefresh("2026-01-14")).toBe(2025);
    const copy = join(dir, "garmin-dashboard-2025.html");
    copyFileSync(path, copy);
    const copied = readFileSync(copy, "utf8");
    expect(await yearAfterRefresh("2026-01-15")).toBe(2026);
    expect(await yearAfterRefresh("2026-12-31")).toBe(2026);
    expect(readFileSync(copy, "utf8")).toBe(copied);
    expect(readBlock(copied, "data")).toMatchObject({ year: { year: 2025 } });
    expect(readdirSync(dir).filter((f) => f.endsWith(".bak"))).toEqual([]);
  });

  it("an update of the copy itself gives it the new year too", async () => {
    save({
      activitiesFrom: "2025-01-01",
      activitiesTo: "2026-01-20",
      activities: byId(row(1, "2025-06-01"), row(2, "2026-01-03")),
    });
    const { writer } = parts();
    setToday("2026-01-14");
    const { path } = await writer.write({ settings: { yearReview: true } });
    const copy = join(dir, "garmin-dashboard-2025.html");
    copyFileSync(path, copy);
    setToday("2026-01-15");
    await writer.write({ path: copy, onlyExisting: true });
    expect(readBlock(readFileSync(copy, "utf8"), "data")).toMatchObject({ year: { year: 2026 } });
  });

  it("has only the sports that the page keeps", async () => {
    saveAllKinds();
    const year = await writtenYear({ yearReview: true, sports: ["running"] });
    expect(year?.sports.map((s) => s.sport)).toEqual(["running"]);
    expect(JSON.stringify(year)).not.toMatch(/cycling|Ride 2/);
  });

  it.each([
    ["none", undefined],
    ["damaged", "{"],
  ])(
    "has every day as missing, and no invented value, with a cache that is %s",
    async (_, text) => {
      if (text !== undefined) writeFileSync(cacheFile(), text);
      const year = await writtenYear({ yearReview: true });
      expect(year).toEqual((await review()).reply.year);
      expect(year?.coverage.missing).toEqual([{ from: "2026-01-01", to: "2026-10-26" }]);
      expect(year?.totals.activities).toBeNull();
    },
  );

  it("asks Garmin for nothing, also when days are missing", async () => {
    saveFromMarch();
    const year = await writtenYear({ yearReview: true });
    expect(year?.coverage.missing).toHaveLength(1);
    expect(api.getJson).not.toHaveBeenCalled();
  });

  it("leaves the year out of a page when the cache cannot be read", async () => {
    vi.spyOn(GarminDashboard.prototype, "readCached").mockRejectedValueOnce(new Error("no rows"));
    expect(await writtenYear({ yearReview: true })).toBeUndefined();
  });
});
