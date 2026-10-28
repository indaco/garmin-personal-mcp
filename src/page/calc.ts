import { addDays } from "../dates";

/**
 * The page's calculations: pure functions over the embedded data, shared by the widgets and tested in
 * Node. Nothing here touches the page.
 */

export interface Activity {
  id?: number;
  name?: string;
  type?: string;
  /** The SDK sport name, from Garmin's sportTypeId. */
  sport?: string;
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

/**
 * The type boards, in tab order. Their keys are SDK names: the sport of Garmin's `sportTypeId`, and the
 * sub-sport `strengthTraining`. Any other SDK sport in the data gets a board too, before `generic` (Other).
 */
export const GROUPS: readonly string[] = [
  "running",
  "strengthTraining",
  "walking",
  "hiking",
  "cycling",
  "swimming",
  "racket",
  "generic",
];

/** Garmin types whose SDK sport is not their board: strength comes as `training` or `fitnessEquipment`. */
const TYPE_BOARD = new Map([
  ["strength_training", "strengthTraining"],
  ["pickleball", "racket"],
]);

/** The racket sports of a Garmin watch, by type key. Padel's key is `paddelball`. */
const RACKET: [RegExp, string][] = [
  [/table_tennis/, "tableTennis"],
  [/platform_tennis/, "platformTennis"],
  [/padel|paddel/, "padel"],
  [/pickleball/, "pickleball"],
  [/racquetball|racketball/, "racquetball"],
  [/squash/, "squash"],
  [/badminton/, "badminton"],
  [/tennis/, "tennis"],
];

/** The racket sport of a type key ("padel", "tableTennis"...); undefined for other types. */
export function sportOf(key: string): string | undefined {
  return RACKET.find(([re]) => re.test(key))?.[1];
}

/** The board of an activity: its SDK sport, or `generic` when the data has none. */
export function groupOf(a: Activity): string {
  const sport = typeof a.sport === "string" && a.sport && a.sport !== "all" ? a.sport : "generic";
  return TYPE_BOARD.get(a.type ?? "") ?? sport;
}

export const isIndoor = (key: string) =>
  ["indoor_cycling", "virtual_ride", "treadmill_running", "indoor_rowing"].includes(key);

/** Seconds of "1:02:03", "5:07" or "5:07/km"; 0 for anything else. */
export function seconds(v: unknown): number {
  const m = typeof v === "string" ? /^(\d+(?::\d{1,2}){1,2})(?:\/km)?$/.exec(v) : null;
  return m ? m[1].split(":").reduce((s, x) => s * 60 + Number(x), 0) : 0;
}

/** Strength and racket sports have little moving time: their session lasts the elapsed time. */
export function sessionSeconds(a: Activity): number {
  const g = groupOf(a);
  const whole =
    (g === "strengthTraining" || g === "racket" || sportOf(a.type ?? "") !== undefined) &&
    typeof a.elapsed === "string";
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
