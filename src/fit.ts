import { Decoder, Profile, Stream } from "@garmin/fitsdk";
import { unzipSync } from "fflate";
import { GarminApiError } from "./api-client";
import { splitOf, workOf } from "./analytics/running";
import { bestE1rm, type PlanStep, planOfSets, topSet } from "./analytics/strength";

/** The fields of a FIT set message the tools read; enums are raw values (decoded without strings). */
export interface FitSet {
  setType?: number;
  repetitions?: number;
  weight?: number;
  duration?: number;
  category?: number[];
  categorySubtype?: number[];
  wktStepIndex?: number;
}

export interface Exercise {
  exercise: string;
  category: string;
  primaryMuscles?: string[];
  secondaryMuscles?: string[];
  sets: Record<string, number>[];
}

/** Garmin's exercise catalogue: its "categories" object, keyed by FIT profile constants. */
export type Catalogue = Record<string, { exercises?: Record<string, unknown> } | undefined>;

// oxlint-disable-next-line typescript/no-explicit-any -- decoded FIT messages are untyped records
type Messages = Record<string, any[] | undefined>;

const SET_TYPE_REST = 0;
const SET_TYPE_ACTIVE = 1;
const types = Profile.types as Record<string, Record<string, string> | undefined>;

/**
 * The FIT profile constant of an SDK name: benchPress -> BENCH_PRESS,
 * 3WayCalfRaise -> _3_WAY_CALF_RAISE, hangingLSit -> HANGING_L_SIT.
 * The tests check it against every exercise, sport, intensity and lap trigger name.
 */
export function toConst(camel: string): string {
  const s = camel
    .replace(/([a-z])([A-Z0-9])/g, "$1_$2")
    .replace(/([0-9])([A-Za-z])/g, "$1_$2")
    .replace(/([A-Z])(?=[A-Z][a-z])/g, "$1_")
    .toUpperCase();
  return /^[0-9]/.test(s) ? `_${s}` : s;
}

/** BENCH_PRESS -> Bench Press */
export function words(constant: string): string {
  return constant
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** The constant of a raw enum value, in lower case (e.g. session_end), as the tools print it. */
function enumName(type: string, value: unknown): string | undefined {
  const name = typeof value === "number" ? types[type]?.[value] : undefined;
  return name === undefined ? undefined : toConst(name).toLowerCase();
}

/** The constant of a category, e.g. BENCH_PRESS; "" for an unknown value. */
function categoryConst(category: number | undefined): string {
  const name = category === undefined ? undefined : types.exerciseCategory?.[category];
  return name === undefined ? "" : toConst(name);
}

/** The constant of an exercise, e.g. INCLINE_SMITH_MACHINE_BENCH_PRESS; "" when the SDK has no name for it. */
function exerciseConst(category: number | undefined, subtype: number | undefined): string {
  const cat = category === undefined ? undefined : types.exerciseCategory?.[category];
  const name =
    cat === undefined || subtype === undefined ? undefined : types[`${cat}ExerciseName`]?.[subtype];
  return name === undefined ? "" : toConst(name);
}

/**
 * Garmin's exercise name (e.g. "Incline Smith Machine Bench Press"), falling back to the category,
 * then to the workout step name for custom exercises, which have no known category.
 */
export function exerciseName(
  category: number | undefined,
  subtype: number | undefined,
  stepName: string | undefined,
): string {
  const cat = categoryConst(category);
  if (!cat || cat === "UNKNOWN") {
    return stepName?.trim() ? stepName : "Unknown exercise";
  }
  return words(exerciseConst(category, subtype) || cat);
}

/** Decodes a FIT file with raw enum values. */
export function decodeFit(bytes: Uint8Array, activityId: number): Messages {
  const { messages, errors } = new Decoder(Stream.fromByteArray(bytes)).read({
    convertTypesToStrings: false,
  });
  if (errors.length > 0) {
    throw new GarminApiError(
      `Cannot decode the .FIT file of ${activityId}: ${errors[0].message}`,
      200,
    );
  }
  return messages as Messages;
}

/** A .FIT file has ".FIT" at bytes 8-11 of its header. */
const isFit = (b: Uint8Array) =>
  b.length >= 12 && b[8] === 0x2e && b[9] === 0x46 && b[10] === 0x49 && b[11] === 0x54;

/** The .FIT file of a download, which is sometimes a zip. */
export function unzipFit(data: Uint8Array, activityId: number): Uint8Array {
  let fit = data;
  if (data.length > 4 && data[0] === 0x50 && data[1] === 0x4b) {
    const entries = unzipSync(data, { filter: (f) => f.name.toLowerCase().endsWith(".fit") });
    const entry = Object.values(entries)[0];
    if (!entry) {
      throw new GarminApiError(
        `The download of activity ${activityId} is a zip without a .fit file`,
        200,
      );
    }
    fit = entry;
  }
  if (!isFit(fit)) {
    throw new GarminApiError(`The download of activity ${activityId} is not a .FIT file`, 200);
  }
  return fit;
}

/** The getActivityLaps answer. */
export function lapsOf(fit: Messages, activityId: number) {
  const sport = enumName("sport", fit.sessionMesgs?.[0]?.sport);
  const foot = sport === "running" || sport === "walking" || sport === "hiking";
  const swim = sport === "swimming";
  const laps = (fit.lapMesgs ?? []).map((lap, i) => {
    const o: Record<string, unknown> = { lap: i + 1 };
    const speed: number | undefined = lap.enhancedAvgSpeed ?? lap.avgSpeed;
    o.km = round((lap.totalDistance ?? 0) / 1000, 2);
    o.time = hms(lap.totalTimerTime ?? 0);
    if (speed != null && speed > 0) {
      if (foot) {
        o.pace = paceText(1000 / speed);
      } else {
        o.kmh = round(speed * 3.6, 1);
      }
    }
    putIfSet(o, "avgHR", lap.avgHeartRate);
    putIfSet(o, "maxHR", lap.maxHeartRate);
    if (lap.avgCadence != null) {
      const cadence = lap.avgCadence + (lap.avgFractionalCadence ?? 0);
      // FIT stores running cadence as strides per minute; Garmin Connect shows steps per minute
      o[foot ? "cadenceSpm" : "cadence"] = Math.round(foot ? cadence * 2 : cadence);
    }
    putIfSet(o, "ascentM", lap.totalAscent);
    putIfSet(o, "descentM", lap.totalDescent);
    putIfSet(o, "avgPowerW", lap.avgPower);
    // running form, in the names and units of the activity summary (FIT gives mm)
    if (lap.avgStanceTime != null) o.gctMs = Math.round(lap.avgStanceTime);
    if (lap.avgVerticalRatio != null) o.vertRatioPct = round(lap.avgVerticalRatio, 1);
    if (lap.avgVerticalOscillation != null) o.vertOscCm = round(lap.avgVerticalOscillation / 10, 1);
    if (lap.avgStepLength != null) o.strideCm = round(lap.avgStepLength / 10, 1);
    const intensity = enumName("intensity", lap.intensity);
    if (intensity) o.intensity = intensity;
    const trigger = enumName("lapTrigger", lap.lapTrigger);
    if (trigger) o.trigger = trigger;
    // the step of the planned workout: the reps of one drill share it
    putIfSet(o, "step", lap.wktStepIndex);
    if (swim) putSwimNumbers(lap, o, speed);
    return o;
  });
  return {
    activityId,
    ...(sport ? { sport } : {}),
    laps,
    ...(sport === "running" ? runNumbers(laps) : {}),
    ...(swim ? { sets: swimSets(fit.lapMesgs ?? []) } : {}),
  };
}

/** What only a swim lap has. A rest lap has no pace, and its 0 strokes and lengths are not a count. */
function putSwimNumbers(
  lap: NonNullable<Messages[string]>[number],
  o: Record<string, unknown>,
  speed: number | undefined,
) {
  // km is rounded to 10 m, too coarse for one length of 25 m
  if (lap.totalDistance != null) o.metres = round(lap.totalDistance, 1);
  if (speed != null && speed > 0) o.swimPace = swimPaceText(100 / speed);
  const stroke = enumName("swimStroke", lap.swimStroke);
  if (stroke) o.stroke = stroke;
  if (lap.numActiveLengths > 0) o.lengths = lap.numActiveLengths;
  if (lap.avgSwolf > 0) o.swolf = lap.avgSwolf;
  const strokes = lap.totalStrokes ?? lap.totalCycles;
  if (strokes > 0) o.strokes = strokes;
}

/**
 * The repeats of a swim: laps in a row of one distance, stroke and intensity, with rests between them.
 * pct is the last repeat's pace against the first, in %: above 0 is slower.
 */
function swimSets(raw: NonNullable<Messages[string]>) {
  const reps = raw
    .map((lap) => ({
      metres: round(lap.totalDistance ?? 0, 1),
      stroke: enumName("swimStroke", lap.swimStroke),
      intensity: lap.intensity,
      speed: (lap.enhancedAvgSpeed ?? lap.avgSpeed ?? 0) as number,
      swolf: lap.avgSwolf > 0 ? (lap.avgSwolf as number) : null,
    }))
    .filter((r) => r.metres > 0 && r.speed > 0);
  const groups: (typeof reps)[] = [];
  for (const r of reps) {
    const last = groups.at(-1);
    const same =
      last?.[0].metres === r.metres &&
      last[0].stroke === r.stroke &&
      last[0].intensity === r.intensity;
    if (same) last.push(r);
    else groups.push([r]);
  }
  return groups
    .filter((g) => g.length > 1)
    .map((g) => {
      const first = 100 / g[0].speed;
      const end = 100 / g.at(-1)!.speed;
      return {
        reps: g.length,
        metres: g[0].metres,
        ...(g[0].stroke ? { stroke: g[0].stroke } : {}),
        firstPace: swimPaceText(first),
        lastPace: swimPaceText(end),
        pct: round(((end - first) / first) * 100, 1),
        firstSwolf: g[0].swolf,
        lastSwolf: g.at(-1)!.swolf,
      };
    });
}

/** A pace as the lap pace: "m:ss/km". */
export const paceText = (sec: number) => `${hms(sec)}/km`;
/** A swim pace: "m:ss/100 m". */
export const swimPaceText = (sec: number) => `${hms(sec)}/100 m`;
/** A percentage with 1 decimal; null when it applies but the data cannot give it. */
const pctOrNull = (v: number | undefined) => (v === undefined ? null : round(v, 1));

/** The numbers of a run that the coach prompts quote: half split and HR drift; reps and fades of a workout. */
export function runNumbers(laps: Record<string, unknown>[]) {
  const s = splitOf(laps);
  const w = workOf(laps);
  return {
    split: s
      ? {
          firstPace: paceText(s.first),
          secondPace: paceText(s.second),
          kind: s.kind,
          hrDriftPct: pctOrNull(s.drift),
        }
      : null,
    ...(w
      ? {
          work: {
            reps: w.reps,
            pace: paceText(w.pace),
            avgHR: w.hr === undefined ? null : Math.round(w.hr),
            fade: w.fades.map((f) => ({
              ...(f.step === undefined ? {} : { step: f.step }),
              reps: f.reps,
              firstPace: paceText(f.first),
              lastPace: paceText(f.last),
              pct: pctOrNull(f.pct),
            })),
          },
        }
      : {}),
  };
}

/** The FIT wkt_step_target value of a rep range: the SDK's enum does not have it. */
const TARGET_REPS = 23;
const STEP_NUMBERS = [
  "intensity",
  "durationType",
  "durationValue",
  "targetType",
  "targetValue",
  "customTargetValueLow",
  "customTargetValueHigh",
  "exerciseCategory",
  "exerciseName",
];

/**
 * The plan the watch ran, from the workout messages: its name and its steps, in FIT units; null
 * without a workout or a step. A step with a field of the wrong type is left out.
 */
export function planSteps(fit: Messages, stepNames = new Map<string, string>()) {
  const workout = fit.workoutMesgs?.[0];
  const steps: PlanStep[] = [];
  for (const m of fit.workoutStepMesgs ?? []) {
    const bad = STEP_NUMBERS.some((f) => m[f] !== undefined && typeof m[f] !== "number");
    if (bad || !Number.isInteger(m.messageIndex)) continue;
    const category = m.exerciseCategory;
    steps.push({
      index: m.messageIndex,
      intensity: enumName("intensity", m.intensity),
      durationType: enumName("wktStepDuration", m.durationType),
      durationValue: m.durationValue,
      targetType: m.targetType === TARGET_REPS ? "reps" : enumName("wktStepTarget", m.targetType),
      targetValue: m.targetValue,
      targetLow: m.customTargetValueLow,
      targetHigh: m.customTargetValueHigh,
      exercise:
        category === undefined
          ? undefined
          : exerciseName(category, m.exerciseName, stepNames.get(`${category}/${m.exerciseName}`)),
    });
  }
  if (!workout || steps.length === 0) return null;
  return { name: typeof workout.wktName === "string" ? workout.wktName : null, steps };
}

/** The getActivitySets answer. */
export function setsOf(fit: Messages, activityId: number, catalogue: Catalogue | undefined) {
  const stepNames = new Map<string, string>();
  for (const t of fit.exerciseTitleMesgs ?? []) {
    const step = Array.isArray(t.wktStepName) ? t.wktStepName[0] : t.wktStepName;
    if (step != null) {
      stepNames.set(`${t.exerciseCategory}/${t.exerciseName}`, step);
    }
  }
  const sets: FitSet[] = fit.setMesgs ?? [];
  const exercises = groupSets(sets, stepNames, catalogue).map((e) => {
    const top = topSet(e.sets);
    if (!top) return e;
    const best = bestE1rm(e.sets);
    return { ...e, top, e1rmKg: best === undefined ? null : round(best, 1) };
  });
  const plan = planSteps(fit, stepNames);
  const done = realSets(sets, stepNames)
    .filter((s) => s.setType === SET_TYPE_ACTIVE)
    .map((s) => ({
      step: s.wktStepIndex,
      exercise: setName(s, stepNames),
      reps: s.repetitions,
      seconds: s.duration,
    }));
  return {
    activityId,
    exercises,
    plan: plan && { name: plan.name, exercises: planOfSets(plan.steps, done) },
  };
}

const keyOf = (s: FitSet) => `${s.category?.[0]}/${s.categorySubtype?.[0]}`;
const setName = (s: FitSet, stepNames: Map<string, string>) =>
  exerciseName(s.category?.[0], s.categorySubtype?.[0], stepNames.get(keyOf(s)));

/**
 * The sets of the workout. The watch opens one more set when the workout ends (no exercise, no reps,
 * no weight, nothing after it): that set and what follows it are not part of the workout.
 */
function realSets(sets: FitSet[], stepNames: Map<string, string>): FitSet[] {
  const isEmpty = (s: FitSet) =>
    s.setType === SET_TYPE_ACTIVE &&
    setName(s, stepNames) === "Unknown exercise" &&
    !((s.repetitions ?? 0) > 0) &&
    !((s.weight ?? 0) > 0);
  const lastReal = sets.findLastIndex((s) => s.setType === SET_TYPE_ACTIVE && !isEmpty(s));
  const end = sets.findIndex((s, i) => i > lastReal && s.setType === SET_TYPE_ACTIVE);
  return end < 0 ? sets : sets.slice(0, end);
}

/**
 * One entry per exercise, in the order first done; a rest period becomes restSec on the set before it.
 * Muscles come from Garmin's exercise catalogue, when there is one.
 */
export function groupSets(
  sets: FitSet[],
  stepNames: Map<string, string>,
  catalogue: Catalogue | undefined,
): Exercise[] {
  const exercises = new Map<string, Exercise>();
  let previous: Record<string, number> | undefined;
  for (const s of realSets(sets, stepNames)) {
    if (s.setType !== SET_TYPE_ACTIVE) {
      if (previous && s.setType === SET_TYPE_REST && s.duration != null) {
        previous.restSec = Math.round(s.duration);
      }
      continue;
    }
    const category = s.category?.[0];
    const subtype = s.categorySubtype?.[0];
    const key = keyOf(s);
    let exercise = exercises.get(key);
    if (!exercise) {
      const cat = categoryConst(category);
      // exercises without a subtype are listed under the category's own name, e.g. PLANK/PLANK
      const entry = cat
        ? catalogue?.[cat]?.exercises?.[exerciseConst(category, subtype) || cat]
        : undefined;
      const found = entry && typeof entry === "object" && !Array.isArray(entry);
      exercise = {
        exercise: setName(s, stepNames),
        category: cat ? words(cat) : "Unknown",
        ...(found
          ? {
              primaryMuscles: muscles((entry as Record<string, unknown>).primaryMuscles),
              secondaryMuscles: muscles((entry as Record<string, unknown>).secondaryMuscles),
            }
          : {}),
        sets: [],
      };
      exercises.set(key, exercise);
    }
    const set: Record<string, number> = {};
    putIfSet(set, "reps", s.repetitions);
    if (s.weight != null && s.weight > 0) {
      set.kg = round(s.weight, 1);
    }
    if (s.duration != null) {
      set.seconds = Math.round(s.duration);
    }
    exercise.sets.push(set);
    previous = set;
  }
  return [...exercises.values()];
}

function muscles(list: unknown): string[] {
  return Array.isArray(list)
    ? list.filter((m): m is string => typeof m === "string" && m.trim() !== "").map(words)
    : [];
}

/** Drops the decimals. */
function putIfSet(o: Record<string, unknown>, name: string, v: number | undefined): void {
  if (v != null) {
    o[name] = Math.trunc(v);
  }
}

export function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function hms(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
