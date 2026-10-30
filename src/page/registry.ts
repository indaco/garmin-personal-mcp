import type { Chart, ChartConfiguration } from "chart.js";
import type * as calc from "./calc";
import type * as metrics from "./metrics";
import type * as running from "./running";
import type * as strength from "./strength";
import type * as sports from "./sports";
import type { Activity } from "./calc";
import type { Fmt, T, Units } from "./i18n";
import { CATALOGUE, inPage } from "./catalogue";
import type { Settings } from "./settings";
import type { Span } from "./layout";

/** The getDashboardData result embedded in the page, plus the coach notes. */
export interface Data {
  generated?: string;
  weeks: number;
  start: string;
  end: string;
  prevStart?: string;
  prevEnd?: string;
  zones?: unknown;
  fitnessAge?: Record<string, unknown>;
  activities: Activity[];
  previousActivities: Activity[];
  hrv: Record<string, unknown>[];
  recovery: Record<string, unknown>[];
  sync?: Record<string, unknown>;
  notes?: string[];
  /** The measurement system of the Garmin profile; the data stays metric. Metric when not set. */
  units?: Units;
  /** The language of the Garmin profile, e.g. it or pt-BR. */
  locale?: string;
  /** The version of the server that wrote the data, e.g. 0.2.0. */
  server?: string;
  /** When the server wrote the page, as an ISO time; older pages have only `generated`. */
  updated?: string;
}

/** What a widget gets to draw itself. Built-in and custom widgets get the same. */
export interface Ctx {
  data: Data;
  /** The widget instance on its board. */
  id: string;
  /** The board (tab) the widget sits on, and the type it shows: "all" or a group. */
  board: string;
  type: string;
  /** The window: Mondays of the first and the last week, and every Monday in between. */
  from: string;
  to: string;
  weeks: string[];
  /** The activities of the window and of the widget's type. */
  activities: Activity[];
  /** The type filter of the widget for any list of activities. */
  ofType: <A extends Activity>(acts: A[]) => A[];
  /** The activities of the window, every type: for numbers that always use all activities, like the load ratio. */
  allActivities: Activity[];
  lang: string;
  t: T;
  fmt: Fmt;
  calc: typeof calc & typeof metrics & typeof running & typeof strength & typeof sports;
  /** A Chart.js chart in `el` that follows the theme; `height` in px. */
  chart: (el: HTMLElement, config: ChartConfiguration, height?: number) => Chart;
  /** A colour token of the theme, e.g. "text", "good", or a group for its type colour. */
  color: (token: string) => string;
  /** A text of a custom widget in the page language, else in English, with its {placeholders} filled. */
  text: (key: string, params?: Record<string, string | number>) => string;
  /** Shows a short message in place of the widget's content. */
  empty: (el: HTMLElement, message?: string) => void;
  /** The item in the URL hash (e.g. a strength exercise), and a way to set it. */
  item?: string;
  setItem: (item: string | undefined) => void;
  /** Draws the whole page again, e.g. after a widget changed one of its own options. */
  refresh: () => void;
}

export type WidgetTexts = Record<string, Record<string, string>>;

export interface WidgetDef {
  id: string;
  title: (t: T) => string;
  /** The types the widget can show; undefined for a widget that has no type. */
  types?: readonly string[];
  span?: Span;
  /** The narrowest width that the widget fits in. */
  minSpan?: Span;
  render: (el: HTMLElement, ctx: Ctx) => void;
  /** Written by Claude and stored in the page, not built in. */
  custom?: boolean;
  /** The texts of a custom widget by language and key; `title` is its title. */
  texts?: WidgetTexts;
}

const widgets = new Map<string, WidgetDef>();

/** A built-in widget: its title, types and width come from the catalogue. */
export function register(def: Pick<WidgetDef, "id" | "render">): void {
  const meta = CATALOGUE.find((c) => c.id === def.id);
  if (!meta) throw new Error(`widget ${def.id} is not in the catalogue`);
  widgets.set(def.id, {
    ...def,
    title: (t) => t(meta.title),
    types: meta.types,
    span: meta.span,
    minSpan: meta.minSpan,
  });
}

/** A custom widget: Claude wrote it, the page block keeps it. A built-in id is never replaced. */
export function registerCustom(def: WidgetDef): void {
  if (widgets.get(def.id)?.custom === false || CATALOGUE.some((c) => c.id === def.id)) return;
  widgets.set(def.id, { ...def, custom: true });
}

/** The built-in widgets whose data the page leaves out: no board shows them, Add widget does not list them. */
export const withheld = new Set<string>();

export function withhold(settings: Settings): void {
  for (const c of CATALOGUE) {
    if (!inPage(c, settings)) {
      widgets.delete(c.id);
      withheld.add(c.id);
    }
  }
}

export const widget = (id: string) => widgets.get(id);
export const allWidgets = () => [...widgets.values()];
