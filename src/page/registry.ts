import type { Chart, ChartConfiguration } from "chart.js";
import type * as calc from "./calc";
import type * as metrics from "./metrics";
import type * as running from "./running";
import type * as strength from "./strength";
import type * as sports from "./sports";
import type { Activity, Group } from "./calc";
import type { Fmt, T } from "./i18n";
import { CATALOGUE } from "./catalogue";
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
}

/** What a widget gets to draw itself. Built-in and custom widgets get the same. */
export interface Ctx {
  data: Data;
  /** The widget instance on its board. */
  id: string;
  /** The board (tab) the widget sits on, and the type it shows: "all" or a group. */
  board: string;
  type: "all" | Group;
  /** The window: Mondays of the first and the last week, and every Monday in between. */
  from: string;
  to: string;
  weeks: string[];
  /** The activities of the window and of the widget's type (and of the type chips on the All board). */
  activities: Activity[];
  /** The type filter of the widget (its type, or the type chips on the All board) for any list of activities. */
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
  /** Shows a short message in place of the widget's content. */
  empty: (el: HTMLElement, message?: string) => void;
  /** The item in the URL hash (e.g. a strength exercise), and a way to set it. */
  item?: string;
  setItem: (item: string | undefined) => void;
  /** Draws the whole page again, e.g. after a widget changed one of its own options. */
  refresh: () => void;
}

export interface WidgetDef {
  id: string;
  title: (t: T) => string;
  /** The types the widget can show; undefined for a widget that has no type. */
  types?: readonly ("all" | Group)[];
  span?: Span;
  render: (el: HTMLElement, ctx: Ctx) => void;
  /** Written by Claude and stored in the page, not built in. */
  custom?: boolean;
}

const widgets = new Map<string, WidgetDef>();

/** A built-in widget: its title, types and width come from the catalogue. */
export function register(def: Pick<WidgetDef, "id" | "render">): void {
  const meta = CATALOGUE.find((c) => c.id === def.id);
  if (!meta) throw new Error(`widget ${def.id} is not in the catalogue`);
  widgets.set(def.id, { ...def, title: (t) => t(meta.title), types: meta.types, span: meta.span });
}

/** A custom widget: Claude wrote it, the page block keeps it. A built-in id is never replaced. */
export function registerCustom(def: WidgetDef): void {
  if (widgets.get(def.id)?.custom === false || CATALOGUE.some((c) => c.id === def.id)) return;
  widgets.set(def.id, { ...def, custom: true });
}

export const widget = (id: string) => widgets.get(id);
export const allWidgets = () => [...widgets.values()];
