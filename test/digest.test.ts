import { describe, expect, it } from "vitest";
import { digest } from "../src/digest";
import { sessionSeconds } from "../src/page/calc";

const squat = (sets: Record<string, number>[]) => ({ exercise: "Back Squat", sets });

/** A run named Easy Run on a day. */
const run = (day: string, type = "running") => ({
  name: "Easy Run",
  type,
  start: `${day} 07:00:00`,
  km: 5,
  duration: "30:00",
});

/** A run on a day with a training load. */
const loaded = (day: string, trainingLoad: number) => ({ ...run(day), trainingLoad });

/** A previous-period row as the server keeps it: a run with km only. */
const row = (day: string, km: number) => ({ type: "running", start: `${day} 07:00:00`, km });

/** An activity without its training load. */
const noLoad = (a: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(a).filter(([k]) => k !== "trainingLoad"));

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

  it("is a few KB for a real-sized period", () => {
    // it grows with weeks, types and exercises, not with the number of sessions
    const many = Array.from({ length: 120 }, (_, i) => ({ ...data.activities[3], id: 100 + i }));
    expect(JSON.stringify(digest({ ...data, activities: many })).length).toBeLessThan(10_000);
  });
});
