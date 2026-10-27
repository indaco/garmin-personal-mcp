import { readFileSync, statSync, writeFileSync } from "node:fs";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
const hash = (page: Page) => page.evaluate(() => location.hash);

const ALL_PRESET = [
  "kpis",
  "readiness",
  "calendar",
  "periodComparison",
  "records",
  "weeklyVolume",
  "intensityMinutes",
  "loadSafety",
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

describe("the page", () => {
  it("keeps the template small", () => {
    // minified, with only the Chart.js parts the page uses: Chart.js is most of it
    expect(statSync("dist/dashboard.html").size).toBeLessThan(300 * 1024);
  });

  it("shows the preset widgets of the All board and no errors", async () => {
    const { page, errors } = await open(browser, pageFile());
    expect(await page.textContent("h1")).toBe("Training + Recovery");
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

  it("selects one type with a chip, and a second click shows all again", async () => {
    const { page } = await open(browser, pageFile());
    const pressed = () =>
      page.$$eval(".chips .chip[aria-pressed=true]", (els) => els.map((e) => e.textContent));
    await page.click(".chip-running");
    expect(await pressed()).toEqual(["Run"]);
    await page.click(".chip-running");
    expect(await pressed()).toEqual(["All"]);
  });

  it("switches between the 11 themes and keeps the choice", async () => {
    const file = pageFile();
    const { page, errors } = await open(browser, file);
    const themes = await page.$$eval("#theme option", (o) =>
      o.map((x) => (x as HTMLOptionElement).value),
    );
    expect(themes).toHaveLength(11);
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
    const { page } = await open(browser, pageFile(), { locale: "it-IT" });
    expect(await page.textContent("h1")).toBe("Allenamento + Recupero");
    expect(await page.textContent("[data-tab=running]")).toContain("Corsa");
    await page.click(".account summary");
    await page.selectOption("#lang", "en");
    expect(await page.textContent("h1")).toBe("Training + Recovery");
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
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

describe("edit mode", () => {
  const one = {
    rev: "r0",
    base: "preset",
    boards: { all: [{ id: "coachNotes", widget: "coachNotes", span: 3 }] },
  };
  const two = {
    rev: "r1",
    base: "preset",
    boards: {
      all: [
        { id: "coachNotes", widget: "coachNotes", span: 3 },
        { id: "x", widget: "notYet", span: 1 },
      ],
    },
  };

  it("hides a widget in its place, and a second click shows it again", async () => {
    const { page } = await open(browser, pageFile({ layout: one }));
    await page.click("text=Edit layout");
    await page.click("[aria-label='Hide Coach notes']");
    expect(await page.getAttribute("[data-id=coachNotes]", "class")).toContain("is-hidden");
    await page.click("text=Done");
    expect(await tiles(page)).toEqual([]);
    expect(await page.textContent(".board-empty")).toContain("no widgets");
    await page.click("text=Edit layout");
    await page.click("[aria-label='Show Coach notes']");
    await page.click("text=Done");
    expect(await tiles(page)).toEqual(["coachNotes"]);
  });

  it("moves a widget with the buttons and sets its width", async () => {
    const { page } = await open(browser, pageFile({ layout: two }));
    await page.click("text=Edit layout");
    expect(await tiles(page)).toEqual(["coachNotes", "x"]);
    await page.click("[aria-label='Move Coach notes later']");
    expect(await tiles(page)).toEqual(["x", "coachNotes"]);
    await page.click("[aria-label='Move Coach notes earlier']");
    expect(await tiles(page)).toEqual(["coachNotes", "x"]);
    await page.click("[aria-label='Width 1 for Coach notes']");
    expect(await page.getAttribute("[data-id=coachNotes]", "class")).toContain("span-1");
  });

  it("moves a widget by drag", async () => {
    const { page } = await open(browser, pageFile({ layout: two }));
    await page.click("text=Edit layout");
    const handle = await page.$("[aria-label='Drag to move Coach notes']");
    const target = await page.$("[data-id=x]");
    const from = (await handle!.boundingBox())!;
    const to = (await target!.boundingBox())!;
    await page.mouse.move(from.x + 5, from.y + 5);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 5 });
    await page.mouse.up();
    expect(await tiles(page)).toEqual(["x", "coachNotes"]);
  });

  it("removes a widget, adds it back from the catalogue, and resets to the preset", async () => {
    const { page } = await open(browser, pageFile({ layout: two }));
    await page.click("text=Edit layout");
    await page.click("[aria-label='Remove Coach notes']");
    expect(await tiles(page)).toEqual(["x"]);
    await page.click("text=Add widget");
    await page.click(".catalogue li:has-text('Coach notes') button");
    expect(await tiles(page)).toEqual(["x", "coachNotes"]);
    await page.click("text=Reset to preset");
    await page.click("text=Done");
    expect(await tiles(page)).toEqual(ALL_PRESET);
  });

  it("keeps a browser edit after a reload, until the page gets a new layout", async () => {
    const file = pageFile({ layout: two });
    const { page } = await open(browser, file);
    await page.click("text=Edit layout");
    await page.click("[aria-label='Remove Coach notes']");
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
  });

  it("copies the layout as text that Claude can save", async () => {
    const { page } = await open(browser, pageFile({ layout: two }));
    await page.click("text=Edit layout");
    await page.click("text=Copy layout");
    const text = await page.inputValue(".layout-text");
    expect(JSON.parse(text)).toEqual({ base: "preset", boards: two.boards });
  });

  it("starts empty on a blank layout", async () => {
    const { page } = await open(
      browser,
      pageFile({ layout: { rev: "b", base: "blank", boards: {} } }),
    );
    expect(await tiles(page)).toEqual([]);
    expect(await page.textContent(".board-empty")).toContain("Add widget");
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
    await page.click("text=Edit layout");
    await page.focus("[aria-label='Move Weekly volume later']");
    await page.keyboard.press("Enter");
    expect(await focused(page)).toBe("Move Weekly volume later");
    expect(await page.textContent("#announce")).toBe("Weekly volume moved to position 7 of 11");
    // a removed tile gives focus to the tile in its place
    await page.focus("[aria-label='Remove Weekly volume']");
    await page.keyboard.press("Enter");
    expect(await focused(page)).toMatch(/Load safety$/);
    expect(await page.textContent("#announce")).toBe("Weekly volume removed");
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

describe("overview widgets", () => {
  it("shows a tooltip on every chart", async () => {
    const { page, errors } = await open(browser, pageFile());
    expect(await page.evaluate(() => Object.keys(window.Chart!.instances).length)).toBeGreaterThan(
      3,
    );
    expect(await chartsWithoutTooltip(page)).toEqual([]);
    expect(errors).toEqual([]);
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

  it("shows a calendar day with its activities on hover", async () => {
    const { page } = await open(browser, pageFile());
    await page.hover("[data-date='2026-10-17']");
    const tip = await page.textContent(".cal-tip");
    expect(tip).toContain("Riverside Half Marathon");
    expect(await page.isVisible(".cal-tip")).toBe(true);
  });

  it("lists the activities, and opens and closes their laps", async () => {
    const { page } = await open(browser, pageFile());
    const rows = () =>
      page.$$eval("[data-id=activities] table.data > tbody > tr:not(.laps-row)", (r) => r.length);
    expect(await rows()).toBe(15);
    await page.click("text=Show all 75");
    expect(await rows()).toBe(75);
    await page.click("text=Show fewer");
    expect(await rows()).toBe(15);
    const button = "[data-id=activities] button[aria-expanded]";
    await page.click(button);
    expect(await page.$$eval(".laps-row", (r) => r.length)).toBe(1);
    await page.click(`${button}[aria-expanded=true]`);
    expect(await page.$$eval(".laps-row", (r) => r.length)).toBe(0);
  });

  it("filters the activities with the type chips", async () => {
    const { page } = await open(browser, pageFile());
    await page.click(".chip-running");
    expect(await page.textContent("[data-id=activities] .more")).toBe("Show all 36");
    // the load ratio still uses all activities, and says so
    expect(await page.textContent("[data-id=kpis]")).toContain("Uses all activities");
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

  it("shows the widgets in Italian", async () => {
    const { page, errors } = await open(browser, pageFile(), { locale: "it-IT" });
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
      "bestEfforts",
      "races",
      "aerobicFitness",
      "intensityShare",
      "runningForm",
      "runWalk",
      "trainingEffect",
      "racePredictor",
      "longRuns",
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
  });

  it("says one session so far instead of a trend", async () => {
    const ride = data.activities.find((a: { type: string }) => a.type === "cycling");
    const { page } = await open(
      browser,
      pageFile({ data: { ...data, activities: [ride], v: 3 } }),
      { hash: "#cycling" },
    );
    expect(await page.textContent("[data-id=typeWeekly]")).toContain("One session so far");
    expect(await page.textContent("[data-id=typeKpis]")).toContain("One session so far");
  });
});

const rows = (page: Page) =>
  page.$$eval(".ex-row", (r) => r.map((x) => x.firstElementChild!.textContent));

describe("strength board", () => {
  it("shows the Strength widgets", async () => {
    const { page, errors } = await open(browser, pageFile(), { hash: "#strengthTraining" });
    expect(await tiles(page)).toEqual([
      "typeKpis",
      "typeWeekly",
      "hrZones",
      "setsPerCategory",
      "muscleBalance",
      "exercises",
      "strengthSessions",
    ]);
    expect(await rows(page)).toHaveLength(9);
    expect(await page.textContent("[data-id=muscleBalance]")).toMatch(
      /Push : pull sets\s*[\d.]+ : 1/,
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

    await page.focus("[data-exercise=plank]");
    await page.keyboard.press("Enter");
    expect(await page.textContent(".detail h3")).toBe("Plank");

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
      data: { ...data, v: 3, activities: [hike, swim, yoga, tennis, ski, ...data.activities] },
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
  });

  it("gives a new sport the board of the Other tab", async () => {
    const { page, errors } = await open(browser, more(), { hash: "#alpineSkiing" });
    expect(await tiles(page)).toEqual(["typeKpis", "typeWeekly", "hrZones", "activities"]);
    expect(await page.textContent("[data-tab=alpineSkiing] .count")).toBe("1");
    expect(await chartsWithoutTooltip(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("draws every extra board without errors, with a tooltip on every chart", async () => {
    const { page, errors } = await open(browser, more());
    for (const tab of ["walking", "hiking", "cycling", "swimming", "racket", "generic"]) {
      await page.click(`[data-tab=${tab}]`);
      expect([tab, await chartsWithoutTooltip(page)]).toEqual([tab, []]);
    }
    expect(errors).toEqual([]);
  });

  it("gives the numbers of each sport", async () => {
    const { page } = await open(browser, more(), { hash: "#hiking" });
    expect(await page.textContent("[data-id=hikeVertical]")).toContain("300 m/h");
    await page.click("[data-tab=swimming]");
    expect(await page.textContent("[data-id=swimDetails]")).toContain("2:00/100 m");
    await page.click("[data-tab=cycling]");
    expect(await page.textContent("[data-id=bikeDetails] .kpis")).toContain("3 rides");
    await page.click("[data-tab=racket]");
    // tennis and padel share the board; the sport column tells them apart
    const sports = await page.$$eval("[data-id=racketDetails] tbody tr", (r) =>
      r.map((x) => x.children[2].textContent),
    );
    // in the order of the data, where the test puts tennis first
    expect(sports).toEqual(["Tennis", "Padel", "Padel", "Padel"]);
    expect(await page.textContent("[data-tab=racket] .count")).toBe("4");
    await page.click("[data-tab=walking]");
    expect(await tiles(page)).toEqual([
      "typeKpis",
      "typeWeekly",
      "hrZones",
      "walkDetails",
      "steps",
      "activities",
    ]);
  });
});

const custom = (id: string, code: string) => ({ id, title: `Custom ${id}`, span: 1, code });
const on = (...ids: string[]) => ({
  rev: "c",
  base: "preset",
  boards: { all: ids.map((id) => ({ id, widget: id, span: 1 })) },
});

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

  it("shows the error of a failing widget in its own tile only", async () => {
    const { page, errors } = await open(
      browser,
      pageFile({
        widgets: [
          custom("broken", "throw new Error('no data here');"),
          custom("bad", "this is not code ("),
        ],
        layout: on("broken", "bad", "coachNotes"),
      }),
    );
    expect(await page.textContent("[data-id=broken] .error")).toContain("no data here");
    expect(await page.textContent("[data-id=bad] .error")).toContain("This widget failed");
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
    await page.click("text=Edit layout");
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
