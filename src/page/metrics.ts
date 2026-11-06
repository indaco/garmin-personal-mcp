import { addDays } from "../dates";
import { type Activity, dayOf, seconds } from "./calc";

/**
 * Training and recovery numbers that the widgets share. Pure functions; the dashboard labels every
 * estimate as one where it shows it.
 */

export interface Zones {
  maxHR?: number;
  /** The lower bound of zones 1-5. */
  floors: number[];
}

/** The default zones of Garmin's zone list (the first entry when none is the default). */
export function zonesOf(raw: unknown): Zones {
  const list = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  const z = list.find((x) => x?.sport === "DEFAULT") ?? list[0];
  if (!z) return { floors: [] };
  const floors = [1, 2, 3, 4, 5]
    .map((n) => z[`zone${n}Floor`])
    .filter((v): v is number => typeof v === "number");
  return {
    ...(typeof z.maxHeartRateUsed === "number" ? { maxHR: z.maxHeartRateUsed } : {}),
    floors,
  };
}

/** Garmin's training load; only without it, moving minutes x avg HR / max HR, as an estimate. */
export function loadOf(
  a: Activity,
  maxHR: number | undefined,
): { value: number; estimate: boolean } | undefined {
  if (typeof a.trainingLoad === "number") return { value: a.trainingLoad, estimate: false };
  const minutes = seconds(a.duration) / 60;
  if (typeof a.avgHR === "number" && maxHR && minutes > 0) {
    return { value: (minutes * a.avgHR) / maxHR, estimate: true };
  }
  return undefined;
}

/** The load of each day from..to (yyyy-MM-dd); a rest day is 0. */
export function dailyLoads(acts: Activity[], from: string, to: string, maxHR?: number): number[] {
  const byDay = new Map<string, number>();
  for (const a of acts) {
    const d = dayOf(a);
    if (d && d >= from && d <= to)
      byDay.set(d, (byDay.get(d) ?? 0) + (loadOf(a, maxHR)?.value ?? 0));
  }
  const out: number[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(byDay.get(d) ?? 0);
  return out;
}

/**
 * The load of the 7 days that end on `day`, against the weekly average of the 28 days that end on it.
 * With `dataStart` (the first day of the data): no chronic load and no ratio when the data starts
 * after the first of the 28 days, because the days before it would count as rest.
 */
export function loadRatio(acts: Activity[], day: string, maxHR?: number, dataStart?: string) {
  const sum = (n: number) =>
    dailyLoads(acts, addDays(day, -(n - 1)), day, maxHR).reduce((s, v) => s + v, 0);
  const acute = sum(7);
  if (dataStart !== undefined && addDays(day, -27) < dataStart) {
    return { acute, chronic: null, ratio: null };
  }
  const chronic = sum(28) / 4;
  return { acute, chronic, ratio: chronic > 0 ? acute / chronic : null };
}

/** The change in % of each value against the one before; null for the first, after a 0, and for a gap and the value after it. */
export function ramp(values: (number | null)[]): (number | null)[] {
  return values.map((v, i) => {
    const before = i > 0 ? values[i - 1] : null;
    return v !== null && before !== null && before > 0 ? change(v, before) : null;
  });
}

/** Foster's monotony (mean / SD of the daily loads) and strain (week load x monotony) of 7 days. */
export function monotony(daily: number[]) {
  const weekLoad = daily.reduce((s, v) => s + v, 0);
  const m = mean(daily);
  const s = sd(daily);
  const value = m !== null && s !== null && s > 0 ? m / s : null;
  return { weekLoad, monotony: value, strain: value === null ? null : weekLoad * value };
}

/**
 * Fitness (42-day) and fatigue (7-day) as exponential averages of the daily loads, from 0 on the first
 * day. Form is the fitness minus the fatigue of the day before: how fresh the day starts.
 */
export function fitnessFatigue(daily: number[]) {
  const fitness: number[] = [];
  const fatigue: number[] = [];
  let ctl = 0;
  let atl = 0;
  for (const load of daily) {
    ctl += (load - ctl) / 42;
    atl += (load - atl) / 7;
    fitness.push(ctl);
    fatigue.push(atl);
  }
  const form = daily.map((_, i) => (i === 0 ? 0 : fitness[i - 1] - fatigue[i - 1]));
  return { fitness, fatigue, form };
}

/**
 * Fitness, fatigue and form of each day from..to; null when no activity has a load. The days from the
 * first activity before `from` warm the averages up, so fitness does not start at 0; `warmupDays`
 * counts them.
 */
export function fitnessFatigueFrom(acts: Activity[], from: string, to: string, maxHR?: number) {
  if (acts.every((a) => !loadOf(a, maxHR))) return null;
  const first = acts
    .map(dayOf)
    .filter((d): d is string => d !== undefined)
    .toSorted()[0];
  const start = first < from ? first : from;
  const all = fitnessFatigue(dailyLoads(acts, start, to, maxHR));
  const warmupDays = (Date.parse(from) - Date.parse(start)) / 86_400_000;
  return {
    fitness: all.fitness.slice(warmupDays),
    fatigue: all.fatigue.slice(warmupDays),
    form: all.form.slice(warmupDays),
    warmupDays,
  };
}

export function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

/** The population standard deviation. */
export function sd(values: number[]): number | null {
  const m = mean(values);
  if (m === null) return null;
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length);
}

/** The mean of the last `n` values (up to and with each one), without the missing ones. */
export function rolling(values: (number | null | undefined)[], n: number): (number | null)[] {
  return values.map((_, i) =>
    mean(
      values.slice(Math.max(0, i - n + 1), i + 1).filter((v): v is number => typeof v === "number"),
    ),
  );
}

/** The change from `before` to `now` in %; null without a base. */
export function change(now: number, before: number): number | null {
  return before > 0 ? ((now - before) / before) * 100 : null;
}

/** The colour of a change: better is green, worse is red, no change is grey. */
export function changeClass(
  delta: number | null | undefined,
  higherIsBetter: boolean,
): "good" | "bad" | "same" {
  if (delta === null || delta === undefined || Math.abs(delta) < 0.5) return "same";
  return delta > 0 === higherIsBetter ? "good" : "bad";
}

/** The sum of `value` over the activities of each week (Mondays). */
export function weekly(
  acts: Activity[],
  weeks: string[],
  value: (a: Activity) => number,
): number[] {
  const out = weeks.map(() => 0);
  for (const a of acts) {
    const d = dayOf(a);
    if (!d) continue;
    const i = weeks.findIndex((w) => d >= w && d <= addDays(w, 6));
    if (i >= 0) out[i] += value(a);
  }
  return out;
}

const finite = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** As `weekly`, for a value that a session can lack: a week of sessions without it is null (a gap), and a week without sessions is 0. */
export function weeklyKnown(
  acts: Activity[],
  weeks: string[],
  value: (a: Activity) => number | undefined,
): (number | null)[] {
  const sessions = weekly(acts, weeks, () => 1);
  const lacking = weekly(acts, weeks, (a) => (value(a) === undefined ? 1 : 0));
  return weekly(acts, weeks, (a) => value(a) ?? 0).map((sum, i) =>
    sessions[i] > 0 && lacking[i] === sessions[i] ? null : sum,
  );
}

/** The mean of a recovery field for each week; only days with a value above 0 count, so a week without one is a gap. */
export function weeklyMeans(
  rows: Record<string, unknown>[],
  weeks: string[],
  field: string,
): (number | null)[] {
  return weeks.map((week) => {
    const end = addDays(week, 6);
    const values = rows
      .filter((r) => typeof r.date === "string" && r.date >= week && r.date <= end)
      .map((r) => finite(r[field]))
      .filter((v): v is number => v !== undefined && v > 0);
    const m = mean(values);
    return m === null ? null : Math.round(m * 10) / 10;
  });
}

/** Estimated 1RM (Epley), only for sets of 1 to 12 reps. */
export function epley(kg: number, reps: number): number | undefined {
  return reps >= 1 && reps <= 12 && kg > 0 ? kg * (1 + reps / 30) : undefined;
}

/** A race time at `d2` km from a time `t1` (s) at `d1` km (Riegel). */
export function riegel(t1: number, d1: number, d2: number): number {
  return t1 * (d2 / d1) ** 1.06;
}

const orZero = (v: unknown) => (typeof v === "number" ? v : 0);

export function intensityMinutes(a: Activity): number {
  return orZero(a.moderateMinutes) + 2 * orZero(a.vigorousMinutes);
}

/** The spread (SD, minutes) of bedtimes; a time before noon counts as after midnight. */
export function bedtimeSpread(minutes: number[]): number | null {
  return sd(minutes.map((m) => (m < 720 ? m + 1440 : m)));
}

export interface ReadinessInputs {
  hrvStatus?: string;
  sleepScore?: number;
  rhr?: number;
  rhrAvg?: number;
  ratio?: number | null;
}

/** The dashboard's own heuristic, not Garmin's readiness. */
export function readiness(x: ReadinessInputs): "easy" | "push" | "normal" | null {
  if (x.hrvStatus === undefined && x.sleepScore === undefined) return null;
  const rhrHigh = x.rhr !== undefined && x.rhrAvg !== undefined && x.rhr >= x.rhrAvg + 5;
  if (x.hrvStatus === "LOW" || (x.sleepScore !== undefined && x.sleepScore < 60) || rhrHigh) {
    return "easy";
  }
  if (
    x.hrvStatus === "BALANCED" &&
    (x.sleepScore ?? 0) >= 80 &&
    typeof x.ratio === "number" &&
    x.ratio < 1.3
  ) {
    return "push";
  }
  return "normal";
}

/** Fewer values than this make no base and no trend, on any board: one good day would decide it. */
export const MIN_SESSIONS = 3;

/**
 * The readiness inputs as the page reads them, with the dates of their rows, and the verdict: the last
 * HRV row and the last recovery row of any date, and the mean resting HR of the 7 rows before the last
 * (none with under MIN_SESSIONS values).
 */
export function readinessOf(
  hrv: Record<string, unknown>[],
  recovery: Record<string, unknown>[],
  ratio: number | null,
) {
  const night = hrv.at(-1);
  const today = recovery.at(-1);
  const before = recovery
    .slice(-8, -1)
    .map((r) => finite(r.rhr))
    .filter((v): v is number => v !== undefined);
  const inputs: ReadinessInputs = {
    hrvStatus: typeof night?.status === "string" ? night.status : undefined,
    sleepScore: finite(today?.sleepScore),
    rhr: finite(today?.rhr),
    rhrAvg: before.length >= MIN_SESSIONS ? (mean(before) ?? undefined) : undefined,
    ratio,
  };
  return {
    verdict: readiness(inputs),
    ...inputs,
    hrvDate: typeof night?.date === "string" ? night.date : undefined,
    recoveryDate: typeof today?.date === "string" ? today.date : undefined,
  };
}

/** As many days as the window, right before it, as the digest does; partial when they start before the data. */
export function periodWindow(from: string, end: string, dataStart: string | undefined) {
  const days = (Date.parse(end) - Date.parse(from)) / 86_400_000 + 1;
  const prevFrom = addDays(from, -days);
  return {
    from: prevFrom,
    to: addDays(from, -1),
    partial: dataStart !== undefined && prevFrom < dataStart,
  };
}
