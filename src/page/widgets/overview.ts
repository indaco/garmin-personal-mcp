import { addDays } from "../../dates";
import { type Activity, GROUPS, groupOf } from "../calc";
import { append, h } from "../dom";
import type { Key } from "../i18n";
import { register } from "../registry";
import {
  between,
  delta,
  everyActivity,
  groupKey,
  kpi,
  kpiRow,
  maxHR,
  note,
  table,
  totals,
  windowEnd,
} from "./ui";

const ANY = ["all", ...GROUPS] as const;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const last = <T>(list: T[]) => list.at(-1);
const of = (acts: Activity[], g: string) => acts.filter((a) => groupOf(a.type ?? "") === g);

register({
  id: "kpis",
  title: (t) => t("w.kpis"),
  types: ANY,
  span: 3,
  render(el, ctx) {
    const { t, fmt, calc } = ctx;
    const sum = totals(ctx, ctx.activities);
    const end = windowEnd(ctx);
    const every = ctx.ofType(everyActivity(ctx));
    const week = totals(ctx, between(every, addDays(end, -6), end));
    // the 4 weeks before the last 7 days, from all embedded data
    const base = totals(ctx, between(every, addDays(end, -34), addDays(end, -7)));
    const ratio = calc.loadRatio(everyActivity(ctx), end, maxHR(ctx)).ratio;
    const hrv = last(ctx.data.hrv.filter((r) => String(r.date) <= end));
    const hrvNow = num(hrv?.hrv);
    const hrvBase = num(hrv?.weeklyAvg);
    const filtered =
      ctx.type !== "all" || ctx.ofType(ctx.allActivities).length !== ctx.allActivities.length;
    append(
      el,
      h(
        "p",
        { class: "totals" },
        t("kpi.totals", { km: fmt.num(sum.km, 1), time: fmt.hours(sum.seconds), n: sum.sessions }),
      ),
      kpiRow(
        kpi(
          t("kpi.distance"),
          `${fmt.num(week.km, 1)} km`,
          h("span", {}, delta(ctx, calc.change(week.km, base.km / 4)), " ", t("kpi.vs4w")),
        ),
        kpi(
          t("kpi.time"),
          fmt.hours(week.seconds),
          h(
            "span",
            {},
            delta(ctx, calc.change(week.seconds, base.seconds / 4)),
            " ",
            t("kpi.vs4w"),
          ),
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
              delta(ctx, calc.change(hrvNow, hrvBase)),
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
  title: (t) => t("w.readiness"),
  span: 2,
  render(el, ctx) {
    const { t, fmt, calc, data } = ctx;
    const hrv = last(data.hrv);
    const rows = data.recovery;
    const today = last(rows);
    const before = rows
      .slice(-8, -1)
      .map((r) => num(r.rhr))
      .filter((v): v is number => v !== undefined);
    const rhrAvg = calc.mean(before) ?? undefined;
    const ratio = calc.loadRatio(everyActivity(ctx), data.end, maxHR(ctx)).ratio;
    const inputs = {
      hrvStatus: typeof hrv?.status === "string" ? hrv.status : undefined,
      sleepScore: num(today?.sleepScore),
      rhr: num(today?.rhr),
      rhrAvg,
      ratio,
    };
    const verdict = calc.readiness(inputs);
    append(
      el,
      h(
        "p",
        { class: `verdict verdict-${verdict ?? "none"}` },
        verdict ? t(`ready.${verdict}` as Key) : fmt.na,
      ),
      kpiRow(
        kpi(t("ready.hrv"), inputs.hrvStatus ?? fmt.na),
        kpi(t("ready.sleep"), fmt.num(inputs.sleepScore)),
        kpi(
          t("ready.rhr"),
          inputs.rhr === undefined ? fmt.na : `${fmt.num(inputs.rhr)} bpm`,
          rhrAvg !== undefined && t("ready.rhrVs", { avg: fmt.num(rhrAvg, 1) }),
        ),
        kpi(t("ready.ratio"), ratio === null ? fmt.na : fmt.num(ratio, 2)),
      ),
      note(t("ready.note")),
    );
  },
});

register({
  id: "fitnessAge",
  title: (t) => t("w.fitnessAge"),
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
      note(t("today.note")),
    );
  },
});

register({
  id: "periodComparison",
  title: (t) => t("w.periodComparison"),
  types: ANY,
  span: 3,
  render(el, ctx) {
    const { t, fmt, calc } = ctx;
    const end = windowEnd(ctx);
    const prev = calc.periodWindow(ctx.from, ctx.to, ctx.data.prevStart);
    const now = ctx.activities;
    const before = ctx.ofType(between(everyActivity(ctx), prev.from, prev.to));
    const groups = GROUPS.filter((g) =>
      [...now, ...before].some((a) => groupOf(a.type ?? "") === g),
    );
    const row = (label: Node | string, a: Activity[], b: Activity[]) => {
      const x = totals(ctx, a);
      const y = totals(ctx, b);
      const cell = (v: string, d: number | null) => h("span", {}, v, " ", delta(ctx, d));
      return [
        label,
        cell(fmt.num(x.sessions), calc.change(x.sessions, y.sessions)),
        x.km > 0 || y.km > 0 ? cell(`${fmt.num(x.km, 1)} km`, calc.change(x.km, y.km)) : "",
        cell(fmt.hours(x.seconds), calc.change(x.seconds, y.seconds)),
        cell(fmt.num(x.load), calc.change(x.load, y.load)),
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
          ...groups.map((g) => row(t(groupKey(g)), of(now, g), of(before, g))),
          ...(groups.length > 1 ? [row(h("strong", {}, t("pc.total")), now, before)] : []),
        ],
        [1, 2, 3, 4],
      ),
    );
  },
});

register({
  id: "records",
  title: (t) => t("w.records"),
  types: ANY,
  span: 3,
  render(el, ctx) {
    const { t, fmt, calc } = ctx;
    const badges: HTMLElement[] = [];
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
    for (const d of ["1k", "mile", "5k", "10k", "half", "marathon"]) {
      const best = ctx.activities
        .map((a) => ({ a, s: calc.seconds((a.best as Record<string, string> | undefined)?.[d]) }))
        .filter((x) => x.s > 0)
        .toSorted((x, y) => x.s - y.s)[0];
      if (best)
        badges.push(badge(t("rec.best", { d: t(`d.${d}` as Key) }), fmt.hms(best.s), best.a));
    }
    const longest = (g: string) =>
      ctx.activities
        .filter((a) => groupOf(a.type ?? "") === g && typeof a.km === "number")
        .toSorted((x, y) => (y.km ?? 0) - (x.km ?? 0))[0];
    const run = longest("run");
    if (run) badges.push(badge(t("rec.longestRun"), `${fmt.num(run.km, 1)} km`, run));
    const ride = longest("bike");
    if (ride) badges.push(badge(t("rec.longestRide"), `${fmt.num(ride.km, 1)} km`, ride));

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
          `${heaviest.name}: ${fmt.num(heaviest.kg, 1)} kg × ${heaviest.reps}`,
          heaviest.a,
        ),
      );
    for (const [name, { v, a }] of [...best1rm].toSorted((x, y) => y[1].v - x[1].v)) {
      badges.push(badge(t("rec.e1rm", { name }), `${fmt.num(v, 1)} kg`, a));
    }
    if (badges.length === 0) {
      ctx.empty(el, t("rec.none"));
      return;
    }
    append(
      el,
      h("div", { class: "badges" }, ...badges),
      best1rm.size > 0 && note(t("rec.estimate")),
    );
  },
});
