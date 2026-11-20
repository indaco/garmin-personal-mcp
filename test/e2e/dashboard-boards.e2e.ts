import type { Page } from "playwright-core";
import { describe, expect, it } from "vitest";
import { digest } from "../../src/digest";
import { en as enTexts } from "../../src/page/i18n/en";
import { fitnessFatigueFrom, zonesOf } from "../../src/analytics/metrics";
import { DASHBOARD_VERSION } from "../../src/prompts";
import { data, open, pageFile } from "./page";
import {
  tiles,
  runningPace,
  without,
  noGarminLoad,
  scrollListeners,
  chartsWithoutTooltip,
  ratios,
  readinessSubs,
  kpiTexts,
  readinessTiles,
  lapTypes,
  hrvTile,
  whole,
  fitnessTiles,
  barLabels,
  planRow,
  chartDataset,
  cyclingAscent,
  indoorRide,
  distanceTile,
  row,
  badTipDates,
  frames,
  tipGaps,
  followsCell,
  onlyActivities,
  browser,
  withBrowser,
} from "./dashboard-shared";

withBrowser();

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

const nulls = (n: number) => Array.from({ length: n }, () => null);
const round = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
/** One ride a day from `from`, with each of `values` as its load. */
const dailyRides = (from: string, values: number[]) =>
  values.map((trainingLoad, i) => {
    const day = new Date(`${from}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + i);
    return bikeRide(day.toISOString().slice(0, 10), { trainingLoad });
  });
/** The datasets of the second Load safety chart, with values to 2 decimals, and the colour tokens. */
async function weekChart(page: Page) {
  const got = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const charts = Object.values(window.Chart!.instances).filter((c) =>
      c.canvas.closest("[data-widget=loadSafety]"),
    );
    return {
      charts: charts.length,
      sets: (charts[1]?.data.datasets ?? []).map((d) => {
        const x = d as unknown as Record<string, unknown>;
        return {
          label: d.label,
          type: d.type,
          data: d.data as (number | null)[],
          border: x.borderColor ?? null,
          background: x.backgroundColor ?? null,
          points: x.pointBackgroundColor ?? null,
          axis: x.yAxisID,
          gaps: x.spanGaps ?? null,
        };
      }),
      token: Object.fromEntries(
        ["accent", "text", "warn", "bad"].map((n) => [n, css.getPropertyValue(`--${n}`).trim()]),
      ),
    };
  });
  return { ...got, sets: got.sets.map((s) => ({ ...s, data: s.data.map(round) })) };
}

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

  describe("each week's monotony and strain in Load safety", () => {
    // the last 5 weeks: one ride (09-28), a week of exactly 2.0 (10-05), a week above 2 (10-12),
    // one ride (10-19) and the week in progress (10-26)
    const RIDES = [
      bikeRide("2026-09-30", { trainingLoad: 200 }),
      ...dailyRides("2026-10-05", [60, 60, 50, 50, 30, 30]),
      ...dailyRides("2026-10-12", [40, 40, 40, 40, 40, 40]),
      bikeRide("2026-10-21", { trainingLoad: 50 }),
      bikeRide("2026-10-26", { trainingLoad: 30 }),
    ];

    it("draws each week's strain as bars and monotony as a line, with a line at 2", async () => {
      const { page, errors } = await open(
        browser,
        pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities: RIDES } }),
      );
      const { charts, sets, token: c } = await weekChart(page);
      expect(charts).toBe(2);
      // a week with one session: 1 / sqrt(6); 6 equal days and a rest day: sqrt(6); the week of
      // 60, 60, 50, 50, 30, 30 and a rest day: mean 40, SD 20
      expect(sets).toEqual([
        {
          label: "Weekly strain",
          type: "bar",
          data: [...nulls(8), 81.65, 560, 587.88, 20.41, null],
          border: null,
          background: `${c.accent}99`,
          points: null,
          axis: "y1",
          gaps: null,
        },
        {
          label: "Weekly monotony",
          type: "line",
          data: [...nulls(8), 0.41, 2, 2.45, 0.41, null],
          border: c.text,
          background: null,
          points: [...Array.from({ length: 10 }, () => c.text), c.bad, c.text, c.text],
          axis: "y",
          gaps: false,
        },
        {
          label: "Monotony 2.0",
          type: "line",
          data: Array.from({ length: 13 }, () => 2),
          border: c.warn,
          background: null,
          points: null,
          axis: "y",
          gaps: null,
        },
      ]);
      expect(new Set([c.accent, c.text, c.warn]).size).toBe(3);
      // the screen-reader table of the second chart
      const table = await page.$$eval("[data-id=loadSafety] .sr-only table", (ts) =>
        [...(ts[1]?.querySelectorAll("tr") ?? [])].map((r) =>
          [...r.children].map((x) => x.textContent),
        ),
      );
      expect(table[0]).toEqual(["", "Weekly strain", "Weekly monotony", "Monotony 2.0"]);
      expect(table.slice(-5)).toEqual([
        ["Sep 28", "81.65", "0.41", "2"],
        ["Oct 5", "560", "2", "2"],
        ["Oct 12", "587.88", "2.45", "2"],
        ["Oct 19", "20.41", "0.41", "2"],
        ["Oct 26*", "", "", "2"],
      ]);
      // the tiles and the first chart do not change: 7 days of 50 and 30, one flagged week
      expect(await kpiTexts(page, "loadSafety")).toEqual({
        "Load · last 7 days": ["80", null],
        "Monotony · 7 days": ["0.61", null],
        "Strain · 7 days": ["49", null],
        "Weeks above +10%": ["1", null],
      });
      const first = async (label: string) =>
        ((await chartDataset(page, "loadSafety", label)).data as (number | null)[])
          .slice(-5)
          .map(round);
      expect(await first("Weekly load")).toEqual([200, 280, 240, 50, 30]);
      expect(await first("Change vs week before (%)")).toEqual([null, 40, -14.29, -79.17, null]);
      expect(errors).toEqual([]);
    });

    it("gives no monotony to the first week of a page whose data starts on a Tuesday", async () => {
      // the Monday before the data would read as a rest day
      const rides = [
        bikeRide("2026-08-04", { trainingLoad: 40 }),
        bikeRide("2026-08-06", { trainingLoad: 20 }),
        bikeRide("2026-08-11", { trainingLoad: 30 }),
      ];
      const { page, errors } = await open(
        browser,
        pageFile({
          data: { ...data, v: DASHBOARD_VERSION, start: "2026-08-04", activities: rides },
        }),
      );
      const { sets } = await weekChart(page);
      expect(sets.slice(0, 2).map((s) => s.data.slice(0, 2))).toEqual([
        [null, 12.25],
        [null, 0.41],
      ]);
      expect(errors).toEqual([]);
    });

    it.each([
      [
        "en-US",
        ["Weekly strain", "Weekly monotony", "Monotony 2.0"],
        "All activities. Red weeks rose more than 10%; a week in progress is not flagged. Monotony and strain (Foster) are estimates. The second chart shows the monotony and strain of each week; a week in progress and a week before the data have none.",
      ],
      [
        "it-IT",
        ["Strain settimanale", "Monotonia settimanale", "Monotonia 2,0"],
        "Tutte le attività. Le settimane rosse sono salite più del 10%; una settimana in corso non viene segnalata. Monotonia e strain (Foster) sono stime. Il secondo grafico mostra monotonia e strain di ogni settimana; una settimana in corso e una settimana prima dei dati non li hanno.",
      ],
      [
        "de-DE",
        ["Wochen-Strain", "Wochenmonotonie", "Monotonie 2,0"],
        "Alle Aktivitäten. Rote Wochen sind um mehr als 10% gestiegen; eine laufende Woche wird nicht markiert. Monotonie und Strain (Foster) sind Schätzungen. Das zweite Diagramm zeigt Monotonie und Strain jeder Woche; eine laufende Woche und eine Woche vor den Daten haben keine.",
      ],
      [
        "es-ES",
        ["Strain semanal", "Monotonía semanal", "Monotonía 2,0"],
        "Todas las actividades. Las semanas en rojo subieron más del 10%; una semana en curso no se marca. La monotonía y el strain (Foster) son estimaciones. El segundo gráfico muestra la monotonía y el strain de cada semana; una semana en curso y una semana anterior a los datos no los tienen.",
      ],
      [
        "fr-FR",
        ["Contrainte hebdomadaire", "Monotonie hebdomadaire", "Monotonie 2,0"],
        "Toutes les activités. Les semaines en rouge ont augmenté de plus de 10 % ; une semaine en cours n'est pas signalée. La monotonie et la contrainte (Foster) sont des estimations. Le second graphique montre la monotonie et la contrainte de chaque semaine ; une semaine en cours et une semaine avant les données n'en ont pas.",
      ],
      [
        "pt-BR",
        ["Strain semanal", "Monotonia semanal", "Monotonia 2,0"],
        "Todas as atividades. As semanas vermelhas subiram mais de 10%; uma semana em andamento não é sinalizada. Monotonia e strain (Foster) são estimativas. O segundo gráfico mostra a monotonia e o strain de cada semana; uma semana em andamento e uma semana antes dos dados não os têm.",
      ],
    ])("names the weekly series and their gaps in %s", async (locale, labels, text) => {
      const { page, errors } = await open(
        browser,
        pageFile({
          data: { ...data, v: DASHBOARD_VERSION, activities: RIDES },
          settings: { languages: ["en", "de", "es", "fr", "it", "pt"] },
        }),
        { locale },
      );
      expect((await weekChart(page)).sets.map((s) => s.label)).toEqual(labels);
      expect(
        await page.$$eval("[data-id=loadSafety] .note", (n) => n.map((x) => x.textContent)),
      ).toEqual([text]);
      expect(errors).toEqual([]);
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
      "warningSigns",
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

  describe("weekly series from synthetic runs", () => {
    const run = { type: "running", sport: "running" };
    // 13 weeks, the last starts on 2026-10-26: the runs fall in the weeks of 10-12 and 10-19
    const runs = [
      { ...run, id: 1, name: "A", start: "2026-10-20 08:00:00", km: 10, duration: "50:00" },
      { ...run, id: 2, name: "B", start: "2026-10-21 08:00:00", km: 5, duration: "25:00" },
      { ...run, id: 3, name: "C", start: "2026-10-13 08:00:00", km: 8, duration: "40:00" },
    ];
    const gaps = Array.from({ length: 10 }, () => null);
    /** Runs from day `monday` of October on, one a day, with these km. */
    const week = (monday: number, kms: number[]) =>
      kms.map((km, i) => ({
        ...run,
        id: monday * 10 + i,
        name: `R${i}`,
        start: `2026-10-${String(monday + i).padStart(2, "0")} 08:00:00`,
        km,
        duration: "30:00",
      }));

    it("draws the fastest 5 km and 10 km effort of each week in Best efforts", async () => {
      // week of 10-19: A is faster over 5 km, B over 10 km; week of 10-12: C alone
      const activities = [
        { ...runs[0], best: { "5k": "20:00", "10k": "50:00" } },
        { ...runs[1], best: { "5k": "25:00", "10k": "45:00" } },
        { ...runs[2], best: { "5k": "24:00", "10k": "48:00" } },
      ];
      const { page, errors } = await open(browser, onlyActivities(activities), {
        hash: "#running",
      });
      // seconds per km: 1440 / 5 and 1200 / 5, then 2880 / 10 and 2700 / 10
      expect((await chartDataset(page, "bestEfforts", "5 km")).data).toEqual([
        ...gaps,
        288,
        240,
        null,
      ]);
      expect((await chartDataset(page, "bestEfforts", "10 km")).data).toEqual([
        ...gaps,
        288,
        270,
        null,
      ]);
      expect(errors).toEqual([]);
    });

    it("draws the share of the longest run in the weekly distance in Long runs", async () => {
      const { page, errors } = await open(browser, onlyActivities(runs), { hash: "#running" });
      const share = (await chartDataset(page, "longRuns", "Longest run share of weekly distance"))
        .data as (number | null)[];
      // 10 of 15 km in the week of 10-19, 8 of 8 km in the week before, no run in the others
      expect(share.slice(0, 10)).toEqual(gaps);
      expect(share[10]).toBe(100);
      expect(share[11]).toBeCloseTo((10 / 15) * 100, 6);
      expect(share[12]).toBeNull();
      expect(errors).toEqual([]);
    });

    it("marks a Long runs week only above 35%, not at 35%", async () => {
      const activities = [...week(5, [7, 7, 6]), ...week(12, [8, 6, 6]), ...week(19, [5, 5, 5, 5])];
      const { page, errors } = await open(browser, onlyActivities(activities), {
        hash: "#running",
      });
      const label = "Longest run share of weekly distance";
      // the weeks of 10-05, 10-12 and 10-19
      const share = (await chartDataset(page, "longRuns", label)).data as (number | null)[];
      expect(share.slice(9, 12)).toEqual([35, 40, 25]);
      const colors = (await page.evaluate(
        (l) =>
          Object.values(window.Chart!.instances)
            .filter((c) => c.canvas.closest("[data-widget=longRuns]"))
            .flatMap((c) => c.data.datasets)
            .find((d) => d.label === l)!.backgroundColor,
        label,
      )) as string[];
      expect(colors[9]).toBe(colors[11]);
      expect(colors[10]).not.toBe(colors[11]);
      expect(errors).toEqual([]);
    });

    it("draws the zone minutes of each week in HR zones", async () => {
      const floors = zonesOf(data.zones).floors;
      const activities = [
        { ...runs[0], hrZonesSec: [600, 1200, 0, 0, 1800] },
        { ...runs[1], hrZonesSec: [60, 0, 0, 0, 0] },
      ];
      const { page, errors } = await open(browser, onlyActivities(activities), {
        hash: "#running",
      });
      const zone = async (n: number) =>
        (await chartDataset(page, "hrZones", `Z${n + 1} (${floors[n]}+)`)).data as number[];
      // minutes of the week of 10-19; the other weeks have none
      expect((await Promise.all([0, 1, 2, 3, 4].map(zone))).map((d) => d.at(-2))).toEqual([
        11, 20, 0, 0, 30,
      ]);
      expect((await zone(0)).filter((v) => v > 0)).toHaveLength(1);
      expect(errors).toEqual([]);
    });

    it("shows the speed of a ride over its moving time in Bike details", async () => {
      const ride = data.activities.find((a: Record<string, unknown>) => a.type === "cycling");
      const rides = [
        { ...ride, id: 11, start: "2026-10-20 09:00:00", km: 30, duration: "1:30:00" },
        { ...without(ride, ["km"]), id: 12, start: "2026-10-19 09:00:00" },
      ];
      const { page, errors } = await open(browser, onlyActivities(rides), { hash: "#cycling" });
      const speeds = await page.$$eval("[data-id=bikeDetails] table.data tbody tr", (r) =>
        r.map((x) => x.children[3].textContent),
      );
      expect(speeds).toEqual(["20.0 km/h", "n/a"]);
      expect(errors).toEqual([]);
    });

    it("totals the load of a run without a Garmin load from its heart rate", async () => {
      const maxHR = zonesOf(data.zones).maxHR!;
      const noLoadRun = { ...runs[0], duration: "60:00", avgHR: 150 };
      const { page, errors } = await open(browser, onlyActivities([noLoadRun]), {
        hash: "#running",
      });
      const tile = page
        .locator("[data-id=typeKpis] .kpi", {
          has: page.locator(".kpi-label", { hasText: "Garmin training load" }),
        })
        .locator(".kpi-value");
      expect(await tile.textContent()).toBe(whole.format((60 * 150) / maxHR));
      expect(errors).toEqual([]);
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

  it("lists in Long runs a run over 15 km and a race, not a short run with laps", async () => {
    const withLaps = data.activities.find((a: { laps?: unknown[] }) => a.laps?.length);
    const make = (id: number, name: string, km: number, race?: boolean) => ({
      ...withLaps,
      id,
      name,
      km,
      race,
      start: `2026-10-2${id} 08:00:00`,
    });
    const activities = [
      make(4, "Short Loop", 15),
      make(3, "Long Loop", 15.5),
      make(2, "Park Race", 5, true),
    ];
    const { page, errors } = await open(
      browser,
      pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities } }),
      { hash: "#running" },
    );
    const names = await page.$$eval("[data-id=longRuns] table.data tbody tr", (r) =>
      r.map((x) => x.children[1].textContent),
    );
    expect(names.toSorted()).toEqual(["Long Loop", "Park Race"]);
    expect(errors).toEqual([]);
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

  it("leaves a planned session of a week without sets out of the KPIs and the table", async () => {
    const { page, errors } = await planPage(
      planned({
        "2026-10-12": [miss("Plank", "sets")],
        "2026-10-16": "no sets",
        "2026-10-19": [hit("Plank")],
      }),
    );
    expect(await kpiTexts(page, "planAdherence")).toEqual({
      "Planned sessions": ["1", null],
      "Exercises hit": ["1", null],
      "Exercises missed": ["0", null],
      "Hit share": ["100%", null],
    });
    expect(await page.$$("[data-id=planAdherence] table")).toHaveLength(0);
    expect(await page.innerText("[data-id=planAdherence]")).toContain(
      "1 strength session has no sets",
    );
    expect(errors).toEqual([]);
  });

  it("shows the empty state and the no-sets note when every planned session is in a week without sets", async () => {
    const { page, errors } = await planPage(
      planned({ "2026-10-12": [hit("Plank")], "2026-10-16": "no sets" }),
    );
    expect(await page.innerText("[data-id=planAdherence] .empty")).toBe(
      "No planned strength session in this period.",
    );
    const text = await page.innerText("[data-id=planAdherence]");
    expect(text).toContain(SKIPPED);
    expect(text).toContain("1 strength session has no sets");
    expect(await page.$$("[data-id=planAdherence] .kpi")).toHaveLength(0);
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
