import { describe, expect, it } from "vitest";
import {
  bestE1rm,
  completed,
  exerciseStats,
  median,
  missingSets,
  muscleGroup,
  muscleSets,
  planAdherence,
  planOfSets,
  type PlanStep,
  pushPull,
  recentWindow,
  setsByCategory,
  slug,
  topSet,
} from "../../src/analytics/strength";
import { epley } from "../../src/analytics/metrics";
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

const inSeptember = (...d: string[]) => d.map((x) => ({ date: `2026-09-${x}` }));

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

  it("counts an exercise without catalogue muscles under other", () => {
    const sets = muscleSets(
      [
        {
          start: "2026-10-15 18:00:00",
          exercises: [{ exercise: "Sled Push", sets: [{ reps: 8 }] }],
        },
      ],
      ["2026-10-12"],
    );
    expect(sets).toEqual({ other: [1] });
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

/** A strength session without sets, as one past the 30 newest. */
const withoutSets = (id: number, start: string) => ({ id, type: "strength_training", start });

describe("sessions without sets", () => {
  // past the 30 newest sessions, or a .FIT file that could not be read
  const noSets = { id: 3, type: "strength_training", start: "2026-10-23 18:00:00" };
  const weeks = ["2026-10-12", "2026-10-19", "2026-10-26"];
  const withGap = [noSets, ...acts];

  it("leaves out each week that holds a session without sets, not one cut-off date", () => {
    // the week of 12 Oct still holds a session with all its sets
    expect(missingSets(withGap, weeks)).toEqual({ sessions: 1, weeks: new Set([1]), complete: 1 });
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
    expect(missingSets([run, ...acts], weeks)).toEqual({
      sessions: 0,
      weeks: new Set(),
      complete: 2,
    });
    expect(setsByCategory([run, ...acts], weeks).Squat).toEqual([1, 2, 0]);
  });

  it("counts no complete week when each week with strength holds a session without sets", () => {
    const gaps = [
      withoutSets(5, "2026-10-14 18:00:00"),
      withoutSets(6, "2026-10-21 18:00:00"),
      ...acts,
    ];
    // the empty week of 26 Oct is a real 0, but it is no week of sets
    expect(missingSets(gaps, weeks)).toMatchObject({ sessions: 2, complete: 0 });
  });

  it("gives push against pull from the complete weeks only", () => {
    expect(pushPull({ chest: [2, null], back: [1, null] })).toBe(2);
  });
});

describe("sessions that count nowhere", () => {
  const weeks = ["2026-10-12", "2026-10-19"];
  const early = { ...acts[1], id: 3, start: "2026-09-01 18:00:00" };
  // a muscle group that no other session trains: a counted session would add its row
  const neck = { exercise: "Neck Curl", category: "Neck", primaryMuscles: ["Neck"] };
  const undone = { ...acts[1], id: 4, exercises: [{ ...neck, sets: [{ reps: 0, kg: 10 }] }] };
  const undated = { ...acts[1], id: 5, start: undefined };

  it("counts only the completed sets of the sessions inside the weeks", () => {
    expect(muscleSets([early, undone, ...acts], weeks)).toEqual(muscleSets(acts, weeks));
    expect(setsByCategory([early, undone, ...acts], weeks)).toEqual(setsByCategory(acts, weeks));
  });

  it("leaves a session without a date out of the exercise stats", () => {
    expect(exerciseStats([undated, ...acts])).toEqual(exerciseStats(acts));
  });
});

describe("median", () => {
  it("is the middle value, the mean of the two middle values, or nothing", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeUndefined();
  });
});

describe("exercise stats", () => {
  const stats = exerciseStats(acts);

  it("leaves out an exercise of a session where no set was done", () => {
    const skipped = exerciseStats([
      {
        start: "2026-10-22 18:00:00",
        exercises: [
          { exercise: "Pull Up", sets: [{ reps: 0 }, { reps: 0 }] },
          { exercise: "Dip", sets: [{ reps: 0, kg: 20 }] },
        ],
      },
      {
        start: "2026-10-15 18:00:00",
        exercises: [{ exercise: "Pull Up", sets: [{ reps: 8 }] }],
      },
      {
        start: "2026-10-08 18:00:00",
        exercises: [{ exercise: "Pull Up", sets: [{ reps: 0 }, { reps: 5 }] }],
      },
    ]);
    // Dip was never done: no entry; Pull Up has only the sessions with one set done or more
    expect(skipped.map((s) => s.name)).toEqual(["Pull Up"]);
    expect(skipped[0].sessions.map((s) => [s.date, s.maxReps])).toEqual([
      ["2026-10-08", 5],
      ["2026-10-15", 8],
    ]);
  });

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
    // a heavier set of 13 reps is not the top set: the 12 reps set is
    const heavy = exerciseStats([
      {
        start: "2026-10-29 18:00:00",
        exercises: [
          squat([
            { reps: 13, kg: 90 },
            { reps: 12, kg: 80 },
          ]),
        ],
      },
    ])[0];
    expect(heavy.sessions[0].top).toEqual({ kg: 80, reps: 12 });
    expect(heavy.sessions[0].e1rm).toBe(epley(80, 12));
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
    expect(pullUps([8, 8, 8, 9, 9, 11]).status).toBe("up");
    expect(pullUps([8, 10, 9, 9, 10, 10]).status).toBe("stalled");
    // more than 5% under the best of the sessions before
    expect(pullUps([8, 10, 9, 9, 9, 9]).status).toBe("down");
    expect(pullUps([20, 20, 20, 19, 19, 19]).status).toBe("stalled");
    // one lucky day long ago does not block a new best: only as many sessions before count
    expect(pullUps([14, 8, 8, 8, 9, 9, 9, 10, 10, 10]).status).toBe("up");
  });

  it("takes the sessions of 14 days or more, so a lift done twice a week gets a status too", () => {
    // every 3 days: the last 6 sessions span 15 days, against the 6 before them
    const flat = [8, 9, 10, 10, 10, 10];
    expect(pullUps([...flat, 10, 10, 10, 10, 10, 10], 3).status).toBe("stalled");
    expect(pullUps([...flat, 10, 10, 10, 10, 10, 11], 3).status).toBe("up");
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

  it("gives no status with fewer sessions before the last ones than in them", () => {
    expect(pullUps([8, 9, 10]).status).toBeNull();
    // 3 sessions against 1 or 2: one good day would decide the tag
    expect(pullUps([8, 9, 10, 11]).status).toBeNull();
    expect(pullUps([8, 10, 9, 9, 9]).status).toBeNull();
    expect(pullUps([8, 9, 10, 10, 10, 10]).status).toBe("stalled");
    // every 6 days: the last 3 span 12 days, so 4 sessions against as many
    expect(pullUps([9, 9, 9, 10, 10, 10, 10], 6).status).toBeNull();
    expect(pullUps([9, 9, 9, 10, 10, 10, 10, 10], 6).status).toBe("stalled");
  });

  it("takes the recent window from the newest sessions, at 14 days exactly", () => {
    expect(recentWindow([])).toBeNull();
    // 14 days from the third newest to the newest: 3 sessions are enough
    expect(recentWindow(inSeptember("01", "02", "03", "10", "17", "24"))).toBe(3);
    // 13 days: one session more, and then too few before them
    expect(recentWindow(inSeptember("01", "02", "03", "11", "17", "24"))).toBeNull();
    expect(recentWindow(inSeptember("01", "02", "03", "04", "05", "11", "17", "24"))).toBe(4);
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

describe("top set and e1RM", () => {
  it("takes the heaviest set of 1 to 12 reps before a heavier set of more reps", () => {
    const sets = [
      { reps: 12, kg: 80 },
      { reps: 13, kg: 90 },
    ];
    expect(topSet(sets)).toEqual({ kg: 80, reps: 12 });
    expect(bestE1rm(sets)).toBe(epley(80, 12));
  });

  it("takes the most reps at the same weight", () => {
    expect(
      topSet([
        { reps: 5, kg: 80 },
        { reps: 8, kg: 80 },
      ]),
    ).toEqual({ kg: 80, reps: 8 });
  });

  it("takes the heaviest set when no set has 1 to 12 reps", () => {
    const sets = [
      { reps: 15, kg: 40 },
      { reps: 20, kg: 50 },
    ];
    expect(topSet(sets)).toEqual({ kg: 50, reps: 20 });
    expect(bestE1rm(sets)).toBeUndefined();
  });

  it("has no top set without a weighted done set", () => {
    const noTop = [
      [{ reps: 10 }],
      [{ seconds: 60, reps: 1 }],
      // a timed set with weight and no reps
      [{ seconds: 30, kg: 20 }],
      [{ reps: 0, kg: 100 }],
      [],
    ];
    for (const sets of noTop) {
      expect(topSet(sets)).toBeUndefined();
      expect(bestE1rm(sets)).toBeUndefined();
    }
  });

  it("gives the best e1RM of all sets of 1 to 12 reps, not the e1RM of the top set", () => {
    const sets = [
      { reps: 1, kg: 100 },
      { reps: 10, kg: 90 },
      { reps: 15, kg: 95 },
    ];
    expect(topSet(sets)).toEqual({ kg: 100, reps: 1 });
    expect(bestE1rm(sets)).toBe(120);
    expect(epley(90, 10)).toBe(120);
  });
});

const step = (index: number, more: Partial<PlanStep> = {}): PlanStep => ({
  index,
  intensity: "active",
  exercise: "Back Squat",
  ...more,
});
const rest = (index: number): PlanStep => ({
  index,
  intensity: "rest",
  durationType: "time",
  durationValue: 90_000,
});
const repeat = (index: number, from: number | undefined, times: number | undefined): PlanStep => ({
  index,
  durationType: "repeat_until_steps_cmplt",
  durationValue: from,
  targetValue: times,
});
const range = (low: number, high: number | undefined): Partial<PlanStep> => ({
  targetType: "reps",
  targetLow: low,
  targetValue: high,
});
const done = (
  stepIndex: number | undefined,
  reps: number | undefined,
  exercise = "Back Squat",
) => ({
  step: stepIndex,
  exercise,
  reps,
  seconds: 30,
});
/** Back Squat, 3 x 8-12 reps: step 0 in a block of 3 with a rest. */
const block = (more: Partial<PlanStep> = range(8, 12)) => [step(0, more), rest(1), repeat(2, 0, 3)];
const squatRow = (more: Record<string, unknown>) => ({
  exercise: "Back Squat",
  steps: [0],
  plannedSets: 3,
  plannedReps: { low: 8, high: 12 },
  plannedRestSec: [90],
  doneSets: 3,
  reps: [10, 10, 10],
  verdict: "hit",
  why: [],
  over: 0,
  extra: 0,
  ...more,
});

/** A rest step of `ms` milliseconds; none is an open rest (lap button). */
const restOf = (index: number, ms?: number): PlanStep => ({
  index,
  intensity: "rest",
  durationType: ms === undefined ? "open" : "time",
  ...(ms === undefined ? {} : { durationValue: ms }),
});
/** Back Squat sets of these reps, on step 0. */
const squatSets = (...reps: number[]) => reps.map((r) => done(0, r));

const verdictOf = (steps: PlanStep[], reps: number[]) => {
  const row = planOfSets(steps, squatSets(...reps))[0];
  return [row.verdict, row.why, row.over];
};

describe("plan of the sets", () => {
  it("plans the active steps times the repeats of the block around them", () => {
    expect(planOfSets(block(), [done(0, 10), done(0, 10), done(0, 10)])).toEqual([squatRow({})]);
  });

  it.each([
    [2, "miss", ["sets"], 0],
    [3, "hit", [], 0],
    [4, "hit", [], 1],
  ])("gives %i done sets of 3 planned: %s %j, extra %i", (count, verdict, why, extra) => {
    const sets = Array.from({ length: count }, () => done(0, 10));
    expect(planOfSets(block(), sets)).toEqual([
      squatRow({ doneSets: count, reps: sets.map(() => 10), verdict, why, extra }),
    ]);
  });

  it.each([
    [7, "miss", ["reps"], 0],
    [8, "hit", [], 0],
    [12, "hit", [], 0],
    [13, "hit", [], 1],
  ])("judges a set of %i reps against 8-12: %s %j, over %i", (reps, verdict, why, over) => {
    expect(planOfSets(block(), [done(0, 10), done(0, reps), done(0, 10)])).toEqual([
      squatRow({ reps: [10, reps, 10], verdict, why, over }),
    ]);
  });

  it("gives both reasons for too few sets with too few reps", () => {
    expect(planOfSets(block(), [done(0, 10), done(0, 7)])).toEqual([
      squatRow({ doneSets: 2, reps: [10, 7], verdict: "miss", why: ["sets", "reps"] }),
    ]);
  });

  it.each([
    [8, 0, null],
    [8, 6, null],
    [8, 8, 8],
    [0, 0, null],
    [8, undefined, null],
  ])("reads the rep range %j to %j as a high end of %j", (low, high, planned) => {
    const [row] = planOfSets(block(range(low, high)), [done(0, 20), done(0, 20), done(0, 20)]);
    expect(row.plannedReps).toEqual({ low, high: planned });
    // more reps than an open range has no top to go over
    expect(row.over).toBe(planned === null ? 0 : 3);
  });

  it("reads a reps duration as a range of one value, and none without its value or low end", () => {
    const reps = { durationType: "reps", durationValue: 10 };
    expect(planOfSets(block(reps), [])[0].plannedReps).toEqual({ low: 10, high: 10 });
    const noValue = { durationType: "reps" };
    expect(planOfSets(block(noValue), [])[0].plannedReps).toBeNull();
    const noLow = { targetType: "reps", targetValue: 12 };
    expect(planOfSets(block(noLow), [])[0].plannedReps).toBeNull();
  });

  it("does not count a set of 0 reps as done", () => {
    expect(planOfSets(block(), [done(0, 10), done(0, 0), done(0, 10)])).toEqual([
      squatRow({ doneSets: 2, reps: [10, 10], verdict: "miss", why: ["sets"] }),
    ]);
  });

  it.each([
    [3, "hit", [] as string[]],
    [2, "miss", ["sets"]],
  ])("judges %i sets of a timed step by the sets only: %s", (count, verdict, why) => {
    const timedStep = { exercise: "Plank", durationType: "time", durationValue: 60_000 };
    const sets = Array.from({ length: count }, () => ({ step: 0, exercise: "Plank", seconds: 60 }));
    expect(planOfSets(block(timedStep), sets)).toEqual([
      squatRow({
        exercise: "Plank",
        plannedReps: null,
        doneSets: count,
        reps: null,
        verdict,
        why,
      }),
    ]);
  });

  it("shows the reps of an open step and of a set without reps, and judges the sets only", () => {
    expect(planOfSets(block({}), [done(0, 10), done(0, 15), done(0, 5)])).toEqual([
      squatRow({ plannedReps: null, reps: [10, 15, 5] }),
    ]);
    const timedSet = { step: 0, exercise: "Back Squat", seconds: 40 };
    expect(planOfSets(block(), [done(0, 10), timedSet, done(0, 10)])).toEqual([
      squatRow({ reps: [10, null, 10] }),
    ]);
  });

  it("gives a warm-up and a cool-down step their part and no verdict", () => {
    const steps = [
      step(0, { intensity: "warmup", exercise: "Push Up" }),
      step(1, range(8, 12)),
      rest(2),
      repeat(3, 1, 3),
      step(4, { intensity: "cooldown", exercise: "Stretch" }),
    ];
    const out = planOfSets(steps, [done(0, 10, "Push Up"), done(4, 1, "Stretch")]);
    const none = {
      plannedReps: null,
      plannedRestSec: [],
      verdict: null,
      why: [],
      over: 0,
      extra: 0,
    };
    expect(out).toEqual([
      {
        ...none,
        exercise: "Push Up",
        steps: [0],
        plannedSets: 1,
        doneSets: 1,
        reps: [10],
        part: "warmup",
      },
      squatRow({ steps: [1], doneSets: 0, reps: [], verdict: "miss", why: ["sets"] }),
      {
        ...none,
        exercise: "Stretch",
        steps: [4],
        plannedSets: 1,
        doneSets: 1,
        reps: [1],
        part: "cooldown",
      },
    ]);
  });

  it("lists the done sets that point at no exercise step after the plan, as not in the plan", () => {
    const sets = [
      done(9, 5, "Curl"),
      done(0, 10),
      done(undefined, 6, "Curl"),
      // a step that is in the plan but is a rest
      done(1, 8, "Dip"),
      done(9, 0, "Row"),
    ];
    const none = {
      steps: [],
      plannedSets: null,
      plannedReps: null,
      verdict: null,
      why: [],
      over: 0,
      extra: 0,
    };
    expect(planOfSets(block(), sets)).toEqual([
      squatRow({ doneSets: 1, reps: [10], verdict: "miss", why: ["sets"] }),
      { ...none, exercise: "Curl", doneSets: 2, reps: [5, 6], notInPlan: true },
      { ...none, exercise: "Dip", doneSets: 1, reps: [8], notInPlan: true },
    ]);
  });

  it.each([
    ["a first step past the repeat", 7, 3],
    ["no first step", undefined, 3],
    ["0 repeats", 0, 0],
    ["-1 repeats", 0, -1],
    ["1.5 repeats", 0, 1.5],
    ["no repeat count", 0, undefined],
  ])("counts a repeat with %s as one pass", (_, from, times) => {
    const steps = [step(0, range(8, 12)), rest(1), repeat(2, from, times)];
    expect(planOfSets(steps, [])[0].plannedSets).toBe(1);
  });

  describe("rest-pause", () => {
    /** Back Squat 8-12 as rest-pause: a set and a mini set 20 s apart, 2 min after the group; null: no rest after. */
    const restPause = (
      inner: PlanStep = restOf(1, 20_000),
      after: PlanStep | null = restOf(3, 120_000),
    ) => [step(0, range(8, 12)), inner, repeat(2, 0, 2), ...(after ? [after] : [])];
    const outer = [...restPause(), repeat(4, 0, 3)];

    it("does not count a mini set under the plan as a miss, and shows every set", () => {
      const [row] = planOfSets(restPause(), squatSets(10, 4));
      expect([row.verdict, row.why, row.over, row.reps, row.doneSets]).toEqual([
        "hit",
        [],
        0,
        [10, 4],
        2,
      ]);
    });

    it("judges the first set of the group", () => {
      expect(verdictOf(restPause(), [7, 4])).toEqual(["miss", ["reps"], 0]);
    });

    it("takes an open inner rest as a rest-pause", () => {
      expect(verdictOf(restPause(restOf(1)), [10, 4])).toEqual(["hit", [], 0]);
    });

    it.each([
      ["an inner rest of 21 s", restPause(restOf(1, 21_000))],
      ["no rest after the block", restPause(undefined, null)],
      ["a rest of 20 s after the block", restPause(undefined, restOf(3, 20_000))],
      ["an open rest after the block", restPause(undefined, restOf(3))],
      [
        "a timed inner rest without a duration",
        restPause({ index: 1, intensity: "rest", durationType: "time" }),
      ],
      [
        "a timed rest after the block without a duration",
        restPause(undefined, { index: 3, intensity: "rest", durationType: "time" }),
      ],
      [
        "a block without an exercise step",
        [
          step(0, range(8, 12)),
          restOf(1, 20_000),
          restOf(2, 20_000),
          repeat(3, 1, 2),
          restOf(4, 120_000),
        ],
      ],
      [
        "an exercise step right after the block",
        restPause(undefined, {
          index: 3,
          intensity: "active",
          exercise: "Plank",
          durationType: "time",
          durationValue: 60_000,
        }),
      ],
      [
        "a short step inside the block that is not a rest",
        restPause({ index: 1, intensity: "active", durationType: "time", durationValue: 10_000 }),
      ],
      [
        "a repeat without a first step",
        [step(0, range(8, 12)), restOf(1, 20_000), repeat(2, undefined, 2), restOf(3, 120_000)],
      ],
      [
        "a repeat count of 1",
        [step(0, range(8, 12)), restOf(1, 20_000), repeat(2, 0, 1), restOf(3, 120_000)],
      ],
      [
        "a repeat count of 2.5",
        [step(0, range(8, 12)), restOf(1, 20_000), repeat(2, 0, 2.5), restOf(3, 120_000)],
      ],
    ])("judges %s as straight sets", (_, steps) => {
      const [verdict, why] = verdictOf(steps, [10, 4]);
      expect(verdict).toBe("miss");
      expect(why).toContain("reps");
    });

    it("judges the first set of each group inside an outer repeat", () => {
      const [row] = planOfSets(outer, squatSets(10, 4, 10, 4, 10, 4));
      expect([row.verdict, row.why, row.plannedSets]).toEqual(["hit", [], 6]);
      expect(verdictOf(outer, [10, 4, 7, 4, 10, 4])).toEqual(["miss", ["reps"], 0]);
    });

    it("counts over on the judged sets only", () => {
      expect(verdictOf(restPause(), [13, 13])).toEqual(["hit", [], 1]);
    });

    it("keeps the positions when a mini set is skipped", () => {
      const steps = [...restPause(), repeat(4, 0, 2)];
      expect(verdictOf(steps, [10, 0, 9, 4])).toEqual(["miss", ["sets"], 0]);
    });

    it("does not judge a set of a timed row or a set without reps", () => {
      const timedRange = [
        step(0, { durationType: "time", durationValue: 30_000, ...range(8, 12) }),
      ];
      expect(planOfSets(timedRange, [done(0, 4)])[0].why).toEqual([]);
      expect(planOfSets(restPause(), [done(0, undefined)])[0].why).toEqual(["sets"]);
    });

    it("does not treat a superset as a rest-pause", () => {
      const steps = [
        step(0, range(8, 12)),
        step(1, { exercise: "Row", ...range(8, 12) }),
        restOf(2, 20_000),
        repeat(3, 0, 2),
        restOf(4, 120_000),
      ];
      const out = planOfSets(steps, [
        done(0, 10),
        done(0, 4),
        done(1, 10, "Row"),
        done(1, 10, "Row"),
      ]);
      expect(out.map((r) => [r.exercise, r.verdict, r.why])).toEqual([
        ["Back Squat", "miss", ["reps"]],
        ["Row", "hit", []],
      ]);
    });

    it("judges a set that points at no step as before", () => {
      const out = planOfSets(restPause(), [done(undefined, 4)]);
      expect(out.find((r) => r.notInPlan)?.reps).toEqual([4]);
    });
  });

  it("multiplies the repeats of a block inside a block", () => {
    const steps = [step(0, range(8, 12)), rest(1), repeat(2, 0, 2), repeat(3, 0, 3)];
    expect(planOfSets(steps, [])[0].plannedSets).toBe(6);
  });

  it("gives one row to the steps of one exercise and one plan, and a row to each other plan", () => {
    const steps = [
      step(0, range(8, 12)),
      step(1, { exercise: "Row", ...range(8, 12) }),
      step(2, range(8, 12)),
      step(3, range(5, 5)),
    ];
    const out = planOfSets(steps, [done(0, 10), done(2, 9), done(3, 5)]);
    expect(out.map((r) => [r.exercise, r.steps, r.plannedSets, r.plannedReps, r.reps])).toEqual([
      ["Back Squat", [0, 2], 2, { low: 8, high: 12 }, [10, 9]],
      ["Row", [1], 1, { low: 8, high: 12 }, []],
      ["Back Squat", [3], 1, { low: 5, high: 5 }, [5]],
    ]);
  });

  it("gives no row to a step without an exercise, or to a rest or recovery step", () => {
    const steps = [
      step(0, { exercise: undefined }),
      step(1, { intensity: "rest" }),
      step(2, { intensity: "recovery" }),
      step(3, { intensity: undefined }),
    ];
    expect(planOfSets(steps, [])).toEqual([]);
  });

  describe("planned rest", () => {
    const row = (more: Partial<PlanStep> = {}) => ({ exercise: "Row", ...range(8, 12), ...more });
    it.each<[string, PlanStep[], (number | null)[][]]>([
      ["straight sets", block(), [[90]]],
      [
        "rest-pause: the short and the long rest",
        [step(0, range(8, 12)), restOf(1, 20_000), repeat(2, 0, 2), restOf(3, 120_000)],
        [[20, 120]],
      ],
      [
        "rest-pause inside an outer repeat",
        [
          step(0, range(8, 12)),
          restOf(1, 20_000),
          repeat(2, 0, 2),
          restOf(3, 120_000),
          repeat(4, 0, 3),
        ],
        [[20, 120]],
      ],
      ["an open rest is null", [step(0, range(8, 12)), restOf(1), repeat(2, 0, 3)], [[null]]],
      [
        "an open rest with a value is null",
        [
          step(0, range(8, 12)),
          { index: 1, intensity: "rest", durationType: "open", durationValue: 30_000 },
          repeat(2, 0, 3),
        ],
        [[null]],
      ],
      [
        "a timed rest without its time is null",
        [
          step(0, range(8, 12)),
          { index: 1, intensity: "rest", durationType: "time" },
          repeat(2, 0, 3),
        ],
        [[null]],
      ],
      [
        "superset: no rest after the first exercise",
        [step(0, range(8, 12)), step(1, row()), rest(2), repeat(3, 0, 3)],
        [[], [90]],
      ],
      [
        "superset: a rest after the block is for the last exercise only",
        [step(0, range(8, 12)), step(1, row()), rest(2), repeat(3, 0, 3), restOf(4, 120_000)],
        [[], [90, 120]],
      ],
      ["a rest only after the block", [step(0, range(8, 12)), repeat(1, 0, 3), rest(2)], [[90]]],
      [
        "an exercise after the block is no rest",
        [step(0, range(8, 12)), repeat(1, 0, 3), step(2, row())],
        [[], []],
      ],
      ["no repeat and no rest", [step(0, range(8, 12)), step(1, row())], [[], []]],
      [
        "one rest of two blocks of one row, once",
        [
          step(0, range(8, 12)),
          rest(1),
          repeat(2, 0, 2),
          step(3, range(8, 12)),
          rest(4),
          repeat(5, 3, 2),
        ],
        [[90]],
      ],
      [
        "only the closest repeat counts",
        [step(0, range(8, 12)), rest(1), repeat(2, 0, 2), repeat(3, 0, 3), restOf(4, 120_000)],
        [[90]],
      ],
      [
        "a repeat without a first step is not around the exercise",
        [step(0, range(8, 12)), rest(1), repeat(2, undefined, 3), restOf(3, 120_000)],
        [[90]],
      ],
    ])("%s", (_name, steps, expected) => {
      expect(planOfSets(steps, []).map((r) => r.plannedRestSec)).toEqual(expected);
    });

    it("gives a row not in the plan no planned rest", () => {
      expect(planOfSets(block(), [done(9, 5, "Curl")])[1]).not.toHaveProperty("plannedRestSec");
    });
  });
});

const hit = (exercise: string) => ({ exercise, verdict: "hit", why: [] });
const miss = (exercise: string, ...why: string[]) => ({ exercise, verdict: "miss", why });
/** A strength session with sets and these plan verdicts. */
const planned = (id: number, day: string, planVerdicts: unknown) => ({
  id,
  type: "strength_training",
  start: `${day} 18:00:00`,
  exercises: [],
  planVerdicts,
});

/** A run on 2026-10-13, with these plan verdicts when given. */
const runOf = (id: number, planVerdicts?: unknown) => ({
  id,
  type: "running",
  sport: "running",
  start: "2026-10-13 07:00:00",
  ...(planVerdicts === undefined ? {} : { planVerdicts }),
});

describe("plan adherence", () => {
  const weeks = ["2026-10-12", "2026-10-19", "2026-10-26"];

  it("counts each exercise once per session, a miss when any of its rows misses", () => {
    const sessions = [
      // a pyramid of 3 rows of one exercise
      planned(1, "2026-10-13", [
        hit("Squat"),
        hit("Squat"),
        miss("Squat", "reps"),
        miss("Bench", "sets"),
        hit("Row"),
      ]),
      // a hit row after a miss row: the exercise stays a miss
      planned(2, "2026-10-20", [
        miss("Squat", "sets"),
        miss("Squat", "reps"),
        hit("Squat"),
        hit("Bench"),
      ]),
    ];
    expect(planAdherence(sessions, weeks)).toEqual({
      weeks: [
        { hit: 1, miss: 2 },
        { hit: 1, miss: 1 },
        { hit: 0, miss: 0 },
      ],
      exercises: [
        { exercise: "Squat", sessions: 2, misses: 2, sets: 1, reps: 2 },
        { exercise: "Bench", sessions: 2, misses: 1, sets: 1, reps: 0 },
      ],
      sessions: 2,
      unplanned: 0,
    });
  });

  it("counts nothing for a row without a verdict, an exercise name or a known reason", () => {
    const rows = [
      { exercise: "Plank", verdict: null, why: [] },
      null,
      { verdict: "hit", why: [] },
      { exercise: 5, verdict: "miss", why: ["sets"] },
      { exercise: "Row", verdict: "x", why: [] },
      { exercise: "Curl", verdict: "miss", why: ["sets", "x"] },
      // a miss without a known reason is still a miss
      { exercise: "Dip", verdict: "miss" },
    ];
    expect(planAdherence([planned(1, "2026-10-27", rows)], weeks)).toEqual({
      weeks: [
        { hit: 0, miss: 0 },
        { hit: 0, miss: 0 },
        { hit: 0, miss: 2 },
      ],
      exercises: [
        { exercise: "Curl", sessions: 1, misses: 1, sets: 1, reps: 0 },
        { exercise: "Dip", sessions: 1, misses: 1, sets: 0, reps: 0 },
      ],
      sessions: 1,
      unplanned: 0,
    });
  });

  it("counts the sessions without a plan, and leaves a week with a session without sets out", () => {
    const sessions = [
      planned(1, "2026-10-12", null),
      // sets not read: no exercises and no plan verdicts
      { id: 2, type: "strength_training", start: "2026-10-21 18:00:00" },
      planned(3, "2026-10-22", [hit("Squat")]),
      // the Sunday before the first week, and the last day of the last week
      planned(4, "2026-10-11", [miss("Squat", "sets")]),
      planned(5, "2026-11-01", [hit("Bench")]),
      // not a list
      planned(6, "2026-10-28", "x"),
    ];
    expect(planAdherence(sessions, weeks)).toEqual({
      weeks: [{ hit: 0, miss: 0 }, null, { hit: 1, miss: 0 }],
      exercises: [],
      // session 3 is in the week of session 2, which has no sets
      sessions: 2,
      unplanned: 1,
    });
  });

  it("leaves the misses of a week with a session without sets out of the most missed", () => {
    const sessions = [
      planned(1, "2026-10-13", [miss("Squat", "sets")]),
      { id: 2, type: "strength_training", start: "2026-10-14 18:00:00" },
      planned(3, "2026-10-20", [hit("Squat")]),
    ];
    expect(planAdherence(sessions, weeks)).toEqual({
      weeks: [null, { hit: 1, miss: 0 }, { hit: 0, miss: 0 }],
      exercises: [],
      sessions: 1,
      unplanned: 0,
    });
  });

  it("counts an unplanned session of a week without sets nowhere", () => {
    const sessions = [
      planned(1, "2026-10-13", null),
      { id: 2, type: "strength_training", start: "2026-10-14 18:00:00" },
    ];
    const plan = planAdherence(sessions, weeks);
    expect(plan.weeks[0]).toBeNull();
    expect(plan.sessions).toBe(0);
    expect(plan.unplanned).toBe(0);
  });

  it("counts strength sessions only, whatever plan verdicts a run has", () => {
    const sessions = [
      planned(1, "2026-10-13", [hit("Squat")]),
      runOf(2, [{ step: 1, type: "cadence", verdict: "miss", why: "low" }]),
      // a free run with laps, and a run whose laps were not read
      runOf(3, null),
      runOf(4),
    ];
    expect(planAdherence(sessions, weeks)).toEqual({
      weeks: [
        { hit: 1, miss: 0 },
        { hit: 0, miss: 0 },
        { hit: 0, miss: 0 },
      ],
      exercises: [],
      sessions: 1,
      unplanned: 0,
    });
  });

  it("lists the most missed exercises first, then by name", () => {
    const sessions = [
      planned(1, "2026-10-13", [miss("Curl", "reps"), miss("Squat", "sets"), hit("Row")]),
      planned(2, "2026-10-20", [miss("Bench", "reps", "sets"), miss("Squat", "sets")]),
    ];
    expect(planAdherence(sessions, weeks).exercises).toEqual([
      { exercise: "Squat", sessions: 2, misses: 2, sets: 2, reps: 0 },
      { exercise: "Bench", sessions: 1, misses: 1, sets: 1, reps: 1 },
      { exercise: "Curl", sessions: 1, misses: 1, sets: 0, reps: 1 },
    ]);
  });
});
