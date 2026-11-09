import { addDays } from "../../dates";
import { type Activity, groupOf, groupsIn } from "../../analytics/calc";
import { append, h } from "../dom";
import type { Key } from "../i18n";
import { register } from "../registry";
import {
  between,
  delta,
  everyActivity,
  garminWord,
  kpi,
  kpiRow,
  maxHR,
  note,
  showAll,
  vsFourWeeks,
  table,
  loadText,
  totals,
  typeName,
  windowEnd,
} from "./ui";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const last = <T>(list: T[]) => list.at(-1);
const of = (acts: Activity[], g: string) => acts.filter((a) => groupOf(a) === g);

register({
  id: "kpis",
  render(el, ctx) {
    const { t, fmt, calc } = ctx;
    const sum = totals(ctx, ctx.activities);
    const end = windowEnd(ctx);
    const every = ctx.ofType(everyActivity(ctx));
    const week = totals(ctx, between(every, addDays(end, -6), end));
    // the 4 weeks before the last 7 days, from all embedded data
    const base = totals(ctx, between(every, addDays(end, -34), addDays(end, -7)));
    const ratio = calc.loadRatio(everyActivity(ctx), end, maxHR(ctx), ctx.data.prevStart).ratio;
    const hrv = last(ctx.data.hrv.filter((r) => String(r.date) <= end));
    const hrvNow = num(hrv?.hrv);
    const hrvBase = num(hrv?.weeklyAvg);
    const filtered = ctx.type !== "all";
    append(
      el,
      h(
        "p",
        { class: "totals" },
        t("kpi.totals", {
          distance: fmt.dist(sum.km),
          // a language added before units keeps "{km} km": give it the metric number
          km: fmt.num(sum.km, 1),
          time: fmt.hours(sum.seconds),
          n: sum.sessions,
        }),
      ),
      kpiRow(
        kpi(
          t("kpi.distance"),
          fmt.dist(week.km),
          vsFourWeeks(ctx, week.km, base.km, end, "kpi.vs4w"),
        ),
        kpi(
          t("kpi.time"),
          fmt.hours(week.seconds),
          vsFourWeeks(ctx, week.seconds, base.seconds, end, "kpi.vs4w"),
        ),
        kpi(
          t("kpi.ratio"),
          ratio === null ? fmt.na : fmt.num(ratio, 2),
          h(
            "span",
            { class: ratio !== null && (ratio < 0.8 || ratio > 1.3) ? "warn" : "good" },
            t("kpi.band"),
          ),
          filtered && t("kpi.ratioAll"),
        ),
        kpi(
          t("kpi.hrv"),
          hrvNow === undefined ? fmt.na : `${fmt.num(hrvNow)} ms`,
          hrvNow !== undefined &&
            hrvBase !== undefined &&
            h(
              "span",
              {},
              delta(ctx, calc.change(hrvNow, hrvBase), "up"),
              " ",
              t("kpi.vsBaseline", { v: fmt.num(hrvBase) }),
            ),
        ),
      ),
    );
  },
});

register({
  id: "readiness",
  render(el, ctx) {
    const { t, fmt, calc, data } = ctx;
    const ratio = calc.loadRatio(everyActivity(ctx), data.end, maxHR(ctx), data.prevStart).ratio;
    const inputs = calc.readinessOf(data.hrv, data.recovery, ratio);
    const { verdict, rhrAvg } = inputs;
    // a row of an older night: the verdict uses it, so say so
    const from = (value: unknown, date: string | undefined) =>
      value !== undefined &&
      date !== undefined &&
      date !== data.end &&
      t("ready.from", { day: fmt.day(date) });
    append(
      el,
      h(
        "p",
        { class: `verdict verdict-${verdict ?? "none"}` },
        verdict ? t(`ready.${verdict}` as Key) : fmt.na,
      ),
      kpiRow(
        kpi(
          t("ready.hrv"),
          inputs.hrvStatus === undefined ? fmt.na : garminWord(ctx, "hrvStatus", inputs.hrvStatus),
          from(inputs.hrvStatus, inputs.hrvDate),
        ),
        kpi(
          t("ready.sleep"),
          fmt.num(inputs.sleepScore),
          from(inputs.sleepScore, inputs.recoveryDate),
        ),
        kpi(
          t("ready.rhr"),
          inputs.rhr === undefined ? fmt.na : `${fmt.num(inputs.rhr)} bpm`,
          rhrAvg !== undefined && t("ready.rhrVs", { avg: fmt.num(rhrAvg, 1) }),
          from(inputs.rhr, inputs.recoveryDate),
        ),
        kpi(t("ready.ratio"), ratio === null ? fmt.na : fmt.num(ratio, 2)),
      ),
      note(t("ready.note")),
    );
  },
});

register({
  id: "fitnessAge",
  render(el, ctx) {
    const { t, fmt } = ctx;
    const fa = ctx.data.fitnessAge;
    if (!fa || num(fa.fitnessAge) === undefined) {
      ctx.empty(el, fmt.na);
      return;
    }
    const components = Object.entries(
      (fa.components ?? {}) as Record<string, Record<string, unknown>>,
    );
    const known = new Set(["bodyFat", "bmi", "rhr", "vigorousDaysAvg", "vigorousMinutesAvg"]);
    append(
      el,
      kpiRow(
        kpi(t("fa.age"), fmt.num(num(fa.fitnessAge), 1)),
        kpi(t("fa.actual"), fmt.num(num(fa.chronologicalAge))),
        kpi(t("fa.achievable"), fmt.num(num(fa.achievableFitnessAge), 1)),
      ),
      components.length > 0 &&
        h(
          "details",
          { class: "more-details" },
          h("summary", {}, t("fa.details")),
          table(
            [t("fa.component"), t("fa.value"), t("fa.target"), t("fa.potential")],
            components.map(([name, c]) => [
              known.has(name) ? t(`fa.${name}` as Key) : name,
              fmt.num(num(c.value), 1),
              fmt.num(num(c.targetValue), 1),
              fmt.num(num(c.potentialAge), 1),
            ]),
            [1, 2, 3],
          ),
        ),
      note(t("today.note")),
    );
  },
});

register({
  id: "periodComparison",
  render(el, ctx) {
    const { t, fmt, calc } = ctx;
    const end = windowEnd(ctx);
    const prev = calc.periodWindow(ctx.from, end, ctx.data.prevStart);
    const now = ctx.activities;
    const before = ctx.ofType(between(everyActivity(ctx), prev.from, prev.to));
    const groups = groupsIn([...now, ...before]);
    const row = (label: Node | string, a: Activity[], b: Activity[]) => {
      const x = totals(ctx, a);
      const y = totals(ctx, b);
      const cell = (v: string, d: number | null) => h("span", {}, v, " ", delta(ctx, d));
      return [
        label,
        cell(fmt.num(x.sessions), calc.change(x.sessions, y.sessions)),
        x.km > 0 || y.km > 0 ? cell(fmt.dist(x.km), calc.change(x.km, y.km)) : "",
        cell(fmt.hours(x.seconds), calc.change(x.seconds, y.seconds)),
        cell(loadText(ctx, x), x.loadKnown && y.loadKnown ? calc.change(x.load, y.load) : null),
      ];
    };
    append(
      el,
      h(
        "p",
        { class: "muted small" },
        t("pc.vs", {
          from: fmt.day(ctx.from),
          to: fmt.day(end),
          pfrom: fmt.day(prev.from),
          pto: fmt.day(prev.to),
        }),
        prev.partial && ` (${t("pc.partial")})`,
      ),
      table(
        [t("pc.type"), t("pc.sessions"), t("pc.distance"), t("pc.time"), t("pc.load")],
        [
          ...groups.map((g) => row(typeName(t, g), of(now, g), of(before, g))),
          ...(groups.length > 1 ? [row(h("strong", {}, t("pc.total")), now, before)] : []),
        ],
        [1, 2, 3, 4],
      ),
    );
  },
});

/** The records shown before "Show all". */
const RECORDS = 4;
/** Where the longest session of these sports goes in the first records. */
const FIRST_SESSIONS = new Map([
  ["running", 1],
  ["cycling", 2],
  ["swimming", 4],
]);
const longestBy = (rows: Activity[], size: (a: Activity) => number) =>
  rows.filter((a) => size(a) > 0).toSorted((x, y) => size(y) - size(x))[0];

register({
  id: "records",
  render(el, ctx) {
    const { t, fmt, calc } = ctx;
    const badges: HTMLElement[] = [];
    // the first ones shown: the longest best effort, the longest run and ride, the top 1RM, the longest swim
    const top: (HTMLElement | undefined)[] = [];
    const badge = (label: string, value: string, a: Activity) =>
      h(
        "div",
        { class: "badge" },
        h("div", { class: "kpi-label" }, label),
        h("div", { class: "badge-value" }, value),
        h(
          "div",
          { class: "muted small" },
          `${fmt.day(String(a.start).slice(0, 10))} · ${a.name ?? ""}`,
        ),
      );
    // a sport board has these in its own table: Best efforts, Exercises
    const summaryOnly = ctx.type === "all";
    for (const d of summaryOnly ? ["1k", "mile", "5k", "10k", "half", "marathon"] : []) {
      const best = ctx.activities
        .map((a) => ({ a, s: calc.seconds((a.best as Record<string, string> | undefined)?.[d]) }))
        .filter((x) => x.s > 0)
        .toSorted((x, y) => x.s - y.s)[0];
      if (best) {
        badges.push(badge(t("rec.best", { d: t(`d.${d}` as Key) }), fmt.hms(best.s), best.a));
        top[0] = badges.at(-1);
      }
    }
    for (const g of groupsIn(ctx.activities)) {
      const rows = of(ctx.activities, g);
      const far = longestBy(rows, (a) => num(a.km) ?? 0);
      const long = far ?? longestBy(rows, (a) => calc.seconds(a.duration));
      if (!long) continue;
      const value = far
        ? fmt.dist(far.km, g === "swimming" ? 2 : undefined)
        : fmt.hms(calc.seconds(long.duration));
      badges.push(badge(t("rec.longest", { sport: typeName(t, g) }), value, long));
      const slot = FIRST_SESSIONS.get(g);
      if (slot) top[slot] = badges.at(-1);
    }

    let heaviest: { kg: number; reps: number; name: string; a: Activity } | undefined;
    const best1rm = new Map<string, { v: number; a: Activity }>();
    for (const a of ctx.activities) {
      for (const e of (a.exercises as
        | { exercise: string; sets: Record<string, number>[] }[]
        | undefined) ?? []) {
        for (const s of e.sets) {
          if (!(s.reps > 0 && s.kg > 0)) continue;
          if (!heaviest || s.kg > heaviest.kg)
            heaviest = { kg: s.kg, reps: s.reps, name: e.exercise, a };
          const v = calc.epley(s.kg, s.reps);
          if (v !== undefined && v > (best1rm.get(e.exercise)?.v ?? 0))
            best1rm.set(e.exercise, { v, a });
        }
      }
    }
    if (heaviest)
      badges.push(
        badge(
          t("rec.topSet"),
          `${heaviest.name}: ${fmt.mass(heaviest.kg)} × ${heaviest.reps}`,
          heaviest.a,
        ),
      );
    const lifts = summaryOnly ? [...best1rm].toSorted((x, y) => y[1].v - x[1].v) : [];
    for (const [name, { v, a }] of lifts) {
      badges.push(badge(t("rec.e1rm", { name }), fmt.mass(v), a));
      top[3] ??= badges.at(-1);
    }
    if (badges.length === 0) {
      ctx.empty(el, t("rec.none"));
      return;
    }
    const first = top.filter((b): b is HTMLElement => b !== undefined);
    const ordered = [...first, ...badges.filter((b) => !first.includes(b))];
    append(
      el,
      h("div", { class: "badges" }, ...ordered),
      lifts.length > 0 && note(t("rec.estimate")),
      showAll(ctx, ordered.slice(RECORDS), ordered.length),
    );
  },
});
