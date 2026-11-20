import type { SignDay } from "../../analytics/metrics";
import { append, h } from "../dom";
import { register } from "../registry";
import type { Ctx } from "../registry";
import { alpha, kpi, kpiRow, note, weekLabel } from "./ui";

/** The recovery widgets show the last 14 days of the data: today's state, so the week window does not change them. */

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const series = (rows: Row[], field: string) => rows.map((r) => num(r[field]));

function recoveryDays(ctx: Ctx): Row[] {
  return ctx.data.recovery.slice(-14);
}

function labels(ctx: Ctx, rows: Row[]): string[] {
  return rows.map((r) => ctx.fmt.day(String(r.date)));
}

function noRows(el: HTMLElement, ctx: Ctx, rows: Row[]): boolean {
  if (rows.length === 0) ctx.empty(el, ctx.fmt.na);
  return rows.length === 0;
}

/** The 14-day note; the Recovery board says it once for all its widgets. */
function rec14(el: HTMLElement, ctx: Ctx): void {
  if (ctx.board !== "recovery") append(el, note(ctx.t("rec14")));
}

const clock = (m: number) =>
  `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;

register({
  id: "hrv",
  render(el, ctx) {
    const { t, calc } = ctx;
    const rows = ctx.data.hrv.slice(-14);
    if (noRows(el, ctx, rows)) return;
    const hrv = series(rows, "hrv");
    ctx.chart(el, {
      type: "line",
      data: {
        labels: labels(ctx, rows),
        datasets: [
          {
            label: t("hrv.low"),
            data: series(rows, "low"),
            borderColor: "transparent",
            pointRadius: 0,
            fill: false,
          },
          {
            label: t("hrv.band"),
            data: series(rows, "high"),
            borderColor: "transparent",
            backgroundColor: `${ctx.color("good")}22`,
            pointRadius: 0,
            fill: "-1",
          },
          {
            label: t("hrv.nightly"),
            data: hrv,
            borderColor: ctx.color("accent"),
            pointRadius: 2,
            spanGaps: true,
          },
          {
            label: t("hrv.avg"),
            data: calc.rolling(hrv, 7),
            borderColor: ctx.color("text"),
            borderDash: [4, 3],
            pointRadius: 0,
          },
        ],
      },
      options: {
        scales: { y: { title: { display: true, text: "ms" } } },
        plugins: { legend: { labels: { filter: (i) => i.text !== t("hrv.low") } } },
      },
    });
    rec14(el, ctx);
  },
});

register({
  id: "restingHr",
  render(el, ctx) {
    const rows = recoveryDays(ctx);
    if (noRows(el, ctx, rows)) return;
    ctx.chart(el, {
      type: "line",
      data: {
        labels: labels(ctx, rows),
        datasets: [
          {
            label: ctx.t("w.restingHr"),
            data: series(rows, "rhr"),
            borderColor: ctx.color("bad"),
            pointRadius: 2,
            spanGaps: true,
          },
        ],
      },
      options: { scales: { y: { title: { display: true, text: "bpm" } } } },
    });
    rec14(el, ctx);
  },
});

register({
  id: "stress",
  render(el, ctx) {
    const rows = recoveryDays(ctx);
    if (noRows(el, ctx, rows)) return;
    ctx.chart(el, {
      type: "line",
      data: {
        labels: labels(ctx, rows),
        datasets: [
          {
            label: ctx.t("w.stress"),
            // below 0: Garmin has no value for that day
            data: series(rows, "stress").map((v) => (v !== null && v < 0 ? null : v)),
            borderColor: ctx.color("accent"),
            pointRadius: 2,
            spanGaps: true,
          },
        ],
      },
      options: { scales: { y: { min: 0, max: 100 } } },
    });
    rec14(el, ctx);
  },
});

register({
  id: "recoveryTrend",
  render(el, ctx) {
    const { t, calc } = ctx;
    const line = (field: string, label: string, color: string, yAxisID: string) => ({
      label,
      data: calc.weeklyMeans(ctx.data.recovery, ctx.weeks, field),
      borderColor: ctx.color(color),
      pointRadius: 3,
      spanGaps: true,
      yAxisID,
    });
    const datasets = [
      line("sleepH", t("w.sleep"), "accent", "y"),
      line("sleepScore", t("ready.sleep"), "text", "y1"),
      line("rhr", t("w.restingHr"), "bad", "y1"),
    ];
    if (datasets.every((d) => d.data.every((v) => v === null))) return ctx.empty(el, ctx.fmt.na);
    ctx.chart(el, {
      type: "line",
      data: { labels: ctx.weeks.map((w) => weekLabel(ctx, w)), datasets },
      options: {
        scales: {
          y: { title: { display: true, text: "h" } },
          y1: { position: "right", grid: { drawOnChartArea: false } },
        },
      },
    });
    append(el, note(t("rt.note")));
  },
});

register({
  id: "sleep",
  render(el, ctx) {
    const { t } = ctx;
    const rows = recoveryDays(ctx);
    if (noRows(el, ctx, rows)) return;
    const stage = (field: string, label: string, color: string) => ({
      type: "bar" as const,
      label,
      data: series(rows, field),
      backgroundColor: color,
      stack: "s",
      yAxisID: "y",
    });
    ctx.chart(el, {
      type: "bar",
      data: {
        labels: labels(ctx, rows),
        datasets: [
          stage("deep", t("sl.deep"), ctx.color("strengthTraining")),
          stage("light", t("sl.light"), ctx.color("cycling")),
          stage("rem", t("sl.rem"), ctx.color("swimming")),
          stage("awake", t("sl.awake"), ctx.color("racket")),
          {
            type: "line" as const,
            label: t("sl.score"),
            data: series(rows, "sleepScore"),
            borderColor: ctx.color("text"),
            pointRadius: 2,
            yAxisID: "y1",
            spanGaps: true,
          },
        ],
      },
      options: {
        scales: {
          x: { stacked: true },
          y: { stacked: true, title: { display: true, text: "h" } },
          y1: { position: "right", min: 0, max: 100, grid: { drawOnChartArea: false } },
        },
      },
    });
    rec14(el, ctx);
  },
});

register({
  id: "sleepNeed",
  render(el, ctx) {
    const { t, fmt, calc } = ctx;
    const rows = recoveryDays(ctx);
    if (noRows(el, ctx, rows)) return;
    const gaps = rows.flatMap((r) =>
      num(r.sleepH) !== null && num(r.needH) !== null ? [num(r.needH)! - num(r.sleepH)!] : [],
    );
    const gap = calc.mean(gaps);
    append(el, kpiRow(kpi(t("sn.gap"), gap === null ? fmt.na : `${fmt.num(gap * 60)} min`)));
    ctx.chart(
      el,
      {
        type: "bar",
        data: {
          labels: labels(ctx, rows),
          datasets: [
            {
              type: "bar",
              label: t("sn.actual"),
              data: series(rows, "sleepH"),
              backgroundColor: ctx.color("accent"),
            },
            {
              type: "line",
              label: t("sn.need"),
              data: series(rows, "needH"),
              borderColor: ctx.color("warn"),
              pointRadius: 2,
              spanGaps: true,
            },
          ],
        },
        options: { scales: { y: { title: { display: true, text: "h" } } } },
      },
      180,
    );
    rec14(el, ctx);
  },
});

register({
  id: "bedtime",
  render(el, ctx) {
    const { t, fmt, calc } = ctx;
    const rows = recoveryDays(ctx);
    if (noRows(el, ctx, rows)) return;
    // after midnight counts as the same night: 00:30 is 24:30
    const bed = series(rows, "bedMin").map((m) => (m === null ? null : m < 720 ? m + 1440 : m));
    const spread = calc.bedtimeSpread(bed.filter((m): m is number => m !== null));
    append(el, kpiRow(kpi(t("bt.spread"), spread === null ? fmt.na : `± ${fmt.num(spread)} min`)));
    ctx.chart(
      el,
      {
        type: "line",
        data: {
          labels: labels(ctx, rows),
          datasets: [
            {
              label: t("w.bedtime"),
              data: bed,
              borderColor: ctx.color("accent"),
              pointRadius: 3,
              showLine: false,
            },
          ],
        },
        options: {
          scales: { y: { reverse: true, ticks: { callback: (v) => clock(Number(v)) } } },
          plugins: { tooltip: { callbacks: { label: (c) => clock(c.parsed.y ?? 0) } } },
        },
      },
      180,
    );
    rec14(el, ctx);
  },
});

register({
  id: "bodyBattery",
  render(el, ctx) {
    const { t } = ctx;
    const rows = recoveryDays(ctx);
    if (noRows(el, ctx, rows)) return;
    ctx.chart(el, {
      type: "bar",
      data: {
        labels: labels(ctx, rows),
        datasets: [
          { label: t("bb.high"), data: series(rows, "bbHigh"), backgroundColor: ctx.color("good") },
          // a light fill with an edge: not told apart from the high bars by colour alone
          {
            label: t("bb.low"),
            data: series(rows, "bbLow"),
            backgroundColor: alpha(ctx.color("bad"), 0.35),
            borderColor: ctx.color("bad"),
            borderWidth: 1.5,
          },
        ],
      },
      options: { scales: { y: { min: 0, max: 100 } } },
    });
    rec14(el, ctx);
  },
});

/** The texts of a day of the strip: a sign day, a clear day, a day without values. */
const DAY_TEXT = { sign: "ws.daySign", clear: "ws.dayClear", none: "ws.dayNone" } as const;

register({
  id: "warningSigns",
  render(el, ctx) {
    const { t, fmt, calc, data } = ctx;
    const days = calc.signDays(data.hrv, data.recovery);
    const signs = calc.warningSignsOf(days);
    const day = days.find((d) => d.date === signs?.date);
    if (signs === null || day === undefined) return ctx.empty(el, fmt.na);
    const value = (v: number | null, unit: string, digits = 0) =>
      v === null ? fmt.na : `${fmt.num(v, digits)} ${unit}`;
    const lines = (d: SignDay): [boolean | null, string][] => [
      [
        d.signals.rhrHigh,
        t("ws.rhr", { rhr: value(d.rhr, "bpm"), base: value(d.rhrBase, "bpm", 1) }),
      ],
      [d.signals.hrvLow, t("ws.hrv", { hrv: value(d.hrv, "ms"), low: value(d.hrvLow, "ms") })],
      [d.signals.sleepLow, t("ws.sleep", { score: fmt.num(d.sleepScore ?? undefined) })],
    ];
    // a single day has a streak of 1 when it is a sign day: the rule stays in one place
    const kind = (d: SignDay) =>
      Object.values(d.signals).every((s) => s === null)
        ? "none"
        : calc.warningSignsOf([d])?.streak === 1
          ? "sign"
          : "clear";
    const dot = (d: SignDay) => {
      const k = kind(d);
      const text = [fmt.day(d.date), t(DAY_TEXT[k]), ...lines(d).map(([, l]) => l)].join(" · ");
      return h("li", { class: `dot ${k}`, title: text }, h("span", { class: "sr-only" }, text));
    };
    const head = signs.flag
      ? t(signs.streak >= calc.SIGN_WINDOW ? "ws.flagMax" : "ws.flag", { n: signs.streak })
      : t(signs.streak === 1 ? "ws.one" : "ws.none");
    append(
      el,
      h("p", { class: signs.flag ? "ws-head warn" : "ws-head" }, head),
      signs.date !== data.end &&
        h("p", { class: "ws-from muted" }, t("ready.from", { day: fmt.day(signs.date) })),
      h(
        "ul",
        { class: "ws-lines" },
        ...lines(day).map(([on, text]) =>
          h("li", { class: on === true && "warn" }, on === true && "⚠ ", text),
        ),
      ),
      h("p", { class: "ws-days muted" }, t("ws.days")),
      h("ol", { class: "ws-dots" }, ...days.slice(-7).map(dot)),
      note(t("ws.note")),
    );
  },
});
