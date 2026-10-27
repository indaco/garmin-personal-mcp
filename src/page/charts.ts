import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  type ChartConfiguration,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PieController,
  PointElement,
  ScatterController,
  Tooltip,
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

const live: Chart[] = [];

/** Chart.js defaults from the theme tokens; called before each render, so a theme change draws again. */
export function themeCharts(): void {
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

export function chart(el: HTMLElement, config: ChartConfiguration, height = 220): Chart {
  // Chart.js builds the chart only when the canvas is in the page, after the widget's try/catch:
  // check the types now, so a wrong type shows in the widget's tile
  const types = [config.type, ...config.data.datasets.map((d) => d.type)].filter(Boolean);
  const unknown = types.find((t) => !CHART_TYPES.includes(String(t)));
  if (unknown) {
    throw new Error(`Chart type ${unknown} is not available: use ${CHART_TYPES.join(", ")}`);
  }
  const canvas = h("canvas", { role: "img" });
  el.append(h("div", { class: "chart", style: `height:${height}px` }, canvas));
  const c = new Chart(canvas, config);
  live.push(c);
  return c;
}

export function destroyCharts(): void {
  for (const c of live.splice(0)) c.destroy();
}

export { Chart };
