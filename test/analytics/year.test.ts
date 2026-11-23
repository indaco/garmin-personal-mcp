import { describe, expect, it } from "vitest";
import type { Activity } from "../../src/analytics/calc";
import { weeklyKnown } from "../../src/analytics/metrics";
import { yearSummary, type YearInput } from "../../src/analytics/year";

/** Coverage of exactly these days. */
const only = (first: string, last: string): Partial<YearInput> => ({
  coverage: { activities: { from: first, to: last } },
});

/** A 1 hour run at 07:00, without km or load. */
const run = (day: string, extra: Record<string, unknown> = {}): Activity => ({
  type: "running",
  sport: "running",
  start: `${day} 07:00:00`,
  duration: "1:00:00",
  ...extra,
});

const ALL = { from: "2023-01-01", to: "2026-12-31" };

const input = (activities: Activity[], extra: Partial<YearInput> = {}): YearInput => ({
  activities,
  hrv: [],
  recovery: [],
  coverage: { activities: ALL },
  ...extra,
});

const from = (day: string): Partial<YearInput> => ({
  coverage: { activities: { from: day, to: "2026-12-31" } },
});

/** Each day from..to of one month (yyyy-MM). */
const days = (month: string, first: number, last: number) =>
  Array.from(
    { length: last - first + 1 },
    (_, i) => `${month}-${String(first + i).padStart(2, "0")}`,
  );

const leapDayRuns = (year: number) =>
  yearSummary(input([run(`${year}-02-29`)]), year, "2026-11-23").totals.activities;

const topMonday = (day: string, year: number) =>
  yearSummary(input([load(day, 80)]), year, "2026-11-23").biggestWeek?.monday;

const sum = (list: readonly (number | null)[]) => list.reduce<number>((s, v) => s + (v ?? 0), 0);

describe("year window", () => {
  it("ends today in the current year", () => {
    const y = yearSummary(input([]), 2026, "2026-11-23");
    expect(y).toMatchObject({ v: 1, year: 2026, from: "2026-01-01", to: "2026-11-23" });
    expect(y.months.map((m) => m.month)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    expect(y.months.at(-1)).toMatchObject({ days: 23, covered: "all" });
  });

  it("ends on 31 December in an earlier year, with the leap day", () => {
    const y = yearSummary(input([]), 2024, "2026-11-23");
    expect(y).toMatchObject({ from: "2024-01-01", to: "2024-12-31" });
    expect(y.months).toHaveLength(12);
    expect(y.months.reduce((s, m) => s + m.days, 0)).toBe(366);
  });

  it("is one day on 1 January", () => {
    const y = yearSummary(input([run("2026-01-01")]), 2026, "2026-01-01");
    expect(y.months).toEqual([
      {
        month: "2026-01",
        covered: "all",
        days: 1,
        activeDays: 1,
        sessions: 1,
        km: null,
        hours: 1,
        load: null,
      },
    ]);
  });

  it("ends on 31 December when today is not in the year", () => {
    // 2025-12-26 holds "26"; a year after today has no covered day here
    const before = yearSummary(input([], only("2025-01-01", "2025-12-26")), 2026, "2025-12-26");
    expect(before).toMatchObject({ from: "2026-01-01", to: "2026-12-31" });
    expect(before.coverage).toMatchObject({ activities: null, complete: false });
  });

  it("is complete on 31 December", () => {
    const y = yearSummary(input([run("2026-12-31")]), 2026, "2026-12-31");
    expect(y).toMatchObject({ to: "2026-12-31", totals: { activities: 1 } });
    expect(y.coverage.complete).toBe(true);
  });

  it("counts 29 February in a leap year only", () => {
    expect(leapDayRuns(2024)).toBe(1);
    expect(leapDayRuns(2025)).toBe(0);
  });

  it("counts the sessions of 1 January and 31 December only inside the year", () => {
    const acts = ["2024-12-31", "2025-01-01", "2025-12-31", "2026-01-01"].map((d) => run(d));
    expect(yearSummary(input(acts), 2025, "2026-11-23").totals.activities).toBe(2);
  });
});

describe("year coverage", () => {
  it("reads a month before the cache as not known", () => {
    const y = yearSummary(input([run("2026-03-01")], from("2026-03-01")), 2026, "2026-03-31");
    expect(y.coverage).toEqual({
      activities: { from: "2026-03-01", to: "2026-03-31" },
      missing: [{ from: "2026-01-01", to: "2026-02-28" }],
      complete: false,
    });
    const none = { covered: "none", days: 0, activeDays: null, sessions: null };
    expect(y.months).toEqual([
      { month: "2026-01", ...none, km: null, hours: null, load: null },
      { month: "2026-02", ...none, km: null, hours: null, load: null },
      {
        month: "2026-03",
        covered: "all",
        days: 31,
        activeDays: 1,
        sessions: 1,
        km: null,
        hours: 1,
        load: null,
      },
    ]);
  });

  it("counts only the covered days of a month", () => {
    const acts = [
      run("2026-03-09"),
      run("2026-03-10"),
      run("2026-03-10", { start: "2026-03-10 18:00:00" }),
    ];
    const y = yearSummary(input(acts, from("2026-03-10")), 2026, "2026-03-31");
    expect(y.months[2]).toEqual({
      month: "2026-03",
      covered: "part",
      days: 22,
      activeDays: 1,
      sessions: 2,
      km: null,
      hours: 2,
      load: null,
    });
    expect(y.totals).toMatchObject({ activities: 2, activeDays: 1 });
  });

  it("names the days after the cache too", () => {
    const coverage = { activities: { from: "2026-02-01", to: "2026-02-10" } };
    const y = yearSummary(input([], { coverage }), 2026, "2026-02-12");
    expect(y.coverage).toEqual({
      activities: { from: "2026-02-01", to: "2026-02-10" },
      missing: [
        { from: "2026-01-01", to: "2026-01-31" },
        { from: "2026-02-11", to: "2026-02-12" },
      ],
      complete: false,
    });
    expect(y.months[1]).toMatchObject({ covered: "part", days: 10 });
  });

  it("names one missing day on each side", () => {
    const coverage = { activities: { from: "2026-01-02", to: "2026-01-30" } };
    expect(yearSummary(input([], { coverage }), 2026, "2026-01-31").coverage).toEqual({
      ...coverage,
      missing: [
        { from: "2026-01-01", to: "2026-01-01" },
        { from: "2026-01-31", to: "2026-01-31" },
      ],
      complete: false,
    });
  });

  it("is complete when the cache holds each day, and a covered day without a session is 0", () => {
    const y = yearSummary(input([]), 2026, "2026-02-10");
    expect(y.coverage).toEqual({
      activities: { from: "2026-01-01", to: "2026-02-10" },
      missing: [],
      complete: true,
    });
    const zero = { activeDays: 0, sessions: 0, km: 0, hours: 0, load: 0 };
    expect(y.months).toEqual([
      { month: "2026-01", covered: "all", days: 31, ...zero },
      { month: "2026-02", covered: "all", days: 10, ...zero },
    ]);
    expect(y.totals).toEqual({
      activities: 0,
      activeDays: 0,
      km: 0,
      hours: 0,
      ascentM: 0,
      calories: 0,
      load: 0,
      estimatedLoads: 0,
      unlikelyTimes: 0,
    });
  });

  it.each([
    ["no cache", null],
    ["a cache that ends before the year", { from: "2025-01-01", to: "2025-12-31" }],
    ["a cache that starts after the year", { from: "2026-03-01", to: "2026-03-31" }],
  ])("has no value with %s", (_name, activities) => {
    const y = yearSummary(
      input([run("2026-01-05")], { coverage: { activities } }),
      2026,
      "2026-02-10",
    );
    expect(y.coverage).toEqual({
      activities: null,
      missing: [{ from: "2026-01-01", to: "2026-02-10" }],
      complete: false,
    });
    expect(y.totals).toEqual({
      activities: null,
      activeDays: null,
      km: null,
      hours: null,
      ascentM: null,
      calories: null,
      load: null,
      estimatedLoads: null,
      unlikelyTimes: null,
    });
    expect(y).toMatchObject({ sports: [], topSport: null, biggestMonth: null, biggestWeek: null });
    expect(y).toMatchObject({ bestBlock: null, mostConsistentMonth: null, longest: null });
    expect(y).toMatchObject({ biggest: null, records: {}, streaks: { days: null, weeks: null } });
    expect(y.rhythm).toMatchObject({ topWeekday: null, topTimeOfDay: null });
  });
});

describe("year totals", () => {
  it("sums each measure and rounds it", () => {
    const acts = [
      run("2026-01-05", { km: 10.04, ascentM: 100.4, calories: 600, trainingLoad: 80.3 }),
      run("2026-01-06", {
        km: 5.02,
        ascentM: 50.3,
        calories: 301,
        duration: "20:00",
        trainingLoad: 40.1,
      }),
    ];
    // 15.06 km, 80 min, 150.7 m, 901 kcal, 120.4
    expect(yearSummary(input(acts), 2026, "2026-01-31").totals).toEqual({
      activities: 2,
      activeDays: 2,
      km: 15.1,
      hours: 1.3,
      ascentM: 151,
      calories: 901,
      load: 120,
      estimatedLoads: 0,
      unlikelyTimes: 0,
    });
  });

  it("has no km, ascent, calories or load when no session has it", () => {
    const acts = [run("2026-01-05", { sport: "strengthTraining", type: "strength_training" })];
    expect(yearSummary(input(acts), 2026, "2026-01-31").totals).toEqual({
      activities: 1,
      activeDays: 1,
      km: null,
      hours: 1,
      ascentM: null,
      calories: null,
      load: null,
      estimatedLoads: 0,
      unlikelyTimes: 0,
    });
  });

  it("sums the known values when some sessions lack them", () => {
    const acts = [run("2026-01-05", { km: 8 }), run("2026-01-06")];
    expect(yearSummary(input(acts), 2026, "2026-01-31").totals.km).toBe(8);
  });

  it("estimates a load from HR and counts the estimate", () => {
    const acts = [run("2026-01-05", { avgHR: 150 }), run("2026-01-06", { trainingLoad: 60 })];
    const zones = [{ sport: "DEFAULT", maxHeartRateUsed: 200 }];
    // 60 min x 150 / 200 = 45
    expect(yearSummary(input(acts, { zones }), 2026, "2026-01-31").totals).toMatchObject({
      load: 105,
      estimatedLoads: 1,
    });
  });

  it("has no estimate from a HR of 0", () => {
    const zones = [{ sport: "DEFAULT", maxHeartRateUsed: 200 }];
    const y = yearSummary(input([run("2026-01-05", { avgHR: 0 })], { zones }), 2026, "2026-01-31");
    expect(y.totals).toMatchObject({ load: null, estimatedLoads: 0 });
  });

  it("has no estimate without the zones", () => {
    const acts = [run("2026-01-05", { avgHR: 150 })];
    expect(yearSummary(input(acts), 2026, "2026-01-31").totals).toMatchObject({
      load: null,
      estimatedLoads: 0,
    });
  });

  it("counts the elapsed time of a strength session", () => {
    const acts = [
      run("2026-01-05", {
        sport: "strengthTraining",
        type: "strength_training",
        duration: "5:00",
        elapsed: "1:30:00",
      }),
    ];
    expect(yearSummary(input(acts), 2026, "2026-01-31").totals.hours).toBe(1.5);
  });

  it("sums the time to the second", () => {
    // 31 x 5:00:06 is 155 h 3 min 6 s, 155.05 h
    const acts = days("2026-01", 1, 31).map((d) => run(d, { duration: "5:00:06" }));
    expect(yearSummary(input(acts), 2026, "2026-01-31").totals.hours).toBe(155.1);
    const less = days("2026-01", 1, 31).map((d) => run(d, { duration: "5:00:05" }));
    expect(yearSummary(input(less), 2026, "2026-01-31").totals.hours).toBe(155);
  });

  it("has no hours when no session has a time", () => {
    const acts = [run("2026-01-05", { duration: undefined })];
    expect(yearSummary(input(acts), 2026, "2026-01-31").totals.hours).toBeNull();
  });
});

/** 6 km in 36 hours without a Garmin load, such as 36:00 typed as hours. */
const left = (day: string, extra: Record<string, unknown> = {}) =>
  run(day, { km: 6, duration: "36:00:00", avgHR: 140, ...extra });

const MAX_HR = { zones: [{ sport: "DEFAULT", maxHeartRateUsed: 200 }] };

const totals = (...acts: Activity[]) => yearSummary(input(acts, MAX_HR), 2026, "2026-01-31").totals;

describe("year unlikely times", () => {
  it("leaves the time and the load out, and keeps the rest of the session", () => {
    const acts = [
      left("2026-01-05", { ascentM: 100, calories: 500, best: { "5k": "25:00" } }),
      run("2026-01-06", { km: 5, ascentM: 20, calories: 300, trainingLoad: 60 }),
    ];
    const y = yearSummary(input(acts, MAX_HR), 2026, "2026-01-31");
    expect(y.totals).toEqual({
      activities: 2,
      activeDays: 2,
      km: 11,
      hours: 1,
      ascentM: 120,
      calories: 800,
      load: 60,
      estimatedLoads: 0,
      unlikelyTimes: 1,
    });
    expect(y.sports).toEqual([{ sport: "running", sessions: 2, km: 11, hours: 1, load: 60 }]);
    expect(y.months[0]).toMatchObject({ sessions: 2, activeDays: 2, km: 11, hours: 1, load: 60 });
    expect(y.streaks.days).toEqual({ from: "2026-01-05", to: "2026-01-06", length: 2 });
    expect(y.records["5k"]).toHaveLength(1);
    expect(y.rhythm.weekdays).toEqual([1, 1, 0, 0, 0, 0, 0]);
  });

  it("is no longest or biggest session, and makes no week, month or block the biggest", () => {
    const acts = [
      left("2026-01-05"),
      left("2026-02-03"),
      run("2026-01-13", { id: 7, trainingLoad: 60 }),
      run("2026-03-31", { trainingLoad: 20 }),
    ];
    const y = yearSummary(input(acts, MAX_HR), 2026, "2026-04-30");
    expect(y.longest).toMatchObject({ id: 7, hours: 1 });
    expect(y.biggest).toMatchObject({ id: 7, load: 60 });
    expect(y.biggestWeek?.monday).toBe("2026-01-12");
    expect(y.biggestMonth?.month).toBe("2026-01");
    expect(y.bestBlock).toMatchObject({ from: "2026-01-05", to: "2026-02-01", value: 60 });
  });

  it("has no hours and no load when it is the only session", () => {
    const y = yearSummary(input([left("2026-01-05")], MAX_HR), 2026, "2026-01-31");
    expect(y.totals).toMatchObject({ activities: 1, km: 6, hours: null, load: null });
    expect(y.totals).toMatchObject({ estimatedLoads: 0, unlikelyTimes: 1 });
    expect(y).toMatchObject({ measure: "hours", longest: null, biggest: null });
    expect(y.sports).toEqual([{ sport: "running", sessions: 1, km: 6, hours: null, load: null }]);
  });

  it("keeps the time of a session with a Garmin load, such as a long climb", () => {
    const climb = { type: "mountaineering", sport: "generic", trainingLoad: 300 };
    expect(totals(left("2026-01-05", climb))).toMatchObject({
      hours: 36,
      load: 300,
      unlikelyTimes: 0,
    });
  });

  it("takes a Garmin load of 0 as no load", () => {
    const y = totals(left("2026-01-05", { trainingLoad: 0 }));
    expect(y).toMatchObject({ hours: null, load: 0, estimatedLoads: 0, unlikelyTimes: 1 });
  });

  it.each([
    ["strength training", { sport: "training", type: "strength_training" }],
    ["padel", { sport: "racket", type: "paddelball" }],
    ["tennis of an older row", { sport: undefined, type: "tennis" }],
  ])("leaves out the time of %s left on, and keeps Garmin's load", (_name, extra) => {
    const times = { duration: "20:00", elapsed: "14:00:00" };
    const act = run("2026-01-05", { ...extra, ...times, avgHR: 120, trainingLoad: 80 });
    expect(totals(act)).toMatchObject({
      hours: null,
      load: 80,
      estimatedLoads: 0,
      unlikelyTimes: 1,
    });
  });

  it("counts each such session of any sport", () => {
    const ride = { type: "cycling", sport: "cycling" };
    expect(totals(left("2026-01-05"), left("2026-01-09", ride)).unlikelyTimes).toBe(2);
  });

  it.each([
    ["12 h at under 1 km/h", "12:00:00", 1, 12, 0],
    ["1 second over 12 h at under 1 km/h", "12:00:01", 1, null, 1],
    ["13 h at 1 km/h", "13:00:00", 13, 13, 0],
    ["13 h at just under 1 km/h", "13:00:00", 12.99, null, 1],
    ["13 h and 1 second with 13 km", "13:00:01", 13, null, 1],
    ["a 30 h ultra of 160 km", "30:00:00", 160, 30, 0],
    ["20 km in 15 h (1.3 km/h)", "15:00:00", 20, 15, 0],
    ["8 km in 11 h", "11:00:00", 8, 11, 0],
    ["a run of 12 min typed as hours", "12:00:00", 2, 12, 0],
    ["a run of 12:30 typed as hours", "12:30:00", 2, null, 1],
    ["an hour of strength without km", "1:00:00", undefined, 1, 0],
    ["a short walk at under 1 km/h", "1:00:00", 0.5, 1, 0],
    ["a long session without km", "14:00:00", undefined, null, 1],
    ["a session of 8 km without a time", undefined, 8, null, 0],
    ["a long session of 0 km", "14:00:00", 0, null, 1],
    ["a long session with a negative km", "14:00:00", -1, null, 1],
    ["a long session with a km that is no number", "14:00:00", Number.NaN, null, 1],
    ["a long session with a km text", "14:00:00", "8", null, 1],
  ])("%s", (_name, duration, km, hours, unlikelyTimes) => {
    expect(totals(run("2026-01-05", { duration, km }))).toMatchObject({ hours, unlikelyTimes });
  });

  it("reads the elapsed time of a strength session and the moving time of a run", () => {
    const strength = { sport: "strengthTraining", type: "strength_training", km: 0.2 };
    const times = { duration: "40:00", elapsed: "14:00:00" };
    expect(totals(run("2026-01-05", { ...strength, ...times })).unlikelyTimes).toBe(1);
    expect(totals(run("2026-01-05", { km: 0.2, ...times })).unlikelyTimes).toBe(0);
  });

  it("does not count one on a day that the cache does not hold", () => {
    const acts = [left("2026-01-05"), left("2026-01-20")];
    const y = yearSummary(input(acts, from("2026-01-10")), 2026, "2026-01-31");
    expect(y.totals.unlikelyTimes).toBe(1);
  });
});

describe("year sports", () => {
  it("gives each sport, most hours first", () => {
    const acts = [
      run("2026-01-05", { km: 10, trainingLoad: 50 }),
      run("2026-01-06", { sport: "cycling", type: "cycling", duration: "2:30:00", km: 60.06 }),
      run("2026-01-07", { km: 5 }),
    ];
    const y = yearSummary(input(acts), 2026, "2026-01-31");
    expect(y.sports).toEqual([
      { sport: "cycling", sessions: 1, km: 60.1, hours: 2.5, load: null },
      { sport: "running", sessions: 2, km: 15, hours: 2, load: 50 },
    ]);
    expect(y.topSport).toBe("cycling");
  });

  it("takes the board of the activity, not its type or its sport", () => {
    const acts = [
      run("2026-01-05", { type: "trail_running" }),
      run("2026-01-06", { type: "treadmill_running" }),
      run("2026-01-07", { type: "strength_training", sport: "training", duration: "3:00:00" }),
      run("2026-01-08", { type: "other", sport: undefined, duration: "30:00" }),
    ];
    const y = yearSummary(input(acts), 2026, "2026-01-31");
    expect(y.sports.map((s) => [s.sport, s.sessions])).toEqual([
      ["strengthTraining", 1],
      ["running", 2],
      ["generic", 1],
    ]);
  });

  it("puts the sport with more sessions first at the same hours", () => {
    const acts = [
      run("2026-01-05", { sport: "cycling", type: "cycling", duration: "2:00:00" }),
      run("2026-01-06"),
      run("2026-01-07"),
    ];
    const y = yearSummary(input(acts), 2026, "2026-01-31");
    expect(y.sports.map((s) => s.sport)).toEqual(["running", "cycling"]);
    expect(y.topSport).toBe("running");
  });

  it("uses the name at the same hours and sessions", () => {
    const acts = [run("2026-01-05"), run("2026-01-06", { sport: "cycling", type: "cycling" })];
    const y = yearSummary(input(acts), 2026, "2026-01-31");
    expect(y.sports.map((s) => s.sport)).toEqual(["cycling", "running"]);
  });

  it("puts a sport without a time last", () => {
    const acts = [
      run("2026-01-05", { sport: "cycling", type: "cycling", duration: undefined }),
      run("2026-01-06"),
    ];
    const y = yearSummary(input(acts), 2026, "2026-01-31");
    expect(y.sports.map((s) => [s.sport, s.hours])).toEqual([
      ["running", 1],
      ["cycling", null],
    ]);
  });

  it("has no top sport without a session", () => {
    expect(yearSummary(input([]), 2026, "2026-01-31")).toMatchObject({
      sports: [],
      topSport: null,
    });
  });
});

const load = (day: string, trainingLoad: number) => run(day, { trainingLoad });

// 2026: 1 January is a Thursday, 5 January is the first Monday, 1 February and 1 March are Sundays
describe("year measure", () => {
  const acts = [
    run("2026-01-06", { avgHR: 150 }),
    run("2026-02-10", { duration: "2:00:00" }),
    run("2026-02-24", { duration: "2:00:00" }),
  ];

  it("is hours when no session has a load", () => {
    const y = yearSummary(input(acts), 2026, "2026-03-01");
    expect(y.measure).toBe("hours");
    expect(y.biggestMonth).toEqual({ month: "2026-02", km: null, hours: 4, load: null });
    expect(y.biggestWeek).toEqual({ monday: "2026-02-09", km: null, hours: 2, load: null });
    expect(y.bestBlock).toEqual({ from: "2026-02-02", to: "2026-03-01", value: 4, sessions: 2 });
  });

  it("is load with one estimated load", () => {
    const zones = [{ sport: "DEFAULT", maxHeartRateUsed: 200 }];
    const y = yearSummary(input(acts, { zones }), 2026, "2026-03-01");
    expect(y.measure).toBe("load");
    expect(y.biggestMonth).toEqual({ month: "2026-01", km: null, hours: 1, load: 45 });
    expect(y.biggestWeek).toEqual({ monday: "2026-01-05", km: null, hours: 1, load: 45 });
    expect(y.bestBlock).toEqual({ from: "2026-01-05", to: "2026-02-01", value: 45, sessions: 1 });
  });

  it("is hours without a session", () => {
    const y = yearSummary(input([]), 2026, "2026-03-01");
    expect(y).toMatchObject({ measure: "hours", biggestMonth: null, biggestWeek: null });
    expect(y).toMatchObject({ bestBlock: null, mostConsistentMonth: null });
  });

  it("rounds the hours of the best block to 1 decimal", () => {
    const y = yearSummary(input([run("2026-01-06", { duration: "1:20:00" })]), 2026, "2026-02-01");
    expect(y.bestBlock?.value).toBe(1.3);
  });
});

describe("year biggest month", () => {
  it("compares the loads before it rounds them", () => {
    const acts = [load("2026-01-10", 100.2), load("2026-02-10", 100.4)];
    expect(yearSummary(input(acts), 2026, "2026-02-28").biggestMonth).toEqual({
      month: "2026-02",
      km: null,
      hours: 1,
      load: 100,
    });
  });

  it("is the earlier month at the same load", () => {
    const acts = [load("2026-01-10", 100), load("2026-02-10", 100)];
    expect(yearSummary(input(acts), 2026, "2026-02-28").biggestMonth?.month).toBe("2026-01");
  });

  it("is null when each load is 0", () => {
    const y = yearSummary(input([load("2026-01-10", 0)]), 2026, "2026-02-28");
    expect(y).toMatchObject({ measure: "load", biggestMonth: null, biggestWeek: null });
    expect(y.bestBlock).toBeNull();
  });
});

describe("year weeks", () => {
  it("leaves out the week across New Year", () => {
    const acts = [load("2026-01-02", 500), load("2026-01-07", 80)];
    const y = yearSummary(input(acts), 2026, "2026-02-01");
    expect(y.biggestWeek).toEqual({ monday: "2026-01-05", km: null, hours: 1, load: 80 });
    expect(y.bestBlock).toMatchObject({ value: 80, sessions: 1 });
  });

  it("leaves out the week across the end of the year", () => {
    // 29 December 2025 is a Monday
    const acts = [load("2025-12-30", 500), load("2025-12-23", 80)];
    expect(yearSummary(input(acts), 2025, "2026-11-23").biggestWeek?.monday).toBe("2025-12-22");
  });

  it("counts a week that starts on 1 January or ends on 31 December", () => {
    // 1 January 2024 is a Monday, 31 December 2023 is a Sunday
    expect(topMonday("2024-01-01", 2024)).toBe("2024-01-01");
    expect(topMonday("2023-12-31", 2023)).toBe("2023-12-25");
  });

  it("leaves out the week in progress until its Sunday", () => {
    const acts = [load("2026-01-06", 80), load("2026-01-13", 500)];
    const weekOn = (today: string) => yearSummary(input(acts), 2026, today).biggestWeek?.monday;
    expect(weekOn("2026-01-17")).toBe("2026-01-05");
    expect(weekOn("2026-01-18")).toBe("2026-01-12");
  });

  it("leaves out a week with a day that the cache does not hold", () => {
    const acts = [load("2026-01-07", 500), load("2026-01-14", 80)];
    const weekFrom = (day: string) =>
      yearSummary(input(acts, from(day)), 2026, "2026-02-01").biggestWeek?.monday;
    expect(weekFrom("2026-01-06")).toBe("2026-01-12");
    expect(weekFrom("2026-01-05")).toBe("2026-01-05");
  });

  it("is null without a whole week", () => {
    const y = yearSummary(input([load("2026-01-07", 80)]), 2026, "2026-01-10");
    expect(y.biggestWeek).toBeNull();
  });

  it("is the earlier week at the same load", () => {
    const acts = [load("2026-01-06", 80), load("2026-01-13", 80)];
    expect(yearSummary(input(acts), 2026, "2026-02-01").biggestWeek?.monday).toBe("2026-01-05");
  });

  it("counts the Monday and the Sunday of a week", () => {
    const acts = [load("2026-01-05", 30), load("2026-01-11", 40), load("2026-01-12", 60)];
    expect(yearSummary(input(acts), 2026, "2026-02-01").biggestWeek).toEqual({
      monday: "2026-01-05",
      km: null,
      hours: 2,
      load: 70,
    });
  });

  it("counts the known loads of a week, as weeklyKnown does", () => {
    const acts = [load("2026-01-06", 80), run("2026-01-08"), load("2026-01-13", 70)];
    const y = yearSummary(input(acts), 2026, "2026-02-01");
    const rows = weeklyKnown(acts, ["2026-01-05", "2026-01-12"], (a) => a.trainingLoad);
    expect(rows).toEqual([80, 70]);
    expect(y.biggestWeek?.load).toBe(80);
  });
});

describe("year best block", () => {
  it("needs 4 whole weeks", () => {
    const acts = [load("2026-01-06", 80), run("2026-01-13"), load("2026-01-27", 20.4)];
    const block = (last: string) =>
      yearSummary(input(acts, only("2026-01-05", last)), 2026, "2026-02-28").bestBlock;
    expect(block("2026-01-31")).toBeNull();
    // the week of 12 January has a session and no load
    expect(block("2026-02-01")).toEqual({
      from: "2026-01-05",
      to: "2026-02-01",
      value: 100,
      sessions: 3,
    });
  });

  it("takes the 4 weeks with the most load, not those of the biggest week", () => {
    const rows = [
      load("2026-01-06", 100),
      ...["2026-02-03", "2026-02-10", "2026-02-17", "2026-02-24"].map((d) => load(d, 60)),
    ];
    const y = yearSummary(input(rows), 2026, "2026-03-01");
    expect(y.biggestWeek?.monday).toBe("2026-01-05");
    expect(y.bestBlock).toEqual({ from: "2026-02-02", to: "2026-03-01", value: 240, sessions: 4 });
  });

  it("is the earlier block at the same load", () => {
    // both the blocks from 5 and from 12 January hold it
    const y = yearSummary(input([load("2026-01-28", 80)]), 2026, "2026-02-08");
    expect(y.bestBlock).toMatchObject({ from: "2026-01-05", to: "2026-02-01" });
  });
});

const consistentMonth = (activities: Activity[], today: string, extra: Partial<YearInput> = {}) =>
  yearSummary(input(activities, extra), 2026, today).mostConsistentMonth;

describe("year most consistent month", () => {
  it("needs 14 covered days", () => {
    const acts = [run("2026-01-20")];
    expect(consistentMonth(acts, "2026-01-31", from("2026-01-19"))).toBeNull();
    expect(consistentMonth(acts, "2026-01-31", from("2026-01-18"))).toEqual({
      month: "2026-01",
      activeDays: 1,
      days: 14,
      sharePct: 7,
    });
  });

  it("can be the month in progress from its 14th day", () => {
    const acts = [run("2026-01-10"), ...days("2026-02", 1, 7).map((d) => run(d))];
    expect(consistentMonth(acts, "2026-02-13")?.month).toBe("2026-01");
    expect(consistentMonth(acts, "2026-02-14")).toEqual({
      month: "2026-02",
      activeDays: 7,
      days: 14,
      sharePct: 50,
    });
  });

  it("compares the share, not the days", () => {
    // 16 of 31 days is 51.6%; 15 of 28 is 53.6%
    const acts = [...days("2026-01", 1, 16), ...days("2026-02", 1, 15)].map((d) => run(d));
    expect(consistentMonth(acts, "2026-02-28")).toEqual({
      month: "2026-02",
      activeDays: 15,
      days: 28,
      sharePct: 54,
    });
  });

  it("takes the month with more active days at the same share", () => {
    // 7 of the 14 covered days, and 14 of 28
    const acts = [...days("2026-01", 18, 24), ...days("2026-02", 1, 14)].map((d) => run(d));
    expect(consistentMonth(acts, "2026-02-28", from("2026-01-18"))?.month).toBe("2026-02");
  });

  it("takes the earlier month at the same share and days", () => {
    const acts = [...days("2026-04", 1, 3), ...days("2026-06", 1, 3)].map((d) => run(d));
    expect(consistentMonth(acts, "2026-06-30")).toEqual({
      month: "2026-04",
      activeDays: 3,
      days: 30,
      sharePct: 10,
    });
  });

  it("counts a day with two sessions once", () => {
    const acts = [run("2026-01-10"), run("2026-01-10", { start: "2026-01-10 18:00:00" })];
    expect(consistentMonth(acts, "2026-01-31")?.activeDays).toBe(1);
  });
});

const dayStreak = (list: string[], extra: Partial<YearInput> = {}, today = "2026-03-31") =>
  yearSummary(
    input(
      list.map((d) => run(d)),
      extra,
    ),
    2026,
    today,
  ).streaks.days;

describe("year day streak", () => {
  it("stops on a day without a session, and the earlier one wins a tie", () => {
    const list = [...days("2026-03", 2, 4), ...days("2026-03", 6, 8)];
    expect(dayStreak(list)).toEqual({ from: "2026-03-02", to: "2026-03-04", length: 3 });
  });

  it("takes the longer one when it comes later", () => {
    const list = [...days("2026-03", 2, 3), ...days("2026-03", 6, 8)];
    expect(dayStreak(list)).toEqual({ from: "2026-03-06", to: "2026-03-08", length: 3 });
  });

  it("starts at the first day that the cache holds", () => {
    const list = days("2026-03", 1, 7);
    expect(dayStreak(list, from("2026-03-04"))).toEqual({
      from: "2026-03-04",
      to: "2026-03-07",
      length: 4,
    });
  });

  it("starts on 1 January and can end today", () => {
    const list = ["2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02"];
    expect(dayStreak(list, {}, "2026-01-02")).toEqual({
      from: "2026-01-01",
      to: "2026-01-02",
      length: 2,
    });
  });

  it("crosses a month and is 1 for one day", () => {
    expect(dayStreak(["2026-02-28", "2026-03-01"])?.length).toBe(2);
    expect(dayStreak(["2026-02-28"])).toEqual({ from: "2026-02-28", to: "2026-02-28", length: 1 });
  });

  it("is null without a session", () => {
    expect(dayStreak([])).toBeNull();
  });
});

const weekStreak = (list: string[], today: string, extra: Partial<YearInput> = {}) =>
  yearSummary(
    input(
      list.map((d) => run(d)),
      extra,
    ),
    2026,
    today,
  ).streaks.weeks;

describe("year week streak", () => {
  it("counts weeks in a row with a session", () => {
    expect(weekStreak(["2026-01-11", "2026-01-12", "2026-01-20"], "2026-03-31")).toEqual({
      from: "2026-01-05",
      to: "2026-01-25",
      length: 3,
    });
  });

  it("counts the week in progress when it has a session, up to today", () => {
    expect(weekStreak(["2026-03-18", "2026-03-24"], "2026-03-25")).toEqual({
      from: "2026-03-16",
      to: "2026-03-25",
      length: 2,
    });
    expect(weekStreak(["2026-03-18"], "2026-03-25")).toEqual({
      from: "2026-03-16",
      to: "2026-03-22",
      length: 1,
    });
  });

  it("counts the days of the first week that are in the year", () => {
    expect(weekStreak(["2025-12-30", "2026-01-06"], "2026-01-31")).toEqual({
      from: "2026-01-05",
      to: "2026-01-11",
      length: 1,
    });
    expect(weekStreak(["2026-01-02", "2026-01-06"], "2026-01-31")).toEqual({
      from: "2026-01-01",
      to: "2026-01-11",
      length: 2,
    });
  });

  it("stops on a week without a session, and the earlier one wins a tie", () => {
    const list = ["2026-01-06", "2026-01-13", "2026-01-27", "2026-02-03"];
    expect(weekStreak(list, "2026-03-31")).toEqual({
      from: "2026-01-05",
      to: "2026-01-18",
      length: 2,
    });
  });

  it("names only days that the cache holds", () => {
    expect(
      weekStreak(["2026-03-04", "2026-03-10"], "2026-03-31", only("2026-03-04", "2026-03-11")),
    ).toEqual({
      from: "2026-03-04",
      to: "2026-03-11",
      length: 2,
    });
  });

  it("does not count a week whose session is on a day that the cache does not hold", () => {
    expect(weekStreak(["2026-01-06", "2026-01-13"], "2026-01-31", from("2026-01-07"))).toEqual({
      from: "2026-01-12",
      to: "2026-01-18",
      length: 1,
    });
  });

  it("is null without a session", () => {
    expect(weekStreak([], "2026-03-31")).toBeNull();
  });
});

const longest = (...acts: Activity[]) => yearSummary(input(acts), 2026, "2026-01-31").longest;

describe("year longest session", () => {
  it("names the session with the most time", () => {
    const ride = run("2026-01-08", {
      id: 7,
      name: "Long ride",
      type: "cycling",
      sport: "cycling",
      duration: "2:20:00",
      km: 55.55,
    });
    expect(longest(run("2026-01-07", { id: 6 }), ride, run("2026-01-09"))).toEqual({
      date: "2026-01-08",
      id: 7,
      name: "Long ride",
      sport: "cycling",
      hours: 2.3,
      km: 55.6,
    });
  });

  it("is the earlier one at the same time, also in a list with the newest first", () => {
    expect(longest(run("2026-01-09"), run("2026-01-07"))?.date).toBe("2026-01-07");
  });

  it("is the first row at the same time and the same start", () => {
    const acts = [run("2026-01-07", { id: 1 }), run("2026-01-07", { id: 2 })];
    expect(longest(...acts)?.id).toBe(1);
  });

  it("has no name, id or km that the row does not have", () => {
    expect(longest(run("2026-01-07"))).toStrictEqual({
      date: "2026-01-07",
      sport: "running",
      hours: 1,
      km: null,
    });
  });

  it("counts the elapsed time of a strength session", () => {
    const strength = run("2026-01-08", {
      sport: "strengthTraining",
      type: "strength_training",
      duration: "10:00",
      elapsed: "1:30:00",
    });
    expect(longest(run("2026-01-07"), strength)).toMatchObject({
      sport: "strengthTraining",
      hours: 1.5,
    });
  });

  it("is null when no session has a time", () => {
    expect(longest(run("2026-01-07", { duration: undefined }))).toBeNull();
    expect(longest()).toBeNull();
  });
});

describe("year biggest session", () => {
  const zones = [{ sport: "DEFAULT", maxHeartRateUsed: 200 }];
  const biggest = (...acts: Activity[]) =>
    yearSummary(input(acts, { zones }), 2026, "2026-01-31").biggest;

  it("names the session with the most load", () => {
    const acts = [
      load("2026-01-06", 80),
      run("2026-01-08", { id: 9, name: "Race", trainingLoad: 120.6 }),
      load("2026-01-09", 90),
    ];
    expect(biggest(...acts)).toEqual({
      date: "2026-01-08",
      id: 9,
      name: "Race",
      sport: "running",
      load: 121,
      estimate: false,
    });
  });

  it("says when the load is an estimate", () => {
    expect(biggest(load("2026-01-06", 40), run("2026-01-08", { avgHR: 150 }))).toStrictEqual({
      date: "2026-01-08",
      sport: "running",
      load: 45,
      estimate: true,
    });
  });

  it("is the earlier one at the same load", () => {
    expect(biggest(load("2026-01-09", 80), load("2026-01-07", 80))?.date).toBe("2026-01-07");
  });

  it("is null when no session has a load", () => {
    expect(biggest(run("2026-01-07"))).toBeNull();
  });
});

const records = (...acts: Activity[]) => yearSummary(input(acts), 2026, "2026-01-31").records;

const withBest = (day: string, time: string, extra: Record<string, unknown> = {}) =>
  run(day, { best: { "5k": time }, ...extra });

describe("year records", () => {
  it("gives each improvement with the time that it beat", () => {
    const acts = [
      withBest("2026-01-20", "24:30", { id: 2, name: "Parkrun" }),
      withBest("2026-01-06", "25:00"),
      withBest("2026-01-13", "25:10"),
      withBest("2026-01-27", "24:00"),
    ];
    expect(records(...acts)).toStrictEqual({
      "5k": [
        { date: "2026-01-06", time: "25:00", previous: null },
        { date: "2026-01-20", time: "24:30", previous: "25:00", id: 2, name: "Parkrun" },
        { date: "2026-01-27", time: "24:00", previous: "24:30" },
      ],
    });
  });

  it("keeps each distance apart", () => {
    const acts = [
      run("2026-01-06", { best: { "1k": "4:30", "5k": "25:00" } }),
      run("2026-01-13", { best: { "1k": "4:40", "5k": "24:00" } }),
    ];
    const r = records(...acts);
    expect(Object.keys(r)).toEqual(["1k", "5k"]);
    expect(r["1k"].map((b) => b.time)).toEqual(["4:30"]);
    expect(r["5k"].map((b) => b.time)).toEqual(["25:00", "24:00"]);
  });

  it("counts a run of an older row without a sport", () => {
    const act = withBest("2026-01-06", "25:00", { sport: undefined, type: "trail_running" });
    expect(records(act)["5k"]).toHaveLength(1);
  });

  it("takes no tie as an improvement", () => {
    const acts = [withBest("2026-01-06", "25:00"), withBest("2026-01-13", "25:00")];
    expect(records(...acts)["5k"].map((r) => r.date)).toEqual(["2026-01-06"]);
  });

  it("starts again each year", () => {
    const acts = [withBest("2025-12-30", "20:00"), withBest("2026-01-06", "25:00")];
    expect(records(...acts)["5k"]).toEqual([{ date: "2026-01-06", time: "25:00", previous: null }]);
  });

  it("counts runs only", () => {
    expect(records(withBest("2026-01-06", "9:00", { sport: "cycling", type: "cycling" }))).toEqual(
      {},
    );
  });

  it("is empty without a best effort", () => {
    expect(records(run("2026-01-06"))).toEqual({});
  });
});

const rhythm = (...starts: string[]) =>
  yearSummary(input(starts.map((start) => run(start.slice(0, 10), { start }))), 2026, "2026-01-31")
    .rhythm;

describe("year rhythm", () => {
  it("counts the sessions of each weekday, Monday first", () => {
    // Monday 5, Tuesday 6, Sunday 11 (two sessions) and Sunday 18 January
    const r = rhythm(
      "2026-01-05 07:00:00",
      "2026-01-06 07:00:00",
      "2026-01-11 07:00:00",
      "2026-01-11 18:00:00",
      "2026-01-18 07:00:00",
    );
    expect(r.weekdays).toEqual([1, 1, 0, 0, 0, 0, 3]);
    expect(r.topWeekday).toBe(6);
  });

  it("takes the earlier weekday at the same count", () => {
    expect(rhythm("2026-01-11 07:00:00", "2026-01-07 07:00:00").topWeekday).toBe(2);
    expect(rhythm("2026-01-11 07:00:00", "2026-01-05 07:00:00").topWeekday).toBe(0);
  });

  it.each([
    ["00:00:00", "night"],
    ["04:59:59", "night"],
    ["05:00:00", "morning"],
    ["11:59:59", "morning"],
    ["12:00:00", "afternoon"],
    ["17:59:59", "afternoon"],
    ["18:00:00", "evening"],
    ["21:59:59", "evening"],
    ["22:00:00", "night"],
    ["23:59:59", "night"],
  ])("reads %s as %s", (time, band) => {
    const r = rhythm(`2026-01-06 ${time}`);
    expect(r.timeOfDay).toEqual({ night: 0, morning: 0, afternoon: 0, evening: 0, [band]: 1 });
    expect(r.topTimeOfDay).toBe(band);
  });

  it("reads an ISO start too", () => {
    expect(rhythm("2026-01-06T13:00:00.0").topTimeOfDay).toBe("afternoon");
  });

  it.each([
    ["morning", ["22:00", "18:00", "12:00", "05:00"]],
    ["afternoon", ["22:00", "18:00", "12:00"]],
    ["evening", ["22:00", "18:00"]],
    ["night", ["22:00", "18:00", "23:00"]],
  ])("takes the %s of a tie or a count", (band, times) => {
    expect(rhythm(...times.map((t) => `2026-01-06 ${t}:00`)).topTimeOfDay).toBe(band);
  });

  it("counts a session without a time of day on its weekday only", () => {
    expect(rhythm("2026-01-06", "2026-01-06 24:00:00")).toEqual({
      weekdays: [0, 2, 0, 0, 0, 0, 0],
      topWeekday: 1,
      timeOfDay: { night: 0, morning: 0, afternoon: 0, evening: 0 },
      topTimeOfDay: null,
    });
  });

  it("has no top without a session", () => {
    expect(rhythm()).toEqual({
      weekdays: [0, 0, 0, 0, 0, 0, 0],
      topWeekday: null,
      timeOfDay: { night: 0, morning: 0, afternoon: 0, evening: 0 },
      topTimeOfDay: null,
    });
  });
});

const hrvRows = (list: string[], hrv: unknown) => list.map((date) => ({ date, hrv }));

const rhrRows = (list: string[], rhr: unknown) => list.map((date) => ({ date, rhr }));

describe("year HRV and resting HR", () => {
  const covered = { activities: ALL, hrv: ALL, rhr: ALL };

  it("gives the mean of a month with 7 values, and only the count of one with 6", () => {
    const hrv = [
      ...hrvRows(days("2026-01", 1, 6), 60),
      ...hrvRows(days("2026-02", 1, 6), 60),
      { date: "2026-02-07", hrv: 65 },
    ];
    const recovery = [
      ...rhrRows(days("2026-01", 1, 6), 48),
      ...rhrRows(days("2026-02", 1, 6), 48),
      { date: "2026-02-07", rhr: 51 },
    ];
    const y = yearSummary(input([], { hrv, recovery, coverage: covered }), 2026, "2026-02-28");
    // (6 x 60 + 65) / 7 = 60.71; (6 x 48 + 51) / 7 = 48.43
    expect(y.hrv).toEqual([
      { month: "2026-01", mean: null, nights: 6 },
      { month: "2026-02", mean: 60.7, nights: 7 },
    ]);
    expect(y.rhr).toEqual([
      { month: "2026-01", mean: null, days: 6 },
      { month: "2026-02", mean: 48.4, days: 7 },
    ]);
    expect(y.coverage.hrv).toEqual({ from: "2026-01-01", to: "2026-02-28" });
    expect(y.coverage.rhr).toEqual({ from: "2026-01-01", to: "2026-02-28" });
  });

  it("has no row for a month without a value, and months in order", () => {
    const hrv = hrvRows(["2026-03-02", "2026-01-05"], 60);
    const y = yearSummary(input([], { hrv, coverage: covered }), 2026, "2026-03-31");
    expect(y.hrv?.map((m) => m.month)).toEqual(["2026-01", "2026-03"]);
  });

  it("counts the values of the year only", () => {
    const hrv = hrvRows(["2025-12-31", "2026-01-01", "2026-02-28", "2026-03-01"], 60);
    const recovery = rhrRows(["2025-12-31", "2026-01-01", "2026-02-28", "2026-03-01"], 48);
    const y = yearSummary(input([], { hrv, recovery, coverage: covered }), 2026, "2026-02-28");
    expect(y.hrv?.map((m) => [m.month, m.nights])).toEqual([
      ["2026-01", 1],
      ["2026-02", 1],
    ]);
    expect(y.rhr?.map((m) => [m.month, m.days])).toEqual([
      ["2026-01", 1],
      ["2026-02", 1],
    ]);
  });

  it("has no key without a value", () => {
    const y = yearSummary(input([], { coverage: covered }), 2026, "2026-02-28");
    for (const key of ["hrv", "rhr"]) {
      expect(y).not.toHaveProperty(key);
      expect(y.coverage).not.toHaveProperty(key);
    }
  });

  it("has no key when each value is outside the year", () => {
    const y = yearSummary(
      input([], {
        hrv: hrvRows(["2025-12-31"], 60),
        recovery: rhrRows(["2025-12-31"], 48),
        coverage: covered,
      }),
      2026,
      "2026-02-28",
    );
    for (const key of ["hrv", "rhr"]) {
      expect(y).not.toHaveProperty(key);
      expect(y.coverage).not.toHaveProperty(key);
    }
  });

  it("keeps the two sources apart", () => {
    const y = yearSummary(
      input([], { recovery: rhrRows(["2026-01-05"], 48), coverage: covered }),
      2026,
      "2026-01-31",
    );
    expect(y).not.toHaveProperty("hrv");
    expect(y.coverage).not.toHaveProperty("hrv");
    expect(y.rhr).toEqual([{ month: "2026-01", mean: null, days: 1 }]);
  });

  it("gives each source its own coverage, inside the year", () => {
    const coverage = {
      activities: ALL,
      hrv: { from: "2025-06-01", to: "2026-01-20" },
      rhr: { from: "2026-01-04", to: "2026-03-31" },
    };
    const rows = { hrv: hrvRows(["2026-01-05"], 60), recovery: rhrRows(["2026-01-05"], 48) };
    const y = yearSummary(input([], { ...rows, coverage }), 2026, "2026-01-31");
    expect(y.coverage.hrv).toEqual({ from: "2026-01-01", to: "2026-01-20" });
    expect(y.coverage.rhr).toEqual({ from: "2026-01-04", to: "2026-01-31" });
  });

  it("has a null coverage when the range of the source is not known", () => {
    const y = yearSummary(
      input([], { hrv: hrvRows(["2026-01-05"], 60), coverage: { activities: ALL, hrv: null } }),
      2026,
      "2026-01-31",
    );
    expect(y.coverage.hrv).toBeNull();
    expect(y.hrv).toEqual([{ month: "2026-01", mean: null, nights: 1 }]);
  });

  it("gives them without an activity cache", () => {
    const y = yearSummary(
      input([], { hrv: hrvRows(["2026-01-05"], 60), coverage: { activities: null, hrv: ALL } }),
      2026,
      "2026-01-31",
    );
    expect(y.hrv).toEqual([{ month: "2026-01", mean: null, nights: 1 }]);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, "60", null, undefined])(
    "counts a value of %s for nothing",
    (value) => {
      const hrv = hrvRows(["2026-01-05"], value);
      const recovery = rhrRows(["2026-01-05"], value);
      const y = yearSummary(input([], { hrv, recovery, coverage: covered }), 2026, "2026-01-31");
      expect(y).not.toHaveProperty("hrv");
      expect(y).not.toHaveProperty("rhr");
    },
  );

  it.each([undefined, 20260105, "2026-01", "2026-02-30", "x"])(
    "counts a row with the date %s for nothing",
    (date) => {
      const extra = { hrv: [{ date, hrv: 60 }], recovery: [{ date, rhr: 48 }], coverage: covered };
      const y = yearSummary(input([], extra), 2026, "2026-03-31");
      expect(y).not.toHaveProperty("hrv");
      expect(y).not.toHaveProperty("rhr");
    },
  );
});

describe("year bad rows", () => {
  const zones = [{ sport: "DEFAULT", maxHeartRateUsed: 200 }];
  const good = [
    run("2026-01-06", {
      km: 10,
      trainingLoad: 80,
      ascentM: 50,
      calories: 600,
      best: { "5k": "25:00" },
    }),
    run("2026-01-07", { km: 8, avgHR: 150 }),
  ];
  const summary = (acts: Activity[]) => yearSummary(input(acts, { zones }), 2026, "2026-01-31");

  it.each([
    ["no start", undefined],
    ["a number", 20260106],
    ["a text", "yesterday"],
    ["a day that does not exist", "2026-01-32 07:00:00"],
    ["a month that does not exist", "2026-13-01 07:00:00"],
  ])("counts a session whose start is %s for nothing", (_name, start) => {
    const bad = run("2026-01-08", { km: 99, trainingLoad: 999, start });
    expect(summary([...good, bad])).toEqual(summary(good));
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -5, "12", null])(
    "reads a value of %s as missing",
    (v) => {
      const fields = { km: v, trainingLoad: v, ascentM: v, calories: v, avgHR: v };
      const bad = run("2026-01-08", fields);
      expect(summary([...good, bad])).toEqual(summary([...good, run("2026-01-08")]));
    },
  );

  it("estimates the load when Garmin's is bad", () => {
    const bad = run("2026-01-08", { trainingLoad: Number.NaN, avgHR: 100 });
    expect(summary([bad]).totals).toMatchObject({ load: 30, estimatedLoads: 1 });
  });

  it.each([0, -200, Number.NaN, Number.POSITIVE_INFINITY])(
    "has no estimate with a max HR of %s",
    (maxHeartRateUsed) => {
      const y = yearSummary(
        input([run("2026-01-08", { avgHR: 100 })], { zones: [{ maxHeartRateUsed }] }),
        2026,
        "2026-01-31",
      );
      expect(y.totals).toMatchObject({ load: null, estimatedLoads: 0 });
      expect(y).toMatchObject({ measure: "hours", biggest: null });
    },
  );

  it.each([
    ["a word", "long"],
    ["a time of 0", "0:00"],
    ["a time with no end", `${"9".repeat(400)}:00`],
    ["a number", 3600],
  ])("has no hours for %s", (_name, duration) => {
    const y = yearSummary(
      input([run("2026-01-08", { avgHR: 100, duration })], { zones }),
      2026,
      "2026-01-31",
    );
    expect(y.totals).toMatchObject({ hours: null, load: null, estimatedLoads: 0 });
    expect(y).toMatchObject({ longest: null, biggest: null, biggestMonth: null });
  });

  it.each([
    ["text"],
    [null],
    [["25:00"]],
    [42],
    [{ "5k": "fast" }],
    [{ "5k": 1500 }],
    [{ "5k": `${"9".repeat(400)}:00` }],
  ])("has no record for a best of %j", (best) => {
    expect(summary([run("2026-01-08", { best })]).records).toEqual({});
  });

  it("has no previous time that is no finite number", () => {
    const acts = [`${"9".repeat(400)}:00`, "25:00"].map((time, i) =>
      run(`2026-01-0${i + 6}`, { best: { "5k": time } }),
    );
    expect(summary(acts).records).toEqual({
      "5k": [{ date: "2026-01-07", time: "25:00", previous: null }],
    });
  });

  it("has no name or id of another type", () => {
    const bad = run("2026-01-08", { id: "9", name: 42 });
    expect(summary([bad]).longest).not.toHaveProperty("id");
    expect(summary([bad]).longest).not.toHaveProperty("name");
  });

  it("does not throw without a usable zone list", () => {
    for (const bad of [null, "x", {}, [null], [42]]) {
      expect(
        yearSummary(input(good, { zones: bad }), 2026, "2026-01-31").totals.estimatedLoads,
      ).toBe(0);
    }
  });
});

describe("year summary as a whole", () => {
  const acts = days("2026-01", 1, 31).flatMap((d, i) => [
    run(d, { id: i, trainingLoad: 10 + i, km: 5 + i }),
    run(d, { id: 100 + i, start: `${d} 19:00:00`, sport: "cycling", type: "cycling", km: i }),
  ]);

  it("does not depend on the order of the rows", () => {
    const y = yearSummary(input(acts), 2026, "2026-02-10");
    expect(yearSummary(input(acts.toReversed()), 2026, "2026-02-10")).toEqual(y);
  });

  it("does not change its input", () => {
    const given = input(acts, {
      hrv: [{ date: "2026-01-05", hrv: 60 }],
      recovery: [{ date: "2026-01-05", rhr: 48 }],
      zones: [{ sport: "DEFAULT", maxHeartRateUsed: 200 }],
    });
    const before = structuredClone(given);
    yearSummary(given, 2026, "2026-02-10");
    expect(given).toEqual(before);
  });

  it("gives the same total in each part", () => {
    const y = yearSummary(input(acts), 2026, "2026-02-10");
    expect(y.totals.activities).toBe(62);
    expect(sum(y.sports.map((s) => s.sessions))).toBe(62);
    expect(sum(y.months.map((m) => m.sessions))).toBe(62);
    expect(sum(y.rhythm.weekdays)).toBe(62);
    expect(sum(Object.values(y.rhythm.timeOfDay))).toBe(62);
    expect(sum(y.sports.map((s) => s.load))).toBe(y.totals.load);
    expect(sum(y.months.map((m) => m.activeDays))).toBe(y.totals.activeDays);
  });

  it("is plain JSON", () => {
    const y = yearSummary(input(acts), 2026, "2026-02-10");
    expect(JSON.parse(JSON.stringify(y))).toEqual(y);
  });
});
