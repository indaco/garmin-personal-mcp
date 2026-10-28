import { addDays } from "../../dates";
import { type Activity, isIndoor, seconds, sessionSeconds, sportOf } from "../calc";
import { append } from "../dom";
import type { Key } from "../i18n";
import { register } from "../registry";
import type { Ctx } from "../registry";
import { oneSession } from "./types";
import { everyActivity, kpi, kpiRow, note, table, weekLabel } from "./ui";

/** The extras of the Walk, Hike, Bike, Swim and Racket sports boards. */

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const day = (a: Activity) => String(a.start).slice(0, 10);
/** km/h over moving time. */
function speed(a: Activity): number | undefined {
  const h = seconds(a.duration) / 3600;
  return typeof a.km === "number" && h > 0 ? a.km / h : undefined;
}

const weekOf = (ctx: Ctx, a: Activity) =>
  ctx.weeks.findIndex((w) => day(a) >= w && day(a) <= addDays(w, 6));

register({
  id: "walkDetails",
  render(el, ctx) {
    const { t, fmt, calc } = ctx;
    if (oneSession(el, ctx)) return;
    const weekly = ctx.weeks.map((_, i) => ctx.activities.filter((a) => weekOf(ctx, a) === i));
    const pace = weekly.map((w) => {
      const d = calc.timedDistance(w);
      return d.km > 0 ? d.seconds / d.km : null;
    });
    const hr = weekly.map((w) =>
      calc.mean(w.map((a) => a.avgHR).filter((v): v is number => typeof v === "number")),
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
              borderColor: ctx.color(ctx.type === "hiking" ? "hiking" : "walking"),
              yAxisID: "y",
              spanGaps: true,
            },
            {
              label: t("col.hr"),
              data: hr,
              borderColor: ctx.color("bad"),
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
              title: { display: true, text: "bpm" },
            },
          },
          plugins: {
            tooltip: {
              callbacks: {
                label: (c) =>
                  c.datasetIndex === 0
                    ? `${c.dataset.label}: ${fmt.hms(c.parsed.y ?? 0)}/km`
                    : `${c.dataset.label}: ${fmt.num(c.parsed.y ?? undefined)} bpm`,
              },
            },
          },
        },
      },
      200,
    );
    append(
      el,
      table(
        [t("col.date"), t("col.name"), t("wd.steps"), t("form.cadence"), t("wd.battery")],
        ctx.activities.map((a) => [
          fmt.day(day(a)),
          a.name ?? "",
          fmt.num(num(a.steps)),
          fmt.num(num(a.cadenceSpm)),
          fmt.num(num(a.bodyBatteryDelta)),
        ]),
        [2, 3, 4],
      ),
    );
  },
});

register({
  id: "steps",
  render(el, ctx) {
    const { t } = ctx;
    const rows = ctx.data.recovery.slice(-14);
    if (rows.length === 0) return ctx.empty(el, ctx.fmt.na);
    const series = (f: string) => rows.map((r) => num(r[f]) ?? null);
    ctx.chart(el, {
      type: "bar",
      data: {
        labels: rows.map((r) => ctx.fmt.day(String(r.date))),
        datasets: [
          {
            type: "bar",
            label: t("wd.steps"),
            data: series("steps"),
            backgroundColor: ctx.color("walking"),
            yAxisID: "y",
          },
          {
            type: "line",
            label: t("wd.goal"),
            data: series("stepGoal"),
            borderColor: ctx.color("warn"),
            pointRadius: 0,
            yAxisID: "y",
            spanGaps: true,
          },
          {
            type: "line",
            label: t("wd.floors"),
            data: series("floors"),
            borderColor: ctx.color("hiking"),
            yAxisID: "y1",
            spanGaps: true,
          },
        ],
      },
      options: {
        scales: {
          y1: { position: "right", grid: { drawOnChartArea: false }, ticks: { precision: 0 } },
        },
      },
    });
    append(el, note(t("rec14")));
  },
});

register({
  id: "hikeVertical",
  render(el, ctx) {
    const { t, fmt, calc } = ctx;
    const list = ctx.activities.filter((a) => calc.verticalPerHour(a) !== undefined);
    if (list.length === 0) return ctx.empty(el);
    append(
      el,
      table(
        [t("col.date"), t("col.name"), t("col.distance"), t("col.ascent"), t("hv.vam")],
        list.map((a) => [
          fmt.day(day(a)),
          a.name ?? "",
          `${fmt.num(num(a.km), 1)} km`,
          `${fmt.num(num(a.ascentM))} m`,
          `${fmt.num(calc.verticalPerHour(a))} m/h`,
        ]),
        [2, 3, 4],
      ),
    );
  },
});

register({
  id: "bikeDetails",
  render(el, ctx) {
    const { t, fmt, calc } = ctx;
    const rides = ctx.activities;
    if (rides.length === 0) return ctx.empty(el);
    const indoor = rides.filter((a) => isIndoor(a.type ?? ""));
    const outdoorTime = rides
      .filter((a) => !isIndoor(a.type ?? ""))
      .reduce((s, a) => s + sessionSeconds(a), 0);
    const indoorTime = indoor.reduce((s, a) => s + sessionSeconds(a), 0);
    append(
      el,
      kpiRow(
        kpi(
          t("bd.outdoor"),
          fmt.hours(outdoorTime),
          t("bd.rides", { n: rides.length - indoor.length }),
        ),
        kpi(t("bd.indoor"), fmt.hours(indoorTime), t("bd.rides", { n: indoor.length })),
      ),
    );
    if (rides.length > 1) {
      const weekly = ctx.weeks.map((_, i) => rides.filter((a) => weekOf(ctx, a) === i));
      ctx.chart(
        el,
        {
          type: "bar",
          data: {
            labels: ctx.weeks.map((w) => weekLabel(ctx, w)),
            datasets: [
              {
                type: "line",
                label: t("tk.speed"),
                data: weekly.map((w) => {
                  const d = calc.timedDistance(w);
                  return d.seconds > 0 ? d.km / (d.seconds / 3600) : null;
                }),
                borderColor: ctx.color("cycling"),
                yAxisID: "y",
                spanGaps: true,
              },
              {
                type: "bar",
                label: t("lr.ascent"),
                data: weekly.map((w) => w.reduce((s, a) => s + (num(a.ascentM) ?? 0), 0)),
                backgroundColor: `${ctx.color("hiking")}88`,
                yAxisID: "y1",
              },
            ],
          },
          options: {
            scales: {
              y: { title: { display: true, text: "km/h" } },
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
    }
    append(
      el,
      table(
        [
          t("col.date"),
          t("col.name"),
          t("col.distance"),
          t("tk.speed"),
          t("col.ascent"),
          t("bd.where"),
        ],
        rides.map((a) => [
          fmt.day(day(a)),
          a.name ?? "",
          `${fmt.num(num(a.km), 1)} km`,
          `${fmt.num(speed(a), 1)} km/h`,
          `${fmt.num(num(a.ascentM))} m`,
          isIndoor(a.type ?? "") ? t("bd.indoor") : t("bd.outdoor"),
        ]),
        [2, 3, 4],
      ),
    );
  },
});

register({
  id: "swimDetails",
  render(el, ctx) {
    const { t, fmt, calc } = ctx;
    if (ctx.activities.length === 0) return ctx.empty(el);
    append(
      el,
      table(
        [
          t("col.date"),
          t("col.name"),
          t("col.distance"),
          t("sw.pace"),
          "SWOLF",
          t("sw.lengths"),
          t("sw.strokes"),
          t("sw.pool"),
        ],
        ctx.activities.map((a) => [
          fmt.day(day(a)),
          a.name ?? "",
          `${fmt.num(num(a.km), 2)} km`,
          `${fmt.hms(calc.swimPace(a))}/100 m`,
          fmt.num(num(a.swolf)),
          fmt.num(num(a.lengths)),
          fmt.num(num(a.strokes)),
          num(a.poolLengthM) === undefined ? fmt.na : `${fmt.num(num(a.poolLengthM))} m`,
        ]),
        [2, 3, 4, 5, 6, 7],
      ),
    );
  },
});

register({
  id: "racketDetails",
  render(el, ctx) {
    const { t, fmt, calc } = ctx;
    if (ctx.activities.length === 0) return ctx.empty(el);
    const floors = calc.zonesOf(ctx.data.zones).floors;
    const perMinute = calc.runLoadPerMinute(everyActivity(ctx));
    let approximate = false;
    const rows = ctx.activities.map((a) => {
      const z = calc.zoneSeconds(a, floors);
      approximate ||= !!z?.approximate;
      const runLoad = perMinute === null ? undefined : (perMinute * sessionSeconds(a)) / 60;
      const sport = sportOf(a.type ?? "");
      return [
        fmt.day(day(a)),
        a.name ?? "",
        sport ? t(`sport.${sport}` as Key) : (a.type ?? "").replaceAll("_", " "),
        fmt.hours(sessionSeconds(a)),
        fmt.num(num(a.avgHR)),
        fmt.num(num(a.maxHR)),
        z ? `${fmt.num((z.sec[2] + z.sec[3] + z.sec[4]) / 60)} min` : fmt.na,
        z ? `${fmt.num(calc.zoneShare(z.sec, [3, 4]) ?? undefined)}%` : fmt.na,
        fmt.num(num(a.calories) === undefined ? undefined : calc.perHour(num(a.calories)!, a)),
        fmt.num(num(a.aerobicTE), 1),
        `${fmt.num(num(a.trainingLoad))} / ${fmt.num(runLoad)}`,
      ];
    });
    append(
      el,
      table(
        [
          t("col.date"),
          t("col.name"),
          t("col.sport"),
          t("col.time"),
          t("col.hr"),
          t("pd.peak"),
          t("pd.z3"),
          t("pd.z45"),
          t("pd.kcal"),
          t("te.aerobic"),
          t("pd.load"),
        ],
        rows,
        [2, 3, 4, 5, 6, 7, 8, 9],
      ),
      note(t("pd.note")),
      approximate && note(t("zones.approximate")),
    );
  },
});
