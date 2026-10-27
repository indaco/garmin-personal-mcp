import { append, h } from "../dom";
import { register } from "../registry";
import type { Ctx } from "../registry";
import { kpi, kpiRow, note } from "./ui";

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
    append(el, note(t("rec14")));
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
    append(el, note(ctx.t("rec14")));
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
          stage("deep", t("sl.deep"), ctx.color("strength")),
          stage("light", t("sl.light"), ctx.color("bike")),
          stage("rem", t("sl.rem"), ctx.color("swim")),
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
    append(el, note(t("rec14")));
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
    append(el, note(t("rec14")));
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
    append(el, note(t("rec14")));
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
          { label: t("bb.low"), data: series(rows, "bbLow"), backgroundColor: ctx.color("bad") },
        ],
      },
      options: { scales: { y: { min: 0, max: 100 } } },
    });
    append(el, h("p", { class: "muted small note" }, t("rec14")));
  },
});
