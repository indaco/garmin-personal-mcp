import { addDays } from "../../dates";
import { type Activity, groupOf } from "../calc";
import { append, h } from "../dom";
import type { Key } from "../i18n";
import { register } from "../registry";
import type { Ctx } from "../registry";
import { oneSession } from "./types";
import { alpha, delta, kpi, kpiRow, note, showAll, table, weekLabel } from "./ui";

/** The Run board: best efforts, races, aerobic fitness, intensity, form, run/walk, training effect, predictions, long runs. */

const DISTANCES = ["1k", "mile", "5k", "10k", "half", "marathon"];
const TREND: Record<string, number> = { "5k": 5, "10k": 10 };
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
    // the fastest effort of each week as pace, like the top set of an exercise: one axis for both
    const effort = (a: Activity, d: string) =>
      ctx.calc.seconds((a.best as Record<string, unknown> | undefined)?.[d]);
    const weekly = Object.entries(TREND).map(([d, km]) => ({
      d,
      km,
      weeks: ctx.weeks.map((_, i) =>
        runs(ctx)
          .filter((a) => weekOf(ctx, a) === i && effort(a, d) > 0)
          .reduce<Activity | undefined>(
            (b, a) => (b && effort(b, d) <= effort(a, d) ? b : a),
            undefined,
          ),
      ),
    }));
    const shown = weekly.filter((x) => x.weeks.filter(Boolean).length >= 2);
    if (shown.length === 0) return;
    ctx.chart(
      el,
      {
        type: "line",
        data: {
          labels: ctx.weeks.map((w) => weekLabel(ctx, w)),
          datasets: shown.map((x, i) => ({
            label: t(`d.${x.d}` as Key),
            data: x.weeks.map((a) => (a ? fmt.to.pace(effort(a, x.d) / x.km) : null)),
            borderColor: ctx.color(i === 0 ? "running" : "accent"),
            spanGaps: true,
          })),
        },
        options: {
          scales: {
            y: {
              reverse: true,
              ticks: { callback: (v) => fmt.hms(Number(v)) },
              title: { display: true, text: t("af.pace", { unit: fmt.unit.pace }) },
            },
          },
          plugins: {
            tooltip: {
              callbacks: {
                label: (c) => {
                  const x = shown[c.datasetIndex];
                  const a = x.weeks[c.dataIndex]!;
                  return `${c.dataset.label}: ${fmt.hms(effort(a, x.d))} · ${fmt.day(day(a))} ${a.name ?? ""}`;
                },
              },
            },
          },
        },
      },
      180,
    );
    append(el, note(t("be.trendNote")));
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
          fmt.dist(num(a.km), 2),
          fmt.hms(ctx.calc.seconds(a.duration)),
          ctx.calc.seconds(a.pace) > 0 ? fmt.pace(ctx.calc.seconds(a.pace)) : "",
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
            data: list.map((a) => ({ x: a.avgHR as number, y: fmt.to.pace(calc.paceSeconds(a)!) })),
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
            title: { display: true, text: t("af.pace", { unit: fmt.unit.pace }) },
            ticks: { callback: (v) => fmt.hms(Number(v)) },
          },
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: (c) => {
                const a = list[c.dataIndex];
                return `${fmt.day(day(a))} ${a.name ?? ""}: ${fmt.hms(c.parsed.y ?? 0)}${fmt.unit.pace} · ${fmt.num(c.parsed.x ?? 0)} bpm`;
              },
            },
          },
        },
      },
    });
    const weekly = ctx.weeks.map((_, i) => runs(ctx).filter((a) => weekOf(ctx, a) === i));
    const pace = weekly.map((w) => {
      const d = calc.timedDistance(w);
      return d.km > 0 ? fmt.to.pace(d.seconds / d.km) : null;
    });
    // intervals, tempo runs and races raise HR for other reasons: efficiency counts the runs below zone 4
    const z4 = calc.zonesOf(ctx.data.zones).floors[3];
    const aerobic = (a: Activity) =>
      z4 === undefined || (typeof a.avgHR === "number" && a.avgHR < z4);
    const effOf = (w: Activity[]) =>
      calc.mean(
        w
          .filter(aerobic)
          .map((a) => calc.efficiency(a))
          .filter((v): v is number => v !== undefined),
      );
    const eff = weekly.map(effOf);
    const points = runs(ctx)
      .filter((a) => aerobic(a) && calc.efficiency(a) !== undefined && weekOf(ctx, a) >= 0)
      .toReversed();
    // the first and the last weeks of the window; a short window compares its halves
    const n = Math.min(4, Math.floor(ctx.weeks.length / 2));
    const now = effOf(weekly.slice(-n).flat());
    const before = effOf(weekly.slice(0, n).flat());
    if (n > 0) {
      append(
        el,
        kpiRow(
          kpi(
            t("af.aerobicEff", { n }),
            now === null ? fmt.na : fmt.num(now, 2),
            now !== null &&
              before !== null &&
              h(
                "span",
                {},
                delta(ctx, calc.change(now, before), "up"),
                " ",
                t("af.vsFirst", { n }),
              ),
          ),
        ),
      );
    }
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
            {
              label: t("af.aerobicRuns"),
              data: points.map((a) => ({
                // the category axis places a point by its label; Chart.js types only number
                x: weekLabel(ctx, ctx.weeks[weekOf(ctx, a)]) as unknown as number,
                y: calc.efficiency(a)!,
              })),
              borderColor: alpha(ctx.color("good"), 0.5),
              backgroundColor: alpha(ctx.color("good"), 0.5),
              showLine: false,
              yAxisID: "y1",
            },
          ],
        },
        options: {
          scales: {
            y: {
              reverse: true,
              ticks: { callback: (v) => fmt.hms(Number(v)) },
              title: { display: true, text: t("af.pace", { unit: fmt.unit.pace }) },
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
                    ? `${c.dataset.label}: ${fmt.hms(c.parsed.y ?? 0)}${fmt.unit.pace}`
                    : c.datasetIndex === 2
                      ? `${fmt.day(day(points[c.dataIndex]))} ${points[c.dataIndex].name ?? ""}: ${fmt.num(c.parsed.y ?? undefined, 2)}`
                      : `${c.dataset.label}: ${fmt.num(c.parsed.y ?? undefined, 2)}`,
              },
            },
          },
        },
      },
      180,
    );
    append(el, note(t(z4 === undefined ? "af.noZones" : "af.aerobicNote")));
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
            paceText(ctx, rw.runPace),
            paceText(ctx, a.pace),
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
    const ascent = weekly.map((w) => fmt.to.elev(w.reduce((s, a) => s + (num(a.ascentM) ?? 0), 0)));
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
              title: { display: true, text: fmt.unit.elev },
            },
          },
        },
      },
      200,
    );
    const split = runs(ctx)
      .filter((a) => Array.isArray(a.laps) && (a.race === true || (num(a.km) ?? 0) > 15))
      .map((a) => ({ a, s: calc.splitOf(a.laps as Parameters<typeof calc.splitOf>[0]) }))
      .filter((x) => x.s);
    append(
      el,
      note(t("lr.note")),
      split.length > 0 &&
        table(
          [
            t("col.date"),
            t("col.name"),
            t("lr.first"),
            t("lr.second"),
            t("lr.split"),
            t("lr.drift"),
            t("lr.gap"),
          ],
          split.map(({ a, s }) => [
            fmt.day(day(a)),
            a.name ?? "",
            fmt.pace(s!.first),
            fmt.pace(s!.second),
            h(
              "span",
              { class: s!.kind === "positive" ? "bad" : s!.kind === "negative" ? "good" : "same" },
              t(`lr.${s!.kind}` as Key),
            ),
            s!.drift === undefined
              ? fmt.na
              : h("span", { class: s!.drift > 5 ? "bad" : "good" }, `${fmt.num(s!.drift, 1)}%`),
            paceText(ctx, a.gap),
          ]),
          [2, 3, 5, 6],
        ),
    );
  },
});

/** A pace of the data ("5:07/km") in the units of the page; n/a without one. */
const paceText = (ctx: Ctx, v: unknown) =>
  ctx.calc.seconds(v) > 0 ? ctx.fmt.pace(ctx.calc.seconds(v)) : ctx.fmt.na;
