import { Profile } from "@garmin/fitsdk";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  decodeFit,
  exerciseName,
  groupSets,
  lapsOf,
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

describe("exercise names", () => {
  it("exerciseNameFromTheSdkNameList", () => {
    expect(
      exerciseName(
        value("exerciseCategory", "benchPress"),
        value("benchPressExerciseName", "inclineSmithMachineBenchPress"),
        "Panca inclinata",
      ),
    ).toBe("Incline Smith Machine Bench Press");
  });

  it("exerciseNameFallsBackToTheCategory", () => {
    expect(exerciseName(value("exerciseCategory", "legRaise"), undefined, undefined)).toBe(
      "Leg Raise",
    );
    expect(exerciseName(value("exerciseCategory", "curl"), 9999, undefined)).toBe("Curl");
  });

  it("customExerciseUsesTheWorkoutStepName", () => {
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
  it("restPeriodBecomesRestSecOnThePreviousSet", () => {
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

  it("musclesComeFromTheExerciseCatalogue", () => {
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
        },
      ],
    });
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
  });

  it("has no sport when the file has no session", () => {
    const fit = decodeFit(fitFile([Profile.MesgNum.LAP, { totalTimerTime: 3725 }]), 11);
    expect(lapsOf(fit, 11)).toEqual({ activityId: 11, laps: [{ lap: 1, km: 0, time: "1:02:05" }] });
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
    expect(() => unzipFit(zipSync({ "a.txt": new Uint8Array([1]) }), 5)).toThrow(
      "The download of activity 5 is a zip without a .fit file",
    );
  });

  it("reports a file it cannot decode", () => {
    expect(() => decodeFit(new TextEncoder().encode("not a fit file"), 6)).toThrow(
      /^Cannot decode the \.FIT file of 6: /,
    );
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
