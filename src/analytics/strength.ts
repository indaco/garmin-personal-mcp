import { addDays } from "../dates";
import type { Activity } from "./calc";
import { dayOf } from "./calc";
import { epley, MIN_SESSIONS, mean } from "./metrics";

/** Strength sets, muscle groups and the statistics of each exercise. Pure functions. */

export interface StrengthSet {
  reps?: number;
  kg?: number;
  seconds?: number;
  restSec?: number;
}

export interface Exercise {
  exercise: string;
  category?: string;
  primaryMuscles?: string[];
  secondaryMuscles?: string[];
  sets: StrengthSet[];
}

export const MUSCLE_GROUPS = [
  "chest",
  "back",
  "shoulders",
  "biceps",
  "triceps",
  "forearms",
  "quads",
  "hamstrings",
  "glutes",
  "calves",
  "abs",
  "hips",
  "other",
] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

const MUSCLES: Record<string, MuscleGroup> = {
  chest: "chest",
  lats: "back",
  traps: "back",
  "lower back": "back",
  shoulders: "shoulders",
  biceps: "biceps",
  triceps: "triceps",
  forearm: "forearms",
  forearms: "forearms",
  quads: "quads",
  hamstrings: "hamstrings",
  glutes: "glutes",
  calves: "calves",
  abs: "abs",
  obliques: "abs",
  hips: "hips",
  abductors: "hips",
  adductors: "hips",
};

export const muscleGroup = (muscle: string): MuscleGroup =>
  MUSCLES[muscle.toLowerCase()] ?? "other";

/** A set is done when it has reps, or a time and no reps (a timed exercise). 0 reps was not done. */
export function completed(s: StrengthSet): boolean {
  return typeof s.reps === "number" ? s.reps > 0 : (s.seconds ?? 0) > 0;
}

const heaviest = (sets: StrengthSet[]) =>
  sets.toSorted((x, y) => y.kg! - x.kg! || y.reps! - x.reps!)[0];

/** The heaviest done set of 1 to 12 reps, then the most reps; without one, the heaviest done set. */
export function topSet(sets: StrengthSet[]): { kg: number; reps: number } | undefined {
  const weighted = sets.filter((s) => (s.kg ?? 0) > 0 && (s.reps ?? 0) > 0);
  const top = heaviest(weighted.filter((s) => s.reps! <= 12)) ?? heaviest(weighted);
  return top && { kg: top.kg!, reps: top.reps! };
}

/** The best Epley e1RM of the done sets of 1 to 12 reps with weight. */
export function bestE1rm(sets: StrengthSet[]): number | undefined {
  const e1rms = sets
    .map((s) => epley(s.kg ?? 0, s.reps ?? 0))
    .filter((v): v is number => v !== undefined);
  return e1rms.length > 0 ? Math.max(...e1rms) : undefined;
}

export const exercisesOf = (a: Activity) =>
  Array.isArray(a.exercises) ? (a.exercises as Exercise[]) : [];

/** A timed set: a time and at most 1 rep (the watch records a plank as 1 rep). */
export const timed = (s: StrengthSet) => (s.seconds ?? 0) > 0 && (s.reps ?? 0) <= 1 && !(s.kg ?? 0);

/** The group of an exercise: the group of its first primary muscle. */
export const exerciseGroup = (e: Exercise): MuscleGroup =>
  e.primaryMuscles?.[0] ? muscleGroup(e.primaryMuscles[0]) : "other";

function weekIndex(a: Activity, weeks: string[]): number {
  const d = dayOf(a);
  return d ? weeks.findIndex((w) => d >= w && d <= addDays(w, 6)) : -1;
}

/**
 * The strength sessions without sets (past the 30 newest whose .FIT file is not saved, or a file that
 * could not be read), the indexes of the weeks that hold one (their set counts would be too low), and
 * the weeks with strength sessions that all have their sets.
 */
export function missingSets(acts: Activity[], weeks: string[]) {
  const strength = acts.filter((a) => String(a.type).includes("strength"));
  const missing = strength.filter((a) => !Array.isArray(a.exercises));
  const at = new Set(missing.map((a) => weekIndex(a, weeks)).filter((i) => i >= 0));
  const withSets = new Set(strength.map((a) => weekIndex(a, weeks)).filter((i) => i >= 0));
  return {
    sessions: missing.length,
    weeks: at,
    complete: [...withSets].filter((i) => !at.has(i)).length,
  };
}

/** null for each week that holds a session without sets, so a chart or a mean leaves it out. */
function leaveOut<T extends Record<string, (number | null)[]>>(
  out: T,
  acts: Activity[],
  weeks: string[],
): T {
  const { weeks: gaps } = missingSets(acts, weeks);
  for (const v of Object.values(out)) for (const i of gaps) v[i] = null;
  return out;
}

/**
 * Completed sets of each muscle group per week: 1 for each primary group, 0.5 for each secondary one;
 * null for a week that holds a session without sets.
 */
export function muscleSets(
  acts: Activity[],
  weeks: string[],
): Partial<Record<MuscleGroup, (number | null)[]>> {
  const out: Partial<Record<MuscleGroup, number[]>> = {};
  const add = (g: MuscleGroup, i: number, v: number) => ((out[g] ??= weeks.map(() => 0))[i] += v);
  for (const a of acts) {
    const i = weekIndex(a, weeks);
    if (i < 0) continue;
    for (const e of exercisesOf(a)) {
      const done = e.sets.filter(completed).length;
      if (done === 0) continue;
      const primary = new Set((e.primaryMuscles ?? []).map(muscleGroup));
      const secondary = new Set(
        (e.secondaryMuscles ?? []).map(muscleGroup).filter((g) => !primary.has(g)),
      );
      if (primary.size === 0) primary.add("other");
      for (const g of primary) add(g, i, done);
      for (const g of secondary) add(g, i, done * 0.5);
    }
  }
  return leaveOut(out, acts, weeks);
}

/** Push sets (chest, shoulders, triceps) over pull sets (back, biceps); null without pull sets. */
export function pushPull(sets: Partial<Record<string, (number | null)[]>>): number | null {
  const sum = (gs: string[]) =>
    gs.reduce((s, g) => s + (sets[g] ?? []).reduce<number>((x, v) => x + (v ?? 0), 0), 0);
  const pull = sum(["back", "biceps"]);
  return pull > 0 ? sum(["chest", "shoulders", "triceps"]) / pull : null;
}

/** Completed sets of each movement category per week; null for a week that holds a session without sets. */
export function setsByCategory(
  acts: Activity[],
  weeks: string[],
): Record<string, (number | null)[]> {
  const out: Record<string, number[]> = {};
  for (const a of acts) {
    const i = weekIndex(a, weeks);
    if (i < 0) continue;
    for (const e of exercisesOf(a)) {
      const done = e.sets.filter(completed).length;
      if (done > 0) (out[e.category ?? e.exercise] ??= weeks.map(() => 0))[i] += done;
    }
  }
  return leaveOut(out, acts, weeks);
}

export interface ExerciseSession {
  date: string;
  workout: string;
  activity: Activity;
  sets: StrengthSet[];
  top?: { kg: number; reps: number };
  volume: number;
  e1rm?: number;
  maxReps: number;
  reps: number;
  longest: number;
}

export interface ExerciseStats {
  name: string;
  category: string;
  muscle: MuscleGroup;
  kind: "weight" | "reps" | "time";
  /** Oldest first. */
  sessions: ExerciseSession[];
  best1rm?: number;
  /**
   * Change in % of the 1RM, max reps or longest set, by kind: the best of the last 3 sessions against the
   * best of the first 3, or the last session against the first with under 6 sessions.
   */
  change: number | null;
  /** The last sessions over 14 days or more against as many sessions before them. See progress(). */
  status: "up" | "stalled" | "down" | null;
  medianRest?: number;
  completedSets: number;
}

/** One entry per exercise name across the sessions. */
export function exerciseStats(acts: Activity[]): ExerciseStats[] {
  const byName = new Map<string, { e: Exercise; sessions: ExerciseSession[] }>();
  for (const a of acts) {
    const date = dayOf(a);
    if (!date) continue;
    for (const e of exercisesOf(a)) {
      const done = e.sets.filter(completed);
      // an exercise of the plan that was skipped (only sets of 0 reps) is no session of it
      if (done.length === 0) continue;
      const weighted = done.filter((s) => (s.kg ?? 0) > 0 && (s.reps ?? 0) > 0);
      const top = topSet(done);
      const e1rm = bestE1rm(done);
      const entry = byName.get(e.exercise) ?? { e, sessions: [] };
      entry.sessions.push({
        date,
        workout: a.name ?? "",
        activity: a,
        sets: e.sets,
        ...(top ? { top } : {}),
        volume: weighted.reduce((s, x) => s + x.kg! * x.reps!, 0),
        ...(e1rm === undefined ? {} : { e1rm }),
        maxReps: Math.max(0, ...done.map((s) => s.reps ?? 0)),
        reps: done.reduce((s, x) => s + (x.reps ?? 0), 0),
        longest: Math.max(0, ...done.filter(timed).map((s) => s.seconds ?? 0)),
      });
      byName.set(e.exercise, entry);
    }
  }
  return [...byName.entries()].map(([name, { e, sessions }]) => {
    sessions.sort((x, y) => (x.date < y.date ? -1 : 1));
    const sets = sessions.flatMap((s) => s.sets.filter(completed));
    const kind = sessions.some((s) => s.top) ? "weight" : sets.every(timed) ? "time" : "reps";
    const measure = (s: ExerciseSession) =>
      kind === "weight" ? s.e1rm : kind === "reps" ? s.maxReps : s.longest;
    const measured = sessions
      .map((s) => ({ date: s.date, v: measure(s) }))
      .filter((x): x is { date: string; v: number } => typeof x.v === "number" && x.v > 0);
    const values = measured.map((x) => x.v);
    const rests = sessions
      .flatMap((s) => s.sets.filter(completed).map((x) => x.restSec))
      .filter((v): v is number => typeof v === "number");
    const e1rms = sessions.map((s) => s.e1rm).filter((v): v is number => v !== undefined);
    return {
      name,
      category: e.category ?? name,
      muscle: exerciseGroup(e),
      kind,
      sessions,
      ...(e1rms.length > 0 ? { best1rm: Math.max(...e1rms) } : {}),
      change:
        values.length >= 6
          ? pct(Math.max(...values.slice(-3)), Math.max(...values.slice(0, 3)))
          : values.length > 1
            ? pct(values.at(-1)!, values[0])
            : null,
      // the time of a set follows the lap button or the plan, not strength: it can vary tenfold
      status: kind === "time" ? null : progress(measured),
      ...(rests.length > 0 ? { medianRest: median(rests) } : {}),
      completedSets: sessions.reduce((s, x) => s + x.sets.filter(completed).length, 0),
    };
  });
}

const pct = (now: number, before: number) => ((now - before) / before) * 100;

/**
 * How many of the newest sessions (oldest first) make the recent window: at least 3, over 14 days or
 * more. A lift done twice a week needs more than 3 sessions for 14 days. Null without as many sessions
 * before them: 3 against 1 is no comparison, one good day would decide it.
 */
export function recentWindow(m: { date: string }[]): number | null {
  let k = MIN_SESSIONS;
  while (k < m.length && m.at(-1)!.date < addDays(m.at(-k)!.date, 14)) k++;
  return m.length >= 2 * k ? k : null;
}

/**
 * The recent window against the one before it: up when it sets a new best, down when its best is more
 * than 5% under, else stalled. One lucky day long ago does not count.
 */
function progress(m: { date: string; v: number }[]): ExerciseStats["status"] {
  const k = recentWindow(m);
  if (k === null) return null;
  const recent = Math.max(...m.slice(-k).map((x) => x.v));
  const before = Math.max(...m.slice(-2 * k, -k).map((x) => x.v));
  if (recent > before) return "up";
  return recent < before * 0.95 ? "down" : "stalled";
}

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const s = values.toSorted((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (mean([s[m - 1], s[m]]) ?? undefined);
}

/** The exercise name for the URL hash, e.g. "barbell-back-squat": letters, marks and digits of any script. */
export function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
  // a name of symbols only keeps its text, so it still gets its own link
  return s || name;
}

/** A step of the plan the watch ran, in FIT units, with FIT enum names in lower case. */
export interface PlanStep {
  index: number;
  intensity?: string;
  durationType?: string;
  /** time in ms, the reps of a reps step, the first step of a repeat */
  durationValue?: number;
  targetType?: string;
  /** the count of a repeat, the high end of a rep range */
  targetValue?: number;
  targetLow?: number;
  targetHigh?: number;
  exercise?: string;
}

/** An active set and the index of the plan step it was done for. */
export interface PlanSet {
  step?: number;
  exercise: string;
  reps?: number;
  seconds?: number;
}

export interface PlanRow {
  exercise: string;
  steps: number[];
  plannedSets: number | null;
  plannedReps: { low: number; high: number | null } | null;
  doneSets: number;
  reps: (number | null)[] | null;
  verdict: "hit" | "miss" | null;
  why: ("sets" | "reps")[];
  over: number;
  extra: number;
  part?: "warmup" | "cooldown";
  notInPlan?: true;
}

const REPEAT = "repeat_until_steps_cmplt";

/** The reps a step plans: a reps duration, or a rep range target whose high end 0 or under low is "at least low". */
function plannedReps(s: PlanStep): PlanRow["plannedReps"] {
  if (s.durationType === "reps" && s.durationValue !== undefined) {
    return { low: s.durationValue, high: s.durationValue };
  }
  if (s.targetType !== "reps" || s.targetLow === undefined) return null;
  const top = s.targetValue ?? 0;
  return { low: s.targetLow, high: top > 0 && top >= s.targetLow ? top : null };
}

/**
 * One row per planned exercise, in plan order, with the planned and done sets and reps, then one row
 * per done exercise whose sets point at no exercise step. A row has the steps of one exercise with one
 * rep plan. A set is done when completed; a set under the low end is a miss, above the high end a hit
 * counted in over. A warm-up or cool-down step has its part and no verdict.
 */
export function planOfSets(steps: PlanStep[], sets: PlanSet[]): PlanRow[] {
  // the times each step runs: the repeats of every block around it
  const times = new Map(steps.map((s) => [s.index, 1]));
  for (const r of steps) {
    if (r.durationType !== REPEAT) continue;
    const from = r.durationValue ?? r.index;
    const n = r.targetValue ?? 0;
    const count = Number.isInteger(n) && n > 0 ? n : 1;
    for (const s of steps) {
      if (s.index >= from && s.index < r.index) times.set(s.index, times.get(s.index)! * count);
    }
  }
  const planned = new Map<string, PlanRow & { plannedSets: number }>();
  const rowOf = new Map<number | undefined, PlanRow>();
  for (const s of steps) {
    const part = s.intensity === "warmup" || s.intensity === "cooldown" ? s.intensity : undefined;
    if (!s.exercise || !(part || s.intensity === "active")) continue;
    const reps = plannedReps(s);
    const isTimed = s.durationType === "time";
    const key = JSON.stringify([s.exercise, part, reps, isTimed]);
    const row = planned.get(key) ?? {
      exercise: s.exercise,
      steps: [],
      plannedSets: 0,
      plannedReps: reps,
      doneSets: 0,
      reps: isTimed ? null : [],
      verdict: null,
      why: [],
      over: 0,
      extra: 0,
      ...(part ? { part } : {}),
    };
    row.steps.push(s.index);
    row.plannedSets += times.get(s.index)!;
    planned.set(key, row);
    rowOf.set(s.index, row);
  }
  const notInPlan = new Map<string, PlanRow>();
  for (const set of sets) {
    if (!completed(set)) continue;
    let row = rowOf.get(set.step);
    if (!row) {
      row = notInPlan.get(set.exercise) ?? {
        exercise: set.exercise,
        steps: [],
        plannedSets: null,
        plannedReps: null,
        doneSets: 0,
        reps: [],
        verdict: null,
        why: [],
        over: 0,
        extra: 0,
        notInPlan: true,
      };
      notInPlan.set(set.exercise, row);
    }
    row.doneSets++;
    row.reps?.push(set.reps ?? null);
  }
  for (const row of planned.values()) {
    if (row.part) continue;
    const done = (row.reps ?? []).filter((r): r is number => r !== null);
    const low = row.plannedReps?.low;
    const high = row.plannedReps?.high;
    if (row.doneSets < row.plannedSets) row.why.push("sets");
    if (low !== undefined && done.some((r) => r < low)) row.why.push("reps");
    row.verdict = row.why.length > 0 ? "miss" : "hit";
    row.extra = Math.max(0, row.doneSets - row.plannedSets);
    row.over = high == null ? 0 : done.filter((r) => r > high).length;
  }
  return [...planned.values(), ...notInPlan.values()];
}
