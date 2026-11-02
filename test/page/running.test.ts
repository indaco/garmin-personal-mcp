import { describe, expect, it } from "vitest";
import {
  efficiency,
  paceSeconds,
  predictRaces,
  racePredictionsOf,
  splitOf,
  workOf,
  workoutMetrics,
  workoutOf,
  workoutSessions,
  zoneOf,
  zoneSeconds,
} from "../../src/page/running";

const floors = [94, 113, 132, 150, 169];

describe("pace and efficiency", () => {
  it("reads the pace, or works it out from distance and moving time", () => {
    expect(paceSeconds({ pace: "5:07/km" })).toBe(307);
    expect(paceSeconds({ km: 10, duration: "50:00" })).toBe(300);
    expect(paceSeconds({ duration: "50:00" })).toBeUndefined();
  });

  it("gives metres per heartbeat", () => {
    // 10 km in 50 min = 200 m/min, at 160 bpm
    expect(efficiency({ km: 10, duration: "50:00", avgHR: 160 })).toBe(1.25);
    expect(efficiency({ km: 10, duration: "50:00" })).toBeUndefined();
  });
});

describe("HR zones", () => {
  it("finds the zone of a heart rate", () => {
    expect(zoneOf(90, floors)).toBe(0);
    expect(zoneOf(94, floors)).toBe(0);
    expect(zoneOf(140, floors)).toBe(2);
    expect(zoneOf(180, floors)).toBe(4);
  });

  it("uses the zone seconds of the activity", () => {
    expect(zoneSeconds({ hrZonesSec: [1, 2, 3, 4, 5] }, floors)).toEqual({
      sec: [1, 2, 3, 4, 5],
      approximate: false,
    });
  });

  it("puts all minutes in the zone of the average HR when the activity has no zone seconds", () => {
    expect(zoneSeconds({ duration: "10:00", avgHR: 140 }, floors)).toEqual({
      sec: [0, 0, 600, 0, 0],
      approximate: true,
    });
    expect(zoneSeconds({ duration: "10:00" }, floors)).toBeUndefined();
  });
});

const lap = (km: number, time: string) => ({ km, time });
const hr = (km: number, time: string, avgHR: number) => ({ km, time, avgHR });

describe("pace split", () => {
  it("compares the pace of the first and the second half", () => {
    const negative = splitOf([lap(1, "5:10"), lap(1, "5:10"), lap(1, "5:00"), lap(1, "4:50")]);
    expect(negative).toEqual({ first: 310, second: 295, kind: "negative" });
    expect(splitOf([lap(1, "5:00"), lap(1, "5:01")])?.kind).toBe("even");
    expect(splitOf([lap(1, "5:00"), lap(1, "5:20")])?.kind).toBe("positive");
  });

  it("gives the HR drift: the drop of pace per heartbeat from the first to the second half", () => {
    // same pace, HR 150 then 159: efficiency drops by 1 - 150/159 = 5.66 %
    const s = splitOf([
      hr(1, "5:00", 150),
      hr(1, "5:00", 150),
      hr(1, "5:00", 159),
      hr(1, "5:00", 159),
    ]);
    expect(s?.drift).toBeCloseTo((1 - 150 / 159) * 100, 6);
    // a lap across the middle counts for its share of time on each side
    const across = splitOf([hr(1, "5:00", 150), hr(1, "5:00", 160), hr(1, "5:00", 160)]);
    expect(across?.drift).toBeCloseTo((1 - (150 * 2 + 160) / 3 / 160) * 100, 6);
  });

  it("has no drift when a lap has no HR", () => {
    expect(splitOf([hr(1, "5:00", 150), lap(1, "5:00")])?.drift).toBeUndefined();
  });

  it("leaves out the warm-up and the cool-down of a structured long run", () => {
    const s = splitOf([
      { km: 1, time: "9:00", intensity: "warmup" },
      { km: 1, time: "5:00", intensity: "active" },
      { km: 1, time: "5:00", intensity: "active" },
      { km: 0.5, time: "4:00", intensity: "cooldown" },
    ]);
    expect(s).toEqual({ first: 300, second: 300, kind: "even" });
  });

  it("leaves out a lap without distance", () => {
    expect(splitOf([{ time: "5:00" }, lap(1, "5:00"), lap(1, "5:20")])?.first).toBe(300);
  });

  it("takes the distance of a lap from its time and pace, not the rounded km", () => {
    // the watch rounds the first lap up to 1.01 km: time / pace gives 1 km, as for the second lap
    const s = splitOf([
      { km: 1.01, time: "5:00", pace: "5:00/km" },
      { km: 1, time: "4:50", pace: "4:50/km" },
    ]);
    expect(s).toMatchObject({ first: 300, second: 290, kind: "negative" });
    // a lap with a pace and no km counts; a lap with neither a pace nor km does not
    const noKm = splitOf([{ time: "10:00", pace: "5:00/km" }, lap(2, "10:00"), { time: "9:00" }]);
    expect(noKm).toEqual({ first: 300, second: 300, kind: "even" });
  });

  it("uses the rounded km of a lap without a pace", () => {
    const s = splitOf([lap(1.01, "5:00"), lap(1, "5:00")]);
    expect(s?.first).toBe(300 / 1.01);
    expect(s?.kind).toBe("even");
    // a lap with km and a pace of 0 also keeps its km
    expect(splitOf([{ ...lap(1.01, "5:00"), pace: "0:00/km" }, lap(1, "5:00")])?.first).toBe(
      300 / 1.01,
    );
  });

  it("has no split without two laps of distance", () => {
    expect(splitOf([lap(1, "5:00")])).toBeUndefined();
    expect(splitOf([])).toBeUndefined();
  });
});

const step = (intensity: string, km: number, time: string, avgHR?: number) => ({
  km,
  time,
  intensity,
  ...(avgHR === undefined ? {} : { avgHR, cadenceSpm: 180, avgPowerW: 300 }),
});

/** A rep of 100 m of one step of the planned workout. */
const stepRep = (index: number, time: string) => ({ ...step("active", 0.1, time), step: index });

describe("work laps of a structured workout", () => {
  const intervals = [
    step("warmup", 2, "12:00", 130),
    step("interval", 1, "4:00", 170),
    step("rest", 0.2, "2:00", 140),
    step("interval", 1, "4:12", 174),
    step("cooldown", 1, "6:00", 135),
  ];

  it("keeps the active and interval laps when the laps also mark a warm-up, rest or cool-down", () => {
    const w = workOf(intervals);
    expect(w?.reps).toBe(2);
    expect(w?.pace).toBe(246);
    // time-weighted: 240 s at 170, 252 s at 174
    expect(w?.hr).toBeCloseTo((240 * 170 + 252 * 174) / 492, 6);
    expect(w?.cadence).toBe(180);
    expect(w?.power).toBe(300);
    // the last rep is 5% slower than the first
    expect(w?.fade).toBeCloseTo(5, 6);
  });

  it("leaves out a work lap under 20 m: the watch adds one between the steps of a workout", () => {
    const w = workOf([
      step("warmup", 1, "6:00", 130),
      step("active", 0.01, "0:04", 120),
      step("active", 0.1, "0:30", 160),
      step("recovery", 0.06, "0:30", 140),
      step("active", 0.1, "0:27", 165),
    ]);
    expect(w?.reps).toBe(2);
    expect(w?.pace).toBe(285);
    expect(w?.fade).toBeCloseTo(-10, 6);
  });

  it("leaves out a work lap under 8 s: its rounded 20 m can be a lap between steps", () => {
    const w = workOf([
      step("warmup", 1, "6:00", 130),
      step("active", 0.02, "0:05", 120),
      step("active", 0.1, "0:30", 160),
      step("recovery", 0.06, "0:30", 140),
      step("active", 0.1, "0:30", 160),
    ]);
    expect(w?.reps).toBe(2);
  });

  it("gives the fade within one workout step: the step with the most reps", () => {
    const rep = (index: number, pace: string) => ({
      ...step("active", 0.1, "0:30"),
      pace,
      step: index,
    });
    const w = workOf([
      step("warmup", 1, "6:00"),
      // 3 cadence drills (step 2), then 4 glider drills (step 6), all 30 s
      rep(2, "4:30/km"),
      rep(2, "4:40/km"),
      rep(2, "4:50/km"),
      rep(6, "5:00/km"),
      rep(6, "5:05/km"),
      rep(6, "5:10/km"),
      rep(6, "5:20/km"),
    ]);
    expect(w?.reps).toBe(7);
    // the glider: 5:20 against 5:00, not against the first cadence drill
    expect(w?.fade).toBeCloseTo(((320 - 300) / 300) * 100, 6);
  });

  it("gives the fade of each workout step with more than one rep, in the order of the steps", () => {
    const w = workOf([
      step("warmup", 1, "6:00"),
      stepRep(2, "0:30"),
      stepRep(2, "0:31"),
      // the watch adds a lap of a few metres between steps: not a rep
      { ...step("active", 0.01, "0:04"), step: 3 },
      stepRep(2, "0:32"),
      stepRep(4, "0:40"),
      stepRep(6, "0:30"),
      stepRep(6, "0:33"),
    ]);
    expect(w?.reps).toBe(6);
    expect(w?.fades).toHaveLength(2);
    expect(w?.fades[0]).toEqual({
      step: 2,
      reps: 3,
      first: 300,
      last: 320,
      pct: expect.closeTo(((320 - 300) / 300) * 100, 6),
    });
    expect(w?.fades[1]).toEqual({
      step: 6,
      reps: 2,
      first: 300,
      last: 330,
      pct: expect.closeTo(10, 6),
    });
    // the page keeps one fade: the step with the most reps
    expect(w?.fade).toBeCloseTo(((320 - 300) / 300) * 100, 6);
  });

  it("gives one fade without a step when the laps have no step", () => {
    const w = workOf(intervals);
    expect(w?.fades).toEqual([{ reps: 2, first: 240, last: 252, pct: expect.closeTo(5, 6) }]);
    expect(w?.fades[0]).not.toHaveProperty("step");
  });

  it("gives no fade for a step with one rep", () => {
    const w = workOf([step("warmup", 1, "6:00"), stepRep(2, "0:30"), stepRep(4, "0:31")]);
    expect(w?.reps).toBe(2);
    expect(w?.fades).toEqual([]);
  });

  it("gives no fade percentage for reps more than 15% apart, and one at 15%", () => {
    // 15% longer: alike by distance (and by time)
    const at = workOf([
      step("warmup", 1, "6:00"),
      step("active", 1, "5:00"),
      step("active", 1.15, "5:45"),
    ]);
    expect(at?.fades).toEqual([{ reps: 2, first: 300, last: 300, pct: 0 }]);
    // 16% longer in distance and in time: not alike, the entry stays without a percentage
    const over = workOf([
      step("warmup", 1, "6:00"),
      step("active", 1, "5:00"),
      step("active", 1.16, "5:48"),
    ]);
    expect(over?.fades).toEqual([{ reps: 2, first: 300, last: 300 }]);
    // alike by time only (both 5:00, 16% longer): the percentage stays
    const byTime = workOf([
      step("warmup", 1, "6:00"),
      step("active", 1, "5:00"),
      step("active", 1.16, "5:00"),
    ]);
    expect(byTime?.fades[0].pct).toBeCloseTo(((300 / 1.16 - 300) / 300) * 100, 6);
    // alike by distance only (1 km each, 25% slower): the percentage stays
    const byKm = workOf([
      step("warmup", 1, "6:00"),
      step("active", 1, "4:00"),
      step("active", 1, "5:00"),
    ]);
    expect(byKm?.fades[0].pct).toBeCloseTo(25, 6);
  });

  it("takes the pace of a lap from the watch: its distance is rounded to 10 m", () => {
    // 30 s strides of about 100 m: by the rounded distance both are 5:00/km
    const w = workOf([
      step("warmup", 1, "6:00"),
      { ...step("active", 0.1, "0:30"), pace: "4:52/km" },
      { ...step("active", 0.1, "0:30"), pace: "5:04/km" },
    ]);
    expect(w?.fade).toBeCloseTo(((304 - 292) / 292) * 100, 6);
    // the time over the distances that the paces give
    expect(w?.pace).toBeCloseTo(60 / (30 / 292 + 30 / 304), 6);
  });

  it("gives the fade of reps of the same time, but not of reps of different lengths", () => {
    // 30 s strides: the same time, other distances
    expect(
      workOf([step("warmup", 1, "6:00"), step("active", 0.1, "0:30"), step("active", 0.11, "0:30")])
        ?.fade,
    ).toBeCloseTo(((30 / 0.11 - 300) / 300) * 100, 6);
    // 1 km reps, then shorter ones: no fade
    const mixed = workOf([
      step("warmup", 1, "6:00"),
      step("active", 1, "5:27"),
      step("active", 1, "5:12"),
      step("active", 0.81, "3:43"),
    ]);
    expect(mixed?.reps).toBe(3);
    expect(mixed?.fade).toBeUndefined();
  });

  it("has no work part for a steady run of auto laps", () => {
    expect(
      workOf([step("active", 1, "5:00", 150), step("active", 1, "5:00", 150)]),
    ).toBeUndefined();
    expect(workOf([lap(1, "5:00"), lap(1, "5:00")])).toBeUndefined();
    // a free run: the watch marks its auto laps "interval"
    expect(
      workOf([step("interval", 1, "5:00", 150), step("interval", 0.86, "4:20", 152)]),
    ).toBeUndefined();
  });

  it("has no work part when the marked laps have no work lap with distance", () => {
    expect(
      workOf([step("warmup", 1, "6:00", 130), step("cooldown", 1, "6:00", 120)]),
    ).toBeUndefined();
    expect(
      workOf([step("warmup", 1, "6:00", 130), { intensity: "active", time: "5:00" }]),
    ).toBeUndefined();
  });

  it("has no HR when a work lap has none", () => {
    expect(workOf([step("warmup", 1, "6:00", 130), step("active", 1, "5:00")])?.hr).toBeUndefined();
  });
});

describe("workout metrics", () => {
  const run = {
    pace: "5:00/km",
    avgHR: 150,
    cadenceSpm: 170,
    gctMs: 250,
    vertRatioPct: 8,
    strideCm: 110,
    avgPowerW: 250,
  };

  it("takes the whole run for a steady run", () => {
    expect(workoutMetrics(run)).toEqual({
      pace: 300,
      hr: 150,
      efficiency: 60_000 / 300 / 150,
      cadence: 170,
      gct: 250,
      vertRatio: 8,
      stride: 110,
      power: 250,
    });
  });

  it("has no efficiency without HR, and skips a value that is not a number", () => {
    const m = workoutMetrics({ ...run, avgHR: Number.NaN, cadenceSpm: "fast" });
    expect(m.hr).toBeUndefined();
    expect(m.efficiency).toBeUndefined();
    expect(m.cadence).toBeUndefined();
    expect(m.pace).toBe(300);
  });

  it("takes the running form from the work laps when the laps have it", () => {
    const form = (gctMs: number, strideCm: number) => ({
      ...step("active", 1, "4:00", 170),
      gctMs,
      vertRatioPct: 7,
      strideCm,
    });
    const m = workoutMetrics({
      ...run,
      laps: [
        { ...step("warmup", 1, "6:00", 130), gctMs: 290, strideCm: 90 },
        form(240, 130),
        form(250, 120),
      ],
    });
    // the reps, not the warm-up and not the whole run (250 ms, 110 cm)
    expect(m).toMatchObject({ gct: 245, vertRatio: 7, stride: 125 });
  });

  it("takes pace, HR, cadence and power from the work laps of a structured workout", () => {
    const m = workoutMetrics({
      ...run,
      laps: [step("warmup", 1, "6:00", 130), step("active", 2, "8:00", 160)],
    });
    expect(m).toMatchObject({ pace: 240, hr: 160, cadence: 180, power: 300, reps: 1 });
    // laps without running form: no form, rather than the whole run with its warm-up
    expect(m.gct).toBeUndefined();
    expect(m.efficiency).toBeCloseTo(60_000 / 240 / 160, 6);
  });
});

describe("workout name", () => {
  it("leaves out the place that Garmin puts before the workout", () => {
    expect(workoutOf("Riverside - Drill Workout")).toBe("Drill Workout");
    expect(workoutOf("Lakeside Park - Drill Workout")).toBe("Drill Workout");
    // only the first " - " is the place
    expect(workoutOf("Hillview - 5 x 1 km - hills")).toBe("5 x 1 km - hills");
  });

  it("keeps a name without a place", () => {
    expect(workoutOf("Tempo Run")).toBe("Tempo Run");
    expect(workoutOf("Riverside - ")).toBe("Riverside - ");
    expect(workoutOf(" - Intervals")).toBe(" - Intervals");
  });
});

describe("workout sessions", () => {
  const reps = [step("warmup", 1, "6:00", 130), step("interval", 1, "4:00", 170)];
  const whole = { pace: "5:20/km", avgHR: 150 };

  it("compares only the sessions with work laps when a session has them: reps with reps", () => {
    const w = workoutSessions([whole, { ...whole, laps: reps }, { ...whole, laps: reps }]);
    expect(w.sessions.map((s) => s.m.pace)).toEqual([240, 240]);
    expect(w.left).toBe(1);
  });

  it("compares every session of a steady workout as whole runs", () => {
    const auto = [step("active", 1, "5:20", 150)];
    const w = workoutSessions([whole, { ...whole, laps: auto }]);
    expect(w.sessions.map((s) => s.m.pace)).toEqual([320, 320]);
    expect(w.left).toBe(0);
  });
});

describe("race predictor", () => {
  it("uses the best effort of 5 km or more that predicts the fastest times", () => {
    const p = predictRaces({ "1k": 200, "5k": 1500, "10k": 3200 });
    // 5 km in 25:00 predicts 10 km in 52:07, faster than the 53:20 10 km: it uses the 5 km
    expect(p?.from).toEqual({ distance: "5k", seconds: 1500 });
    expect(p?.times["10k"]).toBeCloseTo(1500 * 2 ** 1.06, 6);
    expect(p?.times.marathon).toBeCloseTo(1500 * (42.195 / 5) ** 1.06, 6);
  });

  it("has no prediction from efforts under 5 km", () => {
    expect(predictRaces({ "1k": 200, mile: 330 })).toBeUndefined();
  });

  it("gives a prediction from each effort of 5 km or more, fastest first", () => {
    const best = { "1k": 200, "5k": 1200, "10k": 2600, half: 5600 };
    const all = racePredictionsOf(best);
    // 10 km from 5k: 2502 s, from half: 2538 s, from 10k: 2600 s
    expect(all.map((o) => o.from.distance)).toEqual(["5k", "half", "10k"]);
    expect(all.map((o) => o.times["10k"])).toEqual(
      all.map((o) => o.times["10k"]).toSorted((a, b) => a - b),
    );
    expect(predictRaces(best)).toEqual(all[0]);
    expect(racePredictionsOf({})).toEqual([]);
    expect(racePredictionsOf({ mile: 400 })).toEqual([]);
  });
});
