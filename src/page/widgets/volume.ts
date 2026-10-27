import { addDays } from "../../dates";
import { type Activity, dayOf, GROUPS, groupOf, sessionSeconds } from "../calc";
import { append, h } from "../dom";
import { register } from "../registry";
import type { Ctx } from "../registry";
import { alpha, typeName, kpi, kpiRow, maxHR, note, picker, weekLabel, windowEnd } from "./ui";

/** The heat of a calendar day by its training minutes. */
const level = (m: number) => (m === 0 ? 0 : m < 30 ? 1 : m < 60 ? 2 : m < 90 ? 3 : 4);

/** The groups that have activities in the list, in tab order. */
const groupsIn = (acts: Activity[]) => GROUPS.filter((g) => acts.some((a) => groupOf(a) === g));

/** Bars stacked per type, one bar per week. */
function stackedWeeks(ctx: Ctx, value: (a: Activity) => number) {
  return groupsIn(ctx.activities).map((g) => ({
    type: "bar" as const,
    label: typeName(ctx.t, g),
    data: ctx.calc.weekly(
      ctx.activities.filter((a) => groupOf(a) === g),
      ctx.weeks,
      value,
    ),
    backgroundColor: ctx.color(g),
    stack: "types",
  }));
}

/** Weekly bars by type, with a picker for the metric and a 4-week average line. */
export function renderVolume(el: HTMLElement, ctx: Ctx, only?: string[]): void {
  const { t, fmt, calc } = ctx;
  const max = maxHR(ctx);
  const metrics: Record<string, [label: string, unit: string, value: (a: Activity) => number]> = {
    time: [t("m.time"), "h", (a) => sessionSeconds(a) / 3600],
    distance: [t("m.distance"), "km", (a) => (typeof a.km === "number" ? a.km : 0)],
    sessions: [t("m.sessions"), "", () => 1],
    load: [t("m.load"), "", (a) => calc.loadOf(a, max)?.value ?? 0],
  };
  const [metric, bar] = picker(
    ctx,
    "metric",
    Object.entries(metrics)
      .filter(([k]) => !only || only.includes(k))
      .map(([k, [label]]) => [k, label]),
  );
  const [, unit, value] = metrics[metric];
  const total = calc.weekly(ctx.activities, ctx.weeks, value);
  append(el, bar);
  if (ctx.activities.length === 0) {
    ctx.empty(el);
    return;
  }
  ctx.chart(el, {
    type: "bar",
    data: {
      labels: ctx.weeks.map((w) => weekLabel(ctx, w)),
      datasets: [
        ...stackedWeeks(ctx, value),
        {
          type: "line",
          label: t("vol.avg"),
          data: calc.rolling(total, 4),
          borderColor: ctx.color("text"),
          borderDash: [4, 3],
          pointRadius: 2,
        },
      ],
    },
    options: {
      scales: {
        x: { stacked: true },
        y: { stacked: true, title: { display: !!unit, text: unit } },
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: (c) => `${c.dataset.label}: ${fmt.num(c.parsed.y ?? undefined, 1)} ${unit}`,
          },
        },
      },
    },
  });
}

register({
  id: "weeklyVolume",
  render: (el, ctx) => renderVolume(el, ctx),
});

register({
  id: "intensityMinutes",
  render(el, ctx) {
    const { t, calc } = ctx;
    if (ctx.activities.length === 0) {
      ctx.empty(el);
      return;
    }
    const minutes = calc.weekly(ctx.activities, ctx.weeks, calc.intensityMinutes);
    ctx.chart(el, {
      type: "bar",
      data: {
        labels: ctx.weeks.map((w) => weekLabel(ctx, w)),
        datasets: [
          {
            type: "bar",
            label: t("w.intensityMinutes"),
            data: minutes,
            backgroundColor: minutes.map((m) => ctx.color(m >= 150 ? "good" : "accent")),
          },
          {
            type: "line",
            label: t("im.guide"),
            data: ctx.weeks.map(() => 150),
            borderColor: ctx.color("warn"),
            borderDash: [5, 4],
            pointRadius: 0,
          },
        ],
      },
      options: { scales: { y: { title: { display: true, text: "min" } } } },
    });
    append(el, note(t("im.note")));
  },
});

register({
  id: "loadSafety",
  render(el, ctx) {
    const { t, fmt, calc } = ctx;
    const max = maxHR(ctx);
    const acts = ctx.allActivities;
    const load = calc.weekly(acts, ctx.weeks, (a) => calc.loadOf(a, max)?.value ?? 0);
    const ramp = calc.ramp(load);
    const open =
      new Date(`${ctx.data.end}T00:00:00Z`).getUTCDay() !== 0 &&
      ctx.weeks.at(-1) === ctx.calc.mondayOf(ctx.data.end);
    // a week in progress has no ramp yet
    if (open) ramp[ramp.length - 1] = null;
    const flagged = ramp.map((r) => r !== null && r > 10);
    const end = windowEnd(ctx);
    const week = calc.monotony(calc.dailyLoads(acts, addDays(end, -6), end, max));
    const estimated = acts.some((a) => calc.loadOf(a, max)?.estimate);
    append(
      el,
      kpiRow(
        kpi(t("ls.weekLoad"), fmt.num(week.weekLoad)),
        kpi(
          t("ls.monotony"),
          week.monotony === null ? fmt.na : fmt.num(week.monotony, 2),
          week.monotony !== null &&
            week.monotony > 2 &&
            h("span", { class: "bad" }, t("ls.monotonyFlag")),
        ),
        kpi(t("ls.strain"), week.strain === null ? fmt.na : fmt.num(week.strain)),
        kpi(t("ls.flagged"), String(flagged.filter(Boolean).length)),
      ),
    );
    ctx.chart(el, {
      type: "bar",
      data: {
        labels: ctx.weeks.map((w) => weekLabel(ctx, w)),
        datasets: [
          {
            type: "bar",
            label: t("ls.load"),
            data: load,
            // only the flagged weeks stand out
            backgroundColor: flagged.map((f) =>
              f ? ctx.color("bad") : alpha(ctx.color("muted"), 0.6),
            ),
            yAxisID: "y",
          },
          {
            type: "line",
            label: t("ls.ramp"),
            data: ramp,
            borderColor: ctx.color("warn"),
            yAxisID: "y1",
            spanGaps: true,
          },
        ],
      },
      options: {
        scales: {
          y: { title: { display: true, text: t("ls.load") } },
          y1: {
            position: "right",
            grid: { drawOnChartArea: false },
            title: { display: true, text: "%" },
          },
        },
      },
    });
    append(el, note(t("ls.note")), estimated && note(t("ls.estimated")));
  },
});

register({
  id: "loadVsRecovery",
  render(el, ctx) {
    const { t, calc } = ctx;
    const max = maxHR(ctx);
    const end = windowEnd(ctx);
    const days: string[] = [];
    for (let d = ctx.from; d <= end; d = addDays(d, 1)) days.push(d);
    const hrv = new Map(
      ctx.data.hrv.map((r) => [String(r.date), typeof r.hrv === "number" ? r.hrv : null]),
    );
    ctx.chart(
      el,
      {
        type: "bar",
        data: {
          labels: days.map((d) => ctx.fmt.day(d)),
          datasets: [
            ...groupsIn(ctx.activities).map((g) => ({
              type: "bar" as const,
              label: typeName(ctx.t, g),
              data: calc.dailyLoads(
                ctx.activities.filter((a) => groupOf(a) === g),
                ctx.from,
                end,
                max,
              ),
              backgroundColor: ctx.color(g),
              stack: "load",
              yAxisID: "y",
            })),
            {
              type: "line" as const,
              label: t("lvr.hrv"),
              data: days.map((d) => hrv.get(d) ?? null),
              borderColor: ctx.color("text"),
              pointRadius: 1,
              yAxisID: "y1",
              spanGaps: true,
            },
          ],
        },
        options: {
          scales: {
            x: { stacked: true },
            y: { stacked: true, title: { display: true, text: t("ls.load") } },
            y1: {
              position: "right",
              grid: { drawOnChartArea: false },
              title: { display: true, text: "HRV (ms)" },
            },
          },
        },
      },
      260,
    );
    append(el, note(t("lvr.note")));
  },
});

register({
  id: "calendar",
  render(el, ctx) {
    const { t, fmt } = ctx;
    const byDay = new Map<string, Activity[]>();
    for (const a of ctx.activities) {
      const d = dayOf(a);
      if (d) byDay.set(d, [...(byDay.get(d) ?? []), a]);
    }
    const minutes = (d: string) =>
      (byDay.get(d) ?? []).reduce((s, a) => s + sessionSeconds(a) / 60, 0);
    const weekday = new Intl.DateTimeFormat(ctx.lang, { weekday: "short", timeZone: "UTC" });
    const tip = h("div", { class: "cal-tip", role: "status", hidden: true });
    const show = (cell: HTMLElement, d: string) => {
      const acts = byDay.get(d) ?? [];
      tip.replaceChildren(
        h("strong", {}, fmt.longDay(d)),
        h("div", {}, acts.length ? t("cal.minutes", { n: fmt.num(minutes(d)) }) : t("cal.rest")),
        ...acts.map((a) =>
          h(
            "div",
            { class: "small" },
            `${a.name ?? ""} · ${typeof a.km === "number" ? `${fmt.num(a.km, 1)} km · ` : ""}${fmt.hours(sessionSeconds(a))}`,
          ),
        ),
      );
      tip.hidden = false;
      const box = cell.getBoundingClientRect();
      const host = el.getBoundingClientRect();
      tip.style.left = `${Math.min(box.left - host.left, host.width - 220)}px`;
      tip.style.top = `${box.bottom - host.top + 6}px`;
    };
    const grid = h("div", {
      class: "cal",
      style: `grid-template-columns: auto repeat(${ctx.weeks.length}, minmax(10px, 18px))`,
    });
    for (let day = 0; day < 7; day++) {
      grid.append(
        h(
          "span",
          { class: "cal-day muted small" },
          day % 2 === 0 ? weekday.format(new Date(Date.UTC(2026, 0, 5 + day))) : "",
        ),
      );
      for (const w of ctx.weeks) {
        const d = addDays(w, day);
        if (d > ctx.data.end) {
          grid.append(h("span", { class: "cal-cell out" }));
          continue;
        }
        const cell = h("button", {
          class: `cal-cell l${level(minutes(d))}`,
          "data-date": d,
          "aria-label": `${fmt.longDay(d)}: ${byDay.has(d) ? t("cal.minutes", { n: fmt.num(minutes(d)) }) : t("cal.rest")}`,
          onpointerenter: () => show(cell, d),
          onfocus: () => show(cell, d),
          onclick: () => show(cell, d),
          onpointerleave: () => (tip.hidden = true),
          onblur: () => (tip.hidden = true),
        });
        grid.append(cell);
      }
    }
    append(el, h("div", { class: "cal-wrap" }, grid, tip));
  },
});
