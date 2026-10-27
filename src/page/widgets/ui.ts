import { addDays } from "../../dates";
import { type Activity, type Group, groupOf, mondayOf, sessionSeconds } from "../calc";
import { h } from "../dom";
import type { Key } from "../i18n";
import { icon } from "../icons";
import type { Ctx } from "../registry";

/** Small building blocks that the built-in widgets share. */

export const groupKey = (g: string) => `type.${g}` as Key;

/** A KPI tile: label, big value, and an optional line under it. */
export function kpi(
  label: string,
  value: string,
  ...sub: (Node | string | false | undefined)[]
): HTMLElement {
  return h(
    "div",
    { class: "kpi" },
    h("div", { class: "kpi-label" }, label),
    h("div", { class: "kpi-value" }, value),
    ...sub.map((s) => s && h("div", { class: "kpi-sub" }, s)),
  );
}

export const kpiRow = (...tiles: HTMLElement[]) => h("div", { class: "kpis" }, ...tiles);

/** A change in %, coloured: better is green, worse is red, no change is grey. */
export function delta(ctx: Ctx, pct: number | null, higherIsBetter = true): HTMLElement {
  // no base to compare with (e.g. no sessions before) is not missing data: show nothing
  return h(
    "span",
    { class: ctx.calc.changeClass(pct, higherIsBetter) },
    pct === null ? "" : ctx.fmt.pct(pct),
  );
}

/** A table; numeric columns align right. */
export function table(
  head: string[],
  rows: (Node | string)[][],
  numeric: number[] = [],
): HTMLElement {
  const cls = (i: number) => (numeric.includes(i) ? "num" : undefined);
  return h(
    "table",
    { class: "data" },
    h("thead", {}, h("tr", {}, ...head.map((x, i) => h("th", { class: cls(i), scope: "col" }, x)))),
    h(
      "tbody",
      {},
      ...rows.map((r) => h("tr", {}, ...r.map((c, i) => h("td", { class: cls(i) }, c)))),
    ),
  );
}

/** The type of an activity with its icon (decorative) and label. */
export function typeCell(ctx: Ctx, a: Activity): HTMLElement {
  const g = groupOf(a.type ?? "");
  return h("span", { class: `type type-${g}` }, icon(g), ctx.t(groupKey(g)));
}

/** A week label; the last week is marked with * while it is in progress. */
export function weekLabel(ctx: Ctx, monday: string): string {
  const open =
    monday === mondayOf(ctx.data.end) && new Date(`${ctx.data.end}T00:00:00Z`).getUTCDay() !== 0;
  return `${ctx.fmt.day(monday)}${open ? "*" : ""}`;
}

/** The last day of the window: Sunday of its last week, or the end of the data. */
export function windowEnd(ctx: Ctx): string {
  const sunday = addDays(ctx.to, 6);
  return sunday < ctx.data.end ? sunday : ctx.data.end;
}

/** Every activity the page has: this period and the one before (compact, for comparisons). */
export function everyActivity(ctx: Ctx): Activity[] {
  return [...ctx.data.activities, ...ctx.data.previousActivities];
}

/** Activities of a type ("all" for every type) between two days. */
export function between(
  acts: Activity[],
  from: string,
  to: string,
  type: "all" | Group = "all",
): Activity[] {
  return acts.filter((a) => {
    const d = typeof a.start === "string" ? a.start.slice(0, 10) : "";
    return d >= from && d <= to && (type === "all" || groupOf(a.type ?? "") === type);
  });
}

export interface Totals {
  sessions: number;
  km: number;
  seconds: number;
  load: number;
}

/** The max HR of the default zones, for estimated loads. */
export const maxHR = (ctx: Ctx) => ctx.calc.zonesOf(ctx.data.zones).maxHR;

export function totals(ctx: Ctx, acts: Activity[]): Totals {
  const max = maxHR(ctx);
  return acts.reduce<Totals>(
    (t, a) => ({
      sessions: t.sessions + 1,
      km: t.km + (typeof a.km === "number" ? a.km : 0),
      seconds: t.seconds + sessionSeconds(a),
      load: t.load + (ctx.calc.loadOf(a, max)?.value ?? 0),
    }),
    { sessions: 0, km: 0, seconds: 0, load: 0 },
  );
}

/** A colour with alpha, from a theme token in #rrggbb. */
export function alpha(color: string, a: number): string {
  return /^#[0-9a-f]{6}$/i.test(color)
    ? `${color}${Math.round(a * 255)
        .toString(16)
        .padStart(2, "0")}`
    : color;
}

/** Buttons that pick one option of a widget; the choice stays while the page is open. */
const choices = new Map<string, string>();
export function picker(
  ctx: Ctx,
  name: string,
  options: [value: string, label: string][],
): [string, HTMLElement] {
  const key = `${ctx.board}/${ctx.id}/${name}`;
  const value = choices.get(key) ?? options[0][0];
  const bar = h(
    "div",
    { class: "picker", role: "group" },
    ...options.map(([v, label]) =>
      h(
        "button",
        {
          class: "chip small",
          "aria-pressed": String(v === value),
          onclick: () => {
            choices.set(key, v);
            ctx.refresh();
          },
        },
        label,
      ),
    ),
  );
  return [value, bar];
}

export const note = (text: string) => h("p", { class: "muted small note" }, text);
