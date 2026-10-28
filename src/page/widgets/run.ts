import { addDays } from "../../dates";
import { type Activity, groupOf } from "../calc";
import { append, h } from "../dom";
import type { Key } from "../i18n";
import { register } from "../registry";
import type { Ctx } from "../registry";
import { oneSession } from "./types";
import { alpha, kpi, kpiRow, note, showAll, table, weekLabel } from "./ui";

/** The Run board: best efforts, races, aerobic fitness, intensity, form, run/walk, training effect, predictions, long runs. */

const DISTANCES = ["1k", "mile", "5k", "10k", "half", "marathon"];
const FORM: [field: string, key: Key, unit: string, digits: number][] = [
  ["cadenceSpm", "form.cadence", "spm", 0],
  ["gctMs", "form.gct", "ms", 0],
  ["strideCm", "form.stride", "cm", 0],
  ["vertOscCm", "form.vertOsc", "cm", 1],
  ["vertRatioPct", "form.vertRatio", "%", 1],
  ["avgPowerW", "form.power", "W", 0],
  ["normPowerW", "form.normPower", "W", 0],
];

const runs = (ctx: Ctx) => ctx.activities.filter((a) => groupOf(a) === "running");
const day = (a: Activity) => String(a.start).slice(0, 10);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const weekOf = (ctx: Ctx, a: Activity) =>
  ctx.weeks.findIndex((w) => day(a) >= w && day(a) <= addDays(w, 6));

/** The fastest of each best-effort distance in the window, with its activity. */
function bestEfforts(ctx: Ctx) {
  const best: Record<string, { s: number; a: Activity }> = {};
  for (const a of runs(ctx)) {
    for (const [d, v] of Object.entries((a.best ?? {}) as Record<string, string>)) {
      const s = ctx.calc.seconds(v);
      if (s > 0 && (!best[d] || s < best[d].s)) best[d] = { s, a };
    }
  }
  return best;
}

register({
  id: "bestEfforts",
  render(el, ctx) {
    const { t, fmt } = ctx;
    const best = bestEfforts(ctx);
    const rows = DISTANCES.filter((d) => best[d]).map((d) => [
      t(`d.${d}` as Key),
      fmt.hms(best[d].s),
      `${fmt.day(day(best[d].a))} · ${best[d].a.name ?? ""}`,
    ]);
    if (rows.length === 0) return ctx.empty(el);
    append(el, table([t("be.distance"), t("col.time"), t("be.activity")], rows, [1]));
  },
});

register({
  id: "races",
  render(el, ctx) {
    const { t, fmt } = ctx;
    const races = runs(ctx).filter((a) => a.race === true);
    if (races.length === 0) return ctx.empty(el, t("races.none"));
    append(
      el,
      table(
        [
          t("col.date"),
          t("col.name"),
          t("col.distance"),
          t("col.time"),
          t("col.pace"),
          t("col.hr"),
          t("form.power"),
          t("te.aerobic"),
        ],
        races.map((a) => [
          fmt.day(day(a)),
          a.name ?? "",
          `${fmt.num(num(a.km), 2)} km`,
          fmt.hms(ctx.calc.seconds(a.duration)),
          String(a.pace ?? ""),
          fmt.num(num(a.avgHR)),
          num(a.avgPowerW) === undefined ? fmt.na : `${fmt.num(num(a.avgPowerW))} W`,
          fmt.num(num(a.aerobicTE), 1),
        ]),
        [2, 3, 4, 5, 6, 7],
      ),
    );
  },
});

register({
  id: "aerobicFitness",
  render(el, ctx) {
    const { t, fmt, calc } = ctx;
    if (oneSession(el, ctx)) return;
    const list = runs(ctx)
      .filter((a) => calc.paceSeconds(a) && typeof a.avgHR === "number")
      .toReversed();
    const accent = ctx.color("accent");
    ctx.chart(el, {
      type: "scatter",
      data: {
        datasets: [
          {
            label: t("af.runs"),
            data: list.map((a) => ({ x: a.avgHR as number, y: calc.paceSeconds(a)! })),
            // oldest pale, newest strong
            backgroundColor: list.map((_, i) => alpha(accent, 0.2 + (0.8 * (i + 1)) / list.length)),
            pointRadius: 4,
          },
        ],
      },
      options: {
        interaction: { mode: "nearest", intersect: true },
        scales: {
          x: { title: { display: true, text: t("col.hr") } },
          y: {
            reverse: true,
            title: { display: true, text: t("af.pace") },
            ticks: { callback: (v) => fmt.hms(Number(v)) },
          },
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: (c) => {
                const a = list[c.dataIndex];
                return `${fmt.day(day(a))} ${a.name ?? ""}: ${fmt.hms(c.parsed.y ?? 0)}/km · ${fmt.num(c.parsed.x ?? 0)} bpm`;
              },
            },
          },
        },
      },
    });
    const weekly = ctx.weeks.map((_, i) => runs(ctx).filter((a) => weekOf(ctx, a) === i));
    const pace = weekly.map((w) => {
      const d = calc.timedDistance(w);
      return d.km > 0 ? d.seconds / d.km : null;
    });
    const eff = weekly.map((w) =>
      calc.mean(w.map((a) => calc.efficiency(a)).filter((v): v is number => v !== undefined)),
    );
    ctx.chart(
      el,
      {
        type: "line",
        data: {
          labels: ctx.weeks.map((w) => weekLabel(ctx, w)),
          datasets: [
            {
              label: t("af.weekPace"),
              data: pace,
              borderColor: ctx.color("running"),
              yAxisID: "y",
              spanGaps: true,
            },
            {
              label: t("af.efficiency"),
              data: eff,
              borderColor: ctx.color("good"),
              yAxisID: "y1",
              spanGaps: true,
            },
          ],
        },
        options: {
          scales: {
            y: {
              reverse: true,
              ticks: { callback: (v) => fmt.hms(Number(v)) },
              title: { display: true, text: t("af.pace") },
            },
            y1: {
              position: "right",
              grid: { drawOnChartArea: false },
              title: { display: true, text: t("af.effUnit") },
            },
          },
          plugins: {
            tooltip: {
              callbacks: {
                label: (c) =>
                  c.datasetIndex === 0
                    ? `${c.dataset.label}: ${fmt.hms(c.parsed.y ?? 0)}/km`
                    : `${c.dataset.label}: ${fmt.num(c.parsed.y ?? undefined, 2)}`,
              },
            },
          },
        },
      },
      180,
    );
  },
});

register({
  id: "intensityShare",
  render(el, ctx) {
    const { t, calc, fmt } = ctx;
    if (oneSession(el, ctx)) return;
    const floors = calc.zonesOf(ctx.data.zones).floors;
    const weeks = ctx.weeks.map(() => [0, 0, 0]);
    for (const a of runs(ctx)) {
      const z = calc.zoneSeconds(a, floors);
      const i = weekOf(ctx, a);
      if (!z || i < 0) continue;
      weeks[i][0] += z.sec[0] + z.sec[1];
      weeks[i][1] += z.sec[3] + z.sec[4];
      weeks[i][2] += z.sec.reduce((s, v) => s + v, 0);
    }
    const share = (n: number) => weeks.map((w) => (w[2] > 0 ? (w[n] / w[2]) * 100 : null));
    ctx.chart(el, {
      type: "line",
      data: {
        labels: ctx.weeks.map((w) => weekLabel(ctx, w)),
        datasets: [
          { label: t("is.easy"), data: share(0), borderColor: ctx.color("good"), spanGaps: true },
          {
            label: t("is.hard"),
            data: share(1),
            borderColor: ctx.color("bad"),
            borderDash: [6, 4], // not told apart by colour alone
            spanGaps: true,
          },
        ],
      },
      options: {
        scales: { y: { min: 0, max: 100, title: { display: true, text: "%" } } },
        plugins: {
          tooltip: {
            callbacks: { label: (c) => `${c.dataset.label}: ${fmt.num(c.parsed.y ?? undefined)}%` },
          },
        },
      },
    });
  },
});

register({
  id: "runningForm",
  render(el, ctx) {
    const { t, fmt, calc } = ctx;
    if (oneSession(el, ctx)) return;
    const present = FORM.filter(([f]) => runs(ctx).some((a) => num(a[f]) !== undefined));
    if (present.length === 0) return ctx.empty(el, fmt.na);
    const grid = h("div", { class: "multiples" });
    append(el, grid);
    const cells: HTMLElement[] = [];
    for (const [field, key, unit, digits] of present) {
      const cell = h("div", { class: "multiple" }, h("h3", {}, `${t(key)} (${unit})`));
      grid.append(cell);
      cells.push(cell);
      const values = ctx.weeks.map((_, i) =>
        calc.mean(
          runs(ctx)
            .filter((a) => weekOf(ctx, a) === i)
            .map((a) => num(a[field]))
            .filter((v): v is number => v !== undefined),
        ),
      );
      ctx.chart(
        cell,
        {
          type: "line",
          data: {
            labels: ctx.weeks.map((w) => weekLabel(ctx, w)),
            datasets: [
              {
                label: t(key),
                data: values,
                borderColor: ctx.color("running"),
                spanGaps: true,
                pointRadius: 2,
              },
            ],
          },
          options: {
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: { label: (c) => `${fmt.num(c.parsed.y ?? undefined, digits)} ${unit}` },
              },
            },
            scales: { y: { title: { display: true, text: unit } } },
          },
        },
        140,
      );
    }
    // cadence and ground contact time first; a hidden chart draws itself when it shows
    append(el, showAll(ctx, cells.slice(2), cells.length));
  },
});

register({
  id: "runWalk",
  render(el, ctx) {
    const { t, fmt } = ctx;
    const list = runs(ctx).filter((a) => a.runWalk && typeof a.runWalk === "object");
    if (list.length === 0) return ctx.empty(el, t("rw.none"));
    append(
      el,
      table(
        [t("col.date"), t("rw.runPace"), t("rw.pace"), t("rw.walk")],
        list.map((a) => {
          const rw = a.runWalk as Record<string, unknown>;
          return [
            fmt.day(day(a)),
            String(rw.runPace ?? fmt.na),
            String(a.pace ?? fmt.na),
            String(rw.walkTime ?? fmt.na),
          ];
        }),
        [1, 2, 3],
      ),
    );
  },
});

register({
  id: "trainingEffect",
  render(el, ctx) {
    const { t, fmt } = ctx;
    if (oneSession(el, ctx)) return;
    const list = runs(ctx).toReversed();
    ctx.chart(
      el,
      {
        type: "line",
        data: {
          labels: list.map((a) => fmt.day(day(a))),
          datasets: [
            {
              label: t("te.aerobic"),
              data: list.map((a) => num(a.aerobicTE) ?? null),
              borderColor: ctx.color("accent"),
              showLine: false,
              pointRadius: 3,
            },
            {
              label: t("te.anaerobic"),
              data: list.map((a) => num(a.anaerobicTE) ?? null),
              borderColor: ctx.color("racket"),
              showLine: false,
              pointRadius: 3,
            },
          ],
        },
        options: { scales: { y: { min: 0, max: 5 } } },
      },
      180,
    );
    const labels = [...new Set(list.map((a) => String(a.teLabel ?? "")).filter(Boolean))];
    const palette = [
      "accent",
      "good",
      "warn",
      "bad",
      "strengthTraining",
      "swimming",
      "hiking",
      "generic",
    ];
    ctx.chart(
      el,
      {
        type: "bar",
        data: {
          labels: ctx.weeks.map((w) => weekLabel(ctx, w)),
          datasets: labels.map((label, n) => ({
            label: label.replaceAll("_", " "),
            data: ctx.weeks.map(
              (_, i) => runs(ctx).filter((a) => weekOf(ctx, a) === i && a.teLabel === label).length,
            ),
            backgroundColor: ctx.color(palette[n % palette.length]),
          })),
        },
        options: {
          scales: { x: { stacked: true }, y: { stacked: true, ticks: { precision: 0 } } },
        },
      },
      160,
    );
  },
});

register({
  id: "racePredictor",
  render(el, ctx) {
    const { t, fmt, calc } = ctx;
    const best = bestEfforts(ctx);
    const p = calc.predictRaces(Object.fromEntries(Object.entries(best).map(([d, v]) => [d, v.s])));
    if (!p) return ctx.empty(el, t("rp.none"));
    const from = best[p.from.distance];
    append(
      el,
      kpiRow(...Object.entries(p.times).map(([d, s]) => kpi(t(`d.${d}` as Key), fmt.hms(s)))),
      note(
        t("rp.note", {
          d: t(`d.${p.from.distance}` as Key),
          time: fmt.hms(p.from.seconds),
          date: fmt.day(day(from.a)),
        }),
      ),
    );
  },
});

register({
  id: "longRuns",
  render(el, ctx) {
    const { t, fmt, calc } = ctx;
    if (oneSession(el, ctx)) return;
    const weekly = ctx.weeks.map((_, i) => runs(ctx).filter((a) => weekOf(ctx, a) === i));
    const share = weekly.map((w) => {
      const km = w.reduce((s, a) => s + (num(a.km) ?? 0), 0);
      const longest = Math.max(0, ...w.map((a) => num(a.km) ?? 0));
      return km > 0 ? (longest / km) * 100 : null;
    });
    const ascent = weekly.map((w) => w.reduce((s, a) => s + (num(a.ascentM) ?? 0), 0));
    ctx.chart(
      el,
      {
        type: "bar",
        data: {
          labels: ctx.weeks.map((w) => weekLabel(ctx, w)),
          datasets: [
            {
              type: "bar",
              label: t("lr.share"),
              data: share,
              backgroundColor: share.map((s) =>
                ctx.color(s !== null && s > 35 ? "bad" : "running"),
              ),
              yAxisID: "y",
            },
            {
              type: "line",
              label: t("lr.ascent"),
              data: ascent,
              borderColor: ctx.color("hiking"),
              yAxisID: "y1",
            },
          ],
        },
        options: {
          scales: {
            y: { min: 0, max: 100, title: { display: true, text: "%" } },
            y1: {
              position: "right",
              grid: { drawOnChartArea: false },
              title: { display: true, text: "m" },
            },
          },
        },
      },
      200,
    );
    const split = runs(ctx)
      .filter((a) => Array.isArray(a.laps) && (a.race === true || (num(a.km) ?? 0) > 15))
      .map((a) => ({ a, s: calc.splitOf(a.laps as { km?: unknown; time?: unknown }[]) }))
      .filter((x) => x.s);
    append(
      el,
      note(t("lr.note")),
      split.length > 0 &&
        table(
          [t("col.date"), t("col.name"), t("lr.first"), t("lr.second"), t("lr.split"), t("lr.gap")],
          split.map(({ a, s }) => [
            fmt.day(day(a)),
            a.name ?? "",
            `${fmt.hms(s!.first)}/km`,
            `${fmt.hms(s!.second)}/km`,
            h(
              "span",
              { class: s!.kind === "positive" ? "bad" : s!.kind === "negative" ? "good" : "same" },
              t(`lr.${s!.kind}` as Key),
            ),
            String(a.gap ?? fmt.na),
          ]),
          [2, 3, 5],
        ),
    );
  },
});
