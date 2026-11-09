import { type Activity, dayOf, isRunning, seconds, weekIndex } from "./calc";
import { change, MIN_SESSIONS, mean, riegel } from "./metrics";
import type { PlanStep } from "./strength";

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

export interface AerobicTrend {
  /** The mean efficiency of each week; null for a week without an aerobic run. */
  weekly: (number | null)[];
  /** The aerobic runs with an efficiency inside the weeks, in the order given. */
  runs: Activity[];
  /** The weeks at each end of the window that are compared: 4, or half of a short window. */
  n: number;
  first: number | null;
  last: number | null;
  firstRuns: number;
  lastRuns: number;
  /** `last` against `first` in %, only with MIN_SESSIONS runs on each side. */
  change: number | null;
}

/**
 * The efficiency of the runs below zone 4 over the Monday `weeks`: intervals, tempo runs and races
 * raise HR for other reasons. Without zones (`z4` undefined) every run with HR counts.
 */
export function aerobicTrend(runs: Activity[], weeks: string[], z4?: number): AerobicTrend {
  const aerobic = runs.filter(
    (a) =>
      (z4 === undefined || (typeof a.avgHR === "number" && a.avgHR < z4)) &&
      efficiency(a) !== undefined &&
      weekIndex(a, weeks) >= 0,
  );
  const values = (from: number, to: number) =>
    aerobic
      .filter((a) => weekIndex(a, weeks) >= from && weekIndex(a, weeks) < to)
      .map((a) => efficiency(a)!);
  const n = Math.min(4, Math.floor(weeks.length / 2));
  const first = values(0, n);
  const last = values(weeks.length - n, weeks.length);
  return {
    weekly: weeks.map((_, i) => mean(values(i, i + 1))),
    runs: aerobic,
    n,
    first: mean(first),
    last: mean(last),
    firstRuns: first.length,
    lastRuns: last.length,
    change:
      Math.min(first.length, last.length) >= MIN_SESSIONS
        ? change(mean(last)!, mean(first)!)
        : null,
  };
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

/**
 * Per week, the share in % of the zone time spent in zones 1-2 (easy) and 4-5 (hard); null for a week
 * without zone time. `approximate` when a run has no zone seconds and counts in the zone of its average HR.
 */
export function weeklyIntensity(acts: Activity[], weeks: string[], floors: number[]) {
  const sums = weeks.map(() => [0, 0, 0]);
  let approximate = false;
  for (const a of acts) {
    const z = zoneSeconds(a, floors);
    const i = weekIndex(a, weeks);
    if (!z || i < 0) continue;
    approximate ||= z.approximate;
    sums[i][0] += z.sec[0] + z.sec[1];
    sums[i][1] += z.sec[3] + z.sec[4];
    sums[i][2] += z.sec.reduce((s, v) => s + v, 0);
  }
  const share = (n: number) => sums.map((w) => (w[2] > 0 ? (w[n] / w[2]) * 100 : null));
  return { easy: share(0), hard: share(1), approximate };
}

/** The longest run's km in % of the week's km; null when the week has no km. */
export function longestShare(week: Activity[]): number | null {
  const km = week.reduce((s, a) => s + (num(a.km) ?? 0), 0);
  const longest = Math.max(0, ...week.map((a) => num(a.km) ?? 0));
  return km > 0 ? (longest / km) * 100 : null;
}

/** Per week, the run with the fastest best effort at `d`; the first in the list keeps a tie. */
export function weeklyFastest(
  runs: Activity[],
  weeks: string[],
  d: string,
): (Activity | undefined)[] {
  const effort = (a: Activity) => seconds((a.best as Record<string, unknown> | undefined)?.[d]);
  return weeks.map((_, i) =>
    runs
      .filter((a) => weekIndex(a, weeks) === i && effort(a) > 0)
      .reduce<Activity | undefined>((b, a) => (b && effort(b) <= effort(a) ? b : a), undefined),
  );
}

export type SplitKind = "negative" | "even" | "positive";

/**
 * The pace of the first and the second half of the distance, from the laps. "even" is within 1% (about
 * 3 s/km at 5:00/km); a faster second half is a negative split. The warm-up, cool-down, rest and
 * recovery laps of a structured run are left out. A lap's distance is its time / pace when it has
 * a pace, because the lap km is rounded to 10 m. With HR on every lap, `drift` is the
 * drop in % of speed per heartbeat from the first to the second half (cardiac drift, Pa:HR).
 */
export function splitOf(
  laps: { km?: unknown; time?: unknown; pace?: unknown; avgHR?: unknown; intensity?: unknown }[],
): { first: number; second: number; kind: SplitKind; drift?: number } | undefined {
  const parts = laps
    // the warm-up, the cool-down and the rests of a structured run are not its running
    .filter((l) => !OTHER.has(l.intensity as string))
    .map((l) => {
      const sec = seconds(l.time);
      // the lap distance is rounded to 10 m: time over the watch's pace is finer
      const pace = seconds(l.pace);
      return {
        km: pace > 0 ? sec / pace : typeof l.km === "number" ? l.km : 0,
        sec,
        hr: typeof l.avgHR === "number" && l.avgHR > 0 ? l.avgHR : undefined,
      };
    })
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
 * Shorter work laps are not reps: an open step of the workout (it ends when you press lap) gives a lap of
 * a few metres and seconds, and its distance is rounded to 10 m, so the time counts too.
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
 * `fades` gives the fade of every step with more than one rep.
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
  // one fade per step with more than one rep (the coach prompts); `fade` above stays the page's
  const groups = work.every((x) => typeof x.l.step === "number")
    ? [...steps.entries()]
    : [[undefined, work] as const];
  const fades = groups
    .filter(([, g]) => g.length > 1)
    .map(([index, g]) => {
      const a = g[0].sec / g[0].km;
      const b = g.at(-1)!.sec / g.at(-1)!.km;
      const ok = alike(g.map((x) => x.km)) || alike(g.map((x) => x.sec));
      return {
        ...(index === undefined ? {} : { step: index as number }),
        reps: g.length,
        first: a,
        last: b,
        ...(ok ? { pct: ((b - a) / a) * 100 } : {}),
      };
    });
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
    fades,
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
  | "power"
  | "plan";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/**
 * The numbers that compare the sessions of one workout: pace, HR, cadence and power of the work laps
 * of a structured workout, else of the whole run; the running form of the whole run; `plan`, the
 * percent of the laps with a planned target that were inside it.
 */
export function workoutMetrics(a: Activity) {
  const work = Array.isArray(a.laps) ? workOf(a.laps as Lap[]) : undefined;
  const verdicts = (Array.isArray(a.planVerdicts) ? a.planVerdicts : []).map(
    (r: unknown) => (r as { verdict?: unknown } | null)?.verdict,
  );
  const hit = verdicts.filter((v) => v === "hit").length;
  const judged = hit + verdicts.filter((v) => v === "miss").length;
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
    plan: judged > 0 ? Math.round((100 * hit) / judged) : undefined,
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

/** Race times (Riegel) from each best effort of 5 km or more, the fastest predicted times first. */
export function racePredictionsOf(best: Record<string, number>) {
  return Object.entries(best)
    .filter(([d, s]) => (EFFORT_KM[d] ?? 0) >= 5 && s > 0)
    .map(([distance, s]) => ({
      from: { distance, seconds: s },
      times: Object.fromEntries(
        Object.entries(RACE_KM).map(([r, km]) => [r, riegel(s, EFFORT_KM[distance], km)]),
      ),
    }))
    .toSorted((a, b) => a.times["10k"] - b.times["10k"]);
}

/** Race times (Riegel) from the best effort of 5 km or more that predicts the fastest times. */
export function predictRaces(best: Record<string, number>) {
  return racePredictionsOf(best)[0];
}

/** A run that set a new fastest time of a best-effort distance. */
export interface Best {
  /** The time in seconds, and as Garmin wrote it. */
  s: number;
  time: string;
  a: Activity;
}

/**
 * Each activity that set a new fastest time of each best-effort distance (`best`), oldest first: the
 * last one is the fastest. A tie is no new best, so the first run with a time holds it, and the list
 * grows with the improvements, not with the sessions. Only the given activities count: the result is
 * the best of the page's weeks, not an all-time record. A time that does not read as seconds (or
 * reads as 0) counts for nothing.
 */
export function bestProgression(acts: Activity[]): Record<string, Best[]> {
  const out = new Map<string, Best[]>();
  const dated = acts.filter((a) => dayOf(a) !== undefined);
  for (const a of dated.toSorted((x, y) => (String(x.start) < String(y.start) ? -1 : 1))) {
    const best = a.best;
    if (typeof best !== "object" || best === null || Array.isArray(best)) continue;
    for (const [d, time] of Object.entries(best)) {
      const s = seconds(time);
      if (s <= 0) continue;
      const list = out.get(d) ?? [];
      if (list.length === 0 || s < list.at(-1)!.s) out.set(d, [...list, { s, time, a }]);
    }
  }
  return Object.fromEntries(out);
}

/** A long run: a race, or a run over 15 km. The dashboard reads its laps; the page and the digest split it. */
export function isLongRun(a: Activity): boolean {
  if (!isRunning(a)) return false;
  return a.race === true || (typeof a.km === "number" && Number.isFinite(a.km) && a.km > 15);
}

/** A lap of a run, in FIT units, for the plan step it was run for. */
export interface PlanLap {
  lap: number;
  step?: number;
  intensity?: string;
  metres?: number;
  seconds?: number;
  /** m/s */
  speed?: number;
  /** raw strides per minute */
  cadence?: number;
  hr?: number;
  power?: number;
}

export type LapTarget =
  | { type: string; low: number; high: number; unit: string }
  | { type: string; zone: number };

export interface LapPlanRow {
  lap: number;
  step: number;
  intensity?: string;
  target: LapTarget | null;
  /** the lap in the unit of the target; a pace in s/km */
  done: number | null;
  verdict: "hit" | "miss" | null;
  /** the signed distance outside the target, in its unit: 0 on a hit */
  off: number | null;
}

/**
 * A lap shorter than this is an open step ended by the lap button: no verdict. The same rule as a rep
 * (MIN_REP_KM, MIN_REP_SEC): 15 m is the raw distance that the rounded lap km shows as 0.02.
 */
const MIN_PLAN_METRES = 15;
const MIN_PLAN_SEC = 8;
const NAMES: Record<string, string> = {
  speed: "pace",
  heart_rate: "heart_rate",
  cadence: "cadence",
  power: "power",
};
/** The plausible range of a target in the unit shown; outside it the conversion is likely wrong. */
const PLAUSIBLE: Record<string, [number, number]> = {
  "/km": [120, 900],
  bpm: [30, 230],
  W: [1, 2000],
  spm: [60, 250],
};

const positive = (v: number | undefined) => (v !== undefined && v > 0 ? v : undefined);
/** s/km of a speed in m/s, in whole seconds, as the pace shows: the verdict uses this value. */
const pace = (speed: number) => Math.round(1000 / speed);

/**
 * The target of a plan step in the unit shown, and the lap's value in that unit. FIT gives speed in
 * mm/s (low is the slower pace), cadence in strides per minute (shown doubled, as steps), heart rate
 * 1-100 as % of max and above 100 as bpm + 100, power 1-1000 as % of FTP and above 1000 as W + 1000.
 * shortcut: the pace, heart rate and power units follow the FIT profile and are not checked on real
 * data (only cadence targets were seen); check them on a real run with such a target.
 */
function targetOf(
  s: PlanStep,
  l: PlanLap,
): { target: LapTarget; done: number | null; value?: number } | null {
  const type = s.targetType === undefined ? undefined : NAMES[s.targetType];
  if (!type) return null;
  if (s.targetValue) return { target: { type, zone: s.targetValue }, done: null };
  const { targetLow: lo, targetHigh: hi } = s;
  if (lo === undefined || hi === undefined) return null;
  if (type === "pace") {
    // a speed of 0 has no pace
    if (lo <= 0 || hi <= 0) return null;
    const speed = positive(l.speed);
    return {
      target: { type, low: pace(lo / 1000), high: pace(hi / 1000), unit: "/km" },
      done: speed === undefined ? null : pace(speed),
    };
  }
  if (type === "cadence") {
    const raw = positive(l.cadence);
    const spm = raw === undefined ? undefined : raw * 2;
    // judged on the value before rounding: the shown spm is rounded
    return {
      target: { type, low: lo * 2, high: hi * 2, unit: "spm" },
      done: spm === undefined ? null : Math.round(spm),
      value: spm,
    };
  }
  const [offset, pct, unit, lapValue] =
    type === "heart_rate" ? [100, "%max", "bpm", l.hr] : [1000, "%ftp", "W", l.power];
  if (lo <= offset || hi <= offset)
    return { target: { type, low: lo, high: hi, unit: pct }, done: null };
  return {
    target: { type, low: lo - offset, high: hi - offset, unit },
    done: positive(lapValue) ?? null,
  };
}

/**
 * One row per lap that has a plan step, in lap order: the step's target, the lap's value, and hit
 * (inside the target, ends included) or miss with the signed distance outside it. No verdict for an
 * open or zone target, a target in % of max HR or FTP, a target outside the plausible range, a lap
 * under 15 m or 8 s, or a lap without the value of its target.
 */
export function planOfLaps(steps: PlanStep[], laps: PlanLap[]): LapPlanRow[] {
  const byIndex = new Map(steps.map((s) => [s.index, s]));
  return laps.flatMap((l) => {
    if (l.step === undefined) return [];
    const row: LapPlanRow = {
      lap: l.lap,
      step: l.step,
      intensity: l.intensity,
      target: null,
      done: null,
      verdict: null,
      off: null,
    };
    const s = byIndex.get(l.step);
    const t = s && targetOf(s, l);
    if (!t) return [row];
    row.target = t.target;
    row.done = t.done;
    if (!("unit" in t.target) || t.done === null) return [row];
    const { low, high, unit } = t.target;
    const [min, max] = PLAUSIBLE[unit];
    const short = (l.metres ?? 0) < MIN_PLAN_METRES || (l.seconds ?? 0) < MIN_PLAN_SEC;
    if (short || [low, high].some((v) => v < min || v > max)) {
      return [row];
    }
    // a pace range runs from slow (low) to fast (high)
    const [a, b] = [Math.min(low, high), Math.max(low, high)];
    const v = t.value ?? t.done;
    const off = v < a ? v - a : v > b ? v - b : 0;
    row.verdict = off === 0 ? "hit" : "miss";
    // a miss by less than 0.05 keeps its side, so off is never 0 on a miss
    row.off = Math.round(off * 10) / 10 || Math.sign(off) * 0.1;
    return [row];
  });
}

/** A workout and target type whose laps miss the plan: under (`low`) or over (`high`) the range. */
export interface RunPlanMiss {
  workout: string;
  type: string;
  laps: number;
  misses: number;
  low: number;
  high: number;
}

/** Text order by code unit, the same on every machine. */
const byText = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);

/**
 * The plan verdicts of the runs in the weeks (`planVerdicts`: [] is a planned run with no target to
 * check, null a run without a plan, absent a run whose laps were not read). One count per lap with a
 * verdict. A week without such a lap is null when it holds a run that was not read: that run can be
 * a planned one.
 */
export function runPlanAdherence(acts: Activity[], weeks: string[]) {
  const out = {
    runs: 0,
    untargeted: 0,
    unread: 0,
    weeks: weeks.map((): { hit: number; miss: number } | null => ({ hit: 0, miss: 0 })),
    mostMissed: [] as RunPlanMiss[],
  };
  const unreadWeeks = new Set<number>();
  const stats = new Map<string, RunPlanMiss>();
  for (const a of acts) {
    const i = weekIndex(a, weeks);
    if (i < 0 || !isRunning(a)) continue;
    out.runs++;
    const rows = a.planVerdicts;
    if (rows === null) continue;
    if (!Array.isArray(rows)) {
      out.unread++;
      unreadWeeks.add(i);
      continue;
    }
    if (rows.length === 0) out.untargeted++;
    const workout = typeof a.name === "string" ? workoutOf(a.name) : undefined;
    for (const r of rows as Record<string, unknown>[]) {
      const { type, verdict, why } = r ?? {};
      if (typeof type !== "string" || (verdict !== "hit" && verdict !== "miss")) continue;
      out.weeks[i]![verdict]++;
      if (workout === undefined) continue;
      const key = JSON.stringify([workout, type]);
      const x = stats.get(key) ?? { workout, type, laps: 0, misses: 0, low: 0, high: 0 };
      stats.set(key, x);
      x.laps++;
      if (verdict === "hit") continue;
      x.misses++;
      if (why === "low" || why === "high") x[why]++;
    }
  }
  for (const i of unreadWeeks)
    if (out.weeks[i]!.hit + out.weeks[i]!.miss === 0) out.weeks[i] = null;
  out.mostMissed = [...stats.values()]
    .filter((x) => x.misses > 0)
    .toSorted(
      (x, y) => y.misses - x.misses || byText(x.workout, y.workout) || byText(x.type, y.type),
    );
  return out;
}
