import { readFileSync, statSync, writeFileSync } from "node:fs";
import axe from "axe-core";
import type { Page } from "playwright-core";
import { describe, expect, it } from "vitest";
import { THEMES } from "../../src/page/theme";
import { preset } from "../../src/page/presets";
import { DASHBOARD_VERSION } from "../../src/prompts";
import { data, open, pageFile } from "./page";
import {
  tabs,
  tiles,
  hash,
  without,
  hours,
  startEdit,
  stopsUnder,
  stickyOffset,
  MET,
  ALL_PRESET,
  shownUnits,
  chartDataset,
  row,
  frames,
  saved,
  custom,
  browser,
  withBrowser,
} from "./dashboard-shared";

withBrowser();

const missed = (due?: string) =>
  pageFile({ data: { ...data, v: DASHBOARD_VERSION, updated: hours(-26), due } });

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
    expect(await page.textContent(`${sel} p`)).toContain("May 10 to Aug 2, 2026");
    // 1 session now against 3 before: the row of 9 May is outside the 85 days
    expect(await page.textContent(`${sel} tbody tr:first-child td:nth-child(2)`)).toContain(
      "1 ▼ 67%",
    );
    expect(errors).toEqual([]);
  });

  it("gives the year of a range start only when the range ends in another year", async () => {
    // 2025-12-01 to 2026-01-25 is 56 days, so the previous period is 2025-10-06 to 2025-11-30
    const { page, errors } = await open(
      browser,
      pageFile({
        data: {
          ...data,
          v: DASHBOARD_VERSION,
          generated: "2026-01-25",
          weeks: 8,
          start: "2025-12-01",
          end: "2026-01-25",
          prevStart: "2025-10-06",
          prevEnd: "2025-11-30",
          activities: [row(9601, "Quarry Loop", "2026-01-10 07:00:00")],
          previousActivities: [row(9611, "Quarry Loop", "2025-11-01 07:00:00")],
        },
      }),
    );
    expect(await page.textContent("[data-widget=periodComparison] p")).toContain(
      "Dec 1, 2025 to Jan 25, 2026 against Oct 6 to Nov 30, 2025",
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
    expect(await page.textContent(`${sel} p`)).toContain("May 11 to Aug 2, 2026");
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

    // sq is as tall as it is wide: the tip counts it at width 1, but in its new row it gets width 2
    const squareBoard = [of("sq", 1), of("b", 1), of("a", 1), of("c", 1), of("d", 1)];
    const openSquare = (layout: object) =>
      open(
        browser,
        pageFile({
          layout,
          widgets: [
            custom("sq", `el.innerHTML = '<div style="aspect-ratio:1"></div>';`),
            tallBox("a", 300),
            tallBox("b", 100),
            tallBox("c", 100),
            tallBox("d", 100),
          ],
        }),
        { viewport: { width: 1280, height: 800 } },
      );
    const squareTip = "swap Custom b and Custom a";

    it("keeps the board when the swap, drawn, does not even out the rows", async () => {
      const { page, errors } = await openSquare(onAll(squareBoard));
      await startEdit(page);
      await page.click(".edit-bar >> text=Auto-arrange");
      const pressed = "sq:1 b:1 a:1 c:2 d:1";
      expect(await spans(page)).toBe(pressed);
      expect(await page.innerText(".edit-tip")).toContain(squareTip);
      await page.click(".edit-tip button");
      expect(await spans(page)).toBe(pressed);
      const failed =
        "Swapping Custom b and Custom a does not even out the rows here, so the board stays as it was.";
      expect(await page.innerText(".edit-tip")).toBe(failed);
      expect(await page.$(".edit-tip button")).toBeNull();
      expect(await page.textContent("#announce")).toBe(failed);
      await page.click(".edit-bar >> text=Done");
      const { boards } = JSON.parse((await saved(page))!).layout;
      expect(boards.all.map((i: { id: string }) => i.id)).toEqual(["sq", "b", "a", "c", "d"]);
      expect(errors).toEqual([]);
    });

    it("does not suggest a refused swap again on that board until edit mode ends", async () => {
      const layout = { ...onAll(squareBoard), boards: { all: squareBoard, running: squareBoard } };
      const { page, errors } = await openSquare(layout);
      await startEdit(page);
      await page.click(".edit-bar >> text=Auto-arrange");
      await page.click(".edit-tip button");
      await page.click(".edit-bar >> text=Auto-arrange");
      expect(await page.$(".edit-tip")).toBeNull();
      expect(await page.textContent("#announce")).toBe("Widgets arranged");
      // another board has its own refused swaps
      await page.click("[role=tab][data-tab=running]");
      await page.click(".edit-bar >> text=Auto-arrange");
      expect(await page.innerText(".edit-tip")).toContain(squareTip);
      await page.click("[role=tab][data-tab=all]");
      await page.click(".edit-bar >> text=Discard");
      await page.click("dialog >> text=Discard changes");
      await startEdit(page);
      await page.click(".edit-bar >> text=Auto-arrange");
      expect(await page.innerText(".edit-tip")).toContain(squareTip);
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
    expect(await page.textContent(".window-toggle")).toBe("Last 4 weeks ▾");
  });

  it("shows the year in the week menus and in a custom range", async () => {
    const { page } = await open(browser, pageFile(), phone);
    const options = await page.$$eval("#from option", (list) =>
      list.map((o) => o.textContent ?? ""),
    );
    expect(options.length).toBeGreaterThan(0);
    for (const text of options) expect(text).toMatch(/, \d{4}/);
    await page.click(".window-toggle");
    await page.selectOption("#from", { index: 2 }); // 11 weeks: no preset
    // both ends in 2026: the year shows once
    expect(await page.textContent(".window-toggle")).toBe("Aug 17 – Oct 26, 2026 ▾");
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
    expect(await focused(page)).toBe("Last 8 weeks");
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
