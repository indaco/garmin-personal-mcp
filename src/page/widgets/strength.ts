import { append, h, keepFocus } from "../dom";
import type { Key } from "../i18n";
import { register } from "../registry";
import type { Ctx } from "../registry";
import type { ExerciseStats, MuscleGroup, StrengthSet } from "../strength";
import { oneSession } from "./types";
import { kpi, kpiRow, note, showAll, weekLabel } from "./ui";

/** The Strength board: sets per movement, muscle-group balance, the exercises with their detail, the sessions. */

const mg = (g: string) => `mg.${g}` as Key;
const PALETTE = [
  "strengthTraining",
  "accent",
  "good",
  "warn",
  "bad",
  "swimming",
  "hiking",
  "racket",
  "cycling",
  "running",
  "generic",
];

register({
  id: "setsPerCategory",
  render(el, ctx) {
    if (oneSession(el, ctx)) return;
    const sets = ctx.calc.setsByCategory(ctx.activities, ctx.weeks);
    const names = Object.keys(sets).toSorted((a, b) => sum(sets[b]) - sum(sets[a]));
    ctx.chart(
      el,
      {
        type: "bar",
        data: {
          labels: ctx.weeks.map((w) => weekLabel(ctx, w)),
          datasets: names.map((name, i) => ({
            label: name,
            data: sets[name],
            backgroundColor: ctx.color(PALETTE[i % PALETTE.length]),
          })),
        },
        options: {
          scales: {
            x: { stacked: true },
            y: {
              stacked: true,
              ticks: { precision: 0 },
              title: { display: true, text: ctx.t("ex.sets") },
            },
          },
        },
      },
      260,
    );
  },
});

const sum = (v: number[]) => v.reduce((s, x) => s + x, 0);

register({
  id: "muscleBalance",
  render(el, ctx) {
    const { t, fmt, calc } = ctx;
    if (oneSession(el, ctx)) return;
    const sets = calc.muscleSets(ctx.activities, ctx.weeks);
    const groups = calc.MUSCLE_GROUPS.filter((g) => sets[g]);
    const avg = groups.map((g) => sum(sets[g]!) / ctx.weeks.length);
    const ratio = calc.pushPull(sets);
    append(el, kpiRow(kpi(t("mb.pushPull"), ratio === null ? fmt.na : `${fmt.num(ratio, 2)} : 1`)));
    ctx.chart(
      el,
      {
        type: "bar",
        data: {
          labels: groups.map((g) => t(mg(g))),
          datasets: [
            {
              label: t("mb.avg"),
              data: avg,
              backgroundColor: avg.map((v) => ctx.color(v < 10 ? "warn" : v > 20 ? "bad" : "good")),
            },
          ],
        },
        options: {
          indexAxis: "y",
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (c) => `${fmt.num(c.parsed.x ?? undefined, 1)} ${t("mb.perWeek")}`,
              },
            },
          },
          scales: { x: { title: { display: true, text: t("mb.perWeek") } } },
        },
      },
      Math.max(160, groups.length * 26),
    );
    append(el, note(t("mb.note")));
  },
});

/** The table state of each exercises widget: sort, group filter and search stay while the page is open. */
const state = new Map<
  string,
  { sort: string; desc: boolean; group: MuscleGroup | null; search: string }
>();

register({
  id: "exercises",
  render(el, ctx) {
    const { t, calc } = ctx;
    const stats = calc.exerciseStats(ctx.activities);
    if (stats.length === 0) return ctx.empty(el);
    const key = `${ctx.board}/${ctx.id}`;
    const st = state.get(key) ?? { sort: "group", desc: false, group: null, search: "" };
    state.set(key, st);
    const groups = calc.MUSCLE_GROUPS.filter((g) => stats.some((s) => s.muscle === g));

    const box = h("div", { class: "ex-table" });
    const chips = h("div", { class: "chips", role: "group", "aria-label": t("ex.groups") });
    const search = h("input", {
      type: "search",
      class: "search",
      placeholder: t("ex.search"),
      "aria-label": t("ex.search"),
      value: st.search,
    });
    search.addEventListener("input", () => {
      st.search = search.value;
      draw();
    });
    const drawChips = () =>
      keepFocus(() =>
        chips.replaceChildren(
          h(
            "button",
            {
              class: "chip",
              "aria-pressed": String(st.group === null),
              onclick: () => {
                st.group = null;
                drawChips();
                draw();
              },
            },
            t("type.all"),
          ),
          ...groups.map((g) =>
            h(
              "button",
              {
                class: "chip",
                "aria-pressed": String(st.group === g),
                onclick: () => {
                  st.group = st.group === g ? null : g;
                  drawChips();
                  draw();
                },
              },
              t(mg(g)),
            ),
          ),
        ),
      );
    drawChips();
    const draw = () => keepFocus(() => box.replaceChildren(exerciseTable(ctx, stats, st, draw)));
    draw();
    append(el, h("div", { class: "ex-tools" }, chips, search), box);

    const open = stats.find((s) => calc.slug(s.name) === ctx.item);
    if (open) append(el, detail(ctx, open));
    append(el, note(t("rec.estimate")));
  },
});

function exerciseTable(
  ctx: Ctx,
  stats: ExerciseStats[],
  st: { sort: string; desc: boolean; group: MuscleGroup | null; search: string },
  redraw: () => void,
): HTMLElement {
  const { t, fmt, calc } = ctx;
  const value: Record<string, (s: ExerciseStats) => number | string> = {
    name: (s) => s.name,
    sessions: (s) => s.sessions.length,
    last: (s) => s.sessions.at(-1)!.date,
    top: (s) => s.sessions.at(-1)!.top?.kg ?? s.sessions.at(-1)!.maxReps,
    best: (s) => s.best1rm ?? 0,
    change: (s) => s.change ?? -Infinity,
  };
  const cols: [string, Key][] = [
    ["name", "ex.name"],
    ["sessions", "ex.sessions"],
    ["last", "ex.last"],
    ["top", "ex.top"],
    ["best", "ex.best"],
    ["change", "ex.change"],
  ];
  const sortBy = (col: string) => {
    st.desc = st.sort === col ? !st.desc : col !== "name";
    st.sort = col;
    redraw();
  };
  const head = h(
    "tr",
    {},
    ...cols.map(([col, k], i) =>
      h(
        "th",
        {
          scope: "col",
          class: i > 0 ? "num" : undefined,
          "aria-sort": st.sort === col ? (st.desc ? "descending" : "ascending") : undefined,
        },
        h(
          "button",
          { class: "sort", onclick: () => sortBy(col) },
          t(k),
          st.sort === col ? (st.desc ? " ↓" : " ↑") : "",
        ),
      ),
    ),
    h("th", { scope: "col" }, t("ex.trend")),
  );
  const body = h("tbody");
  const needle = st.search.trim().toLowerCase();
  for (const g of calc.MUSCLE_GROUPS) {
    if (st.group && st.group !== g) continue;
    const rows = stats.filter(
      (s) => s.muscle === g && (!needle || s.name.toLowerCase().includes(needle)),
    );
    if (rows.length === 0) continue;
    const order = st.sort === "group" ? "name" : st.sort;
    rows.sort((a, b) => {
      const x = value[order](a);
      const y = value[order](b);
      const c = typeof x === "string" ? x.localeCompare(String(y), ctx.lang) : x - (y as number);
      return st.desc ? -c : c;
    });
    body.append(
      h(
        "tr",
        { class: "group-row" },
        h(
          "th",
          { colspan: "7", scope: "rowgroup" },
          `${t(mg(g))} · ${t("ex.groupRow", { n: rows.length, sets: rows.reduce((s, r) => s + r.completedSets, 0) })}`,
        ),
      ),
    );
    for (const s of rows) {
      const last = s.sessions.at(-1)!;
      const selected = ctx.item === calc.slug(s.name);
      const toggle = () => {
        ctx.setItem(selected ? undefined : calc.slug(s.name));
        // the detail opens after the table: take the focus there
        if (!selected)
          document.getElementById(`ex-detail-${ctx.id}`)?.querySelector<HTMLElement>("h3")?.focus();
      };
      body.append(
        h(
          "tr",
          {
            class: `ex-row${selected ? " selected" : ""}`,
            "data-exercise": calc.slug(s.name),
            onclick: toggle,
          },
          h(
            "td",
            {},
            h(
              "button",
              {
                class: "linkish",
                "aria-expanded": String(selected),
                "aria-controls": `ex-detail-${ctx.id}`,
                onclick: (e: Event) => {
                  e.stopPropagation(); // the row would toggle it again
                  toggle();
                },
              },
              s.name,
            ),
          ),
          h("td", { class: "num" }, String(s.sessions.length)),
          h("td", { class: "num" }, fmt.day(last.date)),
          h("td", { class: "num" }, topText(ctx, s, last)),
          h("td", { class: "num" }, s.best1rm === undefined ? "" : fmt.mass(s.best1rm)),
          h(
            "td",
            { class: "num" },
            s.change === null
              ? ""
              : h(
                  "span",
                  { class: calc.changeClass(s.change, true) },
                  `${s.change > 0 ? "↑" : s.change < 0 ? "↓" : "→"} ${fmt.pct(s.change)}`,
                ),
          ),
          h("td", {}, sparkline(s)),
        ),
      );
    }
  }
  return h("table", { class: "data exercises" }, h("thead", {}, head), body);
}

function topText(ctx: Ctx, s: ExerciseStats, x: ExerciseStats["sessions"][number]): string {
  if (s.kind === "weight") return x.top ? `${ctx.fmt.mass(x.top.kg)} × ${x.top.reps}` : "";
  if (s.kind === "reps") return ctx.t("ex.reps", { n: x.maxReps });
  return `${x.longest} s`;
}

/** One set as "62.5 × 10", "45 s" or "12 reps". */
function setText(ctx: Ctx, set: StrengthSet): string {
  if (set.kg) return `${ctx.fmt.num(ctx.fmt.to.mass(set.kg), 1)} × ${set.reps ?? 0}`;
  if (ctx.calc.timed(set)) return `${set.seconds} s`;
  return ctx.t("ex.reps", { n: set.reps ?? 0 });
}

/** A small decorative trend line of the top set (or max reps, or the longest set). */
function sparkline(s: ExerciseStats): SVGElement {
  const v = s.sessions.map((x) =>
    s.kind === "weight" ? (x.top?.kg ?? 0) : s.kind === "reps" ? x.maxReps : x.longest,
  );
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 80 20");
  svg.setAttribute("class", "spark");
  svg.setAttribute("aria-hidden", "true");
  if (v.length > 1) {
    const min = Math.min(...v);
    const span = Math.max(...v) - min || 1;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute(
      "points",
      v.map((y, i) => `${(i / (v.length - 1)) * 78 + 1},${19 - ((y - min) / span) * 18}`).join(" "),
    );
    svg.append(line);
  }
  return svg;
}

function detail(ctx: Ctx, s: ExerciseStats): HTMLElement {
  const { t, fmt } = ctx;
  const panel = h(
    "section",
    { class: "detail", id: `ex-detail-${ctx.id}`, "aria-label": s.name },
    h(
      "header",
      { class: "detail-head" },
      h("h3", { tabindex: "-1" }, s.name),
      h(
        "span",
        { class: "muted small" },
        `${t(mg(s.muscle))}${s.medianRest === undefined ? "" : ` · ${t("ex.rest", { v: fmt.hms(s.medianRest) })}`}`,
      ),
      h(
        "button",
        { class: "tool", "aria-label": t("add.close"), onclick: () => ctx.setItem(undefined) },
        "✕",
      ),
    ),
  );
  if (s.sessions.length > 1) {
    const labels = s.sessions.map((x) => fmt.day(x.date));
    const line = (label: string, data: (number | null)[], color: string) => ({
      type: "line" as const,
      label,
      data,
      borderColor: ctx.color(color),
      yAxisID: "y",
      spanGaps: true,
    });
    const datasets =
      s.kind === "weight"
        ? [
            line(
              t("ex.weight", { unit: fmt.unit.mass }),
              s.sessions.map((x) => (x.top ? fmt.to.mass(x.top.kg) : null)),
              "strengthTraining",
            ),
            line(
              t("ex.e1rm", { unit: fmt.unit.mass }),
              s.sessions.map((x) => (x.e1rm === undefined ? null : fmt.to.mass(x.e1rm))),
              "accent",
            ),
            {
              type: "bar" as const,
              label: t("ex.volume", { unit: fmt.unit.mass }),
              data: s.sessions.map((x) => fmt.to.mass(x.volume)),
              backgroundColor: `${ctx.color("muted")}55`,
              yAxisID: "y1",
            },
          ]
        : s.kind === "reps"
          ? [
              line(
                t("ex.maxReps"),
                s.sessions.map((x) => x.maxReps),
                "strengthTraining",
              ),
              {
                type: "bar" as const,
                label: t("ex.totalReps"),
                data: s.sessions.map((x) => x.reps),
                backgroundColor: `${ctx.color("muted")}55`,
                yAxisID: "y1",
              },
            ]
          : [
              line(
                t("ex.longest"),
                s.sessions.map((x) => x.longest),
                "strengthTraining",
              ),
            ];
    ctx.chart(
      panel,
      {
        type: "bar",
        data: { labels, datasets },
        options: {
          scales: {
            y: { position: "left" },
            y1: {
              position: "right",
              grid: { drawOnChartArea: false },
              display: datasets.length > 2 || s.kind === "reps",
            },
          },
        },
      },
      200,
    );
  } else {
    append(panel, note(t("one.session")));
  }
  const list = h("ol", { class: "ex-sessions", reversed: true });
  for (const x of s.sessions.toReversed()) {
    const sets = x.sets.map((set) => {
      const done = ctx.calc.completed(set);
      const what = setText(ctx, set);
      const pct =
        set.kg && set.reps && s.best1rm ? ` (${fmt.num((set.kg / s.best1rm) * 100)}%)` : "";
      const rest = set.restSec ? ` · ${t("ex.restAfter", { v: fmt.hms(set.restSec) })}` : "";
      return h(
        "li",
        { class: done ? undefined : "not-done" },
        `${what}${pct}${rest}${done ? "" : ` · ${t("ex.notDone")}`}`,
      );
    });
    list.append(
      h(
        "li",
        {},
        h("strong", {}, `${fmt.day(x.date)} · ${x.workout}`),
        h("ul", { class: "sets" }, ...sets),
      ),
    );
  }
  append(panel, list);
  return panel;
}

/** The sessions shown before "Show all". */
const SESSIONS = 6;

register({
  id: "strengthSessions",
  render(el, ctx) {
    const { t, fmt, calc } = ctx;
    const acts = ctx.activities.filter((a) => calc.exercisesOf(a).length > 0);
    if (acts.length === 0) return ctx.empty(el);
    const sessions: HTMLElement[] = [];
    for (const a of acts) {
      const exercises = calc.exercisesOf(a);
      sessions.push(
        h(
          "details",
          { class: "session" },
          h(
            "summary",
            {},
            `${fmt.day(String(a.start).slice(0, 10))} · ${a.name ?? ""} · ${t("ss.count", { n: exercises.length })}`,
          ),
          h(
            "ol",
            { class: "ex-sessions" },
            ...exercises.map((e) =>
              h(
                "li",
                {},
                h("strong", {}, e.exercise),
                h("span", { class: "muted small" }, ` · ${t(mg(calc.exerciseGroup(e)))}`),
                h("div", { class: "small" }, e.sets.map((x) => setText(ctx, x)).join(", ")),
              ),
            ),
          ),
        ),
      );
    }
    // the activities come newest first: the older sessions go behind "Show all"
    append(el, ...sessions, showAll(ctx, sessions.slice(SESSIONS), sessions.length));
  },
});
