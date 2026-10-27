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
 * 3 s/km at 5:00/km); a faster second half is a negative split.
 */
export function splitOf(
  laps: { km?: unknown; time?: unknown }[],
): { first: number; second: number; kind: SplitKind } | undefined {
  const parts = laps
    .map((l) => ({ km: typeof l.km === "number" ? l.km : 0, sec: seconds(l.time) }))
    .filter((l) => l.km > 0 && l.sec > 0);
  if (parts.length < 2) return undefined;
  const half = parts.reduce((s, l) => s + l.km, 0) / 2;
  const sum = { first: { km: 0, sec: 0 }, second: { km: 0, sec: 0 } };
  let done = 0;
  for (const l of parts) {
    // a lap across the middle counts for its share on each side
    const before = Math.max(0, Math.min(l.km, half - done));
    const ratio = before / l.km;
    sum.first.km += before;
    sum.first.sec += l.sec * ratio;
    sum.second.km += l.km - before;
    sum.second.sec += l.sec * (1 - ratio);
    done += l.km;
  }
  const first = sum.first.sec / sum.first.km;
  const second = sum.second.sec / sum.second.km;
  const diff = (second - first) / first;
  return {
    first,
    second,
    kind: Math.abs(diff) <= 0.01 ? "even" : diff < 0 ? "negative" : "positive",
  };
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
