import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  type ChartConfiguration,
  type ChartDataset,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PieController,
  PointElement,
  ScatterController,
  type ChartEvent,
  Tooltip,
  type LegendElement,
  type LegendItem,
} from "chart.js";
import { h } from "./dom";
import { token } from "./theme";

// only the parts the page uses: chart.js/auto would bring every chart type, scale and plugin
Chart.register(
  BarController,
  LineController,
  ScatterController,
  DoughnutController,
  PieController,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Filler,
);

// pie and doughnut legend items are data points (index); the others are datasets (datasetIndex)
const key = (i: LegendItem) => i.datasetIndex ?? i.index ?? -1;

/**
 * A legend click shows only that series; a click on the one series left shows them all again.
 * Shift, Cmd or Ctrl hides or shows just that series. Only the series in the legend change, so a
 * series a widget keeps out of its legend (the low edge of a band) stays.
 */
function legendClick(e: ChartEvent, item: LegendItem, legend: LegendElement<never>): void {
  const c = legend.chart;
  const shown = (i: LegendItem) =>
    i.datasetIndex === undefined
      ? c.getDataVisibility(i.index ?? -1)
      : c.isDatasetVisible(i.datasetIndex);
  const show = (i: LegendItem, on: boolean) => {
    if (i.datasetIndex !== undefined) c.setDatasetVisibility(i.datasetIndex, on);
    else if (shown(i) !== on) c.toggleDataVisibility(i.index ?? -1);
  };
  const native = e.native as MouseEvent | null;
  const items = legend.legendItems ?? [];
  if (native?.shiftKey || native?.metaKey || native?.ctrlKey) {
    show(item, !shown(item));
  } else {
    const alone = items.every((i) => shown(i) === (key(i) === key(item)));
    for (const i of items) show(i, alone || key(i) === key(item));
  }
  c.update();
}

Chart.defaults.plugins.legend.onClick = legendClick;
// pie and doughnut set their own handler, which wins over the default
Chart.overrides.doughnut.plugins.legend.onClick = legendClick;
Chart.overrides.pie.plugins.legend.onClick = legendClick;

const live: Chart[] = [];

/** Chart.js defaults from the theme tokens and the language; called before each render, so a theme change draws again. */
export function themeCharts(language: string): void {
  Chart.defaults.locale = language;
  Chart.defaults.color = token("muted");
  Chart.defaults.borderColor = token("line");
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.maintainAspectRatio = false;
  // the page draws itself again on each click: an animation would replay every time
  Chart.defaults.animation = false;
  Chart.defaults.interaction.mode = "index";
  Chart.defaults.interaction.intersect = false;
  const tip = Chart.defaults.plugins.tooltip;
  tip.backgroundColor = token("panel2");
  tip.titleColor = token("text");
  tip.bodyColor = token("text");
  tip.borderColor = token("line");
  tip.borderWidth = 1;
}

export const CHART_TYPES = ["bar", "line", "scatter", "doughnut", "pie"];

type Tick = (value: number) => unknown;

/** The tick text of the axis that holds a dataset's values: the table reads as the chart does. */
function axisText(config: ChartConfiguration, set: ChartDataset): Tick | undefined {
  const horizontal = config.options?.indexAxis === "y";
  const axis = horizontal
    ? ((set as { xAxisID?: string }).xAxisID ?? "x")
    : ((set as { yAxisID?: string }).yAxisID ?? "y");
  const scales = config.options?.scales as
    | Record<string, { ticks?: { callback?: unknown } }>
    | undefined;
  return scales?.[axis]?.ticks?.callback as Tick | undefined;
}

/** A value as text, by the axis when it can: a custom widget's callback may need what only a live chart has. */
function valueText(v: number, tick: Tick | undefined): string {
  try {
    const shown = tick?.(v);
    if (typeof shown === "string" || typeof shown === "number") return String(shown);
  } catch {
    // the plain number below
  }
  return new Intl.NumberFormat(Chart.defaults.locale, { maximumFractionDigits: 2 }).format(v);
}

/** A value of a dataset as text: a number, an {x, y} point, or nothing. */
function text(v: unknown, tick?: Tick): string {
  if (typeof v === "number") return valueText(v, tick);
  if (isPoint(v)) return `${text(v.x)}: ${text(v.y, tick)}`;
  // an object that is not a point has no text; an array is a floating bar
  const empty = v === null || v === undefined || (typeof v === "object" && !Array.isArray(v));
  return empty ? "" : String(v);
}

function isPoint(v: unknown): v is { x: unknown; y: unknown } {
  return typeof v === "object" && v !== null && "x" in v && "y" in v;
}

/** The category axis places a point by its label, not by its position. */
function cell(
  data: unknown[],
  label: unknown,
  i: number,
  labelled: boolean,
  tick: Tick | undefined,
): string {
  if (labelled && data.some(isPoint)) {
    return data
      .filter(isPoint)
      .filter((p) => p.x === label)
      .map((p) => text(p.y, tick))
      .join(", ");
  }
  return text(data[i], tick);
}

/** The data of a chart as a table that only screen readers get: one row per label, one column per series. */
function dataTable(config: ChartConfiguration, title: string): HTMLElement {
  const sets = config.data.datasets;
  const labels = config.data.labels ?? (sets[0]?.data ?? []).map((_, i) => i + 1);
  // the wrapper hides it: a table grows to its content whatever its width
  return h(
    "div",
    { class: "sr-only" },
    h(
      "table",
      {},
      h("caption", {}, title),
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          h("td", {}),
          ...sets.map((d) => h("th", { scope: "col" }, String(d.label ?? ""))),
        ),
      ),
      h(
        "tbody",
        {},
        ...labels.map((label, i) =>
          h(
            "tr",
            {},
            h("th", { scope: "row" }, String(label ?? "")),
            ...sets.map((d) =>
              h(
                "td",
                {},
                cell(d.data, label, i, config.data.labels !== undefined, axisText(config, d)),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

export function chart(el: HTMLElement, config: ChartConfiguration, height = 220): Chart {
  // Chart.js builds the chart only when the canvas is in the page, after the widget's try/catch:
  // check the types now, so a wrong type shows in the widget's tile
  const types = [config.type, ...config.data.datasets.map((d) => d.type)].filter(Boolean);
  const unknown = types.find((t) => !CHART_TYPES.includes(String(t)));
  if (unknown) {
    throw new Error(`Chart type ${unknown} is not available: use ${CHART_TYPES.join(", ")}`);
  }
  // the title of the small chart, else of the tile; screen readers read the table instead of the picture
  const title =
    (el.closest(".multiple")?.querySelector("h3") ?? el.closest(".tile")?.querySelector("h2"))
      ?.textContent ?? "";
  const canvas = h("canvas", { "aria-hidden": "true" });
  el.append(
    h("div", { class: "chart", style: `height:${height}px` }, canvas, dataTable(config, title)),
  );
  const c = new Chart(canvas, config);
  live.push(c);
  return c;
}

export function destroyCharts(): void {
  for (const c of live.splice(0)) c.destroy();
}

export { Chart };
