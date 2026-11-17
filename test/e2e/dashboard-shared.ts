// The browser and the helpers of the dashboard page tests, split over several files so that
// they run in parallel.
import type { Browser, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, expect } from "vitest";
import { digest } from "../../src/digest";
import { preset } from "../../src/page/presets";
import { DASHBOARD_VERSION } from "../../src/prompts";
import { data, closePages, launch, open, pageFile } from "./page";

/** The browser of the tests of one file. */
export let browser: Browser;

/** Opens one browser for the file that calls it, and closes the pages of each test. */
export function withBrowser(): void {
  beforeAll(async () => {
    browser = await launch();
  });
  afterEach(() => closePages(browser));
  afterAll(async () => {
    await browser?.close();
  });
}

export const tabs = (page: Page) =>
  page.$$eval("[role=tab]", (els) =>
    els.map((e) => [e.getAttribute("data-tab"), e.querySelector(".count")?.textContent]),
  );
export const tiles = (page: Page) =>
  page.$$eval(".tile", (els) => els.map((e) => (e as HTMLElement).dataset.id));
/** The "Average pace" value of the running board for the given activities. */
export async function runningPace(activities: unknown[]): Promise<string | null> {
  const { page } = await open(
    browser,
    pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities } }),
    {
      hash: "#running",
    },
  );
  return page
    .locator("[data-id=typeKpis] .kpi", {
      has: page.locator(".kpi-label", { hasText: "Average pace" }),
    })
    .locator(".kpi-value")
    .textContent();
}
export const hash = (page: Page) => page.evaluate(() => location.hash);
/** A copy of the object without the given fields. */
export const without = (o: object, fields: string[]) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !fields.includes(k)));
/** An activity without Garmin's load: the page estimates it from the HR. */
export const noGarminLoad = (a: object) => without(a, ["trainingLoad"]);
/** The ISO time n hours from now. */
export const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
/** Opens edit mode from the settings menu. */
export async function startEdit(page: Page): Promise<void> {
  await page.click(".account summary");
  await page.click(".account-panel >> text=Edit layout");
}

/** The stops of Shift+Tab, from the last control up to the skip link, that sit under the given bar. */
export async function stopsUnder(
  page: Page,
  bar: string,
): Promise<{ hidden: string[]; stops: number }> {
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const all = [
      ...document.querySelectorAll<HTMLElement>(
        "a[href], button, input, select, summary, [tabindex='0']",
      ),
    ].filter((e) => e.offsetParent !== null && !e.hasAttribute("disabled"));
    all[all.length - 1].focus();
  });
  const hidden: string[] = [];
  let stops = 0;
  for (; stops < 80; stops++) {
    const hit = await page.evaluate((sel) => {
      const el = document.activeElement as HTMLElement;
      const b = document.querySelector(sel)!.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const inside = el.closest(sel) !== null;
      const under = !inside && r.width > 0 && r.height > 0 && r.top < b.bottom && r.bottom > b.top;
      return {
        skip: el.classList.contains("skip"),
        label: under
          ? `${el.tagName} ${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30)}`
          : "",
      };
    }, bar);
    // the skip link is the end of the walk: it sits at the top of the page, above the bar
    if (hit.skip) break;
    if (hit.label) hidden.push(hit.label);
    await page.keyboard.press("Shift+Tab");
  }
  return { hidden, stops };
}

/** The scroll listeners on the window, read through the browser's debugger. */
export const scrollListeners = async (page: Page) => {
  const cdp = await page.context().newCDPSession(page);
  const { result } = await cdp.send("Runtime.evaluate", { expression: "window" });
  const { listeners } = await cdp.send("DOMDebugger.getEventListeners", {
    objectId: result.objectId!,
  });
  await cdp.detach();
  return listeners.filter((l) => l.type === "scroll").length;
};

/** The sticky offset the page sets for keyboard focus. */
export const stickyOffset = (page: Page) =>
  page.evaluate(() => document.documentElement.style.getPropertyValue("--sticky-h"));

/** The text of the Records tile on the Hike tab of a page with these activities. */
export const hikeRecords = async (activities: object[]) => {
  const { page } = await open(
    browser,
    pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities } }),
    { hash: "#hiking" },
  );
  return page.innerText("[data-id=records]");
};

/** The shown tiles of the board by row: their heights, and the space left at the right of the grid. */
export const gridRows = (page: Page) =>
  page.$eval(".grid", (grid) => {
    const box = grid.getBoundingClientRect();
    const rows = new Map<number, { id?: string; height: number; right: number }[]>();
    for (const el of grid.querySelectorAll<HTMLElement>(":scope > .tile")) {
      const r = el.getBoundingClientRect();
      const row = rows.get(Math.round(r.top)) ?? [];
      row.push({ id: el.dataset.id, height: Math.round(r.height), right: r.right });
      rows.set(Math.round(r.top), row);
    }
    return [...rows.values()].map((row) => ({
      ids: row.map((t) => t.id).join("+"),
      heights: new Set(row.map((t) => t.height)).size,
      gap: Math.round(box.right - Math.max(...row.map((t) => t.right))),
    }));
  });

/** A record that the all board met the whole preset, so a test layout of few widgets stays small. */
export const MET = { all: preset("all").map((i) => i.widget) };

export const ALL_PRESET = [
  "kpis",
  "readiness",
  "calendar",
  "periodComparison",
  "weeklyVolume",
  "intensityMinutes",
  "records",
  "loadSafety",
  "fitnessFatigue",
  "loadVsRecovery",
  "activities",
  "coachNotes",
];

/** Hovers a real data point of every visible chart; returns the ids of the charts without a tooltip. */
export async function chartsWithoutTooltip(page: Page): Promise<string[]> {
  const keys = await page.evaluate(() =>
    Object.values(window.Chart!.instances)
      .filter((c) => c.canvas.offsetParent)
      .map((c, i) => {
        c.canvas.dataset.probe = String(i);
        return String(i);
      }),
  );
  const missing: string[] = [];
  for (const key of keys) {
    const pos = await page.evaluate((k) => {
      const c = Object.values(window.Chart!.instances).find((x) => x.canvas.dataset.probe === k)!;
      c.canvas.scrollIntoView({ block: "center" });
      for (let d = 0; d < c.data.datasets.length; d++) {
        const meta = c.getDatasetMeta(d);
        const i = meta.data.findIndex(
          (p) =>
            p && !(p as { skip?: boolean }).skip && Number.isFinite(p.x) && Number.isFinite(p.y),
        );
        if (i >= 0) {
          const r = c.canvas.getBoundingClientRect();
          return { x: r.left + meta.data[i].x, y: r.top + meta.data[i].y };
        }
      }
      return null;
    }, key);
    if (!pos) continue;
    await page.mouse.move(pos.x, pos.y);
    await page.waitForTimeout(80);
    const shown = await page.evaluate(
      (k) =>
        Object.values(window.Chart!.instances)
          .find((x) => x.canvas.dataset.probe === k)!
          .tooltip!.getActiveElements().length > 0,
      key,
    );
    if (!shown)
      missing.push(
        await page.evaluate(
          (k) =>
            Object.values(window.Chart!.instances)
              .find((x) => x.canvas.dataset.probe === k)!
              .canvas.closest(".tile")!
              .getAttribute("data-id")!,
          key,
        ),
      );
  }
  return missing;
}

/** The text of the All, Run, Strength and Bike boards of a page with these units, race names left out. */
export async function shownUnits(units?: string): Promise<string> {
  const { page, errors } = await open(browser, pageFile({ data: { ...data, units } }));
  let text = "";
  for (const tab of ["all", "running", "strengthTraining", "cycling"]) {
    await page.click(`[data-tab=${tab}]`);
    text += await page.innerText("#app");
  }
  expect(errors).toEqual([]);
  // race names such as "5 km" and the 15 km long-run threshold stay metric
  return text.replaceAll(/\b(1|5|10|15) km\b/g, "");
}

/** The values of the load ratio tiles: the overview's and the readiness widget's. */
export const ratios = (page: Page) =>
  page.$$eval("[data-id=kpis] .kpi, [data-id=readiness] .kpi", (kpis) =>
    kpis
      .filter((k) => (k.querySelector(".kpi-label")?.textContent ?? "").startsWith("Load ratio"))
      .map((k) => k.querySelector(".kpi-value")?.textContent),
  );

/** All sub texts of the tiles of the readiness widget: label → list. */
export const readinessSubs = (page: Page) =>
  page.$$eval("[data-id=readiness] .kpi", (kpis): Record<string, string[]> =>
    Object.fromEntries(
      kpis.map((k) => [
        k.querySelector(".kpi-label")?.textContent ?? "",
        [...k.querySelectorAll(".kpi-sub")].map((x) => x.textContent ?? ""),
      ]),
    ),
  );

/** The tiles of a widget: label → [value, sub text or null]. */
export const kpiTexts = (page: Page, widget: string) =>
  page.$$eval(`[data-id=${widget}] .kpi`, (kpis) =>
    Object.fromEntries(
      kpis.map((k) => [
        k.querySelector(".kpi-label")?.textContent,
        [
          k.querySelector(".kpi-value")?.textContent,
          k.querySelector(".kpi-sub")?.textContent ?? null,
        ],
      ]),
    ),
  );

/** The page text of the HRV statuses of the fixture. */
export const statusText: Record<string, string> = { BALANCED: "Balanced" };

/** The readiness tiles the page must show for the digest's readiness. */
export function readinessTiles(r: NonNullable<ReturnType<typeof digest>["readiness"]>) {
  return {
    "HRV status": [r.hrvStatus === null ? "n/a" : (statusText[r.hrvStatus] ?? r.hrvStatus), null],
    "Sleep score": [r.sleepScore === null ? "n/a" : String(r.sleepScore), null],
    "Resting HR": [
      r.rhr === null ? "n/a" : `${r.rhr} bpm`,
      r.rhrAvg7 === null ? null : `7 days before: ${r.rhrAvg7.toFixed(1)} bpm`,
    ],
    "Load ratio 7:28": [r.loadRatio === null ? "n/a" : r.loadRatio.toFixed(2), null],
  };
}

/** Pages for the Garmin word tests. */
export const withStatus = (status?: string) => ({
  ...data,
  v: DASHBOARD_VERSION,
  hrv: data.hrv.map((r: Record<string, unknown>, i: number, all: unknown[]) =>
    i === all.length - 1 ? { ...r, status } : r,
  ),
});
export const lapTypes = async (languages: string[], intensities?: (string | undefined)[]) => {
  const activities = data.activities.map((a: { laps?: Record<string, unknown>[] }) =>
    a.laps && intensities
      ? {
          ...a,
          laps: a.laps.map((l, i) => ({
            ...l,
            intensity: intensities[i % intensities.length],
          })),
        }
      : a,
  );
  const { page, errors } = await open(
    browser,
    pageFile({ data: { ...data, activities, v: DASHBOARD_VERSION }, settings: { languages } }),
  );
  const buttons = page.locator("[data-id=activities] button[aria-expanded]:visible");
  for (let i = 0, n = await buttons.count(); i < n; i++) await buttons.nth(i).click();
  const cells = await page.$$eval(".laps-row tbody tr", (rows) =>
    rows.map((r) => r.lastElementChild!.textContent),
  );
  expect(errors).toEqual([]);
  return cells;
};

export const hrvTile = async (status: string | undefined, languages: string[], label: string) => {
  const { page, errors } = await open(
    browser,
    pageFile({ data: withStatus(status), settings: { languages } }),
  );
  const tile = (await kpiTexts(page, "readiness"))[label];
  expect(errors).toEqual([]);
  return { tile, verdict: await page.textContent(".verdict") };
};

/** A number as the page's fmt.num shows it in English: no decimals. */
export const whole = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

/** The fitness, fatigue and form tiles for the last day of a fitnessFatigueFrom result. */
export const fitnessTiles = (ff: { fitness: number[]; fatigue: number[]; form: number[] }) => ({
  "Fitness · 42 days": [whole.format(ff.fitness.at(-1)!), null],
  "Fatigue · 7 days": [whole.format(ff.fatigue.at(-1)!), null],
  Form: [whole.format(ff.form.at(-1)!), null],
});

/** The dataset labels of the bar charts in the tiles of `widget`. */
export const barLabels = (page: Page, widget: string) =>
  page.evaluate(
    (w) =>
      Object.values(window.Chart!.instances)
        .filter(
          (c) =>
            c.canvas.closest(`[data-widget=${w}]`) &&
            (c.config as { type?: string }).type === "bar",
        )
        .flatMap((c) => c.data.datasets.map((d) => String(d.label))),
    widget,
  );

/** A lap row of `planVerdicts` with the given verdict. */
export const planRow = (verdict: unknown) => ({ step: 1, type: "cadence", verdict, why: "" });

/** The values and the gap setting of the dataset `label` of the chart in the tile of `widget`. */
export const chartDataset = (page: Page, widget: string, label: string) =>
  page.evaluate(
    ([w, l]) => {
      // a widget can draw more than one chart: take the dataset of the label from any of them
      const d = Object.values(window.Chart!.instances)
        .filter((c) => c.canvas.closest(`[data-widget=${w}]`))
        .flatMap((c) => c.data.datasets)
        .find((x) => x.label === l)!;
      return { data: d.data, spanGaps: (d as { spanGaps?: unknown }).spanGaps };
    },
    [widget, label],
  );

/** The value of the "Ascent" tile of the cycling board for the given activities. */
export async function cyclingAscent(
  activities: unknown[],
): Promise<{ text: string | null; page: Page }> {
  const { page, errors } = await open(
    browser,
    pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities } }),
    { hash: "#cycling" },
  );
  expect(errors).toEqual([]);
  const text = await page
    .locator("[data-id=typeKpis] .kpi", { has: page.locator(".kpi-label", { hasText: "Ascent" }) })
    .locator(".kpi-value")
    .textContent();
  return { text, page };
}

/** A ride on a trainer, with a distance or without. */
export const indoorRide = (n: number, start: string, km?: number) => ({
  id: 800 + n,
  name: "Ride",
  type: "indoor_cycling",
  sport: "cycling",
  duration: "45:00",
  start: `${start} 09:00:00`,
  ...(km === undefined ? {} : { km }),
});
/** The value and the number of lines under it of the "Distance" tile of the cycling board. */
export async function distanceTile(activities: unknown[]) {
  const { page, errors } = await open(
    browser,
    pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities } }),
    { hash: "#cycling" },
  );
  expect(errors).toEqual([]);
  const tile = page.locator("[data-id=typeKpis] .kpi", {
    has: page.locator(".kpi-label", { hasText: "Distance" }),
  });
  return {
    value: await tile.locator(".kpi-value").textContent(),
    sub: await tile.locator(".kpi-sub").count(),
  };
}

/** A synthetic running row; a missing name gives a row without the field. */
export const row = (id: number, name: string | undefined, start: string) => ({
  id,
  ...(name ? { name } : {}),
  type: "running",
  sport: "running",
  start,
  km: 5,
  duration: "30:00",
});

export type Block = "start" | "center" | "end";

/** The dates whose calendar tip leaves the viewport, or whose tile body grows a scroll. */
export async function badTipDates(page: Page, block: Block, only?: string): Promise<string[]> {
  return page.$$eval(
    "[data-id=calendar] .cal-cell[data-date]",
    (cells, args) => {
      const bad: string[] = [];
      const tip = document.querySelector(".cal-tip") as HTMLElement;
      const body = document.querySelector("[data-id=calendar] .tile-body") as HTMLElement;
      const view = document.documentElement;
      for (const cell of cells) {
        const date = cell.getAttribute("data-date") ?? "";
        if (args.only && date !== args.only) continue;
        cell.scrollIntoView({ block: args.block });
        cell.dispatchEvent(new PointerEvent("pointerenter"));
        const r = tip.getBoundingClientRect();
        const inside =
          !tip.hidden &&
          r.left >= 0 &&
          r.top >= 0 &&
          r.right <= view.clientWidth &&
          r.bottom <= view.clientHeight;
        if (!inside || body.scrollHeight > body.clientHeight) bad.push(date);
        cell.dispatchEvent(new PointerEvent("pointerleave"));
      }
      return bad;
    },
    { block, only },
  );
}

export const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/** The tip's top minus the cell's bottom, and the cell's top minus the tip's bottom. */
export const tipGaps = (page: Page, selector: string) =>
  page.evaluate((s) => {
    const cell = document.querySelector(s)!.getBoundingClientRect();
    const tip = document.querySelector(".cal-tip")!.getBoundingClientRect();
    return { below: tip.top - cell.bottom, above: cell.top - tip.bottom };
  }, selector);

export const followsCell = (g: { below: number; above: number }) =>
  Math.abs(g.below - 6) <= 1 || Math.abs(g.above - 6) <= 1;

export const saved = (page: Page) =>
  page.evaluate(() => localStorage.getItem(`garmin-layout:${location.pathname}`));
export const onlyActivities = (activities: unknown[]) =>
  pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities } });
export const zero = (sets: Record<string, unknown>[], field: string) =>
  sets.map((s) => ({ ...s, [field]: 0 }));
export const rows = (page: Page) =>
  page.$$eval(".ex-row .linkish", (r) => r.map((x) => x.textContent));
export const custom = (id: string, code: string) => ({ id, title: `Custom ${id}`, span: 1, code });
