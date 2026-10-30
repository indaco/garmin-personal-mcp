import { addDays } from "../dates";
import type { Activity } from "./calc";
import { dayOf } from "./calc";
import { epley, mean } from "./metrics";

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
 * could not be read) and the indexes of the weeks that hold one: their set counts would be too low.
 */
export function missingSets(acts: Activity[], weeks: string[]) {
  const missing = acts.filter(
    (a) => String(a.type).includes("strength") && !Array.isArray(a.exercises),
  );
  const at = new Set(missing.map((a) => weekIndex(a, weeks)).filter((i) => i >= 0));
  return { sessions: missing.length, weeks: at };
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
      const weighted = done.filter((s) => (s.kg ?? 0) > 0 && (s.reps ?? 0) > 0);
      const top = weighted.toSorted((x, y) => y.kg! - x.kg! || y.reps! - x.reps!)[0];
      const e1rms = weighted
        .map((s) => epley(s.kg!, s.reps!))
        .filter((v): v is number => v !== undefined);
      const entry = byName.get(e.exercise) ?? { e, sessions: [] };
      entry.sessions.push({
        date,
        workout: a.name ?? "",
        activity: a,
        sets: e.sets,
        ...(top ? { top: { kg: top.kg!, reps: top.reps! } } : {}),
        volume: weighted.reduce((s, x) => s + x.kg! * x.reps!, 0),
        ...(e1rms.length > 0 ? { e1rm: Math.max(...e1rms) } : {}),
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
 * The last sessions, at least 3 and over 14 days or more, against as many sessions just before them:
 * up when they set a new best, down when their best is more than 5% under, else stalled. A lift done
 * twice a week needs more than 3 sessions for 14 days; one lucky day long ago does not count.
 */
function progress(m: { date: string; v: number }[]): ExerciseStats["status"] {
  let k = 3;
  while (k < m.length && m.at(-1)!.date < addDays(m.at(-k)!.date, 14)) k++;
  if (m.length <= k) return null;
  const recent = Math.max(...m.slice(-k).map((x) => x.v));
  const before = Math.max(...m.slice(Math.max(0, m.length - 2 * k), -k).map((x) => x.v));
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
