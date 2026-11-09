import { type Activity, dayOf, groupOf, seconds, sessionSeconds } from "./calc";
import { mean } from "./metrics";
import { recentWindow } from "./strength";

/** Numbers of the walk, hike, bike, swim and racket sport widgets. Pure functions. */

/** Seconds per 100 m. */
export function swimPace(a: Activity): number | undefined {
  const t = seconds(a.duration);
  return typeof a.km === "number" && a.km > 0 && t > 0 ? t / (a.km * 10) : undefined;
}

const positive = (v: unknown) => (typeof v === "number" && v > 0 ? v : undefined);

/** Strokes per length. Garmin counts a stroke for each full cycle of the watch arm. */
export function strokesPerLength(a: Activity): number | undefined {
  const strokes = positive(a.strokes);
  const lengths = positive(a.lengths);
  return strokes && lengths ? strokes / lengths : undefined;
}

/** Metres per stroke of the watch arm. */
export function distancePerStroke(a: Activity): number | undefined {
  const strokes = positive(a.strokes);
  const km = positive(a.km);
  return strokes && km ? (km * 1000) / strokes : undefined;
}

export interface SwimTrend {
  poolLengthM: number;
  /** Oldest first: swims of one pool length with a pace and a stroke count. */
  sessions: { a: Activity; date: string; pace: number; strokes: number }[];
  /** The other swims: open water, another pool length, or a swim without strokes. */
  left: number;
  /** The newest swims against as many before them; null when there are not as many, or too close. */
  window: {
    swims: number;
    pace: { recent: number; before: number };
    strokes: { recent: number; before: number };
  } | null;
}

const byDate = (x: { date: string }, y: { date: string }) => x.date.localeCompare(y.date);

/**
 * The swims that compare with each other: only one pool length, the one with the most swims (the
 * newest one on a tie), because SWOLF and strokes depend on it. Open water has no pool length.
 */
export function swimTrend(acts: Activity[]): SwimTrend | undefined {
  const swims = acts.filter((a) => groupOf(a) === "swimming");
  const pools = new Map<number, SwimTrend["sessions"]>();
  for (const a of swims) {
    const pool = positive(a.poolLengthM);
    const date = dayOf(a);
    const pace = swimPace(a);
    const strokes = strokesPerLength(a);
    if (!pool || !date || !pace || !strokes) continue;
    pools.set(pool, [...(pools.get(pool) ?? []), { a, date, pace, strokes }]);
  }
  const best = [...pools]
    .map(([poolLengthM, list]) => ({ poolLengthM, sessions: list.toSorted(byDate) }))
    .toSorted(
      (x, y) =>
        y.sessions.length - x.sessions.length ||
        y.sessions.at(-1)!.date.localeCompare(x.sessions.at(-1)!.date),
    )[0];
  if (!best) return undefined;
  const { sessions } = best;
  const k = recentWindow(sessions);
  const means = (v: (s: SwimTrend["sessions"][number]) => number) => ({
    recent: mean(sessions.slice(-k!).map(v))!,
    before: mean(sessions.slice(-2 * k!, -k!).map(v))!,
  });
  return {
    ...best,
    left: swims.length - sessions.length,
    window: k ? { swims: k, pace: means((s) => s.pace), strokes: means((s) => s.strokes) } : null,
  };
}

/** Ascent in metres per hour of moving time. */
export function verticalPerHour(a: Activity): number | undefined {
  const h = seconds(a.duration) / 3600;
  return typeof a.ascentM === "number" && h > 0 ? a.ascentM / h : undefined;
}

/** A value (e.g. calories) per hour of session time. */
export function perHour(value: number, a: Activity): number | undefined {
  const h = sessionSeconds(a) / 3600;
  return h > 0 ? value / h : undefined;
}

/** km/h over moving time. */
export function kmPerHour(a: Activity): number | undefined {
  const hours = seconds(a.duration) / 3600;
  return typeof a.km === "number" && hours > 0 ? a.km / hours : undefined;
}

/** The share in % of the zone seconds in the given zones (0-4). */
export function zoneShare(sec: number[], zones: number[]): number | null {
  const total = sec.reduce((s, v) => s + v, 0);
  return total > 0 ? (zones.reduce((s, z) => s + (sec[z] ?? 0), 0) / total) * 100 : null;
}

/** Garmin load per moving minute of the runs: to compare a session with a run of the same length. */
export function runLoadPerMinute(acts: Activity[]): number | null {
  let load = 0;
  let minutes = 0;
  for (const a of acts) {
    if (groupOf(a) !== "running" || typeof a.trainingLoad !== "number") continue;
    load += a.trainingLoad;
    minutes += seconds(a.duration) / 60;
  }
  return minutes > 0 ? load / minutes : null;
}
