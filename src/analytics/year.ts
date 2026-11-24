import { addDays } from "../dates";
import {
  type Activity,
  dayOf,
  groupOf,
  isRunning,
  mondayOf,
  sessionSeconds,
  weeksOf,
} from "./calc";
import { loadOf, zonesOf } from "./metrics";
import { bestProgression } from "./running";

/** A range of days (yyyy-MM-dd), both included. */
export interface DayRange {
  readonly from: string;
  readonly to: string;
}

/** The cached rows of a year, after the page settings removed what they leave out. */
export interface YearInput {
  readonly activities: readonly Activity[];
  readonly hrv: readonly Readonly<Record<string, unknown>>[];
  readonly recovery: readonly Readonly<Record<string, unknown>>[];
  /** Garmin's zone list, for the max HR of a load estimate. */
  readonly zones?: unknown;
  /** The days that the cache holds, per source; they can reach past the year. */
  readonly coverage: {
    readonly activities: DayRange | null;
    readonly hrv?: DayRange | null;
    readonly rhr?: DayRange | null;
  };
}

/** A session that a part names. */
export interface SessionRef {
  readonly date: string;
  readonly id?: number;
  readonly name?: string;
}

export interface YearSport {
  readonly sport: string;
  readonly sessions: number;
  readonly km: number | null;
  readonly hours: number | null;
  readonly load: number | null;
}

export interface YearMonth {
  /** yyyy-MM */
  readonly month: string;
  readonly covered: "all" | "part" | "none";
  /** The days of the month that the cache holds. */
  readonly days: number;
  readonly activeDays: number | null;
  readonly sessions: number | null;
  readonly km: number | null;
  readonly hours: number | null;
  readonly load: number | null;
}

interface Volume {
  readonly km: number | null;
  readonly hours: number | null;
  readonly load: number | null;
}

interface Streak extends DayRange {
  readonly length: number;
}

export interface TimeOfDay {
  readonly night: number;
  readonly morning: number;
  readonly afternoon: number;
  readonly evening: number;
}

/** The recap of a calendar year. A value that the cache does not hold is null, never 0. */
export interface YearSummary {
  /** The version of this shape. */
  readonly v: 1;
  readonly year: number;
  readonly from: string;
  readonly to: string;
  readonly coverage: {
    readonly activities: DayRange | null;
    readonly missing: readonly DayRange[];
    readonly complete: boolean;
    readonly hrv?: DayRange | null;
    readonly rhr?: DayRange | null;
  };
  /** What the biggest month and week and the best block compare. */
  readonly measure: "load" | "hours";
  readonly totals: {
    readonly activities: number | null;
    readonly activeDays: number | null;
    readonly km: number | null;
    readonly hours: number | null;
    readonly ascentM: number | null;
    readonly calories: number | null;
    readonly load: number | null;
    readonly estimatedLoads: number | null;
    /** The sessions whose time is not likely: it counts for nothing, also in a load estimate. */
    readonly unlikelyTimes: number | null;
  };
  readonly sports: readonly YearSport[];
  readonly topSport: string | null;
  readonly months: readonly YearMonth[];
  readonly biggestMonth: ({ readonly month: string } & Volume) | null;
  readonly biggestWeek: ({ readonly monday: string } & Volume) | null;
  readonly bestBlock: (DayRange & { readonly value: number; readonly sessions: number }) | null;
  readonly mostConsistentMonth: {
    readonly month: string;
    readonly activeDays: number;
    readonly days: number;
    readonly sharePct: number;
  } | null;
  readonly streaks: { readonly days: Streak | null; readonly weeks: Streak | null };
  readonly longest:
    | (SessionRef & { readonly sport: string; readonly hours: number; readonly km: number | null })
    | null;
  readonly biggest:
    | (SessionRef & { readonly sport: string; readonly load: number; readonly estimate: boolean })
    | null;
  readonly records: Readonly<
    Record<
      string,
      readonly (SessionRef & { readonly time: string; readonly previous: string | null })[]
    >
  >;
  readonly rhythm: {
    /** The sessions of each weekday, Monday first. */
    readonly weekdays: readonly number[];
    readonly topWeekday: number | null;
    readonly timeOfDay: TimeOfDay;
    readonly topTimeOfDay: keyof TimeOfDay | null;
  };
  readonly hrv?: readonly {
    readonly month: string;
    readonly mean: number | null;
    readonly nights: number;
  }[];
  readonly rhr?: readonly {
    readonly month: string;
    readonly mean: number | null;
    readonly days: number;
  }[];
}

/** The whole weeks of the best block. */
const BLOCK_WEEKS = 4;

/** The covered days that a month needs for the most consistent month. */
const CONSISTENT_DAYS = 14;

/** The days with a value that a month needs for its mean HRV or resting HR. */
const MEAN_DAYS = 7;

/** A session needs more seconds than this for its time to be unlikely. */
const LONG_SECONDS = 12 * 3600;

/** The parts of the day; at a tie the first one is the top. */
const DAY_PARTS = ["morning", "afternoon", "evening", "night"] as const;

/** A session of a covered day, with its values checked once. */
interface Session {
  readonly a: Activity;
  readonly day: string;
  readonly sport: string;
  readonly km: number | undefined;
  readonly hours: number | undefined;
  readonly ascentM: number | undefined;
  readonly calories: number | undefined;
  readonly load: number | undefined;
  readonly estimate: boolean;
  /** Its time is not likely, so it has no hours and no load estimate. */
  readonly unlikely: boolean;
}

function round(v: number, decimals = 0): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

const rounded = (v: number | null, decimals = 0) => (v === null ? null : round(v, decimals));

/** A finite number of 0 or more; anything else is a missing value. */
const amount = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;

/** As `amount`, without 0. */
const positive = (v: unknown): number | undefined => amount(v) || undefined;

const within = (day: string, range: DayRange): boolean => day >= range.from && day <= range.to;

function daysOf(range: DayRange): string[] {
  const days: string[] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) days.push(d);
  return days;
}

/** The days that both ranges hold; `from` is after `to` when there are none. */
const overlap = (range: DayRange, span: DayRange): DayRange => ({
  from: range.from > span.from ? range.from : span.from,
  to: range.to < span.to ? range.to : span.to,
});

/** The days that both ranges hold; null when there are none. */
function clip(range: DayRange | null | undefined, span: DayRange): DayRange | null {
  if (!range) return null;
  const days = overlap(range, span);
  return days.from <= days.to ? days : null;
}

/** The days of the span before and after the covered range. */
function missingOf(span: DayRange, covered: DayRange | null): DayRange[] {
  if (!covered) return [span];
  return [
    { from: span.from, to: addDays(covered.from, -1) },
    { from: addDays(covered.to, 1), to: span.to },
  ].filter((r) => r.from <= r.to);
}

/**
 * A long time at under 1 km/h: minutes typed as hours, or a strength or racket session left on.
 * A moving time with a Garmin load is measured, so a slow climb or an ultra stays.
 */
function isUnlikely(a: Activity, seconds = 0, km = 0): boolean {
  const moving = seconds === sessionSeconds({ ...a, elapsed: undefined });
  const measured = moving && positive(a.trainingLoad) !== undefined;
  return seconds > LONG_SECONDS && km < seconds / 3600 && !measured;
}

/** The sessions of the covered days, oldest first. A start that is not such a day is left out. */
function sessionsOf(input: YearInput, covered: DayRange | null): Session[] {
  const days = new Set(covered ? daysOf(covered) : []);
  const maxHR = positive(zonesOf(input.zones).maxHR);
  return input.activities
    .flatMap((a) => {
      const day = dayOf(a);
      if (day === undefined || !days.has(day)) return [];
      const seconds = positive(sessionSeconds(a));
      const km = amount(a.km);
      const unlikely = isUnlikely(a, seconds, km);
      const avgHR = unlikely ? undefined : positive(a.avgHR);
      const load = loadOf({ ...a, trainingLoad: amount(a.trainingLoad), avgHR }, maxHR);
      return {
        a,
        day,
        sport: groupOf(a),
        km,
        hours: seconds === undefined || unlikely ? undefined : seconds / 3600,
        ascentM: amount(a.ascentM),
        calories: amount(a.calories),
        load: amount(load?.value),
        estimate: load?.estimate === true,
        unlikely,
      };
    })
    .toSorted((x, y) => order(String(x.a.start), String(y.a.start)));
}

const order = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

/** The sum of the known values: null when there are sessions and none has it. */
function known(
  sessions: readonly Session[],
  value: (s: Session) => number | undefined,
): number | null {
  const values = sessions.map(value).filter((v) => v !== undefined);
  return sessions.length > 0 && values.length === 0 ? null : values.reduce((s, v) => s + v, 0);
}

const kmOf = (sessions: readonly Session[]) => known(sessions, (s) => s.km);
const hoursOf = (sessions: readonly Session[]) => known(sessions, (s) => s.hours);
const loadsOf = (sessions: readonly Session[]) => known(sessions, (s) => s.load);

const volume = (sessions: readonly Session[]): Volume => ({
  km: rounded(kmOf(sessions), 1),
  hours: rounded(hoursOf(sessions), 1),
  load: rounded(loadsOf(sessions)),
});

const activeDaysOf = (sessions: readonly Session[]) => new Set(sessions.map((s) => s.day)).size;

function groupBy(
  sessions: readonly Session[],
  key: (s: Session) => string,
): Map<string, Session[]> {
  const out = new Map<string, Session[]>();
  for (const s of sessions) {
    const list = out.get(key(s));
    if (list) list.push(s);
    else out.set(key(s), [s]);
  }
  return out;
}

function totalsOf(sessions: readonly Session[], covered: DayRange | null): YearSummary["totals"] {
  if (!covered) {
    return {
      activities: null,
      activeDays: null,
      km: null,
      hours: null,
      ascentM: null,
      calories: null,
      load: null,
      estimatedLoads: null,
      unlikelyTimes: null,
    };
  }
  return {
    activities: sessions.length,
    activeDays: activeDaysOf(sessions),
    ...volume(sessions),
    ascentM: rounded(known(sessions, (s) => s.ascentM)),
    calories: rounded(known(sessions, (s) => s.calories)),
    estimatedLoads: sessions.filter((s) => s.load !== undefined && s.estimate).length,
    unlikelyTimes: sessions.filter((s) => s.unlikely).length,
  };
}

/** Most hours first, then more sessions, then the name. */
function sportsOf(sessions: readonly Session[]): YearSport[] {
  return [...groupBy(sessions, (s) => s.sport)]
    .map(([sport, list]) => ({ sport, list, hours: hoursOf(list) ?? 0 }))
    .toSorted(
      (x, y) => y.hours - x.hours || y.list.length - x.list.length || order(x.sport, y.sport),
    )
    .map(({ sport, list }) => ({ sport, sessions: list.length, ...volume(list) }));
}

/** The months that the span reaches, with their days inside it. */
function monthsIn(span: DayRange): DayRange[] {
  const months = new Map<string, DayRange>();
  for (const day of daysOf(span)) {
    const month = day.slice(0, 7);
    months.set(month, { from: months.get(month)?.from ?? day, to: day });
  }
  return [...months.values()];
}

function monthOf(
  range: DayRange,
  sessions: readonly Session[],
  covered: DayRange | null,
): YearMonth {
  const month = range.from.slice(0, 7);
  const held = clip(covered, range);
  if (!held) {
    return {
      month,
      covered: "none",
      days: 0,
      activeDays: null,
      sessions: null,
      km: null,
      hours: null,
      load: null,
    };
  }
  const list = sessions.filter((s) => within(s.day, held));
  return {
    month,
    covered: held.from === range.from && held.to === range.to ? "all" : "part",
    days: daysOf(held).length,
    activeDays: activeDaysOf(list),
    sessions: list.length,
    ...volume(list),
  };
}

/** The first of the items with the highest value; null when no value is above 0. */
function firstMax<T>(
  items: readonly T[],
  value: (item: T) => number | undefined,
): { item: T; value: number } | null {
  let top: { item: T; value: number } | null = null;
  for (const item of items) {
    const v = value(item) ?? 0;
    if (v > (top?.value ?? 0)) top = { item, value: v };
  }
  return top;
}

/** The sessions of a range of days. */
interface Part extends DayRange {
  readonly sessions: readonly Session[];
}

const partOf = (range: DayRange, sessions: readonly Session[]): Part => ({
  ...range,
  sessions: sessions.filter((s) => within(s.day, range)),
});

/** The Monday-Sunday weeks that the range holds whole. */
const wholeWeeks = (range: DayRange): DayRange[] =>
  weeksOf(range.from, range.to)
    .map((monday) => ({ from: monday, to: addDays(monday, 6) }))
    .filter((w) => w.from >= range.from && w.to <= range.to);

/** The 4 whole weeks in a row with the highest measure. */
function bestBlockOf(
  weeks: readonly DayRange[],
  sessions: readonly Session[],
  measure: (sessions: readonly Session[]) => number,
  decimals: number,
): YearSummary["bestBlock"] {
  const blocks = weeks
    .slice(0, -(BLOCK_WEEKS - 1))
    .map((w) => partOf({ from: w.from, to: addDays(w.from, BLOCK_WEEKS * 7 - 1) }, sessions));
  const best = firstMax(blocks, (b) => measure(b.sessions));
  return (
    best && {
      from: best.item.from,
      to: best.item.to,
      value: round(best.value, decimals),
      sessions: best.item.sessions.length,
    }
  );
}

/** The highest share of active covered days, then more active days, then the earlier month. */
function mostConsistent(months: readonly YearMonth[]): YearSummary["mostConsistentMonth"] {
  const rows = months
    .flatMap(({ month, days, activeDays }) =>
      days >= CONSISTENT_DAYS && activeDays ? [{ month, days, activeDays }] : [],
    )
    .toSorted(
      (x, y) => y.activeDays / y.days - x.activeDays / x.days || y.activeDays - x.activeDays,
    );
  if (rows.length === 0) return null;
  const { month, activeDays, days } = rows[0];
  return { month, activeDays, days, sharePct: round((100 * activeDays) / days) };
}

/** The longest run of ranges that each have a session; the earlier one of two that are as long. */
function streakOf(ranges: readonly DayRange[], sessions: readonly Session[]): Streak | null {
  let best: Streak | null = null;
  let first = "";
  let length = 0;
  for (const r of ranges) {
    if (!sessions.some((s) => within(s.day, r))) {
      length = 0;
      continue;
    }
    if (length === 0) first = r.from;
    length += 1;
    if (length > (best?.length ?? 0)) best = { from: first, to: r.to, length };
  }
  return best;
}

function streaksOf(sessions: readonly Session[], covered: DayRange | null): YearSummary["streaks"] {
  if (!covered) return { days: null, weeks: null };
  const days = daysOf(covered).map((d) => ({ from: d, to: d }));
  const weeks = weeksOf(covered.from, covered.to).map((monday) =>
    overlap({ from: monday, to: addDays(monday, 6) }, covered),
  );
  return { days: streakOf(days, sessions), weeks: streakOf(weeks, sessions) };
}

const refOf = (a: Activity): SessionRef => ({
  date: String(a.start).slice(0, 10),
  ...(typeof a.id === "number" ? { id: a.id } : {}),
  ...(typeof a.name === "string" ? { name: a.name } : {}),
});

function longestOf(sessions: readonly Session[]): YearSummary["longest"] {
  const top = firstMax(sessions, (s) => s.hours);
  return (
    top && {
      ...refOf(top.item.a),
      sport: top.item.sport,
      hours: round(top.value, 1),
      km: rounded(top.item.km ?? null, 1),
    }
  );
}

function biggestOf(sessions: readonly Session[]): YearSummary["biggest"] {
  const top = firstMax(sessions, (s) => s.load);
  return (
    top && {
      ...refOf(top.item.a),
      sport: top.item.sport,
      load: round(top.value),
      estimate: top.item.estimate,
    }
  );
}

/** The runs that set a new best of the year, per distance, each with the time that it beat. */
function recordsOf(sessions: readonly Session[]): YearSummary["records"] {
  const runs = sessions.map((s) => s.a).filter(isRunning);
  return Object.fromEntries(
    Object.entries(bestProgression(runs))
      .map(([distance, list]) => [distance, list.filter((b) => Number.isFinite(b.s))] as const)
      .filter(([, list]) => list.length > 0)
      .map(([distance, list]) => [
        distance,
        list.map((b, i) => ({
          ...refOf(b.a),
          time: b.time,
          previous: i > 0 ? list[i - 1].time : null,
        })),
      ]),
  );
}

/** The part of the day of the local start; undefined when the start has no time. */
function dayPartOf(a: Activity): keyof TimeOfDay | undefined {
  const hour = Number(/[T ](\d{2}):/.exec(String(a.start))?.[1]);
  if (!(hour < 24)) return undefined;
  if (hour < 5 || hour >= 22) return "night";
  if (hour < 12) return "morning";
  return hour < 18 ? "afternoon" : "evening";
}

function rhythmOf(sessions: readonly Session[]): YearSummary["rhythm"] {
  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  const timeOfDay = { night: 0, morning: 0, afternoon: 0, evening: 0 };
  for (const { a, day } of sessions) {
    const monday = mondayOf(day);
    weekdays[weekdays.findIndex((_, i) => addDays(monday, i) === day)] += 1;
    const part = dayPartOf(a);
    if (part) timeOfDay[part] += 1;
  }
  return {
    weekdays,
    topWeekday: firstMax([...weekdays.keys()], (i) => weekdays[i])?.item ?? null,
    timeOfDay,
    topTimeOfDay: firstMax(DAY_PARTS, (part) => timeOfDay[part])?.item ?? null,
  };
}

/** The values of a field above 0 in each month of the span, the months without one left out. */
function monthValues(
  rows: readonly Readonly<Record<string, unknown>>[],
  field: string,
  span: DayRange,
): { month: string; mean: number | null; count: number }[] {
  const days = new Set(daysOf(span));
  const values = new Map<string, number[]>();
  for (const row of rows) {
    const v = positive(row[field]);
    if (v === undefined || typeof row.date !== "string" || !days.has(row.date)) continue;
    const month = row.date.slice(0, 7);
    values.set(month, [...(values.get(month) ?? []), v]);
  }
  return [...values]
    .toSorted(([x], [y]) => order(x, y))
    .map(([month, list]) => ({
      month,
      mean:
        list.length < MEAN_DAYS ? null : round(list.reduce((s, v) => s + v, 0) / list.length, 1),
      count: list.length,
    }));
}

/** The recap of `year` from the cached rows; `today` (yyyy-MM-dd) ends the current year. */
export function yearSummary(input: YearInput, year: number, today: string): YearSummary {
  const span: DayRange = {
    from: `${year}-01-01`,
    to: today.startsWith(`${year}-`) ? today : `${year}-12-31`,
  };
  const covered = clip(input.coverage.activities, span);
  const missing = missingOf(span, covered);
  const sessions = sessionsOf(input, covered);
  const sports = sportsOf(sessions);
  const monthSpans = monthsIn(span);
  const months = monthSpans.map((m) => monthOf(m, sessions, covered));
  const measure = sessions.some((s) => s.load !== undefined) ? "load" : "hours";
  const measured = (list: readonly Session[]) =>
    (measure === "load" ? loadsOf(list) : hoursOf(list)) ?? 0;
  const hrv = monthValues(input.hrv, "hrv", span);
  const rhr = monthValues(input.recovery, "rhr", span);
  const weeks = covered ? wholeWeeks(covered) : [];
  const topMonth = firstMax(
    monthSpans.map((m) => partOf(m, sessions)),
    (p) => measured(p.sessions),
  );
  const topWeek = firstMax(
    weeks.map((w) => partOf(w, sessions)),
    (p) => measured(p.sessions),
  );
  return {
    v: 1,
    year,
    ...span,
    coverage: {
      activities: covered,
      missing,
      complete: missing.length === 0,
      ...(hrv.length > 0 ? { hrv: clip(input.coverage.hrv, span) } : {}),
      ...(rhr.length > 0 ? { rhr: clip(input.coverage.rhr, span) } : {}),
    },
    measure,
    totals: totalsOf(sessions, covered),
    sports,
    topSport: sports[0]?.sport ?? null,
    months,
    biggestMonth: topMonth && {
      month: topMonth.item.from.slice(0, 7),
      ...volume(topMonth.item.sessions),
    },
    biggestWeek: topWeek && { monday: topWeek.item.from, ...volume(topWeek.item.sessions) },
    bestBlock: bestBlockOf(weeks, sessions, measured, measure === "load" ? 0 : 1),
    mostConsistentMonth: mostConsistent(months),
    streaks: streaksOf(sessions, covered),
    longest: longestOf(sessions),
    biggest: biggestOf(sessions),
    records: recordsOf(sessions),
    rhythm: rhythmOf(sessions),
    ...(hrv.length > 0
      ? { hrv: hrv.map(({ month, mean, count }) => ({ month, mean, nights: count })) }
      : {}),
    ...(rhr.length > 0
      ? { rhr: rhr.map(({ month, mean, count }) => ({ month, mean, days: count })) }
      : {}),
  };
}
