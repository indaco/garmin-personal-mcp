import { describe, expect, it } from "vitest";
import {
  bedtimeSpread,
  change,
  changeClass,
  dailyLoads,
  epley,
  fitnessFatigue,
  intensityMinutes,
  loadOf,
  loadRatio,
  mean,
  monotony,
  periodWindow,
  ramp,
  readiness,
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
