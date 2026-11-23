import type { YearSummary } from "../../analytics/year";
import { append, h } from "../dom";
import { type Ctx, register } from "../registry";
import { kpi, kpiRow, note, rangeDays, sessionTable, table, typeName, withUnit } from "./ui";

/** The recap of the calendar year, from the data as the server gives it: the tiles only format it. */

const opt = (v: number | null) => v ?? undefined;
const hours = (ctx: Ctx, v: number | null) => withUnit(ctx, ctx.fmt.num(opt(v), 1), " h");

const load = (ctx: Ctx, v: number | null) => `${ctx.t("m.load")} ${ctx.fmt.num(opt(v))}`;

const period = (ctx: Ctx, p: { from: string; to: string }) => {
  const [from, to] = rangeDays(ctx.fmt, p.from, p.to);
  return ctx.t("period", { from, to });
};

/** "Jan 2026" from "2026-01". */
const monthName = (ctx: Ctx, month: string) =>
  new Intl.DateTimeFormat(ctx.lang, { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}-01T00:00:00Z`),
  );

/** The weekday names, Monday first. */
const weekdays = (ctx: Ctx) => {
  const name = new Intl.DateTimeFormat(ctx.lang, { weekday: "long", timeZone: "UTC" });
  return Array.from({ length: 7 }, (_, i) => name.format(Date.UTC(2026, 0, 5 + i)));
};

const parts = (...x: (string | false | undefined)[]) => x.filter(Boolean).join(" · ");

const known = (values: (number | null)[]) => values.filter((v) => v !== null).length;

/** The recap has no session to list: without a covered day that is missing data, not 0. */
function noSessions(el: HTMLElement, ctx: Ctx, y: YearSummary): boolean {
  const { activities } = y.totals;
  if (activities !== null && activities > 0) return false;
  ctx.empty(el, activities === null ? ctx.fmt.na : ctx.t("yr.noSessions"));
  return true;
}

/** A tile of the recap; a page without the recap says so. */
function yearTile(id: string, render: (el: HTMLElement, ctx: Ctx, y: YearSummary) => void): void {
  register({
    id,
    render(el, ctx) {
      const y = ctx.data.year;
      if (y) render(el, ctx, y);
      else ctx.empty(el, ctx.t("yr.none"));
    },
  });
}

yearTile("yearTotals", (el, ctx, y) => {
  const { t, fmt } = ctx;
  const { totals } = y;
  const { activities, complete } = y.coverage;
  const [from, to] = activities ? rangeDays(fmt, activities.from, activities.to) : [];
  append(
    el,
    kpiRow(
      kpi(t("pc.sessions"), fmt.num(opt(totals.activities))),
      kpi(t("yr.activeDays"), fmt.num(opt(totals.activeDays))),
      kpi(t("pc.distance"), fmt.dist(opt(totals.km))),
      kpi(t("pc.time"), hours(ctx, totals.hours)),
      kpi(t("col.ascent"), fmt.elev(opt(totals.ascentM))),
      kpi(t("yr.calories"), withUnit(ctx, fmt.num(opt(totals.calories)), " kcal")),
      kpi(
        t("pc.load"),
        fmt.num(opt(totals.load)),
        totals.estimatedLoads !== null &&
          totals.estimatedLoads > 0 &&
          t("yr.estimates", { n: totals.estimatedLoads }),
      ),
    ),
    !complete &&
      note(from && to ? t("yr.covered", { from, to }) : t("yr.noDays", { year: y.year })),
    totals.unlikelyTimes !== null &&
      totals.unlikelyTimes > 0 &&
      note(t("yr.unlikely", { n: totals.unlikelyTimes })),
  );
});

yearTile("yearMonths", (el, ctx, y) => {
  const { t, fmt } = ctx;
  const byLoad = y.measure === "load";
  const values = y.months.map((m) => (byLoad ? m.load : m.hours));
  if (known(values) > 1) {
    ctx.chart(el, {
      type: "bar",
      data: {
        labels: y.months.map((m) => monthName(ctx, m.month)),
        datasets: [
          {
            label: t(byLoad ? "m.load" : "m.time"),
            data: values,
            backgroundColor: ctx.color("accent"),
          },
        ],
      },
      options: byLoad ? {} : { scales: { y: { title: { display: true, text: "h" } } } },
    });
  }
  append(
    el,
    table(
      [
        t("yr.month"),
        t("pc.sessions"),
        t("yr.activeDays"),
        t("pc.distance"),
        t("pc.time"),
        t("pc.load"),
      ],
      y.months.map((m) => [
        monthName(ctx, m.month) +
          (m.covered === "part" ? ` · ${t("yr.partDays", { n: m.days })}` : ""),
        fmt.num(opt(m.sessions)),
        fmt.num(opt(m.activeDays)),
        fmt.dist(opt(m.km)),
        hours(ctx, m.hours),
        fmt.num(opt(m.load)),
      ]),
      [1, 2, 3, 4, 5],
    ),
  );
});

yearTile("yearSports", (el, ctx, y) => {
  const { t, fmt } = ctx;
  if (noSessions(el, ctx, y)) return;
  append(
    el,
    y.topSport !== null &&
      h("p", { class: "totals" }, t("yr.topSport", { sport: typeName(t, y.topSport) })),
    table(
      [t("col.sport"), t("pc.sessions"), t("pc.distance"), t("pc.time"), t("pc.load")],
      y.sports.map((s) => [
        typeName(t, s.sport),
        fmt.num(s.sessions),
        fmt.dist(opt(s.km)),
        hours(ctx, s.hours),
        fmt.num(opt(s.load)),
      ]),
      [1, 2, 3, 4],
    ),
  );
});

const BANDS = [
  ["night", "22:00-4:59"],
  ["morning", "5:00-11:59"],
  ["afternoon", "12:00-17:59"],
  ["evening", "18:00-21:59"],
] as const;

yearTile("yearRhythm", (el, ctx, y) => {
  const { t, fmt } = ctx;
  if (noSessions(el, ctx, y)) return;
  const { weekdays: days, topWeekday, timeOfDay, topTimeOfDay } = y.rhythm;
  const names = weekdays(ctx);
  const top = BANDS.find(([part]) => part === topTimeOfDay);
  append(
    el,
    kpiRow(
      kpi(t("yr.weekday"), topWeekday === null ? fmt.na : names[topWeekday]),
      kpi(t("yr.timeOfDay"), top ? t(`yr.${top[0]}`) : fmt.na, top?.[1]),
    ),
    table(
      [t("yr.weekday"), t("pc.sessions")],
      names.map((name, i) => [name, fmt.num(days[i])]),
      [1],
    ),
    table(
      [t("yr.timeOfDay"), t("pc.sessions")],
      BANDS.map(([part, band]) => [`${t(`yr.${part}`)} (${band})`, fmt.num(timeOfDay[part])]),
      [1],
    ),
  );
});

yearTile("yearHighlights", (el, ctx, y) => {
  const { t, fmt } = ctx;
  const { biggestMonth, biggestWeek, bestBlock, mostConsistentMonth, longest, biggest } = y;
  const byLoad = y.measure === "load";
  const volume = (v: { km: number | null; hours: number | null; load: number | null }) =>
    parts(fmt.dist(opt(v.km)), hours(ctx, v.hours), load(ctx, v.load));
  const session = (s: { date: string; name?: string }) => parts(fmt.longDay(s.date), s.name);
  append(
    el,
    kpiRow(
      kpi(
        t("yr.bigMonth"),
        biggestMonth ? monthName(ctx, biggestMonth.month) : fmt.na,
        biggestMonth !== null && volume(biggestMonth),
      ),
      kpi(
        t("yr.bigWeek"),
        biggestWeek ? t("ready.from", { day: fmt.longDay(biggestWeek.monday) }) : fmt.na,
        biggestWeek !== null && volume(biggestWeek),
      ),
      kpi(
        t("yr.block"),
        bestBlock ? period(ctx, bestBlock) : fmt.na,
        bestBlock !== null &&
          parts(
            byLoad ? load(ctx, bestBlock.value) : hours(ctx, bestBlock.value),
            t("yr.sessions", { n: bestBlock.sessions }),
          ),
      ),
      kpi(
        t("yr.consistent"),
        mostConsistentMonth ? monthName(ctx, mostConsistentMonth.month) : fmt.na,
        mostConsistentMonth !== null &&
          t("yr.daysOf", {
            n: mostConsistentMonth.activeDays,
            days: mostConsistentMonth.days,
            pct: mostConsistentMonth.sharePct,
          }),
      ),
      kpi(
        t("yr.longest"),
        hours(ctx, longest && longest.hours),
        longest !== null && parts(typeName(t, longest.sport), fmt.dist(opt(longest.km))),
        longest !== null && session(longest),
      ),
      kpi(
        t("yr.biggest"),
        fmt.num(biggest?.load),
        biggest !== null && parts(typeName(t, biggest.sport), biggest.estimate && t("yr.estimate")),
        biggest !== null && session(biggest),
      ),
    ),
    note(t(byLoad ? "yr.byLoad" : "yr.byTime")),
  );
});

yearTile("yearStreaks", (el, ctx, y) => {
  const { t, fmt } = ctx;
  const { days, weeks } = y.streaks;
  append(
    el,
    kpiRow(
      kpi(
        t("yr.dayStreak"),
        days ? t("yr.days", { n: days.length }) : fmt.na,
        days !== null && period(ctx, days),
      ),
      kpi(
        t("yr.weekStreak"),
        weeks ? t("yr.weeks", { n: weeks.length }) : fmt.na,
        weeks !== null && period(ctx, weeks),
      ),
    ),
    note(t("yr.streakNote")),
  );
});

const DISTANCES = ["1k", "mile", "5k", "10k", "half", "marathon"] as const;

yearTile("yearRecords", (el, ctx, y) => {
  const { t, fmt } = ctx;
  const rows = DISTANCES.flatMap((d) =>
    (y.records[d] ?? []).map((r) => [
      t(`d.${d}`),
      parts(fmt.longDay(r.date), r.name),
      r.time,
      r.previous ?? fmt.na,
    ]),
  );
  if (rows.length === 0) {
    return ctx.empty(el, y.coverage.activities ? t("yr.noRecords") : fmt.na);
  }
  append(
    el,
    ...sessionTable(
      ctx,
      [t("be.distance"), t("be.activity"), t("col.time"), t("yr.before")],
      rows,
      [2, 3],
    ),
    note(t("yr.recordsNote")),
  );
});

yearTile("yearRecovery", (el, ctx, y) => {
  const { t, fmt } = ctx;
  if (!y.hrv && !y.rhr) return ctx.empty(el, t("yr.noRecovery"));
  const rows = y.months
    .map(({ month }) => ({
      month: monthName(ctx, month),
      hrv: y.hrv?.find((x) => x.month === month),
      rhr: y.rhr?.find((x) => x.month === month),
    }))
    .filter((r) => r.hrv || r.rhr);
  const hrv = rows.map((r) => r.hrv?.mean ?? null);
  const rhr = rows.map((r) => r.rhr?.mean ?? null);
  const line = (label: string, data: (number | null)[], color: string, yAxisID: string) => ({
    label,
    data,
    borderColor: ctx.color(color),
    pointRadius: 3,
    spanGaps: true,
    yAxisID,
  });
  // one mean is no line: its row says it
  const left = known(hrv) > 1;
  const right = known(rhr) > 1;
  if (left || right) {
    ctx.chart(el, {
      type: "line",
      data: {
        labels: rows.map((r) => r.month),
        datasets: [
          ...(left ? [line(t("hrv.nightly"), hrv, "accent", "y")] : []),
          ...(right ? [line(t("w.restingHr"), rhr, "bad", "y1")] : []),
        ],
      },
      options: {
        scales: {
          y: { display: left, title: { display: true, text: "ms" } },
          y1: {
            display: right,
            position: "right",
            grid: { drawOnChartArea: false },
            title: { display: true, text: "bpm" },
          },
        },
      },
    });
  }
  append(
    el,
    table(
      [t("yr.month"), t("hrv.nightly"), t("yr.nights"), t("w.restingHr"), t("yr.dayCount")],
      rows.map((r) => [
        r.month,
        fmt.num(r.hrv?.mean ?? undefined),
        fmt.num(r.hrv?.nights),
        fmt.num(r.rhr?.mean ?? undefined),
        fmt.num(r.rhr?.days),
      ]),
      [1, 2, 3, 4],
    ),
    note(t("yr.meanNote")),
  );
});
