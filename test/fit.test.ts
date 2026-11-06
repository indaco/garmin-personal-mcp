import { Profile } from "@garmin/fitsdk";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  decodeFit,
  exerciseName,
  groupSets,
  lapsOf,
  runNumbers,
  setsOf,
  toConst,
  unzipFit,
  type FitSet,
} from "../src/fit";
import { fitFile } from "./fit-file";

const types = Profile.types as Record<string, Record<string, string> | undefined>;
import fitNames from "./fixtures/fit-constant-names.json";

/** Raw value of a FIT profile enum, e.g. value("exerciseCategory", "benchPress") = 0 */
function value(type: string, name: string): number {
  const entry = Object.entries(types[type] ?? {}).find(([, n]) => n === name);
  if (!entry) throw new Error(`${type} has no ${name}`);
  return Number(entry[0]);
}

const SQUAT = value("exerciseCategory", "squat");
const BARBELL_BOX_SQUAT = value("squatExerciseName", "barbellBoxSquat");
const ACTIVE = 1;
const REST = 0;

function set(setType: number, repetitions?: number, weight?: number, duration?: number): FitSet {
  const s: FitSet = { setType, repetitions, weight, duration };
  if (setType === ACTIVE) {
    s.category = [SQUAT];
    s.categorySubtype = [BARBELL_BOX_SQUAT];
  }
  return s;
}

/** A lap as the getActivityLaps answer gives it. */
function lap(
  km: number,
  time: string,
  pace?: string,
  avgHR?: number,
  intensity?: string,
  step?: number,
): Record<string, unknown> {
  return {
    km,
    time,
    ...(pace === undefined ? {} : { pace }),
    ...(avgHR === undefined ? {} : { avgHR }),
    ...(intensity === undefined ? {} : { intensity }),
    ...(step === undefined ? {} : { step }),
  };
}

/** A lap of the size of a real one: pace, HR, cadence and running form. */
function fullLap(km: number, time: string, pace: string, intensity: string, step?: number) {
  return {
    lap: 1,
    ...lap(km, time, pace, 160, intensity, step),
    maxHR: 175,
    cadenceSpm: 180,
    ascentM: 2,
    descentM: 1,
    avgPowerW: 320,
    gctMs: 240,
    vertRatioPct: 7.1,
    vertOscCm: 8.4,
    strideCm: 120.5,
    trigger: "manual",
  };
}

describe("exercise names", () => {
  it("names the exercise from the SDK name list", () => {
    expect(
      exerciseName(
        value("exerciseCategory", "benchPress"),
        value("benchPressExerciseName", "inclineSmithMachineBenchPress"),
        "Panca inclinata",
      ),
    ).toBe("Incline Smith Machine Bench Press");
  });

  it("falls back to the category name", () => {
    expect(exerciseName(value("exerciseCategory", "legRaise"), undefined, undefined)).toBe(
      "Leg Raise",
    );
    expect(exerciseName(value("exerciseCategory", "curl"), 9999, undefined)).toBe("Curl");
  });

  it("names a custom exercise after its workout step", () => {
    expect(exerciseName(value("exerciseCategory", "unknown"), 3, "My Press")).toBe("My Press");
    expect(exerciseName(undefined, undefined, undefined)).toBe("Unknown exercise");
  });

  it("gives the FIT profile constant for every exercise category and name", () => {
    const mismatches: string[] = [];
    for (const [num, { const: cat, names }] of Object.entries(fitNames.exerciseCategories)) {
      const camel = types.exerciseCategory?.[num] ?? "";
      if (toConst(camel) !== cat) mismatches.push(`${num}: ${camel} vs ${cat}`);
      for (const [sub, name] of Object.entries(names)) {
        const js = types[`${camel}ExerciseName`]?.[sub];
        if (js === undefined || toConst(js) !== name)
          mismatches.push(`${cat}/${sub}: ${js} vs ${name}`);
      }
    }
    expect(mismatches).toEqual([]);
    expect(Object.keys(fitNames.exerciseCategories)).toHaveLength(53);
  });

  it("gives the FIT profile constant for every sport, intensity and lap trigger", () => {
    const mismatches: string[] = [];
    for (const [type, values] of Object.entries(fitNames.enums)) {
      for (const [num, name] of Object.entries(values)) {
        if (name === "INVALID") continue;
        const js = types[type]?.[num];
        if (js === undefined || toConst(js) !== name)
          mismatches.push(`${type}/${num}: ${js} vs ${name}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe("sets", () => {
  it("turns a rest period into restSec on the set before it", () => {
    const out = groupSets(
      [
        set(ACTIVE, 12, 35, 206),
        set(REST, undefined, undefined, 90),
        set(ACTIVE, 10, 50, 123),
        set(REST, undefined, undefined, 120),
        set(ACTIVE, 0, undefined, 7),
      ],
      new Map(),
      undefined,
    );
    expect(out).toHaveLength(1);
    expect(out[0].exercise).toBe("Barbell Box Squat");
    expect(out[0].category).toBe("Squat");
    expect(out[0]).not.toHaveProperty("primaryMuscles");
    expect(out[0].sets).toEqual([
      { reps: 12, kg: 35, seconds: 206, restSec: 90 },
      { reps: 10, kg: 50, seconds: 123, restSec: 120 },
      { reps: 0, seconds: 7 },
    ]);
  });

  it("drops the empty set the watch opens when the workout ends", () => {
    const unknown = value("exerciseCategory", "unknown");
    const stray: FitSet = { setType: ACTIVE, repetitions: 0, duration: 17.5, category: [unknown] };
    const out = groupSets(
      [
        set(ACTIVE, 5, 60, 20),
        set(REST, undefined, undefined, 25),
        stray,
        set(REST, undefined, undefined, 2),
      ],
      new Map(),
      undefined,
    );
    expect(out).toHaveLength(1);
    // the rest after the empty set does not replace the real rest before it
    expect(out[0].sets).toEqual([{ reps: 5, kg: 60, seconds: 20, restSec: 25 }]);
  });

  it("keeps an unknown set that has reps, a weight or a real set after it", () => {
    const unknown = value("exerciseCategory", "unknown");
    const out = groupSets(
      [
        { setType: ACTIVE, repetitions: 0, duration: 30, category: [unknown] },
        set(ACTIVE, 5, 60, 20),
        { setType: ACTIVE, repetitions: 8, duration: 30, category: [unknown] },
      ],
      new Map(),
      undefined,
    );
    expect(out.map((e) => [e.exercise, e.sets.length])).toEqual([
      ["Unknown exercise", 2],
      ["Barbell Box Squat", 1],
    ]);
  });

  it("reads the muscles from the exercise catalogue", () => {
    const catalogue = {
      SQUAT: {
        exercises: {
          BARBELL_BOX_SQUAT: {
            primaryMuscles: ["QUADS", "GLUTES"],
            secondaryMuscles: ["HAMSTRINGS", ""],
          },
        },
      },
      PLANK: { exercises: { PLANK: { primaryMuscles: ["ABS"], secondaryMuscles: ["SHOULDERS"] } } },
    };
    const plank: FitSet = {
      setType: ACTIVE,
      duration: 60,
      category: [value("exerciseCategory", "plank")],
      categorySubtype: [],
    };
    const out = groupSets([set(ACTIVE, 6, 70, 257), plank], new Map(), catalogue);
    expect(out[0].primaryMuscles).toEqual(["Quads", "Glutes"]);
    expect(out[0].secondaryMuscles).toEqual(["Hamstrings"]);
    expect(out[1].primaryMuscles).toEqual(["Abs"]);
  });

  it("names a custom exercise after its workout step, read from the FIT file", () => {
    const unknown = value("exerciseCategory", "unknown");
    const fit = decodeFit(
      fitFile(
        [
          Profile.MesgNum.EXERCISE_TITLE,
          { exerciseCategory: unknown, exerciseName: 3, wktStepName: "My Press" },
        ],
        [
          Profile.MesgNum.SET,
          {
            setType: ACTIVE,
            repetitions: 8,
            weight: 20.5,
            duration: 30.4,
            category: [unknown],
            categorySubtype: [3],
          },
        ],
        [Profile.MesgNum.SET, { setType: REST, duration: 59.6 }],
      ),
      7,
    );
    expect(setsOf(fit, 7, undefined)).toEqual({
      activityId: 7,
      exercises: [
        {
          exercise: "My Press",
          category: "Unknown",
          sets: [{ reps: 8, kg: 20.5, seconds: 30, restSec: 60 }],
          top: { kg: 20.5, reps: 8 },
          // 20.5 x (1 + 8 / 30) = 25.97, rounded to 0.1
          e1rmKg: 26,
        },
      ],
    });
  });

  it("gives no exercises for a FIT file without sets", () => {
    expect(setsOf({}, 8, undefined)).toEqual({ activityId: 8, exercises: [] });
  });
});

describe("laps", () => {
  it("gives pace and steps per minute for foot sports", () => {
    const fit = decodeFit(
      fitFile(
        [
          Profile.MesgNum.LAP,
          {
            totalDistance: 1000,
            totalTimerTime: 330.4,
            enhancedAvgSpeed: 3.03,
            avgHeartRate: 150,
            maxHeartRate: 161,
            avgCadence: 80,
            avgFractionalCadence: 0.5,
            totalAscent: 5,
            totalDescent: 4,
            avgPower: 290,
            intensity: "active",
            lapTrigger: "sessionEnd",
          },
        ],
        [Profile.MesgNum.SESSION, { sport: "running" }],
      ),
      9,
    );
    expect(lapsOf(fit, 9)).toEqual({
      activityId: 9,
      sport: "running",
      laps: [
        {
          lap: 1,
          km: 1,
          time: "5:30",
          pace: "5:30/km",
          avgHR: 150,
          maxHR: 161,
          cadenceSpm: 161,
          ascentM: 5,
          descentM: 4,
          avgPowerW: 290,
          intensity: "active",
          trigger: "session_end",
        },
      ],
      // one lap: no half split
      split: null,
    });
  });

  it("gives the split and the work of a structured run", () => {
    const fit = decodeFit(
      fitFile(
        [
          Profile.MesgNum.LAP,
          {
            totalDistance: 1000,
            totalTimerTime: 360,
            enhancedAvgSpeed: 1000 / 360,
            intensity: "warmup",
          },
        ],
        [
          Profile.MesgNum.LAP,
          {
            totalDistance: 400,
            totalTimerTime: 96,
            enhancedAvgSpeed: 400 / 96,
            avgHeartRate: 170,
            intensity: "interval",
            wktStepIndex: 1,
          },
        ],
        [
          Profile.MesgNum.LAP,
          {
            totalDistance: 400,
            totalTimerTime: 100,
            enhancedAvgSpeed: 4,
            avgHeartRate: 174,
            intensity: "interval",
            wktStepIndex: 1,
          },
        ],
        [
          Profile.MesgNum.LAP,
          {
            totalDistance: 1000,
            totalTimerTime: 390,
            enhancedAvgSpeed: 1000 / 390,
            intensity: "cooldown",
          },
        ],
        [Profile.MesgNum.SESSION, { sport: "running" }],
      ),
      14,
    );
    // the warm-up and the cool-down do not count in the split: 96 s at 170 against 100 s at 174
    expect(lapsOf(fit, 14)).toMatchObject({
      split: { firstPace: "4:00/km", secondPace: "4:10/km", kind: "positive", hrDriftPct: 6.2 },
      work: {
        reps: 2,
        pace: "4:05/km",
        avgHR: 172,
        fade: [{ step: 1, reps: 2, firstPace: "4:00/km", lastPace: "4:10/km", pct: 4.2 }],
      },
    });
  });

  it("gives km/h and plain cadence for other sports", () => {
    const fit = decodeFit(
      fitFile(
        [
          Profile.MesgNum.LAP,
          { totalDistance: 20000, totalTimerTime: 2400, avgSpeed: 8.333, avgCadence: 85 },
        ],
        [Profile.MesgNum.SESSION, { sport: "cycling" }],
      ),
      10,
    );
    expect(lapsOf(fit, 10).laps).toEqual([{ lap: 1, km: 20, time: "40:00", kmh: 30, cadence: 85 }]);
    // the split and the work are numbers of a run
    expect(lapsOf(fit, 10)).not.toHaveProperty("split");
    expect(lapsOf(fit, 10)).not.toHaveProperty("work");
  });

  it("gives no split and no work for a walk", () => {
    const walkLap = { totalDistance: 1000, totalTimerTime: 600, enhancedAvgSpeed: 1000 / 600 };
    const fit = decodeFit(
      fitFile(
        [Profile.MesgNum.LAP, walkLap],
        [Profile.MesgNum.LAP, walkLap],
        [Profile.MesgNum.SESSION, { sport: "walking" }],
      ),
      15,
    );
    const answer = lapsOf(fit, 15);
    expect(answer.laps[0]).toMatchObject({ pace: "10:00/km" });
    expect(answer).not.toHaveProperty("split");
    expect(answer).not.toHaveProperty("work");
  });

  it("gives the workout step of a lap, so the reps of one drill stay together", () => {
    const fit = decodeFit(
      fitFile(
        [Profile.MesgNum.LAP, { totalTimerTime: 30, intensity: "warmup", wktStepIndex: 0 }],
        [Profile.MesgNum.LAP, { totalTimerTime: 30, intensity: "active", wktStepIndex: 2 }],
        [Profile.MesgNum.LAP, { totalTimerTime: 5, intensity: "cooldown" }],
      ),
      12,
    );
    const laps = lapsOf(fit, 12).laps;
    expect(laps).toEqual([
      // step 0 is a real step (the warm-up), not a missing one
      { lap: 1, km: 0, time: "0:30", intensity: "warmup", step: 0 },
      { lap: 2, km: 0, time: "0:30", intensity: "active", step: 2 },
      { lap: 3, km: 0, time: "0:05", intensity: "cooldown" },
    ]);
    // the lap that ends the session has no step at all, not an undefined one
    expect(laps[2]).not.toHaveProperty("step");
  });

  it("gives the running form of a lap: ground contact, vertical ratio and oscillation, stride", () => {
    const fit = decodeFit(
      fitFile(
        [
          Profile.MesgNum.LAP,
          {
            totalTimerTime: 30,
            avgStanceTime: 261.5,
            avgVerticalRatio: 6.86,
            avgVerticalOscillation: 81.7,
            avgStepLength: 1339,
          },
        ],
        [Profile.MesgNum.SESSION, { sport: "running" }],
      ),
      13,
    );
    // the names and units of the activity summary: mm become cm
    expect(lapsOf(fit, 13).laps[0]).toMatchObject({
      gctMs: 262,
      vertRatioPct: 6.9,
      vertOscCm: 8.2,
      strideCm: 133.9,
    });
  });

  it("has no sport when the file has no session", () => {
    const fit = decodeFit(fitFile([Profile.MesgNum.LAP, { totalTimerTime: 3725 }]), 11);
    expect(lapsOf(fit, 11)).toEqual({ activityId: 11, laps: [{ lap: 1, km: 0, time: "1:02:05" }] });
  });
});

describe("run numbers of the laps", () => {
  it("gives the half split and the HR drift of a steady run", () => {
    const r = runNumbers([lap(1, "5:00", "5:00/km", 150), lap(1, "4:50", "4:50/km", 162)]);
    // 45,000 beats for the first km, 46,980 for the second: 4.2% less distance per beat
    expect(r).toEqual({
      split: { firstPace: "5:00/km", secondPace: "4:50/km", kind: "negative", hrDriftPct: 4.2 },
    });
  });

  it("gives no HR drift when a counted lap has no HR", () => {
    const r = runNumbers([lap(1, "5:00", "5:00/km", 150), lap(1, "5:00", "5:00/km")]);
    expect(r.split).toEqual({
      firstPace: "5:00/km",
      secondPace: "5:00/km",
      kind: "even",
      hrDriftPct: null,
    });
    // a warm-up without HR does not count: the drift stays
    const warm = runNumbers([
      lap(1, "7:00", "7:00/km", undefined, "warmup"),
      lap(1, "5:00", "5:00/km", 150),
      lap(1, "5:00", "5:00/km", 150),
    ]);
    expect(warm.split?.hrDriftPct).toBe(0);
  });

  it("gives a null split when fewer than 2 laps count", () => {
    expect(runNumbers([lap(1, "5:00", "5:00/km", 150)])).toEqual({ split: null });
    expect(runNumbers([])).toEqual({ split: null });
  });

  it("gives the reps and the fade of each step of a structured workout", () => {
    const r = runNumbers([
      lap(1, "6:00", "6:00/km", 130, "warmup"),
      lap(0.4, "1:36", "4:00/km", 170, "active", 2),
      lap(0.4, "1:38", "4:05/km", 172, "active", 2),
      // an open step that ends when you press lap gives a lap of a few metres: not a rep
      lap(0.01, "0:04", undefined, 150, "active", 3),
      lap(0.4, "1:40", "4:10/km", 175, "active", 2),
      lap(1, "4:30", "4:30/km", 168, "active", 4),
      lap(1, "6:30", "6:30/km", 125, "cooldown"),
    ]);
    // 564 s over 2.2 km; HR time-weighted: 96,036 beats / 564 s = 170.3
    expect(r.work).toEqual({
      reps: 4,
      pace: "4:16/km",
      avgHR: 170,
      fade: [{ step: 2, reps: 3, firstPace: "4:00/km", lastPace: "4:10/km", pct: 4.2 }],
    });
    expect(r.split).not.toBeNull();
  });

  it("gives a null average HR when a work lap has no HR", () => {
    const r = runNumbers([
      lap(1, "6:00", "6:00/km", 130, "warmup"),
      lap(1, "4:00", "4:00/km", 170, "interval"),
      lap(1, "4:06", "4:06/km", undefined, "interval"),
    ]);
    expect(r.work).toEqual({
      reps: 2,
      pace: "4:03/km",
      avgHR: null,
      // no step on the laps: one fade for all reps, without a step
      fade: [{ reps: 2, firstPace: "4:00/km", lastPace: "4:06/km", pct: 2.5 }],
    });
    expect(r.work?.fade[0]).not.toHaveProperty("step");
  });

  it("gives a null fade percentage for reps more than 15% apart", () => {
    const r = runNumbers([
      lap(1, "6:00", "6:00/km", 130, "warmup"),
      lap(1, "5:00", "5:00/km", 160, "active", 1),
      lap(0.5, "2:20", "4:40/km", 165, "active", 1),
    ]);
    expect(r.work?.fade).toEqual([
      { step: 1, reps: 2, firstPace: "5:00/km", lastPace: "4:40/km", pct: null },
    ]);
  });

  it("gives the split from km and time when the laps have no pace", () => {
    const r = runNumbers([lap(1, "5:00", undefined, 150), lap(1, "5:30", undefined, 150)]);
    expect(r).toEqual({
      split: { firstPace: "5:00/km", secondPace: "5:30/km", kind: "positive", hrDriftPct: 9.1 },
    });
  });

  it("adds under 5% to the laps of an interval run", () => {
    const laps = [
      fullLap(2, "12:00", "6:00/km", "warmup"),
      ...Array.from({ length: 8 }, (_, i) => [
        fullLap(0.4, "1:36", `4:0${i}/km`, "interval", 1),
        fullLap(0.01, "0:04", "6:40/km", "active", 2),
        fullLap(0.2, "1:30", "7:30/km", "recovery", 3),
      ]).flat(),
      fullLap(1, "6:30", "6:30/km", "cooldown"),
    ];
    expect(laps).toHaveLength(26);
    const before = JSON.stringify({ laps }).length;
    const after = JSON.stringify({ laps, ...runNumbers(laps) }).length;
    expect(runNumbers(laps).work?.fade).toHaveLength(1);
    expect(after).toBeLessThanOrEqual(before * 1.05);
  });
});

describe("FIT files", () => {
  it("unzips the .fit entry of a zipped download", () => {
    const fit = fitFile();
    const zip = zipSync({ "readme.txt": new Uint8Array([1]), "123_ACTIVITY.FIT": fit });
    expect(unzipFit(zip, 123)).toEqual(fit);
  });

  it("keeps a download that is not a zip", () => {
    const fit = fitFile();
    expect(unzipFit(fit, 1)).toBe(fit);
  });

  it("reports a zip without a .fit file", () => {
    const zip = zipSync({ "a.txt": new Uint8Array([1]) });
    expect(() => unzipFit(zip, 5)).toThrow(
      "The download of activity 5 is a zip without a .fit file",
    );
    expect(() => unzipFit(zip, 5)).toThrow(expect.objectContaining({ status: 200 }));
  });

  it("gives the status 200 to a download that is not a .FIT file", () => {
    const bytes = new Uint8Array(20);
    expect(() => unzipFit(bytes, 5)).toThrow("The download of activity 5 is not a .FIT file");
    expect(() => unzipFit(bytes, 5)).toThrow(expect.objectContaining({ status: 200 }));
  });

  it("reports a file it cannot decode", () => {
    const bytes = new TextEncoder().encode("not a fit file");
    expect(() => decodeFit(bytes, 6)).toThrow(/^Cannot decode the \.FIT file of 6: /);
    expect(() => decodeFit(bytes, 6)).toThrow(expect.objectContaining({ status: 200 }));
  });

  // The SDK returns the messages it read along with the error: a damaged file must give no partial sets.
  it.each([
    ["a wrong CRC", (b: Uint8Array) => b.map((v, i) => (i === b.length - 1 ? v ^ 0xff : v))],
    ["a cut file", (b: Uint8Array) => b.slice(0, b.length - 10)],
  ])("fails on a file with %s instead of returning part of it", (_, damage) => {
    const fit = fitFile(
      [
        Profile.MesgNum.SET,
        {
          setType: ACTIVE,
          repetitions: 5,
          category: [SQUAT],
          categorySubtype: [BARBELL_BOX_SQUAT],
        },
      ],
      [
        Profile.MesgNum.SET,
        {
          setType: ACTIVE,
          repetitions: 6,
          category: [SQUAT],
          categorySubtype: [BARBELL_BOX_SQUAT],
        },
      ],
    );
    expect(() => decodeFit(damage(fit), 8)).toThrow(/^Cannot decode the \.FIT file of 8: /);
  });
});

/** A .FIT file of one lap with this sport, decoded. */
const swimLap = (sport: string, fields: Record<string, unknown>) =>
  decodeFit(
    fitFile(
      [Profile.MesgNum.SESSION, { sport }],
      [
        Profile.MesgNum.LAP,
        { totalDistance: 100, totalTimerTime: 110, enhancedAvgSpeed: 100 / 110, ...fields },
      ],
    ),
    20,
  );

/** A .FIT file of a swim with these laps, decoded. */
const swimLaps = (...laps: Record<string, unknown>[]) =>
  decodeFit(
    fitFile(
      [Profile.MesgNum.SESSION, { sport: "swimming" }],
      ...laps.map((l): [number, Record<string, unknown>] => [Profile.MesgNum.LAP, l]),
    ),
    30,
  );
const rep = (metres: number, sec: number, swimStroke = "freestyle", avgSwolf = 40) => ({
  totalDistance: metres,
  totalTimerTime: sec,
  enhancedAvgSpeed: metres / sec,
  swimStroke,
  avgSwolf,
});

const plainSpeedRep = (sec: number) => ({
  totalDistance: 50,
  totalTimerTime: sec,
  avgSpeed: 50 / sec,
});

describe("lapsOf on a swim", () => {
  it("gives the pace per 100 m and the swim numbers of an interval", () => {
    const fit = swimLap("swimming", {
      swimStroke: "freestyle",
      numActiveLengths: 4,
      avgCadence: 30,
      avgSwolf: 42,
      totalCycles: 64,
    });
    expect(lapsOf(fit, 20).laps).toEqual([
      {
        lap: 1,
        km: 0.1,
        metres: 100,
        time: "1:50",
        kmh: 3.3,
        swimPace: "1:50/100 m",
        cadence: 30,
        stroke: "freestyle",
        lengths: 4,
        swolf: 42,
        strokes: 64,
      },
    ]);
  });

  it("reads the strokes of a lap that names its sport", () => {
    const fit = swimLap("swimming", { sport: "swimming", totalCycles: 64 });
    expect(lapsOf(fit, 23).laps[0]).toMatchObject({ strokes: 64 });
  });

  it("gives a rest lap no pace and no zero strokes", () => {
    const fit = swimLap("swimming", { totalDistance: 0, enhancedAvgSpeed: 0, totalCycles: 0 });
    const [rest] = lapsOf(fit, 21).laps;
    expect(rest).not.toHaveProperty("swimPace");
    expect(rest).not.toHaveProperty("strokes");
  });

  it("leaves the laps of another sport as they are", () => {
    const fit = swimLap("cycling", { swimStroke: "freestyle", avgSwolf: 42, totalCycles: 64 });
    const [ride] = lapsOf(fit, 22).laps;
    for (const key of ["swimPace", "stroke", "lengths", "swolf", "strokes"])
      expect(ride).not.toHaveProperty(key);
  });

  const rest = { totalDistance: 0, totalTimerTime: 20, enhancedAvgSpeed: 0 };

  it("compares the first and the last repeat of a set, over the rests between them", () => {
    const { sets } = lapsOf(swimLaps(rep(100, 100), rest, rep(100, 105), rest, rep(100, 110)), 30);
    expect(sets).toEqual([
      {
        reps: 3,
        metres: 100,
        stroke: "freestyle",
        firstPace: "1:40/100 m",
        lastPace: "1:50/100 m",
        pct: 10,
        firstSwolf: 40,
        lastSwolf: 40,
      },
    ]);
  });

  it("starts a new set at another distance or stroke, and needs 2 repeats", () => {
    const { sets } = lapsOf(
      swimLaps(
        rep(200, 240),
        rep(50, 50),
        rep(50, 52),
        rep(50, 60, "backstroke"),
        rep(50, 62, "backstroke"),
      ),
      31,
    );
    expect(sets!.map((x) => [x.metres, x.stroke, x.reps])).toEqual([
      [50, "freestyle", 2],
      [50, "backstroke", 2],
    ]);
  });

  it("has no sets for a swim without laps, and leaves out a lap without a distance or a speed", () => {
    expect(lapsOf(swimLaps(), 36).sets).toEqual([]);
    const { sets } = lapsOf(
      swimLaps(
        { totalTimerTime: 20 },
        { totalDistance: 50, totalTimerTime: 50 },
        rep(100, 100),
        rep(100, 110),
      ),
      37,
    );
    expect(sets).toMatchObject([{ reps: 2, metres: 100 }]);
  });

  it("reads the speed of a lap that has only the average speed", () => {
    expect(lapsOf(swimLaps(plainSpeedRep(50), plainSpeedRep(55)), 38).sets).toMatchObject([
      { firstPace: "1:40/100 m", lastPace: "1:50/100 m", pct: 10 },
    ]);
  });

  it("gives a rest 0 metres, and a lap without a distance no metres", () => {
    const { laps } = lapsOf(
      swimLaps({ totalDistance: 0, totalTimerTime: 20 }, { totalTimerTime: 20 }),
      39,
    );
    expect(laps[0].metres).toBe(0);
    expect(laps[1]).not.toHaveProperty("metres");
  });

  it("keeps a warm-up of the same distance out of the set", () => {
    const { sets } = lapsOf(
      swimLaps(
        { ...rep(100, 130), intensity: "warmup" },
        { ...rep(100, 100), intensity: "active" },
        { ...rep(100, 102), intensity: "active" },
      ),
      35,
    );
    expect(sets).toMatchObject([{ reps: 2, firstPace: "1:40/100 m", lastPace: "1:42/100 m" }]);
  });

  it("shows a missing SWOLF as null and gives no stroke when the laps have none", () => {
    const plain = { totalDistance: 50, totalTimerTime: 50, enhancedAvgSpeed: 1 };
    expect(lapsOf(swimLaps(plain, plain), 32).sets).toEqual([
      {
        reps: 2,
        metres: 50,
        firstPace: "1:40/100 m",
        lastPace: "1:40/100 m",
        pct: 0,
        firstSwolf: null,
        lastSwolf: null,
      },
    ]);
  });

  it("gives an empty list without a repeated set, and no sets for another sport", () => {
    expect(lapsOf(swimLaps(rep(1000, 1200)), 33).sets).toEqual([]);
    expect(lapsOf(swimLap("cycling", {}), 34)).not.toHaveProperty("sets");
  });
});
