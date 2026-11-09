import { addDays } from "../../dates";
import { type Activity, isIndoor, seconds, sessionSeconds, sportOf } from "../../analytics/calc";
import { append, h } from "../dom";
import type { Key } from "../i18n";
import { register } from "../registry";
import type { Ctx } from "../registry";
import { oneSession } from "./types";
import { delta, everyActivity, kpi, kpiRow, note, sessionTable, weekLabel, withUnit } from "./ui";

/** The extras of the Walk, Hike, Bike, Swim and Racket sports boards. */

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const day = (a: Activity) => String(a.start).slice(0, 10);
/** km/h over moving time. */
function speed(a: Activity): number | undefined {
  const hours = seconds(a.duration) / 3600;
  return typeof a.km === "number" && hours > 0 ? a.km / hours : undefined;
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
      return d.km > 0 ? fmt.to.pace(d.seconds / d.km) : null;
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
              title: { display: true, text: t("af.pace", { unit: fmt.unit.pace }) },
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
                    ? `${c.dataset.label}: ${fmt.hms(c.parsed.y ?? 0)}${fmt.unit.pace}`
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
      ...sessionTable(
        ctx,
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
      ...sessionTable(
        ctx,
        [
          t("col.date"),
          t("col.name"),
          t("col.distance"),
          t("col.ascent"),
          t("hv.vam", { unit: fmt.unit.elev }),
        ],
        list.map((a) => [
          fmt.day(day(a)),
          a.name ?? "",
          fmt.dist(num(a.km)),
          fmt.elev(num(a.ascentM)),
          withUnit(ctx, fmt.elev(calc.verticalPerHour(a)), "/h"),
        ]),
        [2, 3, 4],
      ),
      note(t("hv.note")),
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
                  return d.seconds > 0 ? fmt.to.speed(d.km / (d.seconds / 3600)) : null;
                }),
                borderColor: ctx.color("cycling"),
                yAxisID: "y",
                spanGaps: true,
              },
              {
                type: "bar",
                label: t("lr.ascent"),
                // a week without ascent data is a gap, not flat riding
                data: weekly.map((w) => {
                  const m = w
                    .map((a) => num(a.ascentM))
                    .filter((v): v is number => v !== undefined);
                  return m.length > 0 ? fmt.to.elev(m.reduce((s, v) => s + v, 0)) : null;
                }),
                backgroundColor: `${ctx.color("hiking")}88`,
                yAxisID: "y1",
              },
            ],
          },
          options: {
            scales: {
              y: { title: { display: true, text: fmt.unit.speed } },
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
    }
    // mountain-bike dynamics (grit, flow): only on a board that has them
    const trails = rides
      .filter((a) => num(a.grit) !== undefined || num(a.flow) !== undefined)
      .toSorted((a, b) => String(a.start).localeCompare(String(b.start)));
    if (trails.length > 1) {
      ctx.chart(
        el,
        {
          type: "line",
          data: {
            labels: trails.map((a) => fmt.day(day(a))),
            datasets: [
              {
                label: t("bd.flow"),
                data: trails.map((a) => num(a.flow) ?? null),
                borderColor: ctx.color("cycling"),
                yAxisID: "y",
                spanGaps: true,
              },
              {
                label: t("bd.grit"),
                data: trails.map((a) => num(a.grit) ?? null),
                borderColor: ctx.color("hiking"),
                borderDash: [6, 4], // not told apart by colour alone
                yAxisID: "y1",
                spanGaps: true,
              },
            ],
          },
          options: {
            scales: {
              y: { title: { display: true, text: t("bd.flow") } },
              y1: {
                position: "right",
                grid: { drawOnChartArea: false },
                title: { display: true, text: t("bd.grit") },
              },
            },
          },
        },
        180,
      );
    }
    const dynamics = trails.length > 0;
    append(
      el,
      ...sessionTable(
        ctx,
        [
          t("col.date"),
          t("col.name"),
          t("col.distance"),
          t("tk.speed"),
          t("col.ascent"),
          t("bd.where"),
          ...(dynamics ? [t("bd.grit"), t("bd.flow")] : []),
        ],
        rides.map((a) => [
          fmt.day(day(a)),
          a.name ?? "",
          fmt.dist(num(a.km)),
          fmt.speed(speed(a)),
          fmt.elev(num(a.ascentM)),
          isIndoor(a.type ?? "") ? t("bd.indoor") : t("bd.outdoor"),
          ...(dynamics ? [fmt.num(num(a.grit), 1), fmt.num(num(a.flow), 1)] : []),
        ]),
        dynamics ? [2, 3, 4, 6, 7] : [2, 3, 4],
      ),
      dynamics && note(t("bd.trailNote")),
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
      ...sessionTable(
        ctx,
        [
          t("col.date"),
          t("col.name"),
          t("col.distance"),
          t("sw.pace"),
          "SWOLF",
          t("sw.lengths"),
          t("sw.strokes"),
          t("sw.perLength"),
          t("sw.perStroke"),
          t("sw.pool"),
        ],
        ctx.activities.map((a) => [
          fmt.day(day(a)),
          a.name ?? "",
          fmt.dist(num(a.km), 2),
          fmt.swimPace(calc.swimPace(a)),
          fmt.num(num(a.swolf)),
          fmt.num(num(a.lengths)),
          fmt.num(num(a.strokes)),
          fmt.num(calc.strokesPerLength(a), 1),
          fmt.elev(calc.distancePerStroke(a), 2),
          withUnit(ctx, fmt.num(num(a.poolLengthM)), " m"),
        ]),
        [2, 3, 4, 5, 6, 7, 8, 9],
      ),
      note(t("sw.note")),
    );
  },
});

register({
  id: "swimTrend",
  render(el, ctx) {
    const { t, fmt, calc } = ctx;
    const trend = calc.swimTrend(ctx.activities);
    if (!trend) return ctx.empty(el, t("st.none"));
    const { sessions, window: w } = trend;
    const last = sessions.at(-1)!;
    const versus = (now: number, before: number) =>
      h(
        "span",
        {},
        delta(ctx, calc.change(now, before), "down"),
        " ",
        t("st.vsBefore", { n: fmt.num(w?.swims) }),
      );
    append(
      el,
      kpiRow(
        kpi(
          t("sw.pace"),
          fmt.swimPace(w ? w.pace.recent : last.pace),
          w ? versus(w.pace.recent, w.pace.before) : undefined,
        ),
        kpi(
          t("sw.perLength"),
          fmt.num(w ? w.strokes.recent : last.strokes, 1),
          w ? versus(w.strokes.recent, w.strokes.before) : undefined,
        ),
      ),
    );
    if (sessions.length > 1) {
      ctx.chart(
        el,
        {
          type: "line",
          data: {
            labels: sessions.map((s) => fmt.day(s.date)),
            datasets: [
              {
                label: t("sw.pace"),
                data: sessions.map((s) => fmt.to.swim(s.pace)),
                borderColor: ctx.color("swimming"),
                yAxisID: "y",
              },
              {
                label: t("sw.perLength"),
                data: sessions.map((s) => s.strokes),
                borderColor: ctx.color("warn"),
                yAxisID: "y1",
              },
            ],
          },
          options: {
            scales: {
              y: {
                // a faster pace is a smaller number: up is better on both axes
                reverse: true,
                title: { display: true, text: t("af.pace", { unit: fmt.unit.swim }) },
                ticks: { callback: (v: string | number) => fmt.hms(Number(v)) },
              },
              y1: {
                reverse: true,
                position: "right",
                grid: { drawOnChartArea: false },
                title: { display: true, text: t("sw.perLength") },
              },
            },
          },
        },
        200,
      );
    }
    append(
      el,
      note(
        t("st.note", {
          pool: withUnit(ctx, fmt.num(trend.poolLengthM), " m"),
          n: fmt.num(sessions.length),
          from: fmt.day(sessions[0].date),
        }),
      ),
      trend.left > 0 && note(t("st.left", { n: fmt.num(trend.left) })),
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
      // all zeros: no zone time was measured, which is not 0 minutes
      const zone = z?.sec.some((s) => s > 0) ? z : undefined;
      const runLoad = perMinute === null ? undefined : (perMinute * sessionSeconds(a)) / 60;
      const sport = sportOf(a.type ?? "");
      return [
        fmt.day(day(a)),
        a.name ?? "",
        sport ? t(`sport.${sport}` as Key) : (a.type ?? "").replaceAll("_", " "),
        fmt.hours(sessionSeconds(a)),
        fmt.num(num(a.avgHR)),
        fmt.num(num(a.maxHR)),
        zone ? `${fmt.num((zone.sec[2] + zone.sec[3] + zone.sec[4]) / 60)} min` : fmt.na,
        zone ? withUnit(ctx, fmt.num(calc.zoneShare(zone.sec, [3, 4]) ?? undefined), "%") : fmt.na,
        fmt.num(num(a.calories) === undefined ? undefined : calc.perHour(num(a.calories)!, a)),
        fmt.num(num(a.aerobicTE), 1),
        `${fmt.num(num(a.trainingLoad))} / ${fmt.num(runLoad)}`,
      ];
    });
    append(
      el,
      ...sessionTable(
        ctx,
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
        [3, 4, 5, 6, 7, 8, 9, 10],
      ),
      note(t("pd.note")),
      approximate && note(t("zones.approximate")),
    );
  },
});
