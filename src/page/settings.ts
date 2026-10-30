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
}
