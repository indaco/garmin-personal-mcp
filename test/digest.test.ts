import { describe, expect, it } from "vitest";
import { digest } from "../src/digest";

const squat = (sets: Record<string, number>[]) => ({ exercise: "Back Squat", sets });

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
    });
  });

  it("sums each type key, with elapsed time only for strength and racket sports", () => {
    expect(d.totals).toEqual({
      walking: { sessions: 1, km: 3, hours: 0.6, load: 0 },
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
    expect(d.weekly["2026-10-26"]).toEqual({ sessions: 1, km: 3, runKm: 0, hours: 0.6, load: 0 });
  });

  it("gives the 7-day load against the weekly average of 28 days", () => {
    // the ride on 27 Sep is outside the 28 days that end on 26 Oct
    expect(d.load).toEqual({ last7Days: 190, weeklyAvgLast28Days: 47.5, acuteToChronic: 4 });
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
