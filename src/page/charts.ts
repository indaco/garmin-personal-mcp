import { Chart, type ChartConfiguration } from "chart.js/auto";
import { h } from "./dom";
import { token } from "./theme";

const live: Chart[] = [];

/** Chart.js defaults from the theme tokens; called before each render, so a theme change draws again. */
export function themeCharts(): void {
  Chart.defaults.color = token("muted");
  Chart.defaults.borderColor = token("line");
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.interaction.mode = "index";
  Chart.defaults.interaction.intersect = false;
  const tip = Chart.defaults.plugins.tooltip;
  tip.backgroundColor = token("panel2");
  tip.titleColor = token("text");
  tip.bodyColor = token("text");
  tip.borderColor = token("line");
  tip.borderWidth = 1;
}

export function chart(el: HTMLElement, config: ChartConfiguration, height = 220): Chart {
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
