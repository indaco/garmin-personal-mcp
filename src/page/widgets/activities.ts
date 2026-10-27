import { type Activity, groupOf, seconds } from "../calc";
import { append, h } from "../dom";
import { register } from "../registry";
import { showAll, table, typeCell } from "./ui";

/** Activities whose laps the page shows: the rows can open. */
const open = new Set<string>();
/** The rows shown before "Show all". */
const ROWS = 15;

register({
  id: "activities",
  render(el, ctx) {
    const { t, fmt } = ctx;
    const acts = ctx.activities;
    if (acts.length === 0) {
      ctx.empty(el);
      return;
    }
    const tbl = table(
      [
        t("col.date"),
        t("col.type"),
        t("col.name"),
        t("col.distance"),
        t("col.time"),
        t("col.pace"),
        t("col.hr"),
        t("col.ascent"),
      ],
      [],
      [3, 4, 5, 6, 7],
    );
    const body = tbl.querySelector("tbody")!;
    const extra: HTMLElement[] = [];
    for (const [n, a] of acts.entries()) {
      const rowsBefore = body.childElementCount;
      const id = String(a.id);
      const laps = Array.isArray(a.laps) ? (a.laps as Record<string, unknown>[]) : [];
      const isOpen = open.has(id);
      const name = h(
        "span",
        {},
        a.name ?? "",
        a.race === true && h("span", { class: "tag" }, t("col.race")),
      );
      const cells: (Node | string)[] = [
        fmt.day(String(a.start).slice(0, 10)),
        typeCell(ctx, a),
        laps.length > 0
          ? h(
              "button",
              {
                class: "linkish",
                "aria-expanded": String(isOpen),
                onclick: () => {
                  if (isOpen) open.delete(id);
                  else open.add(id);
                  ctx.refresh();
                },
              },
              name,
              ` · ${t("laps.show")}`,
            )
          : name,
        typeof a.km === "number" ? `${fmt.num(a.km, 2)} km` : "",
        fmt.hms(ctx.calc.sessionSeconds(a)),
        pace(a, fmt.num),
        typeof a.avgHR === "number" ? fmt.num(a.avgHR) : "",
        typeof a.ascentM === "number" ? `${fmt.num(a.ascentM)} m` : "",
      ];
      body.append(
        h("tr", {}, ...cells.map((c, i) => h("td", { class: i >= 3 ? "num" : undefined }, c))),
      );
      if (isOpen) {
        body.append(
          h(
            "tr",
            { class: "laps-row" },
            h(
              "td",
              { colspan: "8" },
              table(
                [
                  t("lap.n"),
                  t("col.distance"),
                  t("col.time"),
                  t("col.pace"),
                  t("col.hr"),
                  t("lap.intensity"),
                ],
                laps.map((l) => [
                  String(l.lap ?? ""),
                  typeof l.km === "number" ? `${fmt.num(l.km, 2)} km` : "",
                  String(l.time ?? ""),
                  String(l.pace ?? (typeof l.kmh === "number" ? `${fmt.num(l.kmh, 1)} km/h` : "")),
                  typeof l.avgHR === "number" ? fmt.num(l.avgHR) : "",
                  String(l.intensity ?? ""),
                ]),
                [1, 2, 3, 4],
              ),
            ),
          ),
        );
      }
      // the row and its laps
      if (n >= ROWS) extra.push(...([...body.children].slice(rowsBefore) as HTMLElement[]));
    }
    append(el, tbl, showAll(ctx, extra, acts.length));
  },
});

/** Pace for activities on foot, speed for rides, nothing for strength or racket sports (their distance means little). */
function pace(a: Activity, num: (v: number, digits: number) => string): string {
  const g = groupOf(a);
  if (g === "strengthTraining" || g === "racket") return "";
  const hours = seconds(a.duration) / 3600;
  if (g === "cycling")
    return typeof a.km === "number" && hours > 0 ? `${num(a.km / hours, 1)} km/h` : "";
  return typeof a.pace === "string" ? a.pace : "";
}
