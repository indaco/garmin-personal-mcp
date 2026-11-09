import { describe, expect, it } from "vitest";
import {
  aerobicTrend,
  bestProgression,
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
} from "../../src/analytics/running";

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

/** A run at 5:00/km: 200 m a minute, so the efficiency is 200 / avgHR. */
const easy = (day: string, avgHR?: number) => ({
  type: "running",
  start: `${day} 07:00:00`,
  pace: "5:00/km",
  ...(avgHR === undefined ? {} : { avgHR }),
});
const EIGHT_WEEKS = [
  "2026-08-31",
  "2026-09-07",
  "2026-09-14",
  "2026-09-21",
  "2026-09-28",
  "2026-10-05",
  "2026-10-12",
  "2026-10-19",
];
const BLOCK = [
  easy("2026-08-20", 125), // before the window
  easy("2026-09-01", 125), // 1.6
  easy("2026-09-02", 160), // zone 4: not aerobic
  easy("2026-09-03"), // no HR, no efficiency
  easy("2026-09-08", 125),
  easy("2026-09-15", 125),
  easy("2026-09-29", 100), // 2.0
  easy("2026-10-06", 100),
  easy("2026-10-20", 100),
];

describe("aerobic efficiency trend", () => {
  it("compares the runs below zone 4 of the last 4 weeks with the first 4", () => {
    const t = aerobicTrend(BLOCK, EIGHT_WEEKS, 150);
    expect(t).toEqual({
      weekly: [1.6, 1.6, 1.6, null, 2, 2, null, 2],
      runs: [BLOCK[1], BLOCK[4], BLOCK[5], BLOCK[6], BLOCK[7], BLOCK[8]],
      n: 4,
      first: expect.closeTo(1.6, 10),
      last: 2,
      firstRuns: 3,
      lastRuns: 3,
      change: expect.closeTo(25, 10),
    });
  });

  it("gives no change with fewer than 3 runs on one side", () => {
    const t = aerobicTrend(BLOCK.slice(0, -1), EIGHT_WEEKS, 150);
    expect([t.last, t.lastRuns, t.change]).toEqual([2, 2, null]);
  });

  it("counts every run with HR when the zones are unknown", () => {
    const t = aerobicTrend(BLOCK, EIGHT_WEEKS, undefined);
    expect([t.first, t.firstRuns, t.weekly[0]]).toEqual([expect.closeTo(1.5125, 10), 4, 1.425]);
  });

  it("leaves out a run at the zone 4 floor and keeps one just below it", () => {
    expect(aerobicTrend([easy("2026-09-01", 150)], EIGHT_WEEKS, 150).runs).toEqual([]);
    expect(aerobicTrend([easy("2026-09-01", 149)], EIGHT_WEEKS, 150).runs).toHaveLength(1);
  });

  it("compares the halves of a short window, and nothing in a 1-week window", () => {
    const three = aerobicTrend(BLOCK, EIGHT_WEEKS.slice(0, 3), 150);
    expect([three.n, three.first, three.last, three.firstRuns, three.lastRuns]).toEqual([
      1, 1.6, 1.6, 1, 1,
    ]);
    const one = aerobicTrend(BLOCK, EIGHT_WEEKS.slice(0, 1), 150);
    expect(one).toEqual({
      weekly: [1.6],
      runs: [BLOCK[1]],
      n: 0,
      first: null,
      last: null,
      firstRuns: 0,
      lastRuns: 0,
      change: null,
    });
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

  it("leaves out a work lap under 20 m: an open step that ends when you press lap", () => {
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
      // an open step that ends when you press lap gives a lap of a few metres: not a rep
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

/** A run on a day with its best efforts. */
const withBest = (id: number, day: string, best: unknown) => ({
  id,
  type: "running",
  start: `${day} 07:00:00`,
  best,
});

/** The progression as [id, seconds, time] rows, per distance. */
const rows = (acts: Record<string, unknown>[]) =>
  Object.fromEntries(
    Object.entries(bestProgression(acts)).map(([d, list]) => [
      d,
      list.map((b) => [b.a.id, b.s, b.time]),
    ]),
  );

describe("best effort progression", () => {
  it("lists each run that set a new best, oldest first, whatever the input order", () => {
    const acts = [
      withBest(5, "2026-10-20", { "5k": "24:00" }), // equals the best: the first run holds it
      withBest(4, "2026-10-13", { "5k": "24:30" }), // slower: not listed
      withBest(3, "2026-10-06", { "5k": "24:00" }),
      withBest(2, "2026-09-29", { "5k": "25:10" }),
      withBest(1, "2026-09-22", { "5k": "26:00" }),
    ];
    expect(rows(acts)).toEqual({
      "5k": [
        [1, 1560, "26:00"],
        [2, 1510, "25:10"],
        [3, 1440, "24:00"],
      ],
    });
    // the same runs, oldest first
    expect(rows(acts.toReversed())).toEqual(rows(acts));
  });

  it("orders two runs of one day by their start time", () => {
    const morning = {
      ...withBest(1, "2026-10-06", { "1k": "4:10" }),
      start: "2026-10-06 07:00:00",
    };
    const evening = {
      ...withBest(2, "2026-10-06", { "1k": "4:00" }),
      start: "2026-10-06 18:30:00",
    };
    expect(rows([evening, morning])["1k"].map((r) => r[0])).toEqual([1, 2]);
    // a tie on the same day: the earlier run holds the best
    const tie = { ...evening, best: { "1k": "4:10" } };
    expect(rows([tie, morning])["1k"].map((r) => r[0])).toEqual([1]);
  });

  it("follows each distance on its own", () => {
    const acts = [
      withBest(2, "2026-10-13", { "5k": "25:00", "10k": "50:00" }),
      withBest(1, "2026-10-06", { "5k": "24:00", "10k": "52:00" }),
    ];
    expect(rows(acts)).toEqual({
      "5k": [[1, 1440, "24:00"]],
      "10k": [
        [1, 3120, "52:00"],
        [2, 3000, "50:00"],
      ],
    });
  });

  it.each([
    ["an unreadable time", "fast"],
    ["a zero time", "0:00"],
    ["a number", 1440],
    ["no time", null],
  ])("skips %s, so it never blocks a real time", (_name, bad) => {
    const acts = [
      withBest(2, "2026-10-13", { "5k": "25:00" }),
      withBest(1, "2026-10-06", { "5k": bad }),
    ];
    expect(rows(acts)).toEqual({ "5k": [[2, 1500, "25:00"]] });
  });

  it.each([
    ["no best", undefined],
    ["a best that is text", "24:00"],
    ["a best that is a list", ["24:00"]],
    ["a best that is null", null],
  ])("gives nothing for %s", (_name, best) => {
    expect(bestProgression([withBest(1, "2026-10-06", best)])).toEqual({});
  });

  it("skips an activity without a day", () => {
    const acts = [withBest(1, "2026-10-06", { "5k": "25:00" }), { id: 2, best: { "5k": "20:00" } }];
    expect(rows(acts)).toEqual({ "5k": [[1, 1500, "25:00"]] });
  });

  it("keeps a distance named like an object property as a distance", () => {
    const acts = [
      withBest(1, "2026-10-06", JSON.parse('{"constructor":"4:00","__proto__":"5:00"}')),
    ];
    const out = bestProgression(acts);
    expect(Object.keys(out).toSorted()).toEqual(["__proto__", "constructor"]);
    const key: string = "constructor";
    expect(out[key].map((b) => b.time)).toEqual(["4:00"]);
  });
});
