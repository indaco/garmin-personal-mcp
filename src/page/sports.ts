import { type Activity, groupOf, seconds, sessionSeconds } from "./calc";

/** Numbers of the walk, hike, bike, swim and racket sport widgets. Pure functions. */

/** Seconds per 100 m. */
export function swimPace(a: Activity): number | undefined {
  const t = seconds(a.duration);
  return typeof a.km === "number" && a.km > 0 && t > 0 ? t / (a.km * 10) : undefined;
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
