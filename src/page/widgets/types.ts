import { addDays } from "../../dates";
import { append, h } from "../dom";
import { register } from "../registry";
import type { Ctx } from "../registry";
import { renderVolume } from "./volume";
import {
  between,
  delta,
  everyActivity,
  kpi,
  kpiRow,
  note,
  totals,
  weekLabel,
  windowEnd,
} from "./ui";

/** The widgets that every type board has: KPIs, the weekly chart and the time in HR zones. */

export const DISTANCE = new Set(["running", "walking", "hiking", "cycling", "swimming"]);

/** Trends need two sessions: with one, the widget says so instead of drawing a chart. */
export function oneSession(el: HTMLElement, ctx: Ctx): boolean {
  if (ctx.activities.length === 0) {
    ctx.empty(el);
    return true;
  }
  if (ctx.activities.length === 1) {
    ctx.empty(el, ctx.t("one.session"));
    return true;
  }
  return false;
}

register({
  id: "typeKpis",
  render(el, ctx) {
    const { t, fmt, calc } = ctx;
    const acts = ctx.activities;
    if (acts.length === 0) {
      ctx.empty(el);
      return;
    }
    const sum = totals(ctx, acts);
    const all = totals(ctx, ctx.allActivities);
    const hr = acts.map((a) => a.avgHR).filter((v): v is number => typeof v === "number");
    const peak = Math.max(...acts.map((a) => (typeof a.maxHR === "number" ? a.maxHR : 0)));
    const end = windowEnd(ctx);
    const every = ctx.ofType(everyActivity(ctx));
    const week = totals(ctx, between(every, addDays(end, -6), end));
    const base = totals(ctx, between(every, addDays(end, -34), addDays(end, -7)));
    const vs = (now: number, before: number) =>
      h("span", {}, delta(ctx, calc.change(now, before / 4)), " ", t("kpi.vs4w"));
    const hasDistance = ctx.type !== "all" && DISTANCE.has(ctx.type);
    const ascent = acts.reduce((s, a) => s + (typeof a.ascentM === "number" ? a.ascentM : 0), 0);
    const tiles = [
      kpi(t("tk.sessions"), fmt.num(sum.sessions), vs(week.sessions, base.sessions)),
      kpi(
        t("tk.time"),
        fmt.hours(sum.seconds),
        t("tk.avg", { v: fmt.hours(sum.seconds / sum.sessions) }),
      ),
      hasDistance && kpi(t("tk.distance"), `${fmt.num(sum.km, 1)} km`, vs(week.km, base.km)),
      hasDistance &&
        sum.km > 0 &&
        (ctx.type === "cycling"
          ? kpi(t("tk.speed"), `${fmt.num(sum.km / (sum.seconds / 3600), 1)} km/h`)
          : kpi(t("tk.pace"), `${fmt.hms(sum.seconds / sum.km)}/km`)),
      ctx.type === "cycling" && kpi(t("tk.ascent"), `${fmt.num(ascent)} m`),
      kpi(
        t("tk.hr"),
        `${fmt.num(calc.mean(hr) ?? undefined)} bpm`,
        peak > 0 && t("tk.peak", { v: fmt.num(peak) }),
      ),
      kpi(
        t("tk.load"),
        fmt.num(sum.load),
        all.load > 0 && t("tk.share", { v: fmt.num((sum.load / all.load) * 100) }),
      ),
    ].filter((x): x is HTMLElement => x instanceof HTMLElement);
    append(el, kpiRow(...tiles), acts.length === 1 && note(t("one.session")));
  },
});

register({
  id: "typeWeekly",
  render(el, ctx) {
    if (oneSession(el, ctx)) return;
    const metrics = ["time", "sessions"];
    if (ctx.type === "all" || DISTANCE.has(ctx.type)) metrics.splice(1, 0, "distance");
    renderVolume(el, ctx, metrics);
  },
});

register({
  id: "hrZones",
  render(el, ctx) {
    const { t, calc, fmt } = ctx;
    if (oneSession(el, ctx)) return;
    const floors = calc.zonesOf(ctx.data.zones).floors;
    const weeks = ctx.weeks.map(() => [0, 0, 0, 0, 0]);
    let approximate = false;
    for (const a of ctx.activities) {
      const z = calc.zoneSeconds(a, floors);
      const d = String(a.start).slice(0, 10);
      const i = ctx.weeks.findIndex((w) => d >= w && d <= addDays(w, 6));
      if (!z || i < 0) continue;
      approximate ||= z.approximate;
      z.sec.forEach((s, n) => (weeks[i][n] += s / 60));
    }
    const colors = ["muted", "cycling", "walking", "racket", "bad"];
    ctx.chart(el, {
      type: "bar",
      data: {
        labels: ctx.weeks.map((w) => weekLabel(ctx, w)),
        datasets: [0, 1, 2, 3, 4].map((n) => ({
          label: `Z${n + 1}${floors[n] ? ` (${floors[n]}+)` : ""}`,
          data: weeks.map((w) => w[n]),
          backgroundColor: ctx.color(colors[n]),
        })),
      },
      options: {
        scales: {
          x: { stacked: true },
          y: { stacked: true, title: { display: true, text: "min" } },
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: (c) => `${c.dataset.label}: ${fmt.num(c.parsed.y ?? undefined)} min`,
            },
          },
        },
      },
    });
    append(el, approximate && note(t("zones.approximate")));
  },
});
