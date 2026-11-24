/** The data that a page can leave out, e.g. a page for a coach without the recovery data. */
export const DATA_ITEMS = ["recovery", "fitnessAge", "zones", "names", "notes"] as const;
export type DataItem = (typeof DATA_ITEMS)[number];

/** The settings of a page, in its settings block. Without them, the page shows everything. */
export interface Settings {
  /** Replaces the title in every language. */
  title?: string;
  /** A line under the title. */
  headline?: string;
  /** The boards to keep; all when not set. */
  sports?: string[];
  /** The data that the server leaves out of the page. */
  exclude?: DataItem[];
  /** The built-in languages of the page, e.g. ["en", "it"]; English and the profile's language when not set. English stays as the fallback text. */
  languages?: string[];
  /** The language before the reader picks one; "auto" when not set. */
  language?: string;
  /** The themes in the page; all when not set. */
  themes?: string[];
  /** The theme before the reader picks one. */
  theme?: string;
  /** Compare the same run workout across weeks: the server loads the laps of its last sessions. Off when not set. */
  workouts?: boolean;
  /** Keep the recovery rows of the whole period, not only the last 14 days. Off when not set. */
  recoveryHistory?: boolean;
  /** Add the recap of the calendar year to the page data, from the cache. Off when not set. */
  yearReview?: boolean;
  /** yyyy-MM-dd: the page starts in the week of this day and grows each week, up to 52 weeks; replaces `weeks`. */
  since?: string;
  /** A page for another person, e.g. a coach: the server makes a new file of it that other users can read (644). */
  shared?: boolean;
}

const isItem = (v: unknown): v is DataItem => DATA_ITEMS.some((x) => x === v);
const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const flag = (v: unknown) => (typeof v === "boolean" ? v : undefined);
const strings = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? v : undefined;
// an empty list would leave a page with nothing
const names = (v: unknown) => (strings(v)?.length ? strings(v) : undefined);

/**
 * The settings of a settings block. The user can edit the page, so a block can hold anything: a value
 * of another type counts as not set. Code reads the settings of a page only through this function. A
 * new setting does not compile without its line here.
 */
export function readSettings(block: unknown): Settings {
  const v = new Map<string, unknown>(Object.entries(block ?? {}));
  const exclude = v.get("exclude");
  const read: { [K in keyof Required<Settings>]: Settings[K] } = {
    title: text(v.get("title")),
    headline: text(v.get("headline")),
    // an empty list keeps no board: not set would show them all
    sports: strings(v.get("sports")),
    // what it knows stays left out, also next to a name that it does not know
    exclude: Array.isArray(exclude) ? exclude.filter(isItem) : undefined,
    languages: names(v.get("languages")),
    language: text(v.get("language")),
    themes: names(v.get("themes")),
    theme: text(v.get("theme")),
    workouts: flag(v.get("workouts")),
    recoveryHistory: flag(v.get("recoveryHistory")),
    yearReview: flag(v.get("yearReview")),
    since: text(v.get("since")),
    shared: flag(v.get("shared")),
  };
  // a setting that is not set has no key: each key is saved, and counts as one
  for (const [key, value] of Object.entries(read)) {
    if (value === undefined) Reflect.deleteProperty(read, key);
  }
  return read;
}
