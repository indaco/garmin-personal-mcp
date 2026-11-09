import { describe, expect, it } from "vitest";
import {
  bedtimeSpread,
  change,
  changeClass,
  dailyLoads,
  epley,
  fitnessFatigue,
  fitnessFatigueFrom,
  intensityMinutes,
  loadOf,
  loadSafety,
  loadRatio,
  mean,
  monotony,
  periodWindow,
  ramp,
  readiness,
  readinessOf,
  riegel,
  rolling,
  sd,
  weekly,
  weeklyKnown,
  weeklyMeans,
  zonesOf,
} from "../../src/analytics/metrics";

const act = (start: string, extra: Record<string, unknown> = {}) => ({
  type: "running",
  start: `${start} 07:00:00`,
  duration: "30:00",
  ...extra,
});

/** A recovery row with a date and the sleep hours; both can be bad on purpose. */
const sleep = (date: unknown, sleepH: unknown) => ({ date, sleepH });

/** The distance of a session, or undefined without one. */
const km = (a: { km?: unknown }) => a.km as number | undefined;

/** Recovery rows, one a day up to 2026-10-26; the last one is today. */
const recoveryRows = (rhr: (number | undefined)[], today: Record<string, unknown> = {}) =>
  [...rhr, undefined].map((v, i, all) => ({
    date: `2026-10-${26 - all.length + 1 + i}`,
    ...(v === undefined ? {} : { rhr: v }),
    ...(i === all.length - 1 ? today : {}),
  }));
const balanced = [{ date: "2026-10-26", status: "BALANCED" }];
/** Seven days before today at 50 bpm. */
const week50 = [50, 50, 50, 50, 50, 50, 50];

/** The verdict of readinessOf, checked against readiness() of the inputs it picked. */
const verdictOf = (
  hrv: Record<string, unknown>[],
  today: Record<string, unknown>,
  ratio: number | null,
) => {
  const r = readinessOf(hrv, recoveryRows(week50, today), ratio);
  expect(r.verdict).toBe(readiness(r));
  return r.verdict;
};

describe("zones", () => {
  it("reads the default sport of Garmin's zone list", () => {
    const raw = [
      { sport: "RUNNING", maxHeartRateUsed: 190, zone1Floor: 1 },
      {
        sport: "DEFAULT",
        maxHeartRateUsed: 188,
        zone1Floor: 94,
        zone2Floor: 113,
        zone3Floor: 132,
        zone4Floor: 150,
        zone5Floor: 169,
      },
    ];
    expect(zonesOf(raw)).toEqual({ maxHR: 188, floors: [94, 113, 132, 150, 169] });
    expect(zonesOf(undefined)).toEqual({ floors: [] });
  });
});

describe("fitness, fatigue and form", () => {
  it("reaches the daily load when the load stays the same", () => {
    const f = fitnessFatigue(Array.from({ length: 400 }, () => 100));
    expect(f.fitness.at(-1)).toBeCloseTo(100, 1);
    expect(f.fatigue.at(-1)).toBeCloseTo(100, 1);
    expect(f.form.at(-1)).toBeCloseTo(0, 1);
  });

  it("starts at 0 and moves 1/42 and 1/7 of the way to each day's load", () => {
    const f = fitnessFatigue([42, 0]);
    expect(f.fitness[0]).toBeCloseTo(1, 6);
    expect(f.fatigue[0]).toBeCloseTo(6, 6);
    // form is the fitness minus the fatigue of the day before
    expect(f.form).toEqual([0, 1 - 6]);
  });

  it("drops fatigue faster than fitness on rest days, so form rises", () => {
    const f = fitnessFatigue([
      ...Array.from({ length: 60 }, () => 100),
      ...Array.from({ length: 10 }, () => 0),
    ]);
    expect(f.form[59]).toBeLessThan(0);
    expect(f.form.at(-1)).toBeGreaterThan(0);
  });
});

describe("load", () => {
  it("uses Garmin's training load, else an estimate from minutes and heart rate", () => {
    expect(loadOf(act("2026-10-01", { trainingLoad: 80 }), 190)).toEqual({
      value: 80,
      estimate: false,
    });
    // 30 min x 152 / 190 = 24
    expect(loadOf(act("2026-10-01", { avgHR: 152 }), 190)).toEqual({ value: 24, estimate: true });
    expect(loadOf(act("2026-10-01"), 190)).toBeUndefined();
    expect(loadOf(act("2026-10-01", { avgHR: 152 }), undefined)).toBeUndefined();
  });

  it("sums the load of each day, with 0 for a rest day", () => {
    const acts = [
      act("2026-10-01", { trainingLoad: 50 }),
      act("2026-10-01", { trainingLoad: 20 }),
      act("2026-10-03", { trainingLoad: 40 }),
    ];
    expect(dailyLoads(acts, "2026-10-01", "2026-10-03")).toEqual([70, 0, 40]);
  });

  it("gives the 7-day load against the weekly average of 28 days", () => {
    const acts = [
      act("2026-10-26", { trainingLoad: 100 }),
      act("2026-10-01", { trainingLoad: 100 }),
    ];
    // acute 100; chronic (100 + 100) / 4 = 50
    expect(loadRatio(acts, "2026-10-26")).toEqual({ acute: 100, chronic: 50, ratio: 2 });
    expect(loadRatio([], "2026-10-26").ratio).toBeNull();
  });

  it("has no chronic load or ratio when the data starts inside the 28 days", () => {
    const acts = [act("2026-10-26", { trainingLoad: 100 })];
    // the 28 days that end on 26 Oct start on 29 Sep
    expect(loadRatio(acts, "2026-10-26", undefined, "2026-09-30")).toEqual({
      acute: 100,
      chronic: null,
      ratio: null,
    });
    expect(loadRatio(acts, "2026-10-26", undefined, "2026-09-29")).toEqual({
      acute: 100,
      chronic: 25,
      ratio: 4,
    });
  });

  it("gives the change of each week against the week before", () => {
    expect(ramp([100, 110, 0, 50])).toEqual([null, 10, -100, null]);
  });

  it.each([
    ["a gap and the value after it", [100, null, 50], [null, null, null]],
    ["a gap first", [null, 100, 110], [null, null, 10]],
    ["the rise before a gap", [100, 200, null], [null, 100, null]],
    ["only gaps", [null, null], [null, null]],
    ["no values", [], []],
  ])("gives no ramp for %s", (_name, values, expected) => {
    expect(ramp(values)).toEqual(expected);
  });

  it("gives monotony and strain of a week (Foster)", () => {
    const m = monotony([10, 10, 10, 10, 10, 10, 10]);
    // no variation: monotony has no value
    expect(m).toMatchObject({ weekLoad: 70, monotony: null, strain: null });
    const v = monotony([60, 0, 60, 0, 60, 0, 60]);
    expect(v.weekLoad).toBe(240);
    expect(v.monotony).toBeCloseTo(34.2857 / 29.6923, 3);
    expect(v.strain).toBeCloseTo(240 * v.monotony!, 6);
  });
});

/** The Mondays of the load safety fixture: 2026-10-05 to 2026-10-26. */
const SAFETY_WEEKS = ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"];
/** 100, 110 (+10%), 132 (+20%) and 50 in the last week. */
const SAFETY_ACTS = [
  act("2026-10-06", { trainingLoad: 100 }),
  act("2026-10-13", { trainingLoad: 110 }),
  act("2026-10-20", { trainingLoad: 66 }),
  act("2026-10-22", { trainingLoad: 66 }),
  act("2026-10-27", { trainingLoad: 50 }),
];

describe("load safety", () => {
  it("flags a ramp above 10%, and gives no ramp to the week in progress", () => {
    // 2026-10-28 is a Wednesday of the last week
    const s = loadSafety(SAFETY_ACTS, SAFETY_WEEKS, "2026-10-28");
    expect(s.load).toEqual([100, 110, 132, 50]);
    expect(s.ramp).toEqual([null, 10, 20, null]);
    expect(s.flagged).toEqual([false, false, true, false]);
  });

  it.each([
    ["on the Sunday that closes the last week", "2026-11-01"],
    ["after the last week", "2026-11-04"],
  ])("keeps the ramp of the last week when the window ends %s", (_name, end) => {
    expect(loadSafety(SAFETY_ACTS, SAFETY_WEEKS, end).ramp.at(-1)).toBeCloseTo(-62.12, 2);
  });

  it("gives monotony and strain of the 7 days that end on the last day", () => {
    const s = loadSafety(SAFETY_ACTS, SAFETY_WEEKS, "2026-10-28");
    // 2026-10-22 to 2026-10-28: 66 on the first day, 50 on the sixth
    expect(s).toMatchObject({
      ...monotony([66, 0, 0, 0, 0, 50, 0]),
      weekLoad: 116,
      unknown: false,
    });
  });

  it("gives an unknown week when no session of the 7 days has a load", () => {
    const acts = [act("2026-10-06", { trainingLoad: 100 }), act("2026-10-27")];
    expect(loadSafety(acts, SAFETY_WEEKS, "2026-10-28").unknown).toBe(true);
    // a rest week is a true 0, not unknown
    expect(loadSafety(acts.slice(0, 1), SAFETY_WEEKS, "2026-10-28").unknown).toBe(false);
  });

  it("estimates a load from HR with a max HR", () => {
    const acts = [act("2026-10-27", { avgHR: 150 })];
    // 30 minutes x 150 / 180
    expect(loadSafety(acts, SAFETY_WEEKS, "2026-10-28", 180)).toMatchObject({
      load: [0, 0, 0, 25],
      weekLoad: 25,
      unknown: false,
    });
  });
});

describe("statistics", () => {
  it("gives mean, standard deviation and a rolling mean", () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(mean([])).toBeNull();
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
    expect(rolling([1, null, 3, 5], 2)).toEqual([1, 1, 3, 4]);
  });

  it("gives the change in % and its colour", () => {
    expect(change(110, 100)).toBe(10);
    expect(change(5, 0)).toBeNull();
    expect(changeClass(10, true)).toBe("good");
    expect(changeClass(10, false)).toBe("bad");
    expect(changeClass(0, true)).toBe("same");
    expect(changeClass(null, true)).toBe("same");
  });

  it("sums a value per week", () => {
    const acts = [
      act("2026-10-05", { km: 5 }),
      act("2026-10-11", { km: 3 }),
      act("2026-10-12", { km: 7 }),
    ];
    expect(weekly(acts, ["2026-10-05", "2026-10-12"], (a) => a.km as number)).toEqual([8, 7]);
    // an activity without a start and one after the last week count nowhere
    const more = [...acts, { id: 9, type: "running", km: 9 }, act("2026-10-19", { km: 4 })];
    expect(weekly(more, ["2026-10-05", "2026-10-12"], (a) => a.km as number)).toEqual([8, 7]);
  });

  describe("weeklyMeans", () => {
    const weeks = ["2026-10-19", "2026-10-26"];

    it("puts a Monday and a Sunday in the same week, and the days around them in the next and the last", () => {
      const rows = [
        sleep("2026-10-18", 1),
        sleep("2026-10-19", 7),
        sleep("2026-10-25", 8),
        sleep("2026-10-26", 4),
      ];
      expect(weeklyMeans(rows, weeks, "sleepH")).toEqual([7.5, 4]);
    });

    it("rounds the mean to one decimal", () => {
      expect(
        weeklyMeans([sleep("2026-10-19", 7), sleep("2026-10-20", 7.5)], weeks, "sleepH")[0],
      ).toBe(7.3);
      expect(weeklyMeans([sleep("2026-10-19", 8)], weeks, "sleepH")[0]).toBe(8);
    });

    it("counts only the values above 0", () => {
      const rows = [
        sleep("2026-10-19", 8),
        sleep("2026-10-20", 0),
        sleep("2026-10-21", null),
        sleep("2026-10-22", "7"),
        sleep("2026-10-23", Number.NaN),
        sleep("2026-10-24", -1),
        { date: "2026-10-25" },
      ];
      expect(weeklyMeans(rows, weeks, "sleepH")).toEqual([8, null]);
    });

    it("gives null for a week with only values that do not count", () => {
      const rows = [sleep("2026-10-19", 0), sleep("2026-10-20", -2), sleep("2026-10-21", null)];
      expect(weeklyMeans(rows, weeks, "sleepH")).toEqual([null, null]);
    });

    it("handles no weeks and no rows", () => {
      expect(weeklyMeans([sleep("2026-10-19", 8)], [], "sleepH")).toEqual([]);
      expect(weeklyMeans([], weeks, "sleepH")).toEqual([null, null]);
    });

    it("leaves out a row without a date or with a date that is not text", () => {
      const rows = [{ sleepH: 9 }, sleep(20261020, 9), sleep(null, 9), sleep("2026-10-20", 6)];
      expect(weeklyMeans(rows, weeks, "sleepH")).toEqual([6, null]);
    });
  });

  describe("weeklyKnown", () => {
    const weeks = ["2026-10-05", "2026-10-12", "2026-10-19"];

    it("sums the sessions of a week that have a value", () => {
      const acts = [act("2026-10-05", { km: 5 }), act("2026-10-06", { km: 3 })];
      expect(weeklyKnown(acts, weeks, km)[0]).toBe(8);
    });

    it("keeps the value of the one session that has it", () => {
      const acts = [act("2026-10-05", { km: 5 }), act("2026-10-06")];
      expect(weeklyKnown(acts, weeks, km)[0]).toBe(5);
    });

    it("gives null for a week of sessions without a value, and 0 for a week without sessions", () => {
      const acts = [act("2026-10-05"), act("2026-10-06"), act("2026-10-19", { km: 2 })];
      expect(weeklyKnown(acts, weeks, km)).toEqual([null, 0, 2]);
    });

    it("keeps a real 0", () => {
      expect(weeklyKnown([act("2026-10-05", { km: 0 })], weeks, km)[0]).toBe(0);
    });

    it("ignores an activity without a start and one after the last week", () => {
      const acts = [act("2026-10-05", { km: 5 }), { id: 9, type: "running" }, act("2026-10-26")];
      expect(weeklyKnown(acts, weeks, km)).toEqual([5, 0, 0]);
    });

    it("gives 0 for every week without activities", () => {
      expect(weeklyKnown([], weeks, km)).toEqual([0, 0, 0]);
    });
  });
});

describe("estimates", () => {
  it("estimates 1RM with Epley for 1 to 12 reps only", () => {
    expect(epley(100, 1)).toBeCloseTo(103.333, 3);
    expect(epley(70, 6)).toBe(84);
    expect(epley(50, 13)).toBeUndefined();
    expect(epley(50, 0)).toBeUndefined();
  });

  it("predicts a race time with Riegel", () => {
    // 5 km in 25:00 -> 10 km in 1500 x 2^1.06
    expect(riegel(1500, 5, 10)).toBeCloseTo(1500 * 2 ** 1.06, 6);
  });

  it("counts vigorous minutes twice", () => {
    expect(intensityMinutes({ moderateMinutes: 20, vigorousMinutes: 10 })).toBe(40);
    expect(intensityMinutes({})).toBe(0);
  });

  it("gives the spread of bedtimes across midnight", () => {
    // 23:30, 00:30 -> 1410 and 1470 (00:30 counts as 24:30); spread 30 min
    expect(bedtimeSpread([1410, 30])).toBe(30);
    expect(bedtimeSpread([])).toBeNull();
  });
});

describe("readiness", () => {
  const ok = { hrvStatus: "BALANCED", sleepScore: 85, rhr: 50, rhrAvg: 50, ratio: 1 };

  it("says go easy on low HRV, poor sleep or a high resting HR", () => {
    expect(readiness({ ...ok, hrvStatus: "LOW" })).toBe("easy");
    expect(readiness({ ...ok, sleepScore: 55 })).toBe("easy");
    expect(readiness({ ...ok, rhr: 55 })).toBe("easy");
  });

  it("says ready to push on balanced HRV, good sleep and a load ratio under 1.3", () => {
    expect(readiness(ok)).toBe("push");
    expect(readiness({ ...ok, ratio: 1.4 })).toBe("normal");
    expect(readiness({ ...ok, sleepScore: 70 })).toBe("normal");
  });

  it("has no verdict without its inputs", () => {
    expect(readiness({})).toBeNull();
  });
});

describe("readiness inputs", () => {
  it("picks today's inputs as the page does and gives the verdict of readiness()", () => {
    const good = { sleepScore: 85, rhr: 50 };
    expect(verdictOf([{ date: "2026-10-26", status: "LOW" }], good, 1)).toBe("easy");
    expect(verdictOf(balanced, { ...good, sleepScore: 59 }, 1)).toBe("easy");
    expect(verdictOf(balanced, { ...good, sleepScore: 60 }, 1)).toBe("normal");
    // the resting HR 5 bpm or more above the 7-day average
    expect(verdictOf(balanced, { ...good, rhr: 55 }, 1)).toBe("easy");
    expect(verdictOf(balanced, { ...good, rhr: 54.9 }, 1)).toBe("push");
    expect(verdictOf(balanced, { ...good, sleepScore: 80 }, 1.296)).toBe("push");
    expect(verdictOf(balanced, { ...good, sleepScore: 80 }, 1.3)).toBe("normal");
    expect(verdictOf(balanced, { ...good, sleepScore: 80 }, 0.8)).toBe("push");
    expect(verdictOf(balanced, { ...good, sleepScore: 80 }, null)).toBe("normal");
    expect(verdictOf(balanced, { ...good, sleepScore: 79 }, 1)).toBe("normal");
  });

  it("returns each input with the date of its row", () => {
    expect(readinessOf(balanced, recoveryRows(week50, { sleepScore: 85, rhr: 52 }), 0.94)).toEqual({
      verdict: "push",
      hrvStatus: "BALANCED",
      hrvDate: "2026-10-26",
      sleepScore: 85,
      rhr: 52,
      rhrAvg: 50,
      recoveryDate: "2026-10-26",
      ratio: 0.94,
    });
  });

  it("has no verdict and no inputs without HRV and recovery rows", () => {
    const r = readinessOf([], [], 1);
    expect(r.verdict).toBeNull();
    expect(r.hrvStatus).toBeUndefined();
    expect(r.sleepScore).toBeUndefined();
    expect(r.rhr).toBeUndefined();
    expect(r.rhrAvg).toBeUndefined();
    expect(r.hrvDate).toBeUndefined();
    expect(r.recoveryDate).toBeUndefined();
  });

  it("reads a value of the wrong type as missing", () => {
    const hrv = [{ date: 20_261_026, status: 3 }];
    const recovery = [{ date: 20_261_026, sleepScore: "85", rhr: Number.NaN }];
    expect(readinessOf(hrv, recovery, 1)).toEqual({ verdict: null, ratio: 1 });
  });

  it("takes the last HRV row and the last recovery row, also from an older night", () => {
    const hrv = [
      { date: "2026-10-23", status: "LOW" },
      { date: "2026-10-24", status: "BALANCED" },
    ];
    // no row for today: the last row is yesterday's, as on the page
    const recovery = recoveryRows(week50, { sleepScore: 85, rhr: 50 }).slice(0, -1);
    const r = readinessOf(hrv, recovery, 1);
    expect(r).toMatchObject({ hrvStatus: "BALANCED", hrvDate: "2026-10-24" });
    expect(r.recoveryDate).toBe("2026-10-25");
    expect(r.sleepScore).toBeUndefined();
    expect(r.rhr).toBe(50);
  });

  it("averages the resting HR of the 7 rows before the last, without the missing ones", () => {
    // the first of 9 rows is out of the 7 days; the second is in them
    const r = readinessOf(balanced, recoveryRows([100, 64, 50, 50, 50, 50, 50, 50]), 1);
    expect(r.rhrAvg).toBe(52);
    const three = readinessOf(balanced, recoveryRows([54, undefined, 50, 52]), 1);
    expect(three.rhrAvg).toBe(52);
    // 2 values are no average: one bad night would turn the verdict to "easy"
    const few = readinessOf(balanced, recoveryRows([40, 40], { rhr: 60 }), 1);
    expect(few.rhrAvg).toBeUndefined();
    expect(few.verdict).toBe("normal");
    expect(readinessOf(balanced, recoveryRows([undefined, undefined]), 1).rhrAvg).toBeUndefined();
    expect(readinessOf(balanced, recoveryRows([]), 1).rhrAvg).toBeUndefined();
  });
});

describe("fitness, fatigue and form of a window", () => {
  it("has no values when no activity has a load", () => {
    expect(fitnessFatigueFrom([act("2026-10-01")], "2026-10-01", "2026-10-03", 190)).toBeNull();
    expect(fitnessFatigueFrom([], "2026-10-01", "2026-10-03", 190)).toBeNull();
  });

  it("warms the averages up from the first activity before the window", () => {
    const acts = [act("2026-09-01", { trainingLoad: 100 }), act("2026-10-02", { avgHR: 152 })];
    const f = fitnessFatigueFrom(acts, "2026-10-01", "2026-10-03", 190)!;
    const all = fitnessFatigue(dailyLoads(acts, "2026-09-01", "2026-10-03", 190));
    expect(f.fitness).toEqual(all.fitness.slice(-3));
    expect(f.fatigue).toEqual(all.fatigue.slice(-3));
    expect(f.form).toEqual(all.form.slice(-3));
    expect(f.fitness[0]).toBeGreaterThan(0);
    // 30 days of warm-up: less than the 42 days of fitness
    expect(f.warmupDays).toBe(30);
  });

  it("starts at 0 on the first day when no activity is before the window", () => {
    const f = fitnessFatigueFrom(
      [act("2026-10-02", { trainingLoad: 42 })],
      "2026-10-01",
      "2026-10-03",
    )!;
    expect(f.fitness).toEqual([0, 1, 1 - 1 / 42]);
    expect(f.form[0]).toBe(0);
    expect(f.warmupDays).toBe(0);
  });
});

describe("period comparison", () => {
  const w = periodWindow;
  it.each([
    [
      "whole past weeks",
      "2026-10-05",
      "2026-10-25",
      "2026-05-04",
      "2026-09-14",
      "2026-10-04",
      false,
    ],
    [
      "the fixture period, 85 days each",
      "2026-08-03",
      "2026-10-26",
      "2026-05-04",
      "2026-05-10",
      "2026-08-02",
      false,
    ],
    [
      "a one-week window on a Monday",
      "2026-10-26",
      "2026-10-26",
      "2026-05-04",
      "2026-10-25",
      "2026-10-25",
      false,
    ],
    [
      "a one-week window on a Sunday",
      "2026-10-19",
      "2026-10-25",
      "2026-05-04",
      "2026-10-12",
      "2026-10-18",
      false,
    ],
    [
      "days that start before the data",
      "2026-05-11",
      "2026-05-24",
      "2026-05-04",
      "2026-04-27",
      "2026-05-10",
      true,
    ],
    [
      "a first day equal to the data start",
      "2026-05-11",
      "2026-05-17",
      "2026-05-04",
      "2026-05-04",
      "2026-05-10",
      false,
    ],
    ["no data start", "2026-05-11", "2026-05-24", undefined, "2026-04-27", "2026-05-10", false],
    [
      "a daylight-saving change",
      "2026-03-30",
      "2026-04-05",
      undefined,
      "2026-03-23",
      "2026-03-29",
      false,
    ],
  ])("compares equal days: %s", (_name, from, end, dataStart, pfrom, pto, partial) => {
    expect(w(from, end, dataStart)).toEqual({ from: pfrom, to: pto, partial });
  });
});
