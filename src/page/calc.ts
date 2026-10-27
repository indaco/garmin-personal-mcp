import { addDays } from "../dates";

/**
 * The page's calculations: pure functions over the embedded data, shared by the widgets and tested in
 * Node. Nothing here touches the page.
 */

export interface Activity {
  id?: number;
  name?: string;
  type?: string;
  start?: string;
  km?: number;
  duration?: string;
  elapsed?: string;
  pace?: string;
  avgHR?: number;
  maxHR?: number;
  trainingLoad?: number;
  [field: string]: unknown;
}

/** The activity groups of the tabs, in tab order. */
export const GROUPS = [
  "run",
  "strength",
  "walk",
  "hike",
  "bike",
  "swim",
  "padel",
  "other",
] as const;
export type Group = (typeof GROUPS)[number];

/** The group of a Garmin type key. Padel's key is `paddelball`. */
export function groupOf(key: string): Group {
  if (key.endsWith("running")) return "run";
  if (key.includes("strength")) return "strength";
  if (["walking", "casual_walking", "speed_walking"].includes(key)) return "walk";
  if (key === "hiking" || key === "mountaineering") return "hike";
  if (/biking|cycling/.test(key) || key === "virtual_ride") return "bike";
  if (key.includes("swimming")) return "swim";
  if (/padel|paddel/.test(key)) return "padel";
  return "other";
}

export const isIndoor = (key: string) =>
  ["indoor_cycling", "virtual_ride", "treadmill_running", "indoor_rowing"].includes(key);

/** Seconds of "1:02:03", "5:07" or "5:07/km"; 0 for anything else. */
export function seconds(v: unknown): number {
  const m = typeof v === "string" ? /^(\d+(?::\d{1,2}){1,2})(?:\/km)?$/.exec(v) : null;
  return m ? m[1].split(":").reduce((s, x) => s * 60 + Number(x), 0) : 0;
}

/** Strength and padel have little moving time: their session lasts the elapsed time. */
export function sessionSeconds(a: Activity): number {
  const g = groupOf(a.type ?? "");
  const whole = (g === "strength" || g === "padel") && typeof a.elapsed === "string";
  return seconds(whole ? a.elapsed : a.duration);
}

export function dayOf(a: Activity): string | undefined {
  return typeof a.start === "string" && /^\d{4}-\d{2}-\d{2}/.test(a.start)
    ? a.start.slice(0, 10)
    : undefined;
}

export function mondayOf(day: string): string {
  return addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
}

/** The Mondays of every week from the week of `start` to the week of `end`. */
export function weeksOf(start: string, end: string): string[] {
  const weeks: string[] = [];
  for (let w = mondayOf(start); w <= end; w = addDays(w, 7)) weeks.push(w);
  return weeks;
}

/** The activities of the weeks `from` to `to` (Mondays, both included). */
export function activitiesIn<T extends Activity>(acts: T[], from: string, to: string): T[] {
  const end = addDays(to, 6);
  return acts.filter((a) => {
    const d = dayOf(a);
    return d !== undefined && d >= from && d <= end;
  });
}
