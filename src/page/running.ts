import { type Activity, seconds } from "./calc";
import { riegel } from "./metrics";

/** Pace, zones, splits and race predictions. Pure functions over the embedded data. */

/** Seconds per km: the activity's pace, or moving time over distance. */
export function paceSeconds(a: Activity): number | undefined {
  const pace = seconds(a.pace);
  if (pace > 0) return pace;
  const t = seconds(a.duration);
  return typeof a.km === "number" && a.km > 0 && t > 0 ? t / a.km : undefined;
}

/** Metres per heartbeat: speed in m/min over average HR. */
export function efficiency(a: Activity): number | undefined {
  const pace = paceSeconds(a);
  return pace && typeof a.avgHR === "number" && a.avgHR > 0 ? 60_000 / pace / a.avgHR : undefined;
}

/** The zone index (0-4) of a heart rate; below zone 1 counts as zone 1. */
export function zoneOf(hr: number, floors: number[]): number {
  let z = 0;
  floors.forEach((f, i) => {
    if (hr >= f) z = i;
  });
  return z;
}

/** Seconds in zones 1-5; without them, all moving time in the zone of the average HR (approximate). */
export function zoneSeconds(
  a: Activity,
  floors: number[],
): { sec: number[]; approximate: boolean } | undefined {
  if (Array.isArray(a.hrZonesSec) && a.hrZonesSec.length === 5) {
    return { sec: a.hrZonesSec as number[], approximate: false };
  }
  const t = seconds(a.duration);
  if (typeof a.avgHR !== "number" || t === 0 || floors.length === 0) return undefined;
  const sec = [0, 0, 0, 0, 0];
  sec[zoneOf(a.avgHR, floors)] = t;
  return { sec, approximate: true };
}

export type SplitKind = "negative" | "even" | "positive";

/**
 * The pace of the first and the second half of the distance, from the laps. "even" is within 1% (about
 * 3 s/km at 5:00/km); a faster second half is a negative split. The warm-up, cool-down, rest and
 * recovery laps of a structured run are left out. With HR on every lap, `drift` is the
 * drop in % of speed per heartbeat from the first to the second half (cardiac drift, Pa:HR).
 */
export function splitOf(
  laps: { km?: unknown; time?: unknown; avgHR?: unknown; intensity?: unknown }[],
): { first: number; second: number; kind: SplitKind; drift?: number } | undefined {
  const parts = laps
    // the warm-up, the cool-down and the rests of a structured run are not its running
    .filter((l) => !OTHER.has(l.intensity as string))
    .map((l) => ({
      km: typeof l.km === "number" ? l.km : 0,
      sec: seconds(l.time),
      hr: typeof l.avgHR === "number" && l.avgHR > 0 ? l.avgHR : undefined,
    }))
    .filter((l) => l.km > 0 && l.sec > 0);
  if (parts.length < 2) return undefined;
  const half = parts.reduce((s, l) => s + l.km, 0) / 2;
  const sum = { first: { km: 0, sec: 0, beats: 0 }, second: { km: 0, sec: 0, beats: 0 } };
  let done = 0;
  for (const l of parts) {
    // a lap across the middle counts for its share on each side
    const before = Math.max(0, Math.min(l.km, half - done));
    const ratio = before / l.km;
    sum.first.km += before;
    sum.first.sec += l.sec * ratio;
    sum.first.beats += l.sec * ratio * (l.hr ?? 0);
    sum.second.km += l.km - before;
    sum.second.sec += l.sec * (1 - ratio);
    sum.second.beats += l.sec * (1 - ratio) * (l.hr ?? 0);
    done += l.km;
  }
  const first = sum.first.sec / sum.first.km;
  const second = sum.second.sec / sum.second.km;
  const diff = (second - first) / first;
  // speed per heartbeat = km / beats; beats are HR x seconds (the /60 cancels out in the ratio)
  const drift = parts.every((l) => l.hr)
    ? (1 - sum.second.km / sum.second.beats / (sum.first.km / sum.first.beats)) * 100
    : undefined;
  return {
    first,
    second,
    kind: Math.abs(diff) <= 0.01 ? "even" : diff < 0 ? "negative" : "positive",
    ...(drift === undefined ? {} : { drift }),
  };
}

/**
 * The workout of a run name. Garmin names a run "<place> - <workout>", so the same workout run in two
 * places has two names: the part after the first " - " is the workout. A name without one stays.
 */
export function workoutOf(name: string): string {
  const i = name.indexOf(" - ");
  const workout = i > 0 ? name.slice(i + 3).trim() : "";
  return workout || name;
}

type Lap = { km?: unknown; time?: unknown; intensity?: unknown } & Record<string, unknown>;
const WORK = new Set(["active", "interval"]);
/** The other parts of a structured workout. A free run has only work laps: its auto laps are "active" or "interval". */
const OTHER = new Set(["warmup", "cooldown", "rest", "recovery"]);
/**
 * Shorter work laps are not reps: the watch adds one of a few metres and seconds between the steps of a
 * workout, and its distance is rounded to 10 m, so the time counts too.
 */
const MIN_REP_KM = 0.02;
const MIN_REP_SEC = 8;
/** Reps are alike when their distances, or their times, differ by at most 15%. */
const alike = (v: number[]) => Math.max(...v) <= Math.min(...v) * 1.15;

/**
 * The work part of a structured workout: its active and interval laps of 20 m and 8 s or more, when the laps
 * also mark another part (warm-up, rest, recovery, cool-down). HR, cadence and power are time-weighted,
 * and only when every work lap has them. The fade is the pace of the last rep against the first, in %,
 * within the workout step with the most reps when the laps have steps (two drills are not compared),
 * and only for reps of the same distance or time: a shorter last rep is faster for that reason alone.
 */
export function workOf(laps: Lap[]) {
  if (!laps.some((l) => OTHER.has(l.intensity as string))) return;
  const work = laps
    .filter((l) => WORK.has(l.intensity as string))
    .map((l) => ({ l, km: typeof l.km === "number" ? l.km : 0, sec: seconds(l.time) }))
    .filter((x) => x.km >= MIN_REP_KM && x.sec >= MIN_REP_SEC)
    // the lap distance is rounded to 10 m: the pace that the watch gives is finer for a short rep
    .map((x) => ({ ...x, km: seconds(x.l.pace) > 0 ? x.sec / seconds(x.l.pace) : x.km }));
  if (work.length === 0) return;
  const sec = work.reduce((s, x) => s + x.sec, 0);
  const avg = (field: string) =>
    work.every((x) => typeof x.l[field] === "number")
      ? work.reduce((s, x) => s + (x.l[field] as number) * x.sec, 0) / sec
      : undefined;
  // the reps of one step of the planned workout: the step with the most, else all of them
  const steps = new Map<unknown, typeof work>();
  for (const x of work) steps.set(x.l.step, [...(steps.get(x.l.step) ?? []), x]);
  const reps = work.every((x) => typeof x.l.step === "number")
    ? [...steps.values()].reduce((a, b) => (b.length > a.length ? b : a))
    : work;
  const first = reps[0].sec / reps[0].km;
  const last = reps.at(-1)!.sec / reps.at(-1)!.km;
  return {
    reps: work.length,
    pace: sec / work.reduce((s, x) => s + x.km, 0),
    hr: avg("avgHR"),
    cadence: avg("cadenceSpm"),
    power: avg("avgPowerW"),
    gct: avg("gctMs"),
    vertRatio: avg("vertRatioPct"),
    stride: avg("strideCm"),
    fade:
      reps.length > 1 && (alike(reps.map((x) => x.km)) || alike(reps.map((x) => x.sec)))
        ? ((last - first) / first) * 100
        : undefined,
  };
}

export type WorkoutMetric =
  | "pace"
  | "hr"
  | "efficiency"
  | "cadence"
  | "gct"
  | "vertRatio"
  | "stride"
  | "power";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/**
 * The numbers that compare the sessions of one workout: pace, HR, cadence and power of the work laps
 * of a structured workout, else of the whole run; the running form of the whole run.
 */
export function workoutMetrics(a: Activity) {
  const work = Array.isArray(a.laps) ? workOf(a.laps as Lap[]) : undefined;
  const pace = work ? work.pace : paceSeconds(a);
  const hr = work ? work.hr : num(a.avgHR);
  const m: Partial<Record<WorkoutMetric, number>> & { reps?: number; fade?: number } = {
    pace,
    hr,
    efficiency: pace && hr ? 60_000 / pace / hr : undefined,
    cadence: work ? work.cadence : num(a.cadenceSpm),
    gct: work ? work.gct : num(a.gctMs),
    vertRatio: work ? work.vertRatio : num(a.vertRatioPct),
    stride: work ? work.stride : num(a.strideCm),
    power: work ? work.power : num(a.avgPowerW),
    reps: work?.reps,
    fade: work?.fade,
  };
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)) as typeof m;
}

/**
 * The sessions of one workout that compare with each other, in the order given. When a session has
 * work laps, only the sessions with work laps count: a whole run with its warm-up and jogs looks
 * slower than reps, and would show progress that is not there. `left` is the number left out.
 */
export function workoutSessions(acts: Activity[]) {
  const all = acts.map((a) => ({ a, m: workoutMetrics(a) }));
  const work = all.filter((s) => s.m.reps !== undefined);
  const sessions = work.length > 0 ? work : all;
  return { sessions, left: all.length - sessions.length };
}

export const RACE_KM: Record<string, number> = {
  "5k": 5,
  "10k": 10,
  half: 21.0975,
  marathon: 42.195,
};
const EFFORT_KM: Record<string, number> = { "1k": 1, mile: 1.609, ...RACE_KM };

/** Race times (Riegel) from the best effort of 5 km or more that predicts the fastest times. */
export function predictRaces(best: Record<string, number>) {
  const options = Object.entries(best)
    .filter(([d, s]) => (EFFORT_KM[d] ?? 0) >= 5 && s > 0)
    .map(([distance, s]) => ({
      from: { distance, seconds: s },
      times: Object.fromEntries(
        Object.entries(RACE_KM).map(([r, km]) => [r, riegel(s, EFFORT_KM[distance], km)]),
      ),
    }));
  return options.toSorted((a, b) => a.times["10k"] - b.times["10k"])[0];
}
