import { describe, expect, it } from "vitest";
import {
  completed,
  exerciseStats,
  missingSets,
  muscleGroup,
  muscleSets,
  pushPull,
  setsByCategory,
  slug,
} from "../../src/page/strength";
import { addDays } from "../../src/dates";

const squat = (sets: Record<string, number>[]) => ({
  exercise: "Back Squat",
  category: "Squat",
  primaryMuscles: ["Quads"],
  secondaryMuscles: ["Glutes", "Lower Back"],
  sets,
});
const plank = {
  exercise: "Plank",
  category: "Plank",
  primaryMuscles: ["Abs"],
  sets: [{ seconds: 60 }, { seconds: 45 }],
};
const pushUp = {
  exercise: "Push Up",
  category: "Push Up",
  primaryMuscles: ["Chest"],
  secondaryMuscles: ["Triceps"],
  sets: [{ reps: 20 }, { reps: 15 }],
};
const acts = [
  {
    id: 2,
    name: "Strength B",
    type: "strength_training",
    start: "2026-10-22 18:00:00",
    exercises: [
      squat([
        { reps: 8, kg: 60, restSec: 90 },
        { reps: 0, kg: 80 },
        { reps: 6, kg: 70, restSec: 120 },
      ]),
      plank,
    ],
  },
  {
    id: 1,
    name: "Strength A",
    type: "strength_training",
    start: "2026-10-15 18:00:00",
    exercises: [squat([{ reps: 8, kg: 55, restSec: 60 }]), pushUp],
  },
];

/** Pull-up sessions, one each `days` days from 1 Sep, with these max reps. */
const pullUps = (reps: number[], days = 7) =>
  exerciseStats(
    reps.map((n, i) => ({
      start: `${addDays("2026-09-01", i * days)} 18:00:00`,
      exercises: [{ exercise: "Pull Up", sets: [{ reps: n }] }],
    })),
  )[0];

describe("sets", () => {
  it("counts a set as done when it has reps, or time without reps", () => {
    expect(completed({ reps: 8, kg: 60 })).toBe(true);
    expect(completed({ reps: 0, kg: 80 })).toBe(false);
    expect(completed({ seconds: 60 })).toBe(true);
    expect(completed({})).toBe(false);
  });
});

describe("muscle groups", () => {
  it.each([
    ["Chest", "chest"],
    ["Lats", "back"],
    ["Traps", "back"],
    ["Lower Back", "back"],
    ["Shoulders", "shoulders"],
    ["Forearm", "forearms"],
    ["Obliques", "abs"],
    ["Adductors", "hips"],
    ["Hamstrings", "hamstrings"],
    ["Neck", "other"],
  ])("%s is %s", (muscle, group) => {
    expect(muscleGroup(muscle)).toBe(group);
  });

  it("counts a set 1 for each primary group and 0.5 for each secondary group", () => {
    const sets = muscleSets(acts, ["2026-10-12", "2026-10-19"]);
    // week of 12 Oct: squat 1 set (quads 1; glutes and back 0.5), push up 2 sets (chest 2, triceps 1)
    expect(sets.quads).toEqual([1, 2]);
    expect(sets.glutes).toEqual([0.5, 1]);
    expect(sets.back).toEqual([0.5, 1]);
    expect(sets.chest).toEqual([2, 0]);
    expect(sets.triceps).toEqual([1, 0]);
    expect(sets.abs).toEqual([0, 2]);
  });

  it("gives push against pull sets", () => {
    expect(pushPull({ chest: [2], shoulders: [1], triceps: [1], back: [2], biceps: [0] })).toBe(2);
    expect(pushPull({ chest: [2] })).toBeNull();
  });
});

describe("categories", () => {
  it("counts completed sets of each movement category per week", () => {
    expect(setsByCategory(acts, ["2026-10-12", "2026-10-19"])).toEqual({
      Squat: [1, 2],
      "Push Up": [2, 0],
      Plank: [0, 2],
    });
  });
});

describe("sessions without sets", () => {
  // past the 30 newest sessions, or a .FIT file that could not be read
  const noSets = { id: 3, type: "strength_training", start: "2026-10-23 18:00:00" };
  const weeks = ["2026-10-12", "2026-10-19", "2026-10-26"];
  const withGap = [noSets, ...acts];

  it("leaves out each week that holds a session without sets, not one cut-off date", () => {
    expect(missingSets(withGap, weeks)).toEqual({ sessions: 1, weeks: new Set([1]) });
    // the week of 19 Oct has sets of one session and none of the other: not a real count
    expect(setsByCategory(withGap, weeks)).toEqual({
      Squat: [1, null, 0],
      "Push Up": [2, null, 0],
      Plank: [0, null, 0],
    });
    expect(muscleSets(withGap, weeks).quads).toEqual([1, null, 0]);
  });

  it("counts a week without strength sessions as 0 and ignores other sports", () => {
    const run = { id: 4, type: "running", start: "2026-10-27 07:00:00" };
    expect(missingSets([run, ...acts], weeks)).toEqual({ sessions: 0, weeks: new Set() });
    expect(setsByCategory([run, ...acts], weeks).Squat).toEqual([1, 2, 0]);
  });

  it("gives push against pull from the complete weeks only", () => {
    expect(pushPull({ chest: [2, null], back: [1, null] })).toBe(2);
  });
});

describe("exercise stats", () => {
  const stats = exerciseStats(acts);

  it("gives the top set, volume and estimated 1RM of each session, oldest first", () => {
    const s = stats.find((x) => x.name === "Back Squat")!;
    expect(s.kind).toBe("weight");
    expect(s.muscle).toBe("quads");
    expect(s.sessions.map((x) => [x.date, x.top, x.volume])).toEqual([
      ["2026-10-15", { kg: 55, reps: 8 }, 440],
      ["2026-10-22", { kg: 70, reps: 6 }, 900],
    ]);
    expect(s.sessions[1].e1rm).toBe(84);
    expect(s.best1rm).toBe(84);
    // the top set and the 1RM from the first to the last session
    expect(s.change).toBeCloseTo(((84 - 55 * (1 + 8 / 30)) / (55 * (1 + 8 / 30))) * 100, 6);
    expect(s.medianRest).toBe(90);
  });

  it("uses reps for exercises without weight, and seconds for timed ones", () => {
    const push = stats.find((x) => x.name === "Push Up")!;
    expect(push.kind).toBe("reps");
    expect(push.sessions[0]).toMatchObject({ maxReps: 20, reps: 35 });
    const p = stats.find((x) => x.name === "Plank")!;
    expect(p.kind).toBe("time");
    expect(p.sessions[0].longest).toBe(60);
  });

  it("counts sets of 1 rep with a time as timed, as the watch records a plank", () => {
    const timed = exerciseStats([
      {
        start: "2026-10-01 18:00:00",
        exercises: [
          {
            exercise: "Plank",
            sets: [
              { reps: 1, seconds: 45 },
              { reps: 1, seconds: 50 },
            ],
          },
        ],
      },
    ])[0];
    expect(timed.kind).toBe("time");
    expect(timed.sessions[0].longest).toBe(50);
  });

  it("compares the best of the last 3 sessions with the best of the first 3 from 6 sessions", () => {
    // one good first day and one bad last day do not decide the change
    expect(pullUps([12, 8, 8, 10, 10, 6]).change).toBe(((10 - 12) / 12) * 100);
    expect(pullUps([8, 9, 10, 12, 11, 10]).change).toBe(((12 - 10) / 10) * 100);
    // under 6 sessions: the first against the last
    expect(pullUps([8, 9, 10, 12, 11]).change).toBe(((11 - 8) / 8) * 100);
  });

  it("marks a lift progressing, stalled or down against the sessions just before the last ones", () => {
    expect(pullUps([8, 9, 10, 11]).status).toBe("up");
    expect(pullUps([8, 10, 9, 10, 10]).status).toBe("stalled");
    // more than 5% under the best of the sessions before
    expect(pullUps([8, 10, 9, 9, 9]).status).toBe("down");
    expect(pullUps([20, 20, 19, 19, 19]).status).toBe("stalled");
    // one lucky day long ago does not block a new best: only as many sessions before count
    expect(pullUps([14, 8, 8, 8, 9, 9, 9, 10, 10, 10]).status).toBe("up");
  });

  it("takes the sessions of 14 days or more, so a lift done twice a week gets a status too", () => {
    // every 3 days: the last 6 sessions span 15 days, against the 4 before them
    expect(pullUps([8, 9, 10, 10, 10, 10, 10, 10, 10, 10], 3).status).toBe("stalled");
    expect(pullUps([8, 9, 10, 10, 10, 10, 10, 10, 10, 11], 3).status).toBe("up");
  });

  it("gives no status to a timed exercise: its set time follows the lap button, not strength", () => {
    const hold = exerciseStats(
      [60, 45, 50, 30, 30].map((seconds, i) => ({
        start: `${addDays("2026-09-01", i * 7)} 18:00:00`,
        exercises: [{ exercise: "Plank", sets: [{ reps: 1, seconds }] }],
      })),
    )[0];
    expect(hold.kind).toBe("time");
    expect(hold.status).toBeNull();
  });

  it("gives no status without sessions before the last 14 days, or before 4 sessions", () => {
    expect(pullUps([8, 9, 10]).status).toBeNull();
    // 4 sessions over 18 days: all of them are the last 14 days or more
    expect(pullUps([10, 9, 10, 10], 6).status).toBeNull();
    expect(pullUps([10, 9, 10, 10], 7).status).toBe("stalled");
  });

  it("makes a URL name of the exercise", () => {
    expect(slug("Barbell Back Squat")).toBe("barbell-back-squat");
    expect(slug("Pull-Up (Assisted)")).toBe("pull-up-assisted");
  });

  it("keeps the letters of any script in the URL name", () => {
    expect(slug("Жим лёжа")).toBe("жим-лёжа");
    expect(slug("腹筋")).toBe("腹筋");
    expect(slug("Développé couché")).toBe("développé-couché");
    // a mark such as a Devanagari vowel sign stays inside its word
    expect(slug("दंड बैठक")).toBe("दंड-बैठक");
  });

  it("uses the name itself when it has no letter or digit", () => {
    expect(slug("💪")).toBe("💪");
  });
});
