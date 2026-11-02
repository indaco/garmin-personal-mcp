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
  zonesOf,
} from "../../src/page/metrics";

const act = (start: string, extra: Record<string, unknown> = {}) => ({
  type: "running",
  start: `${start} 07:00:00`,
  duration: "30:00",
  ...extra,
});

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
    const few = readinessOf(balanced, recoveryRows([54, undefined, 50]), 1);
    expect(few.rhrAvg).toBe(52);
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
  it("compares the window with the same number of weeks before it", () => {
    expect(periodWindow("2026-10-05", "2026-10-19", "2026-05-04")).toEqual({
      from: "2026-09-14",
      to: "2026-10-04",
      partial: false,
    });
    expect(periodWindow("2026-05-11", "2026-05-18", "2026-05-04")).toEqual({
      from: "2026-04-27",
      to: "2026-05-10",
      partial: true,
    });
  });
});
