import { addDays } from "./dates";
import { round } from "./fit";
import { type Activity, dayOf, mondayOf, sessionSeconds, seconds } from "./page/calc";
import { loadOf, loadRatio, zonesOf } from "./page/metrics";
import { workoutOf } from "./page/running";

type Json = Record<string, unknown>;

/** A load is null (n/a) when the sessions have none; estimatedLoads counts estimates from HR. */
interface Totals {
  sessions: number;
  km?: number;
  hours?: number;
  load: number | null;
  estimatedLoads?: number;
}

interface Week {
  sessions: number;
  km: number;
  runKm: number;
  hours: number;
  load: number | null;
  estimatedLoads?: number;
  /** The period starts after this Monday: the week is not whole. */
  partial?: true;
}

/** The running sums of a type or a week; `known` and `estimated` count the sessions with a load. */
interface Sum {
  sessions: number;
  km: number;
  runKm: number;
  hours: number;
  load: number;
  known: number;
  estimated: number;
}

interface TopSet {
  date: string;
  top: string;
}

/** What Claude needs for the coach notes, in a few KB instead of the whole getDashboardData result. */
export interface Digest {
  period: Json;
  totals: Record<string, Totals>;
  previousPeriodTotals: Record<string, Totals>;
  weekly: Record<string, Week>;
  load: {
    last7Days: number | null;
    weeklyAvgLast28Days: number | null;
    acuteToChronic: number | null;
    estimatedLoads: number;
  };
  bestEfforts: Record<string, { time: string; date: string; name: unknown }>;
  races: Json[];
  /** The run names with more than one session: the workouts that the workout trend compares. */
  repeatedRuns: Record<string, number>;
  strengthExercises: Record<string, { sessions: number; first?: TopSet; last?: TopSet }>;
  hrvLast14: unknown[];
  recovery: unknown;
  fitnessAge: Json;
  sync: unknown;
}

/**
 * Sums and copies of a getDashboardData result, with the page's load functions, so a coach note can
 * quote what the page shows. A number that the data cannot back is null (n/a); a load from the HR
 * estimate is counted in `estimatedLoads`.
 */
export function digest(data: Json): Digest {
  const acts = list(data.activities).filter((a) => dayOf(a as Activity) !== undefined);
  const previous = list(data.previousActivities).filter((a) => dayOf(a as Activity) !== undefined);
  const start = typeof data.start === "string" ? data.start : "";
  const end = typeof data.end === "string" ? data.end : "";
  // the page's load: Garmin's, else its labelled estimate from HR
  const maxHR = zonesOf(data.zones).maxHR;
  const loadIn = (a: Json) => loadOf(a as Activity, maxHR);

  const totals: Record<string, Sum> = {};
  const weekly: Record<string, Sum> = {};
  for (const a of acts) {
    const type = typeOf(a);
    const km = num(a.km);
    for (const s of [
      (totals[type] ??= sum()),
      (weekly[mondayOf(dayOf(a as Activity)!)] ??= sum()),
    ]) {
      add(s, km, sessionSeconds(a as Activity) / 3600, loadIn(a));
      if (type.endsWith("running")) s.runKm += km;
    }
  }

  // as many days as the period, right before it: the previous rows start a week earlier
  const days = start && end ? (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1 : 0;
  const previousPeriod =
    days > 0 ? { from: addDays(start, -days), to: addDays(start, -1) } : undefined;
  const previousPeriodTotals: Record<string, Sum> = {};
  for (const a of previous) {
    const day = dayOf(a as Activity)!;
    if (previousPeriod && (day < previousPeriod.from || day > previousPeriod.to)) continue;
    add((previousPeriodTotals[typeOf(a)] ??= sum()), num(a.km), 0, loadIn(a));
  }

  // the weeks before the period count for the 28 days, as on the page
  const every = [...acts, ...previous] as Activity[];
  const dataStart = typeof data.prevStart === "string" ? data.prevStart : undefined;
  const ratio = loadRatio(every, end, maxHR, dataStart);
  const loadsFrom = (from: string) =>
    every.filter((a) => dayOf(a)! >= from && dayOf(a)! <= end).map((a) => loadOf(a, maxHR));
  const week = loadsFrom(addDays(end, -6));
  const month = loadsFrom(addDays(end, -27));
  // sessions without any load: n/a, not 0; no session at all is rest, a true 0
  const unknown = (loads: typeof week) => loads.length > 0 && loads.every((l) => l === undefined);

  const bestEfforts: Digest["bestEfforts"] = {};
  for (const a of acts) {
    for (const [distance, time] of Object.entries(isObject(a.best) ? a.best : {})) {
      const known = bestEfforts[distance];
      if (typeof time === "string" && (!known || seconds(time) < seconds(known.time))) {
        bestEfforts[distance] = { time, date: dayOf(a as Activity)!, name: a.name };
      }
    }
  }

  // activities come most recent first: the first top set seen is the last one done
  const strengthExercises: Digest["strengthExercises"] = {};
  for (const a of acts) {
    for (const e of list(a.exercises)) {
      if (typeof e.exercise !== "string") continue;
      const x = (strengthExercises[e.exercise] ??= { sessions: 0 });
      x.sessions++;
      const top = topSet(list(e.sets));
      if (top) {
        const set = { date: dayOf(a as Activity)!, top };
        x.last ??= set;
        x.first = set;
      }
    }
  }

  const age = isObject(data.fitnessAge) ? data.fitnessAge : {};
  return {
    period: {
      ...pick(data, ["start", "end", "weeks", "prevStart", "prevEnd"]),
      ...(previousPeriod ? { previousPeriod } : {}),
    },
    totals: mapValues(totals, (t) => roundTotals(t, true)),
    previousPeriodTotals: mapValues(previousPeriodTotals, (t) => roundTotals(t, false)),
    weekly: Object.fromEntries(
      Object.entries(weekly)
        .toSorted(([a], [b]) => (a < b ? -1 : 1))
        // the period starts after this Monday: the week is not whole
        .map(([k, w]) => [
          k,
          { ...roundWeek(w), ...(k < start ? { partial: true as const } : {}) },
        ]),
    ),
    load: {
      last7Days: unknown(week) ? null : round(ratio.acute, 1),
      weeklyAvgLast28Days:
        ratio.chronic === null || unknown(month) ? null : round(ratio.chronic, 1),
      acuteToChronic: ratio.ratio === null ? null : round(ratio.ratio, 2),
      estimatedLoads: month.filter((l) => l?.estimate).length,
    },
    bestEfforts,
    races: acts
      .filter((a) => a.race === true)
      .map((a) => ({
        date: dayOf(a as Activity),
        ...pick(a, ["name", "km", "duration", "pace", "avgHR"]),
      })),
    repeatedRuns: repeatedRuns(acts),
    strengthExercises,
    hrvLast14: list(data.hrv).slice(-14),
    recovery: data.recovery,
    fitnessAge: pick(age, ["fitnessAge", "chronologicalAge", "achievableFitnessAge"]),
    sync: data.sync,
  };
}

/** The number of runs of each workout (the run name without its place) that has more than one, most first. */
function repeatedRuns(acts: Json[]): Record<string, number> {
  const count = new Map<string, number>();
  for (const a of acts) {
    if (typeOf(a).endsWith("running") && typeof a.name === "string") {
      const w = workoutOf(a.name);
      count.set(w, (count.get(w) ?? 0) + 1);
    }
  }
  return Object.fromEntries([...count].filter(([, n]) => n > 1).toSorted((x, y) => y[1] - x[1]));
}

/** The heaviest completed set, as "70 kg x 6"; undefined for sets without weight. */
function topSet(sets: Json[]): string | undefined {
  const top = sets
    .filter((s) => num(s.reps) > 0 && num(s.kg) > 0)
    .toSorted((a, b) => num(b.kg) - num(a.kg) || num(b.reps) - num(a.reps))[0];
  return top ? `${num(top.kg)} kg x ${num(top.reps)}` : undefined;
}

function sum(): Sum {
  return { sessions: 0, km: 0, runKm: 0, hours: 0, load: 0, known: 0, estimated: 0 };
}

function add(s: Sum, km: number, hours: number, load: ReturnType<typeof loadOf>): void {
  s.sessions++;
  s.km += km;
  s.hours += hours;
  if (load) {
    s.load += load.value;
    s.known++;
    if (load.estimate) s.estimated++;
  }
}

/** The load of sessions that all lack one is n/a; the count of estimates only when there are some. */
function loadPart(s: Sum): Pick<Totals, "load" | "estimatedLoads"> {
  return {
    load: s.known > 0 ? round(s.load, 1) : null,
    ...(s.estimated > 0 ? { estimatedLoads: s.estimated } : {}),
  };
}

function roundWeek(w: Sum): Week {
  return {
    sessions: w.sessions,
    km: round(w.km, 1),
    runKm: round(w.runKm, 1),
    hours: round(w.hours, 1),
    ...loadPart(w),
  };
}

/** Rounded to 0.1; no km for types without distance (strength, racket sports). */
function roundTotals(t: Sum, hours: boolean): Totals {
  return {
    sessions: t.sessions,
    ...(t.km ? { km: round(t.km, 1) } : {}),
    ...(hours ? { hours: round(t.hours, 1) } : {}),
    ...loadPart(t),
  };
}

function typeOf(a: Json): string {
  return typeof a.type === "string" ? a.type : "other";
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function list(v: unknown): Json[] {
  return Array.isArray(v) ? v.filter(isObject) : [];
}

function pick(o: Json, keys: string[]): Json {
  return Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
}

function mapValues<T, U>(o: Record<string, T>, f: (v: T) => U): Record<string, U> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));
}

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
