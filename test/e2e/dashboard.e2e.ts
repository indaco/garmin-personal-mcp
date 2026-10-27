import { readFileSync, writeFileSync } from "node:fs";
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
  "fitnessAge",
  "periodComparison",
  "records",
  "weeklyVolume",
  "intensityMinutes",
  "loadSafety",
  "calendar",
  "loadVsRecovery",
  "hrv",
  "restingHr",
  "sleep",
  "sleepNeed",
  "bedtime",
  "bodyBattery",
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
      ["run", "36"],
      ["strength", "24"],
      ["walk", "9"],
      ["bike", "3"],
      ["padel", "3"],
    ]);
  });

  it("keeps the tab and the window in the URL hash", async () => {
    const file = pageFile();
    const { page } = await open(browser, file);
    await page.click("[data-tab=run]");
    await page.focus("[data-tab=run]");
    await page.keyboard.press("ArrowRight");
    expect(await page.getAttribute("[data-tab=strength]", "aria-selected")).toBe("true");
    await page.click(".window-bar .chip >> text=Last 4");
    expect(await hash(page)).toBe("#strength@2026-10-05_2026-10-26");

    const again = await open(browser, file, { hash: "#strength@2026-10-05_2026-10-26" });
    expect(await again.page.getAttribute("[data-tab=strength]", "aria-selected")).toBe("true");
    expect(await again.page.inputValue("#from")).toBe("2026-10-05");
  });

  it("selects one type with a chip, and a second click shows all again", async () => {
    const { page } = await open(browser, pageFile());
    const pressed = () =>
      page.$$eval(".chips .chip[aria-pressed=true]", (els) => els.map((e) => e.textContent));
    await page.click(".chip-run");
    expect(await pressed()).toEqual(["Run"]);
    await page.click(".chip-run");
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
    for (const theme of themes) await page.selectOption("#theme", theme);
    await page.selectOption("#theme", "paper");
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("paper");
    expect(errors).toEqual([]);
  });

  it("follows the browser language, and the language menu", async () => {
    const { page } = await open(browser, pageFile(), { locale: "it-IT" });
    expect(await page.textContent("h1")).toBe("Allenamento + Recupero");
    expect(await page.textContent("[data-tab=run]")).toContain("Corsa");
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

describe("overview widgets", () => {
  it("shows a tooltip on every chart", async () => {
    const { page, errors } = await open(browser, pageFile());
    expect(await page.evaluate(() => Object.keys(window.Chart!.instances).length)).toBeGreaterThan(
      8,
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
    await page.click(".chip-run");
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
    for (const tab of ["run", "strength", "walk", "bike", "padel"]) {
      await page.click(`[data-tab=${tab}]`);
      expect([tab, await chartsWithoutTooltip(page)]).toEqual([tab, []]);
    }
    expect(errors).toEqual([]);
  });

  it("fits every board on a phone", async () => {
    const { page } = await open(browser, pageFile(), { viewport: { width: 390, height: 844 } });
    for (const tab of ["all", "run", "strength", "walk", "bike", "padel"]) {
      await page.click(`[data-tab=${tab}]`);
      expect([
        tab,
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ]).toEqual([tab, true]);
    }
  });

  it("shows the Run widgets", async () => {
    const { page } = await open(browser, pageFile(), { hash: "#run" });
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
      { hash: "#bike" },
    );
    expect(await page.textContent("[data-id=typeWeekly]")).toContain("One session so far");
    expect(await page.textContent("[data-id=typeKpis]")).toContain("One session so far");
  });
});
