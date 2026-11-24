import type { YearSummary } from "../../analytics/year";
import { append, h } from "../dom";
import { type Ctx, register } from "../registry";
import { alpha, kpi, kpiRow, note, rangeDays, sessionTable, table, typeName, withUnit } from "./ui";

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
const weekdays = (ctx: Ctx, weekday: "long" | "short") => {
  const name = new Intl.DateTimeFormat(ctx.lang, { weekday, timeZone: "UTC" });
  return Array.from({ length: 7 }, (_, i) => name.format(Date.UTC(2026, 0, 5 + i)));
};

const parts = (...x: (string | false | undefined)[]) => x.filter(Boolean).join(" · ");

const known = (values: (number | null)[]) => values.filter((v) => v !== null).length;

/** The numbers of a chart, folded under it; with no chart they are in view. */
const numbers = (ctx: Ctx, charted: boolean, ...content: (HTMLElement | false)[]) =>
  charted
    ? [h("details", { class: "more-details" }, h("summary", {}, ctx.t("yr.numbers")), ...content)]
    : content;

/** The row of the small charts of a tile. */
const multiples = (el: HTMLElement) => {
  const grid = h("div", { class: "multiples fit" });
  el.append(grid);
  return grid;
};

/** The place of a small chart, under its title. */
const multiple = (grid: HTMLElement, title: string) => {
  const cell = h("div", { class: "multiple" }, h("h3", {}, title));
  grid.append(cell);
  return cell;
};

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
  const charted = known(values) > 1;
  const name = (m: YearSummary["months"][number]) => monthName(ctx, m.month);
  const days = (m: YearSummary["months"][number]) => t("yr.partDays", { n: m.days });
  if (charted) {
    ctx.chart(el, {
      type: "bar",
      data: {
        labels: y.months.map(name),
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
  // a low bar or no bar can be a month with days missing: the folded rows cannot say it
  const missing = y.months.filter((m) => m.covered !== "all");
  append(
    el,
    charted && missing.length > 0 && note(missing.map((m) => parts(name(m), days(m))).join("; ")),
    ...numbers(
      ctx,
      charted,
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
          parts(name(m), m.covered === "part" && days(m)),
          fmt.num(opt(m.sessions)),
          fmt.num(opt(m.activeDays)),
          fmt.dist(opt(m.km)),
          hours(ctx, m.hours),
          fmt.num(opt(m.load)),
        ]),
        [1, 2, 3, 4, 5],
      ),
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
  );
  const { sports } = y;
  const charted = known(sports.map((s) => s.hours)) > 1;
  if (charted) {
    ctx.chart(
      el,
      {
        type: "bar",
        data: {
          labels: sports.map((s) => typeName(t, s.sport)),
          datasets: [
            {
              label: t("m.time"),
              data: sports.map((s) => s.hours),
              backgroundColor: sports.map((s) => ctx.color(s.sport)),
              maxBarThickness: 18,
            },
          ],
        },
        options: {
          indexAxis: "y",
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (c) => {
                  const s = sports[c.dataIndex];
                  return parts(hours(ctx, s.hours), t("yr.sessions", { n: s.sessions }));
                },
              },
            },
          },
          scales: { x: { title: { display: true, text: "h" } } },
        },
      },
      Math.max(160, sports.length * 30),
    );
  }
  append(
    el,
    ...numbers(
      ctx,
      charted,
      table(
        [t("col.sport"), t("pc.sessions"), t("pc.distance"), t("pc.time"), t("pc.load")],
        sports.map((s) => [
          typeName(t, s.sport),
          fmt.num(s.sessions),
          fmt.dist(opt(s.km)),
          hours(ctx, s.hours),
          fmt.num(opt(s.load)),
        ]),
        [1, 2, 3, 4],
      ),
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
  const names = weekdays(ctx, "long");
  const bands = BANDS.map(([part, band]) => `${t(`yr.${part}`)} (${band})`);
  const top = BANDS.find(([part]) => part === topTimeOfDay);
  append(
    el,
    kpiRow(
      kpi(t("yr.weekday"), topWeekday === null ? fmt.na : names[topWeekday]),
      kpi(t("yr.timeOfDay"), top ? t(`yr.${top[0]}`) : fmt.na, top?.[1]),
    ),
  );
  const grid = multiples(el);
  const bars = (
    title: string,
    labels: string[],
    full: string[],
    counts: readonly number[],
    best: number | null,
  ) =>
    ctx.chart(
      multiple(grid, title),
      {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              label: t("pc.sessions"),
              data: [...counts],
              backgroundColor: counts.map((_, i) =>
                i === best ? ctx.color("accent") : alpha(ctx.color("muted"), 0.6),
              ),
              maxBarThickness: 28,
            },
          ],
        },
        options: {
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { title: ([c]) => full[c.dataIndex] } },
          },
          scales: { y: { ticks: { precision: 0, maxTicksLimit: 5 } } },
        },
      },
      150,
    );
  bars(t("yr.weekday"), weekdays(ctx, "short"), names, days, topWeekday);
  const times = BANDS.map(([part]) => timeOfDay[part]);
  // no session has a time of day: no chart of zeros
  if (top) {
    const labels = BANDS.map(([part]) => t(`yr.${part}`));
    bars(t("yr.timeOfDay"), labels, bands, times, BANDS.indexOf(top));
  }
  append(
    el,
    ...numbers(
      ctx,
      true,
      table(
        [t("yr.weekday"), t("pc.sessions")],
        names.map((name, i) => [name, fmt.num(days[i])]),
        [1],
      ),
      table(
        [t("yr.timeOfDay"), t("pc.sessions")],
        bands.map((band, i) => [band, fmt.num(times[i])]),
        [1],
      ),
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

const DAY_MS = 86_400_000;

/** A date as a number, so that a chart places it at its true distance from the others. */
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const dayOf = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

const DISTANCES = ["1k", "mile", "5k", "10k", "half", "marathon"] as const;

yearTile("yearRecords", (el, ctx, y) => {
  const { t, fmt } = ctx;
  const run = (r: { date: string; name?: string }) => parts(fmt.longDay(r.date), r.name);
  const lists = DISTANCES.map((d) => ({ title: t(`d.${d}`), list: y.records[d] ?? [] }));
  const rows = lists.flatMap(({ title, list }) =>
    list.map((r) => [title, run(r), r.time, r.previous ?? fmt.na]),
  );
  if (rows.length === 0) {
    return ctx.empty(el, y.coverage.activities ? t("yr.noRecords") : fmt.na);
  }
  const several = lists.filter(({ list }) => list.length > 1);
  const charted = several.length > 0;
  if (charted) {
    const grid = multiples(el);
    for (const { title, list } of several) {
      ctx.chart(
        multiple(grid, parts(title, list.at(-1)?.time)),
        {
          type: "line",
          data: {
            datasets: [
              {
                label: t("col.time"),
                data: list.map((r) => ({ x: dayNumber(r.date), y: ctx.calc.seconds(r.time) })),
                borderColor: ctx.color("running"),
                // a record stands until the next one
                stepped: true,
                pointRadius: 3,
              },
            ],
          },
          options: {
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  title: ([c]) => run(list[c.dataIndex]),
                  label: (c) => list[c.dataIndex].time,
                },
              },
            },
            scales: {
              x: {
                type: "linear",
                min: dayNumber(y.from),
                max: dayNumber(y.to),
                afterBuildTicks: (axis) => {
                  axis.ticks = y.months.map(({ month }) => ({ value: dayNumber(`${month}-01`) }));
                },
                ticks: { callback: (v) => fmt.day(dayOf(Number(v))), maxRotation: 0 },
              },
              y: {
                reverse: true,
                ticks: { callback: (v) => fmt.hms(Number(v)), maxTicksLimit: 5 },
              },
            },
          },
        },
        150,
      );
    }
    // one record is no line: a number
    const single = lists.filter(({ list }) => list.length === 1);
    append(
      el,
      single.length > 0 &&
        kpiRow(...single.map(({ title, list }) => kpi(title, list[0].time, run(list[0])))),
    );
  }
  append(
    el,
    ...numbers(
      ctx,
      charted,
      ...sessionTable(
        ctx,
        [t("be.distance"), t("be.activity"), t("col.time"), t("yr.before")],
        rows,
        [2, 3],
      ),
      note(t("yr.recordsNote")),
    ),
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
  const measures = [
    {
      label: t("hrv.nightly"),
      unit: "ms",
      color: "accent",
      data: rows.map((r) => r.hrv?.mean ?? null),
    },
    {
      label: t("w.restingHr"),
      unit: "bpm",
      color: "bad",
      data: rows.map((r) => r.rhr?.mean ?? null),
    },
  ];
  // one mean is no line: its row says it, so the rows stay in view
  const lines = measures.filter((m) => known(m.data) > 1);
  const charted = lines.length > 0 && measures.every((m) => known(m.data) !== 1);
  if (lines.length > 0) {
    const grid = multiples(el);
    for (const { label, unit, color, data } of lines) {
      ctx.chart(
        multiple(grid, `${label} (${unit})`),
        {
          type: "line",
          data: {
            labels: rows.map((r) => r.month),
            datasets: [
              { label, data, borderColor: ctx.color(color), pointRadius: 3, spanGaps: true },
            ],
          },
          options: { plugins: { legend: { display: false } } },
        },
        180,
      );
    }
  }
  append(
    el,
    ...numbers(
      ctx,
      charted,
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
    ),
    note(t("yr.meanNote")),
  );
});
