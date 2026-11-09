import { describe, expect, it } from "vitest";
import { filterData } from "../src/dashboard-page";
import { digest, syncGaps } from "../src/digest";
import { hms, round } from "../src/fit";
import { type Activity, sessionSeconds } from "../src/analytics/calc";
import type { Settings } from "../src/page/settings";
import { fitnessFatigueFrom, loadRatio, readinessOf } from "../src/analytics/metrics";
import { predictRaces, splitOf } from "../src/analytics/running";

const squat = (sets: Record<string, number>[]) => ({ exercise: "Back Squat", sets });

/** A run named Easy Run on a day. */
const run = (day: string, type = "running") => ({
  name: "Easy Run",
  type,
  start: `${day} 07:00:00`,
  km: 5,
  duration: "30:00",
});

/** A strength session on a day with its exercises. */
const strength = (day: string, exercises: unknown[]) => ({
  ...run(day, "strength_training"),
  exercises,
});

/** A run of the Run board (SDK sport "running") on a day, with its km and more fields. */
const onBoard = (day: string, name: string, km: number, more: Record<string, unknown> = {}) => ({
  ...run(day),
  sport: "running",
  name,
  km,
  ...more,
});

/** A lap with its time, the watch's pace and its average HR. */
const lapOf = (km: number, time: string, pace: string, avgHR?: number) => ({
  km,
  time,
  pace,
  ...(avgHR === undefined ? {} : { avgHR }),
});

/** The pace text of the digest. */
const paceText = (sec: number) => `${hms(sec)}/km`;

/** A run on a day with a training load. */
const loaded = (day: string, trainingLoad: number) => ({ ...run(day), trainingLoad });

/** A previous-period row as the server keeps it: a run with km only. */
const row = (day: string, km: number) => ({ type: "running", start: `${day} 07:00:00`, km });

/** An activity without its training load. */
const noLoad = (a: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(a).filter(([k]) => k !== "trainingLoad"));

/** HRV rows up to `last`, the last one with its status. */
const hrvTo = (last: string, status: string) => [
  { date: "2026-10-20", hrv: 60, status: "LOW" },
  { date: last, hrv: 66, status },
];

/** Recovery rows: 7 days at 50 bpm, then today's row. */
const recoveryTo = (today: Record<string, unknown>) => [
  ...Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${19 + i}`, rhr: 50 })),
  today,
];

/** Runs with an acute load in the last 7 days and the rest of the 28 days before them. */
const loads = (acute: number, rest: number) => [
  loaded("2026-10-25", acute),
  loaded("2026-10-10", rest),
];

/** A small getDashboardData result, most recent activity first, as the server returns it. */
const data = {
  generated: "2026-10-26",
  weeks: 12,
  start: "2026-08-03",
  end: "2026-10-26",
  prevStart: "2026-05-04",
  prevEnd: "2026-08-02",
  fitnessAge: {
    chronologicalAge: 41,
    fitnessAge: 34.6,
    achievableFitnessAge: 31.2,
    components: {},
  },
  activities: [
    {
      id: 6,
      name: "Walk",
      type: "walking",
      start: "2026-10-26 08:00:00",
      km: 3,
      duration: "36:00",
    },
    {
      id: 5,
      name: "City 10K",
      type: "running",
      sport: "running",
      start: "2026-10-25 07:00:00",
      km: 10,
      duration: "50:00",
      pace: "5:00/km",
      avgHR: 160,
      race: true,
      trainingLoad: 100,
      best: { "5k": "24:00", "10k": "49:30" },
    },
    {
      id: 4,
      name: "Strength B",
      type: "strength_training",
      start: "2026-10-22 18:00:00",
      duration: "10:00",
      elapsed: "1:00:00",
      trainingLoad: 40,
      // a set with 0 reps was not completed: it is never the top set
      exercises: [
        squat([
          { reps: 8, kg: 60 },
          { reps: 0, kg: 80 },
          { reps: 6, kg: 70 },
        ]),
      ],
    },
    {
      id: 3,
      name: "Easy Run",
      type: "running",
      sport: "running",
      start: "2026-10-20 07:00:00",
      km: 5.5,
      duration: "30:00",
      // runs count moving time, not elapsed time
      elapsed: "31:30",
      trainingLoad: 50,
      best: { "5k": "25:10" },
    },
    {
      id: 2,
      name: "Ride",
      type: "cycling",
      start: "2026-09-27 10:00:00",
      km: 40,
      duration: "1:30:00",
      trainingLoad: 60,
    },
    {
      id: 1,
      name: "Strength A",
      type: "strength_training",
      start: "2026-09-01 18:00:00",
      duration: "15:00",
      elapsed: "45:00",
      trainingLoad: 30,
      exercises: [squat([{ reps: 8, kg: 55 }]), { exercise: "Plank", sets: [{ seconds: 60 }] }],
    },
  ],
  previousActivities: [
    {
      id: 0,
      start: "2026-07-01 07:00:00",
      type: "running",
      km: 8,
      duration: "45:00",
      trainingLoad: 70,
    },
    { id: -1, start: "2026-06-01 07:00:00", type: "running", km: 4.25, duration: "25:00" },
  ],
  hrv: Array.from({ length: 16 }, (_, i) => ({ date: `2026-10-${String(11 + i)}`, hrv: 60 + i })),
  recovery: [{ date: "2026-10-26", sleepH: 7.5, rhr: 50 }],
  sync: { garminCalls: 4, newActivities: 1, failedDays: 0, failedDates: [], cachedActivities: 8 },
};

describe("digest", () => {
  const d = digest(data);

  it("copies the period", () => {
    expect(d.period).toEqual({
      start: "2026-08-03",
      end: "2026-10-26",
      weeks: 12,
      prevStart: "2026-05-04",
      prevEnd: "2026-08-02",
      // as many days as start..end (85), right before start
      previousPeriod: { from: "2026-05-10", to: "2026-08-02" },
    });
  });

  it("sums each type key, with elapsed time only for strength and racket sports", () => {
    expect(d.totals).toEqual({
      // a walk without a training load: n/a, not 0
      walking: { sessions: 1, km: 3, hours: 0.6, load: null },
      running: { sessions: 2, km: 15.5, hours: 1.3, load: 150 },
      strength_training: { sessions: 2, hours: 1.8, load: 70 },
      cycling: { sessions: 1, km: 40, hours: 1.5, load: 60 },
    });
  });

  it("counts the elapsed time of every racket sport", () => {
    const tennis = {
      type: "tennis",
      start: "2026-10-20 18:00:00",
      duration: "20:00",
      elapsed: "1:30:00",
    };
    expect(digest({ ...data, activities: [tennis] }).totals.tennis.hours).toBe(1.5);
  });

  it("counts a session as long as the page does, whatever its sport field", () => {
    const rows = [
      { type: "strength_training", sport: "training", duration: "10:00", elapsed: "1:00:00" },
      { type: "tennis", sport: "tennis", duration: "20:00", elapsed: "1:30:00" },
    ].map((r) => ({ ...r, start: "2026-10-20 18:00:00" }));
    const t = digest({ ...data, activities: rows }).totals;
    expect(t.strength_training.hours).toBe(Math.round((sessionSeconds(rows[0]) / 3600) * 10) / 10);
    expect(t.tennis.hours).toBe(Math.round((sessionSeconds(rows[1]) / 3600) * 10) / 10);
  });

  it("sums the previous period for the comparison", () => {
    expect(d.previousPeriodTotals).toEqual({ running: { sessions: 2, km: 12.3, load: 70 } });
  });

  it("sums each Monday-Sunday week, oldest first", () => {
    expect(Object.keys(d.weekly)).toEqual(["2026-08-31", "2026-09-21", "2026-10-19", "2026-10-26"]);
    expect(d.weekly["2026-10-19"]).toEqual({
      sessions: 3,
      km: 15.5,
      runKm: 15.5,
      hours: 2.3,
      load: 190,
    });
    expect(d.weekly["2026-10-26"]).toEqual({
      sessions: 1,
      km: 3,
      runKm: 0,
      hours: 0.6,
      load: null,
    });
  });

  it("gives the 7-day load against the weekly average of 28 days", () => {
    // the ride on 27 Sep is outside the 28 days that end on 26 Oct
    expect(d.load).toEqual({
      last7Days: 190,
      weeklyAvgLast28Days: 47.5,
      acuteToChronic: 4,
      estimatedLoads: 0,
    });
  });

  it("has no 28-day load or ratio when the data does not cover the 28 days", () => {
    // a 1-week page: its data starts 21 days before the end, not 27
    const week = {
      ...data,
      weeks: 1,
      start: "2026-10-19",
      prevStart: "2026-10-05",
      activities: [loaded("2026-10-25", 100)],
      previousActivities: [],
    };
    expect(digest(week).load).toEqual({
      last7Days: 100,
      weeklyAvgLast28Days: null,
      acuteToChronic: null,
      estimatedLoads: 0,
    });
    // from the first of the 28 days on, the data covers them
    expect(digest({ ...week, prevStart: "2026-09-29" }).load.acuteToChronic).toBe(4);
    expect(digest({ ...week, prevStart: "2026-09-30" }).load.acuteToChronic).toBeNull();
  });

  it("counts the previous activities in the 28-day load", () => {
    const out = digest({
      ...data,
      start: "2026-10-05",
      prevStart: "2026-09-01",
      activities: [loaded("2026-10-25", 100)],
      previousActivities: [
        { id: 0, type: "running", start: "2026-10-01 07:00:00", trainingLoad: 100 },
      ],
    });
    // acute 100; chronic (100 + 100) / 4 = 50
    expect(out.load).toEqual({
      last7Days: 100,
      weeklyAvgLast28Days: 50,
      acuteToChronic: 2,
      estimatedLoads: 0,
    });
  });

  it("gives no load, not 0, when no session has one", () => {
    const none = digest({
      ...data,
      activities: data.activities.map(noLoad),
      previousActivities: data.previousActivities.map(noLoad),
    });
    expect(none.load).toEqual({
      last7Days: null,
      weeklyAvgLast28Days: null,
      acuteToChronic: null,
      estimatedLoads: 0,
    });
    expect(none.totals.running.load).toBeNull();
    expect(none.previousPeriodTotals.running.load).toBeNull();
    expect(none.weekly["2026-10-19"].load).toBeNull();
  });

  it("gives 0 for 7 days without sessions, and sums only the known loads of a mix", () => {
    const out = digest({
      ...data,
      activities: [run("2026-10-10"), loaded("2026-10-08", 80)],
      previousActivities: [],
    });
    // no session in the last 7 days is rest, a true 0
    expect(out.load).toMatchObject({ last7Days: 0, weeklyAvgLast28Days: 20, acuteToChronic: 0 });
    expect(out.totals.running).toEqual({ sessions: 2, km: 10, hours: 1, load: 80 });
  });

  it("uses the page's estimate from heart rate for a session without load, and counts it", () => {
    const out = digest({
      ...data,
      zones: [{ sport: "DEFAULT", maxHeartRateUsed: 200 }],
      activities: [
        { type: "running", start: "2026-10-25 07:00:00", duration: "30:00", avgHR: 150 },
      ],
      previousActivities: [],
    });
    // 30 min x 150 / 200
    expect(out.load).toEqual({
      last7Days: 22.5,
      weeklyAvgLast28Days: 5.6,
      acuteToChronic: 4,
      estimatedLoads: 1,
    });
    expect(out.totals.running).toEqual({ sessions: 1, hours: 0.5, load: 22.5, estimatedLoads: 1 });
    expect(out.weekly["2026-10-19"]).toMatchObject({ load: 22.5, estimatedLoads: 1 });
    expect(d.totals.running).not.toHaveProperty("estimatedLoads");
  });

  it("marks the first week as partial when the period starts after its Monday", () => {
    const out = digest({
      ...data,
      start: "2026-08-05",
      activities: [run("2026-08-06"), run("2026-10-20")],
    });
    expect(out.weekly["2026-08-03"].partial).toBe(true);
    expect(out.weekly["2026-10-19"]).not.toHaveProperty("partial");
    // a period that starts on a Monday has only whole weeks
    expect(Object.values(d.weekly).filter((w) => "partial" in w)).toEqual([]);
  });

  it("compares with a previous period of the same length", () => {
    const out = digest({
      ...data,
      // 5 May is in the data (from prevStart, 4 May) but before the 85 days that end on 2 Aug
      previousActivities: [row("2026-05-05", 99), row("2026-05-10", 1), row("2026-08-02", 2)],
    });
    expect(out.previousPeriodTotals.running).toMatchObject({ sessions: 2, km: 3 });
    // without the start of the period, every previous activity counts
    const loose = digest({
      ...data,
      start: undefined,
      previousActivities: [row("2026-05-05", 99), row("2026-05-10", 1)],
    });
    expect(loose.previousPeriodTotals.running).toMatchObject({ sessions: 2, km: 100 });
    expect(loose.period).not.toHaveProperty("previousPeriod");
  });

  it("has no load ratio without load in the 28 days", () => {
    expect(digest({ ...data, activities: [] }).load.acuteToChronic).toBeNull();
  });

  it("keeps the fastest effort of each distance with its activity", () => {
    expect(d.bestEfforts).toEqual({
      "5k": { time: "24:00", date: "2026-10-25", name: "City 10K" },
      "10k": { time: "49:30", date: "2026-10-25", name: "City 10K" },
    });
  });

  it("lists the races", () => {
    expect(d.races).toEqual([
      {
        date: "2026-10-25",
        name: "City 10K",
        km: 10,
        duration: "50:00",
        pace: "5:00/km",
        avgHR: 160,
      },
    ]);
  });

  it("gives the first and the last top set of each exercise", () => {
    expect(d.strengthExercises).toEqual({
      "Back Squat": {
        sessions: 2,
        first: { date: "2026-09-01", top: "55 kg x 8" },
        last: { date: "2026-10-22", top: "70 kg x 6" },
      },
      Plank: { sessions: 1 },
    });
    // a heavier set of 13 reps is not the top set: the heaviest set of 1 to 12 reps is
    const out = digest({
      ...data,
      activities: [
        strength("2026-10-20", [
          squat([
            { reps: 13, kg: 90 },
            { reps: 12, kg: 80 },
            { reps: 10, kg: 80 },
          ]),
        ]),
      ],
    });
    expect(out.strengthExercises["Back Squat"].last).toEqual({
      date: "2026-10-20",
      top: "80 kg x 12",
    });
  });

  it("keeps the last 14 nights of HRV and copies recovery, fitness age and sync", () => {
    expect(d.hrvLast14).toHaveLength(14);
    expect(d.hrvLast14[0]).toEqual({ date: "2026-10-13", hrv: 62 });
    expect(d.recovery).toEqual(data.recovery);
    expect(d.fitnessAge).toEqual({
      fitnessAge: 34.6,
      chronologicalAge: 41,
      achievableFitnessAge: 31.2,
    });
    expect(d.sync).toEqual(data.sync);
  });

  it("leaves out an exercise without a name", () => {
    const out = digest({
      ...data,
      activities: [
        {
          ...run("2026-10-20", "strength_training"),
          exercises: [{ sets: [{ reps: 5, kg: 50 }] }, squat([{ reps: 5, kg: 60 }])],
        },
      ],
    });
    expect(Object.keys(out.strengthExercises)).toEqual(["Back Squat"]);
  });

  it("leaves out an exercise whose sets were all not done", () => {
    const out = digest({
      ...data,
      activities: [
        strength("2026-10-22", [
          squat([{ reps: 0, kg: 80 }]),
          { exercise: "Plank", sets: [{ seconds: 60 }] },
          { exercise: "Dip", sets: [{ reps: 0, seconds: 30 }] },
        ]),
        strength("2026-10-20", [squat([{ reps: 5, kg: 60 }])]),
      ],
    });
    expect(out.strengthExercises["Back Squat"]).toEqual({
      sessions: 1,
      first: { date: "2026-10-20", top: "60 kg x 5" },
      last: { date: "2026-10-20", top: "60 kg x 5" },
    });
    // a timed set without reps is done; 0 reps is not done, even with a time
    expect(out.strengthExercises.Plank).toEqual({ sessions: 1 });
    expect(out.strengthExercises).not.toHaveProperty("Dip");
  });

  it("lists the races and the runs over 15 km with the page's split and HR drift", () => {
    // 8 km at 5:00/km and 8 km at 4:50/km; the km of the first lap is rounded up
    const laps = [lapOf(8.01, "40:00", "5:00/km", 150), lapOf(8, "38:40", "4:50/km", 155)];
    const s = splitOf(laps)!;
    const out = digest({
      ...data,
      activities: [
        onBoard("2026-10-24", "Long Run", 16.04, { laps }),
        // a lap without HR: no drift
        onBoard("2026-10-17", "Hill Run", 16, {
          laps: [laps[0], { ...laps[1], avgHR: undefined }],
        }),
        onBoard("2026-10-10", "No Laps", 16),
        onBoard("2026-10-03", "Exactly 15", 15, { laps }),
        // one lap: no split
        onBoard("2026-09-26", "Just Over", 15.1, { laps: [laps[0]] }),
        onBoard("2026-09-19", "City 10K", 10, { race: true }),
        // a ride is not a run, also as a race
        { ...run("2026-09-12", "cycling"), sport: "cycling", km: 40, race: true, laps },
      ],
    });
    const none = { firstPace: null, secondPace: null, kind: null, hrDriftPct: null };
    expect(out.longRuns).toEqual([
      {
        date: "2026-10-24",
        name: "Long Run",
        km: 16,
        firstPace: paceText(s.first),
        secondPace: paceText(s.second),
        kind: s.kind,
        hrDriftPct: round(s.drift!, 1),
      },
      {
        date: "2026-10-17",
        name: "Hill Run",
        km: 16,
        firstPace: "5:00/km",
        secondPace: "4:50/km",
        kind: "negative",
        hrDriftPct: null,
      },
      { date: "2026-10-10", name: "No Laps", km: 16, ...none },
      { date: "2026-09-26", name: "Just Over", km: 15.1, ...none },
      { date: "2026-09-19", name: "City 10K", km: 10, ...none },
    ]);
    // time / pace makes the halves 8 km each: the page's numbers, not the rounded km
    expect(out.longRuns[0]).toMatchObject({ firstPace: "5:00/km", secondPace: "4:50/km" });
    // speed per beat: 8 / (2400 x 150) against 8 / (2320 x 155)
    expect(out.longRuns[0].hrDriftPct).toBe(-0.1);
    // the race of the fixture has no laps
    expect(d.longRuns).toEqual([{ date: "2026-10-25", name: "City 10K", km: 10, ...none }]);
  });

  it("gives the longest run of the period", () => {
    const out = digest({
      ...data,
      activities: [
        onBoard("2026-10-24", "Easy", 8.04),
        onBoard("2026-10-17", "Long", 18.06),
        // the first one wins a tie
        onBoard("2026-10-10", "Long Too", 18.06),
        { ...run("2026-10-03", "cycling"), sport: "cycling", km: 60 },
      ],
    });
    expect(out.longestRun).toEqual({ date: "2026-10-17", name: "Long", km: 18.1 });
    // runs without a distance, or no run at all: no longest run
    const noKm = digest({ ...data, activities: [{ ...onBoard("2026-10-24", "Drill", 0) }] });
    expect(noKm).not.toHaveProperty("longestRun");
    expect(digest({ ...data, activities: [data.activities[0]] })).not.toHaveProperty("longestRun");
    expect(d.longestRun).toEqual({ date: "2026-10-25", name: "City 10K", km: 10 });
  });

  it("predicts race times from each best effort of 5 km or more, fastest first", () => {
    const page = predictRaces({ "5k": 24 * 60, "10k": 49 * 60 + 30 })!;
    expect(d.racePredictions).toHaveLength(2);
    expect(d.racePredictions[0]).toEqual({
      from: page.from.distance,
      time: d.bestEfforts[page.from.distance].time,
      date: "2026-10-25",
      "5k": hms(page.times["5k"]),
      "10k": hms(page.times["10k"]),
      half: hms(page.times.half),
      marathon: hms(page.times.marathon),
    });
    // 5 km in 24:00 predicts 10 km in 50:02: the 10 km of 49:30 is the estimate
    expect(d.racePredictions.map((r) => r.from)).toEqual(["10k", "5k"]);
    expect(d.racePredictions[1]).toMatchObject({ time: "24:00", "5k": "24:00", "10k": "50:02" });
    const short = digest({
      ...data,
      activities: [{ ...run("2026-10-24"), best: { "1k": "3:50", mile: "6:20" } }],
    });
    expect(short.racePredictions).toEqual([]);
    expect(digest({ ...data, activities: [run("2026-10-24")] }).racePredictions).toEqual([]);
  });

  it("predicts race times from the efforts of the runs only, as the page does", () => {
    const out = digest({
      ...data,
      activities: [
        // a walk with Garmin's fastest splits, faster than the run
        {
          ...run("2026-10-24", "walking"),
          name: "Walk",
          sport: "walking",
          best: { "5k": "20:00" },
        },
        onBoard("2026-10-20", "Tempo", 10, { best: { "5k": "24:00" } }),
      ],
    });
    expect(out.racePredictions).toHaveLength(1);
    expect(out.racePredictions[0]).toMatchObject({
      from: "5k",
      time: "24:00",
      date: "2026-10-20",
      "5k": "24:00",
      "10k": "50:02",
    });
    // the digest's best efforts still list every activity
    expect(out.bestEfforts["5k"]).toEqual({ time: "20:00", date: "2026-10-24", name: "Walk" });
  });

  it("lists the run names that repeat most first", () => {
    const tempo = (day: string) => ({ ...run(day), name: "Tempo" });
    const out = digest({
      ...data,
      activities: [
        run("2026-10-12"),
        run("2026-10-05"),
        tempo("2026-10-04"),
        tempo("2026-10-03"),
        tempo("2026-10-02"),
      ],
    });
    expect(Object.entries(out.repeatedRuns)).toEqual([
      ["Tempo", 3],
      ["Easy Run", 2],
    ]);
  });

  it("finds a run by its sport: a virtual run counts for the run km and the repeated names", () => {
    const virtual = (day: string) => ({ ...run(day, "virtual_run"), sport: "running" });
    const out = digest({
      ...data,
      activities: [
        virtual("2026-10-12"),
        virtual("2026-10-05"),
        // a type key and a sport that disagree: the sport wins
        { ...run("2026-10-04", "running"), sport: "cycling" },
      ],
    });
    expect(out.weekly["2026-10-05"].runKm).toBe(5);
    expect(out.weekly["2026-10-12"].runKm).toBe(5);
    expect(out.weekly["2026-09-28"].runKm).toBe(0);
    expect(out.repeatedRuns).toEqual({ "Easy Run": 2 });
  });

  it("counts the run names that repeat: the workouts that the dashboard can compare across weeks", () => {
    expect(d.repeatedRuns).toEqual({});
    const more = digest({
      ...data,
      activities: [
        ...data.activities,
        run("2026-10-12", "trail_running"),
        run("2026-10-05"),
        { ...run("2026-10-04", "cycling"), name: "City 10K" },
      ],
    });
    // runs only: a ride of the same name does not count
    expect(more.repeatedRuns).toEqual({ "Easy Run": 3 });
    // the place that Garmin puts before the workout does not count
    const places = digest({
      ...data,
      activities: [
        { ...run("2026-10-12"), name: "Riverside - Drill Workout" },
        { ...run("2026-10-05"), name: "Hillview - Drill Workout" },
      ],
    });
    expect(places.repeatedRuns).toEqual({ "Drill Workout": 2 });
  });

  it("skips an activity without a start date", () => {
    const e = digest({ ...data, activities: [{ id: 9, type: "running", km: 5 }] });
    expect(e.totals).toEqual({});
  });

  it("keeps the last 14 recovery rows of a page with a year of them, and the same verdict", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, "0")}`,
      sleepScore: 60 + i,
      rhr: 50 + (i % 3),
    }));
    const out = digest({ ...data, recovery: rows });
    expect(out.recovery).toEqual(rows.slice(-14));
    expect(out.recovery).toHaveLength(14);
    expect(out.readiness).toEqual(digest({ ...data, recovery: rows.slice(-14) }).readiness);
    expect(out.readiness?.recoveryDate).toBe("2026-09-30");
    expect(out.readiness?.sleepScore).toBe(89);
  });

  it.each([
    [14, 0],
    [15, 1],
  ])("keeps the last 14 of %i recovery rows", (count, skipped) => {
    const rows = Array.from({ length: count }, (_, i) => ({
      date: `2026-10-${String(i + 1).padStart(2, "0")}`,
      rhr: 50 + i,
    }));
    const out = digest({ ...data, recovery: rows });
    expect(out.recovery).toHaveLength(14);
    expect(out.recovery).toEqual(rows.slice(skipped));
  });

  it("leaves a recovery that is an object as it is", () => {
    const recovery = { date: "2026-10-26", rhr: 50 };
    expect(digest({ ...data, recovery }).recovery).toEqual(recovery);
  });

  it("keeps an empty recovery list empty, and an absent one absent", () => {
    expect(digest({ ...data, recovery: [] }).recovery).toEqual([]);
    expect(digest({ ...data, recovery: undefined }).recovery).toBeUndefined();
  });

  it("gives the page's readiness verdict and its inputs, rounded", () => {
    const hrv = hrvTo("2026-10-26", "BALANCED");
    const recovery = [
      ...[50, 51, 52, 53, 50, 51, 52].map((rhr, i) => ({ date: `2026-10-${19 + i}`, rhr })),
      { date: "2026-10-26", sleepScore: 85, rhr: 55 },
    ];
    const out = digest({ ...data, hrv, recovery });
    expect(out.readiness).toEqual({
      verdict: "normal",
      hrvStatus: "BALANCED",
      hrvDate: "2026-10-26",
      sleepScore: 85,
      rhr: 55,
      // 359 / 7 = 51.29
      rhrAvg7: 51.3,
      recoveryDate: "2026-10-26",
      loadRatio: 4,
    });
    const every = [...data.activities, ...data.previousActivities] as Activity[];
    const ratio = loadRatio(every, data.end, undefined, data.prevStart).ratio;
    expect(out.readiness?.verdict).toBe(readinessOf(hrv, recovery, ratio).verdict);
  });

  it("gives the verdict from the exact load ratio, not the rounded one", () => {
    const ready = {
      ...data,
      hrv: hrvTo("2026-10-26", "BALANCED"),
      recovery: recoveryTo({ date: "2026-10-26", sleepScore: 80, rhr: 50 }),
      previousActivities: [],
    };
    // 81 against (81 + 169) / 4 = 1.296: under 1.3, shown as 1.3
    expect(digest({ ...ready, activities: loads(81, 169) }).readiness).toMatchObject({
      verdict: "push",
      loadRatio: 1.3,
    });
    // 65 against (65 + 135) / 4 = 1.3
    expect(digest({ ...ready, activities: loads(65, 135) }).readiness).toMatchObject({
      verdict: "normal",
      loadRatio: 1.3,
    });
    // 40 against (40 + 160) / 4 = 0.8
    expect(digest({ ...ready, activities: loads(40, 160) }).readiness).toMatchObject({
      verdict: "push",
      loadRatio: 0.8,
    });
  });

  it("has no load ratio in the readiness when the data does not cover the 28 days", () => {
    const week = {
      ...data,
      weeks: 1,
      start: "2026-10-19",
      prevStart: "2026-10-05",
      hrv: hrvTo("2026-10-26", "BALANCED"),
      recovery: recoveryTo({ date: "2026-10-26", sleepScore: 85, rhr: 50 }),
      activities: loads(81, 169),
      previousActivities: [],
    };
    // without a ratio the verdict cannot be "push"
    expect(digest(week).readiness).toMatchObject({ verdict: "normal", loadRatio: null });
    expect(digest({ ...week, prevStart: "2026-09-29" }).readiness).toMatchObject({
      verdict: "push",
      loadRatio: 1.3,
    });
  });

  it("gives the dates of the rows when they are from an older night", () => {
    const out = digest({
      ...data,
      hrv: hrvTo("2026-10-24", "LOW"),
      // no row for today: the last row is yesterday's, as on the page
      recovery: recoveryTo({ date: "2026-10-26", sleepScore: 85, rhr: 50 }).slice(0, -1),
    });
    expect(out.readiness).toEqual({
      verdict: "easy",
      hrvStatus: "LOW",
      hrvDate: "2026-10-24",
      sleepScore: null,
      rhr: 50,
      rhrAvg7: 50,
      recoveryDate: "2026-10-25",
      loadRatio: 4,
    });
  });

  it("gives null, not a guess, for each readiness value that the data cannot back", () => {
    // HRV rows without a status, and a recovery row without a sleep score
    expect(d.readiness).toEqual({
      verdict: null,
      hrvStatus: null,
      hrvDate: "2026-10-26",
      sleepScore: null,
      rhr: 50,
      rhrAvg7: null,
      recoveryDate: "2026-10-26",
      loadRatio: 4,
    });
  });

  it("has no readiness without HRV and recovery rows, and no sleep or HRV text then", () => {
    const out = digest({ ...data, hrv: [], recovery: [] });
    expect(out).not.toHaveProperty("readiness");
    // the page leaves both lists empty when it excludes recovery
    expect(JSON.stringify(out)).not.toMatch(/sleep|"hrv(Status|Date)"/i);
    expect(JSON.stringify(out.fitnessFatigue)).not.toMatch(/sleep|hrv/i);
  });

  it("gives the HRV inputs and null for sleep and resting HR with HRV rows only", () => {
    expect(digest({ ...data, hrv: hrvTo("2026-10-26", "LOW"), recovery: [] }).readiness).toEqual({
      verdict: "easy",
      hrvStatus: "LOW",
      hrvDate: "2026-10-26",
      sleepScore: null,
      rhr: null,
      rhrAvg7: null,
      recoveryDate: null,
      loadRatio: 4,
    });
  });

  it("gives the sleep and resting HR inputs and null for HRV with recovery rows only", () => {
    const recovery = recoveryTo({ date: "2026-10-26", sleepScore: 85, rhr: 50 });
    expect(digest({ ...data, hrv: [], recovery }).readiness).toEqual({
      verdict: "normal",
      hrvStatus: null,
      hrvDate: null,
      sleepScore: 85,
      rhr: 50,
      rhrAvg7: 50,
      recoveryDate: "2026-10-26",
      loadRatio: 4,
    });
  });

  it("gives today's fitness, fatigue and form as the page, warmed up by the weeks before", () => {
    const every = [...data.activities, ...data.previousActivities] as Activity[];
    const f = fitnessFatigueFrom(every, data.start, data.end)!;
    expect(d.fitnessFatigue).toEqual({
      fitness: round(f.fitness.at(-1)!, 1),
      fatigue: round(f.fatigue.at(-1)!, 1),
      form: round(f.form.at(-1)!, 1),
    });
    // form is the fitness minus the fatigue of 25 Oct: today has no load
    expect(d.fitnessFatigue).toEqual({ fitness: 5.2, fatigue: 18.3, form: -16 });
  });

  it("uses the page's load estimate for fitness, and has none without any load", () => {
    const zones = [{ sport: "DEFAULT", maxHeartRateUsed: 200 }];
    const activities = [
      { type: "running", start: "2026-10-25 07:00:00", duration: "30:00", avgHR: 150 },
    ];
    const out = digest({ ...data, zones, activities, previousActivities: [] });
    const f = fitnessFatigueFrom(activities, data.start, data.end, 200)!;
    expect(out.fitnessFatigue).toEqual({
      fitness: round(f.fitness.at(-1)!, 1),
      fatigue: round(f.fatigue.at(-1)!, 1),
      form: round(f.form.at(-1)!, 1),
    });
    expect(out.fitnessFatigue?.fitness).toBeGreaterThan(0);
    const none = digest({
      ...data,
      activities: data.activities.map(noLoad),
      previousActivities: data.previousActivities.map(noLoad),
    });
    expect(none.fitnessFatigue).toBeNull();
  });

  it("has no fitness without the start of the period", () => {
    expect(digest({ ...data, start: undefined }).fitnessFatigue).toBeNull();
  });

  it("is a few KB for a real-sized period", () => {
    // it grows with weeks, types and exercises, not with the number of sessions
    const many = Array.from({ length: 120 }, (_, i) => ({ ...data.activities[3], id: 100 + i }));
    expect(JSON.stringify(digest({ ...data, activities: many })).length).toBeLessThan(10_000);
  });
});

describe("syncGaps", () => {
  it("gives nothing for no sync, a non-object, an empty object or a clean sync", () => {
    for (const sync of [undefined, null, "x", 3, [], {}, { failedDays: 0, failedSections: [] }])
      expect(syncGaps(sync)).toBeUndefined();
  });

  it("names each kind of gap", () => {
    expect(syncGaps({ failedDays: 2 })).toBe("days: 2");
    expect(syncGaps({ failedSections: ["hrv", "sleep"] })).toBe("sections: hrv, sleep");
    expect(syncGaps({ failedDetails: 3 })).toBe("session details: 3");
    expect(syncGaps({ stoppedEarly: true })).toBe("Garmin stopped answering");
  });

  it("joins all the gaps, and ignores values of the wrong type", () => {
    expect(
      syncGaps({ failedDays: 1, failedSections: ["hrv"], failedDetails: 4, stoppedEarly: true }),
    ).toBe("days: 1; sections: hrv; session details: 4; Garmin stopped answering");
    expect(
      syncGaps({ failedDays: "2", failedSections: "hrv", failedDetails: NaN, stoppedEarly: 1 }),
    ).toBeUndefined();
  });
});

const swim = (start: string, extra: Record<string, unknown>) => ({
  sport: "swimming",
  type: "lap_swimming",
  start: `${start} 07:00:00`,
  name: "Pool Swim",
  km: 1,
  duration: "20:00",
  ...extra,
});
const week = (d: string, duration: string, strokes: number) =>
  swim(d, { duration, lengths: 40, strokes, poolLengthM: 25 });

describe("swims", () => {
  const lake = swim("2026-10-20", {
    type: "open_water_swimming",
    name: "Lake Swim",
    km: 2.5,
    duration: "55:00",
    swolf: 60,
    strokes: 1500,
  });
  const pool = (start: string) =>
    swim(start, { swolf: 38, lengths: 40, strokes: 720, poolLengthM: 25 });

  it("has no swims field without a swim", () => {
    expect(digest(data)).not.toHaveProperty("swims");
  });

  it("gives the weeks, the longest swim and the newest swims, with pool and open water apart", () => {
    const { swims } = digest({
      ...data,
      activities: [lake, pool("2026-10-19"), ...data.activities],
    });
    expect(swims!.weekly).toEqual({ "2026-10-19": { sessions: 2, km: 3.5 } });
    expect(swims!.longest).toEqual({
      date: "2026-10-20",
      name: "Lake Swim",
      km: 2.5,
      openWater: true,
    });
    expect(swims!.recent[0]).toEqual({
      date: "2026-10-20",
      name: "Lake Swim",
      openWater: true,
      km: 2.5,
      pace: "2:12/100 m",
      swolf: 60,
      strokesPerLength: null,
      poolLengthM: null,
    });
    expect(swims!.recent[1]).toMatchObject({
      openWater: false,
      pace: "2:00/100 m",
      strokesPerLength: 18,
      poolLengthM: 25,
    });
    // one pool swim: a trend without a comparison, and the lake left out
    expect(swims!.poolTrend).toEqual({
      poolLengthM: 25,
      swims: 1,
      from: "2026-10-19",
      left: 1,
      comparedSwims: null,
      pace: null,
      strokesPerLength: null,
    });
  });

  it("has no pool trend in open water only", () => {
    expect(digest({ ...data, activities: [lake] }).swims!.poolTrend).toBeNull();
  });

  it("shows a swim without a distance as n/a, and never as the longest", () => {
    const { km: _km, ...rest } = pool("2026-10-19");
    const { swims } = digest({ ...data, activities: [rest] });
    expect(swims!.weekly["2026-10-19"]).toEqual({ sessions: 1, km: null });
    expect(swims!.longest).toBeNull();
    expect(swims!.recent[0]).toMatchObject({ km: null, pace: null });
  });

  it("adds the known km of a week that also has a swim without a distance", () => {
    const { km: _km, ...noKm } = pool("2026-10-19");
    for (const activities of [
      [noKm, pool("2026-10-20")],
      [pool("2026-10-20"), noKm],
    ])
      expect(digest({ ...data, activities }).swims!.weekly["2026-10-19"]).toEqual({
        sessions: 2,
        km: 1,
      });
  });

  it("has no swims on a page without the sport, and no names on a page without names", () => {
    const activities = [pool("2026-10-19")];
    const settings = (s: object) => filterData({ ...data, activities }, s as Settings);
    expect(digest(settings({ sports: ["running"] }))).not.toHaveProperty("swims");
    const { swims } = digest(settings({ exclude: ["names"] }));
    expect(swims!.recent[0].name).toBeUndefined();
    expect(JSON.stringify(swims)).not.toContain("Pool Swim");
  });

  it("reads a swim without a type as a pool swim", () => {
    const { type: _type, ...rest } = pool("2026-10-19");
    expect(digest({ ...data, activities: [rest] }).swims!.recent[0].openWater).toBe(false);
  });

  it("keeps the 8 newest swims", () => {
    const many = Array.from({ length: 10 }, (_, i) => pool(`2026-10-${10 + i}`));
    const { swims } = digest({ ...data, activities: many });
    expect(swims!.recent).toHaveLength(8);
    expect(swims!.recent[0].date).toBe("2026-10-19");
  });

  it("compares the newest pool swims with as many before them", () => {
    const { swims } = digest({
      ...data,
      activities: [
        week("2026-10-19", "20:00", 720),
        week("2026-10-12", "20:00", 720),
        week("2026-10-05", "20:00", 720),
        week("2026-09-28", "21:40", 800),
        week("2026-09-21", "21:40", 800),
        week("2026-09-14", "21:40", 800),
      ],
    });
    expect(swims!.poolTrend).toMatchObject({
      comparedSwims: 3,
      pace: { recent: "2:00/100 m", before: "2:10/100 m" },
      strokesPerLength: { recent: 18, before: 20 },
    });
  });
});
