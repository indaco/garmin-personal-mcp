import { addDays } from "./dates";
import { round } from "./fit";
import { type Activity, dayOf, mondayOf, sessionSeconds, seconds } from "./page/calc";

type Json = Record<string, unknown>;

interface Totals {
  sessions: number;
  km?: number;
  hours?: number;
  load: number;
}

interface Week {
  sessions: number;
  km: number;
  runKm: number;
  hours: number;
  load: number;
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
  load: { last7Days: number; weeklyAvgLast28Days: number; acuteToChronic: number | null };
  bestEfforts: Record<string, { time: string; date: string; name: unknown }>;
  races: Json[];
  strengthExercises: Record<string, { sessions: number; first?: TopSet; last?: TopSet }>;
  hrvLast14: unknown[];
  recovery: unknown;
  fitnessAge: Json;
  sync: unknown;
}

/**
 * Sums and copies of a getDashboardData result, and no page logic: the page calculates the rest in the
 * browser. Every number in it comes straight from the data, so a coach note can quote it.
 */
export function digest(data: Json): Digest {
  const acts = list(data.activities).filter((a) => dayOf(a as Activity) !== undefined);
  const end = typeof data.end === "string" ? data.end : "";

  const totals: Record<string, Totals> = {};
  const weekly: Record<string, Week> = {};
  for (const a of acts) {
    const type = typeOf(a);
    const t = (totals[type] ??= { sessions: 0, km: 0, hours: 0, load: 0 });
    const w = (weekly[mondayOf(dayOf(a as Activity)!)] ??= {
      sessions: 0,
      km: 0,
      runKm: 0,
      hours: 0,
      load: 0,
    });
    const km = num(a.km);
    const hours = sessionSeconds(a as Activity) / 3600;
    const load = num(a.trainingLoad);
    t.sessions++;
    t.km! += km;
    t.hours! += hours;
    t.load += load;
    w.sessions++;
    w.km += km;
    w.hours += hours;
    w.load += load;
    if (type.endsWith("running")) {
      w.runKm += km;
    }
  }

  const previousPeriodTotals: Record<string, Totals> = {};
  for (const a of list(data.previousActivities)) {
    const t = (previousPeriodTotals[typeOf(a)] ??= { sessions: 0, km: 0, load: 0 });
    t.sessions++;
    t.km! += num(a.km);
    t.load += num(a.trainingLoad);
  }

  const loadFrom = (from: string) =>
    acts
      .filter((a) => dayOf(a as Activity)! >= from && dayOf(a as Activity)! <= end)
      .reduce((s, a) => s + num(a.trainingLoad), 0);
  const acute = loadFrom(addDays(end, -6));
  const chronic = loadFrom(addDays(end, -27)) / 4;

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
    period: pick(data, ["start", "end", "weeks", "prevStart", "prevEnd"]),
    totals: mapValues(totals, roundTotals),
    previousPeriodTotals: mapValues(previousPeriodTotals, roundTotals),
    weekly: Object.fromEntries(
      Object.entries(weekly)
        .toSorted(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, w]) => [k, roundWeek(w)]),
    ),
    load: {
      last7Days: round(acute, 1),
      weeklyAvgLast28Days: round(chronic, 1),
      acuteToChronic: chronic > 0 ? round(acute / chronic, 2) : null,
    },
    bestEfforts,
    races: acts
      .filter((a) => a.race === true)
      .map((a) => ({
        date: dayOf(a as Activity),
        ...pick(a, ["name", "km", "duration", "pace", "avgHR"]),
      })),
    strengthExercises,
    hrvLast14: list(data.hrv).slice(-14),
    recovery: data.recovery,
    fitnessAge: pick(age, ["fitnessAge", "chronologicalAge", "achievableFitnessAge"]),
    sync: data.sync,
  };
}

/** The heaviest completed set, as "70 kg x 6"; undefined for sets without weight. */
function topSet(sets: Json[]): string | undefined {
  const top = sets
    .filter((s) => num(s.reps) > 0 && num(s.kg) > 0)
    .toSorted((a, b) => num(b.kg) - num(a.kg) || num(b.reps) - num(a.reps))[0];
  return top ? `${num(top.kg)} kg x ${num(top.reps)}` : undefined;
}

function roundWeek(w: Week): Week {
  return {
    sessions: w.sessions,
    km: round(w.km, 1),
    runKm: round(w.runKm, 1),
    hours: round(w.hours, 1),
    load: round(w.load, 1),
  };
}

/** Rounded to 0.1; no km for types without distance (strength, racket sports). */
function roundTotals(t: Totals): Totals {
  return {
    sessions: t.sessions,
    ...(t.km ? { km: round(t.km, 1) } : {}),
    ...(t.hours === undefined ? {} : { hours: round(t.hours, 1) }),
    load: round(t.load, 1),
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
