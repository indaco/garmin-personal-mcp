// The Year tab: the recap of the calendar year that the server puts in `data.year`.
import { readFileSync } from "node:fs";
import type { Page } from "playwright-core";
import { describe, expect, it } from "vitest";
import type { YearSummary } from "../../src/analytics/year";
import type { Settings } from "../../src/page/settings";
import { DASHBOARD_VERSION } from "../../src/prompts";
import {
  browser,
  chartDataset,
  chartsWithoutTooltip,
  custom,
  startEdit,
  tabs,
  tiles,
  withBrowser,
} from "./dashboard-shared";
import { data, open, pageFile } from "./page";

withBrowser();

const month = (
  m: string,
  days: number,
  activeDays: number,
  km: number | null,
  load: number | null,
): YearSummary["months"][number] => ({
  month: m,
  covered: "all",
  days,
  activeDays,
  sessions: activeDays + 1,
  km,
  hours: activeDays * 1.5,
  load,
});

/** One record, of a run without a name. */
const one = (time: string) => [{ date: "2026-01-10", time, previous: null }];

/** A whole year until 20 March, with a value in every part. */
const YEAR: YearSummary = {
  v: 1,
  year: 2026,
  from: "2026-01-01",
  to: "2026-03-20",
  coverage: {
    activities: { from: "2026-01-01", to: "2026-03-20" },
    missing: [],
    complete: true,
    hrv: { from: "2026-01-01", to: "2026-03-20" },
    rhr: { from: "2026-03-07", to: "2026-03-20" },
  },
  measure: "load",
  totals: {
    activities: 1234,
    activeDays: 60,
    km: 812.4,
    hours: 95.5,
    ascentM: 5400,
    calories: 45000,
    load: 6200,
    estimatedLoads: 0,
    unlikelyTimes: 0,
  },
  sports: [
    { sport: "running", sessions: 40, km: 400.5, hours: 40.2, load: 4000 },
    { sport: "alpineSkiing", sessions: 1, km: null, hours: 2, load: null },
  ],
  topSport: "running",
  months: [
    month("2026-01", 31, 12, 1200.5, 1500),
    month("2026-02", 28, 10, 90.2, 1300),
    month("2026-03", 20, 8, null, 1100),
  ],
  biggestMonth: { month: "2026-01", km: 1200.5, hours: 18, load: 1500 },
  biggestWeek: { monday: "2026-01-12", km: 41.2, hours: 5.5, load: 480 },
  bestBlock: { from: "2026-01-05", to: "2026-02-01", value: 1456, sessions: 14 },
  mostConsistentMonth: { month: "2026-02", activeDays: 10, days: 28, sharePct: 36 },
  streaks: {
    days: { from: "2026-01-03", to: "2026-01-07", length: 5 },
    weeks: { from: "2026-02-02", to: "2026-02-08", length: 1 },
  },
  longest: {
    date: "2026-01-18",
    id: 11,
    name: "Long <b>run</b>",
    sport: "running",
    hours: 3.2,
    km: 30.1,
  },
  biggest: {
    date: "2026-02-15",
    id: 12,
    name: "Hills",
    sport: "running",
    load: 222,
    estimate: true,
  },
  records: {
    "5k": [
      { date: "2026-01-10", id: 1, name: "First", time: "25:00", previous: null },
      { date: "2026-02-10", id: 2, time: "24:10", previous: "25:00" },
    ],
    half: [{ date: "2026-03-01", id: 3, name: "Race", time: "1:55:00", previous: null }],
  },
  rhythm: {
    weekdays: [3, 0, 5, 1, 2, 9, 7],
    topWeekday: 5,
    timeOfDay: { night: 1, morning: 14, afternoon: 2, evening: 10 },
    topTimeOfDay: "morning",
  },
  hrv: [
    { month: "2026-01", mean: 61, nights: 31 },
    { month: "2026-02", mean: 58, nights: 28 },
    { month: "2026-03", mean: null, nights: 3 },
  ],
  rhr: [{ month: "2026-03", mean: 48, days: 14 }],
};

/** A year without one covered day: the shape that the server gives. */
const EMPTY: YearSummary = {
  ...YEAR,
  coverage: {
    activities: null,
    missing: [{ from: "2026-01-01", to: "2026-03-20" }],
    complete: false,
    hrv: null,
    rhr: null,
  },
  measure: "hours",
  totals: {
    activities: null,
    activeDays: null,
    km: null,
    hours: null,
    ascentM: null,
    calories: null,
    load: null,
    estimatedLoads: null,
    unlikelyTimes: null,
  },
  sports: [],
  topSport: null,
  months: ["2026-01", "2026-02"].map((m) => ({
    month: m,
    covered: "none",
    days: 0,
    activeDays: null,
    sessions: null,
    km: null,
    hours: null,
    load: null,
  })),
  biggestMonth: null,
  biggestWeek: null,
  bestBlock: null,
  mostConsistentMonth: null,
  streaks: { days: null, weeks: null },
  longest: null,
  biggest: null,
  records: {},
  rhythm: {
    weekdays: [0, 0, 0, 0, 0, 0, 0],
    topWeekday: null,
    timeOfDay: { night: 0, morning: 0, afternoon: 0, evening: 0 },
    topTimeOfDay: null,
  },
  hrv: undefined,
  rhr: undefined,
};

/** A year whose days are there, without one session. */
const IDLE: YearSummary = {
  ...EMPTY,
  coverage: YEAR.coverage,
  totals: {
    activities: 0,
    activeDays: 0,
    km: 0,
    hours: 0,
    ascentM: 0,
    calories: 0,
    load: 0,
    estimatedLoads: 0,
    unlikelyTimes: 0,
  },
  months: ["2026-01", "2026-02"].map((m) => ({
    month: m,
    covered: "all",
    days: 28,
    activeDays: 0,
    sessions: 0,
    km: 0,
    hours: 0,
    load: 0,
  })),
};

const ON: Settings = { yearReview: true };

const openYear = (
  year: YearSummary | undefined = YEAR,
  blocks: {
    settings?: Settings;
    layout?: unknown;
    widgets?: unknown;
    extra?: object;
    hash?: string;
    locale?: string;
    timezoneId?: string;
    viewport?: { width: number; height: number };
    init?: string;
  } = {},
) => {
  const { settings = ON, extra = {}, hash = "#year", layout, widgets, ...options } = blocks;
  return open(
    browser,
    pageFile({
      data: { ...data, v: DASHBOARD_VERSION, ...(year ? { year } : {}), ...extra },
      settings,
      layout,
      widgets,
    }),
    { hash, ...options },
  );
};

/** The page with no recap in its data. */
const openWithout = (blocks: Parameters<typeof openYear>[1] = {}) =>
  open(
    browser,
    pageFile({
      data: { ...data, v: DASHBOARD_VERSION },
      settings: blocks.settings ?? ON,
      layout: blocks.layout,
      widgets: blocks.widgets,
    }),
    { hash: blocks.hash ?? "#year" },
  );

const text = async (page: Page, id: string) =>
  ((await page.textContent(`[data-id=${id}] .tile-body`)) ?? "").trim();

/** The KPI tiles of a widget: label, value, then the lines under it. */
const kpis = (page: Page, id: string) =>
  page.$$eval(`[data-id=${id}] .kpi`, (els) =>
    els.map((e) => [...e.children].map((c) => c.textContent)),
  );

/** The rows of the tables that a widget shows: not the hidden data table of a chart. */
const rows = (page: Page, id: string) =>
  page.$$eval(`[data-id=${id}] table.data:not(.sr-only *) tbody tr`, (els) =>
    els.map((e) => [...e.children].map((c) => c.textContent)),
  );

/** The rows of the data table of a chart, for screen readers. */
const chartRows = (page: Page, id: string) =>
  page.$$eval(`[data-id=${id}] .sr-only tbody tr`, (els) =>
    els.map((e) => [...e.children].map((c) => c.textContent)),
  );

/** The axes of the charts of a widget: id, shown or not, title, and grid over the chart or not. */
const axes = (page: Page, id: string) =>
  page.evaluate(
    (w) =>
      Object.values(window.Chart!.instances)
        .filter((c) => c.canvas.closest(`[data-widget=${w}]`))
        .flatMap((c) =>
          Object.entries(c.options.scales ?? {}).flatMap(([axis, x]) => {
            const o = x as {
              display?: unknown;
              title?: { display?: boolean; text?: string };
              grid?: { drawOnChartArea?: boolean };
            };
            return axis === "x"
              ? []
              : [
                  [
                    axis,
                    o.display !== false,
                    o.title?.display ? o.title.text : "",
                    o.grid?.drawOnChartArea !== false,
                  ],
                ];
          }),
        ),
    id,
  );

const notes = (page: Page, id: string) =>
  page.$$eval(`[data-id=${id}] .note`, (els) => els.map((e) => e.textContent));

const IDS = [
  "yearTotals",
  "yearMonths",
  "yearSports",
  "yearRhythm",
  "yearHighlights",
  "yearStreaks",
  "yearRecords",
  "yearRecovery",
];

const FILL =
  "Some days of the year are missing. To add them, ask your assistant for a year review and say yes in the form, then ask it to update this page. An automatic refresh does not add them.";
const NONE = "This page has no recap of the year yet. Ask your assistant to update the page.";

/** What every Year tile and the tab show, in a page that runs `init` first, and the year of its clock. */
const recap = async (init?: string) => {
  const { page, errors } = await openYear(YEAR, { init });
  expect(errors).toEqual([]);
  expect(await tiles(page)).toEqual(IDS);
  const values = await Promise.all(IDS.map((id) => text(page, id)));
  const tab = await page.textContent("[data-tab=year]");
  return { values, tab, year: await page.evaluate(() => new Date().getFullYear()) };
};

describe("the Year tab", () => {
  it("shows the eight tiles in order, right after Recovery, with no page error", async () => {
    const { page, errors } = await openYear();
    expect((await tabs(page)).slice(0, 3)).toEqual([
      ["all", expect.any(String)],
      ["recovery", undefined],
      ["year", undefined],
    ]);
    expect(await page.textContent("[data-tab=year]")).toBe("Year");
    expect(await tiles(page)).toEqual(IDS);
    const spans = await page.$$eval(".tile", (els) =>
      els.map((e) => /span-(\d)/.exec(e.className)?.[1]),
    );
    expect(spans).toEqual(["3", "3", "2", "1", "2", "1", "3", "3"]);
    expect(await page.$$(".tile .error")).toEqual([]);
    expect(await chartsWithoutTooltip(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  it.each(["2027-01-15", "2031-06-01"])(
    "keeps the recap of its file when the file opens on %s",
    async (today) => {
      const now = await recap();
      const later = await recap(`(() => {
        const Native = Date;
        const at = Native.parse("${today}T12:00:00Z");
        window.Date = class extends Native {
          constructor(...args) { super(...(args.length ? args : [at])); }
          static now() { return at; }
        };
      })();`);
      expect(later.year).toBe(Number(today.slice(0, 4)));
      expect(later.values).toEqual(now.values);
      expect(later.tab).toBe(now.tab);
      expect(now.values.join(" ")).toContain("2026");
    },
  );

  it("has an icon of its own", async () => {
    const { page } = await openYear(YEAR, { settings: { ...ON, sports: ["running", "generic"] } });
    const paths = await page.$$eval("[role=tab]", (els) =>
      els.map((e) => [e.getAttribute("data-tab"), e.querySelector("path")?.getAttribute("d")]),
    );
    const year = paths.find(([tab]) => tab === "year")?.[1];
    expect(year).toBeTruthy();
    // a tab without an icon gets the one of the Other tab
    expect(paths.map(([tab]) => tab)).toContain("generic");
    expect(paths.filter(([, d]) => d === year)).toHaveLength(1);
  });

  it.each([{}, { yearReview: false }])(
    "is not on a page with the settings %j, also when the data has a recap",
    async (settings) => {
      const { page, errors } = await openYear(YEAR, { settings });
      expect((await tabs(page)).map(([tab]) => tab)).not.toContain("year");
      // the link to the tab opens the All board
      expect(await page.getAttribute("[role=tab][aria-selected=true]", "data-tab")).toBe("all");
      expect(await page.$$("[data-widget^=year]")).toEqual([]);
      expect(errors).toEqual([]);
    },
  );

  it.each<["preset" | "blank", string[]]>([
    ["preset", IDS],
    ["blank", []],
  ])("shows its widgets on an edited page that started as %s: %j", async (base, ids) => {
    const layout = {
      rev: "r1",
      base,
      boards: { all: [{ id: "coachNotes", widget: "coachNotes", span: 3 }] },
    };
    const { page, errors } = await openYear(YEAR, { layout });
    expect((await tabs(page)).map(([tab]) => tab)).toContain("year");
    expect(await tiles(page)).toEqual(ids);
    expect(await page.locator("#board").getByRole("button", { name: "Edit layout" }).count()).toBe(
      ids.length === 0 ? 1 : 0,
    );
    expect(errors).toEqual([]);
  });

  it("shows on a page that keeps some sports only", async () => {
    const { page, errors } = await openYear(YEAR, {
      settings: { yearReview: true, sports: ["running"] },
    });
    expect((await tabs(page)).map(([tab]) => tab)).toEqual(["all", "recovery", "year", "running"]);
    expect(await tiles(page)).toEqual(IDS);
    expect(errors).toEqual([]);
  });

  it("leaves out the HRV and resting HR tile on a page that excludes recovery", async () => {
    const { page, errors } = await openYear(YEAR, {
      settings: { yearReview: true, exclude: ["recovery"] },
    });
    expect(await tiles(page)).toEqual(IDS.slice(0, -1));
    expect(errors).toEqual([]);
  });

  it("says that the week window and the activity names do not change it", async () => {
    const { page } = await openYear();
    expect(await page.$$eval(".board-note", (els) => els.map((e) => e.textContent))).toEqual([
      "The recap of 2026: the week window and the activity names do not change it.",
    ]);
  });

  it("keeps its tiles when the week window and the activity names change", async () => {
    const { page, errors } = await openYear();
    const all = () =>
      page.$$eval(".tile-body", (els) => els.map((e) => e.textContent?.replace(/\s+/g, " ")));
    const before = await all();
    await page.click(".window-bar .chip >> text=Last 4");
    expect(await page.getAttribute("[role=tab][aria-selected=true]", "data-tab")).toBe("year");
    expect(await all()).toEqual(before);
    await page.click(".names-open");
    await page.locator("dialog input[type=checkbox]").first().click();
    await page.click("dialog .btn.primary");
    expect(await page.textContent(".names-open")).toContain("1 chosen");
    expect(await all()).toEqual(before);
    expect(errors).toEqual([]);
  });

  it("lists the names of every sport in the Activity names", async () => {
    const { page } = await openYear();
    const names = async () => {
      await page.click(".names-open");
      const list = await page.$$eval("dialog label", (els) => els.map((e) => e.textContent));
      await page.click("dialog .btn.primary");
      return list;
    };
    const year = await names();
    await page.click("[data-tab=all]");
    expect(year).toEqual(await names());
    expect(year.length).toBeGreaterThan(1);
  });

  it.each([
    ["some days", { from: "2026-02-10", to: "2026-03-20" }],
    ["today only", { from: "2026-01-01", to: "2026-03-19" }],
  ])("says how to add the missing days: %s", async (_, activities) => {
    const { page } = await openYear({
      ...YEAR,
      coverage: { ...YEAR.coverage, activities, complete: false },
    });
    expect(await page.$$eval(".board-note", (els) => els.map((e) => e.textContent))).toEqual([
      `The recap of 2026: the week window and the activity names do not change it. ${FILL}`,
    ]);
  });

  it("shows one note in place of the tiles when the page has no recap yet", async () => {
    const { page, errors } = await openWithout();
    expect(await tiles(page)).toEqual([]);
    expect(await page.$$eval("#board p", (els) => els.map((e) => e.textContent))).toEqual([NONE]);
    expect(await page.$(".board-empty")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("keeps a custom widget and another built-in widget on a board with no recap", async () => {
    const layout = {
      boards: {
        year: [
          { id: "yearTotals", widget: "yearTotals", span: 3 },
          { id: "mine", widget: "mine", span: 1 },
          { id: "kpis", widget: "kpis", span: 3 },
        ],
      },
    };
    const widgets = [custom("mine", "el.textContent = String(ctx.data.year);")];
    const { page, errors } = await openWithout({ layout, widgets });
    expect(await tiles(page)).toEqual(["mine", "kpis"]);
    expect(await text(page, "mine")).toBe("undefined");
    expect(await page.textContent(".board-note")).toBe(NONE);
    expect(errors).toEqual([]);
  });

  it("keeps the widget of another opt-in setting on a board with no recap", async () => {
    const { page, errors } = await openWithout({
      layout: { boards: { year: [{ id: "recoveryTrend", widget: "recoveryTrend", span: 3 }] } },
      settings: { yearReview: true, recoveryHistory: true },
    });
    expect(await tiles(page)).toEqual(["recoveryTrend"]);
    expect(errors).toEqual([]);
  });

  it("shows its tiles in edit mode without a recap, each with the note", async () => {
    const { page, errors } = await openWithout();
    await startEdit(page);
    expect(await tiles(page)).toEqual(IDS);
    for (const id of IDS) expect(await text(page, id), id).toBe(NONE);
    expect(errors).toEqual([]);
  });

  it("says the same in a year tile on another board", async () => {
    const layout = { boards: { all: [{ id: "yearTotals", widget: "yearTotals", span: 3 }] } };
    const { page, errors } = await openWithout({ layout, hash: "#all" });
    expect(await text(page, "yearTotals")).toBe(NONE);
    expect(errors).toEqual([]);
  });

  it("shows a year tile with its values on another board", async () => {
    const layout = { boards: { all: [{ id: "yearTotals", widget: "yearTotals", span: 3 }] } };
    const { page } = await openYear(YEAR, { layout, hash: "#all" });
    expect((await kpis(page, "yearTotals"))[0]).toEqual(["Sessions", "1,234"]);
    expect(await page.$(".board-note")).toBeNull();
  });

  it("offers edit mode on a board whose tiles are all hidden", async () => {
    const layout = {
      boards: { year: [{ id: "yearTotals", widget: "yearTotals", span: 3, hidden: true }] },
      seen: { year: IDS },
    };
    const { page } = await openYear(YEAR, { layout });
    expect(await tiles(page)).toEqual([]);
    expect(await page.$(".board-empty button")).not.toBeNull();
  });

  it("gives a custom widget the recap", async () => {
    const layout = { boards: { year: [{ id: "mine", widget: "mine", span: 1 }] } };
    const widgets = [
      custom(
        "mine",
        "el.textContent = `${ctx.data.year.totals.activities} ${ctx.type} ${ctx.activities.length > 0}`;",
      ),
    ];
    const { page, errors } = await openYear(YEAR, { layout, widgets });
    // the board shows every type, like the All board
    expect(await text(page, "mine")).toBe("1234 all true");
    expect(errors).toEqual([]);
  });

  it("adds a widget in edit mode with the type All", async () => {
    const { page, errors } = await openYear();
    await startEdit(page);
    await page.click("text=Add widget");
    const list = await page.textContent("dialog .catalogue");
    expect(list).toContain("Weekly volume");
    // no widget has a type of the recap
    const chosen = await page.$$eval("dialog .catalogue select", (els) =>
      els.map((e) => [
        e instanceof HTMLSelectElement && e.value,
        e.querySelector("option[value=year]") !== null,
      ]),
    );
    expect(chosen.length).toBeGreaterThan(1);
    expect(chosen.filter(([, year]) => year)).toEqual([]);
    expect(chosen.filter(([value]) => value === "all").length).toBeGreaterThan(1);
    const options = await page.$$eval("dialog .catalogue select", (els) =>
      els.map((e) => [...e.querySelectorAll("option")].map((o) => o.value)),
    );
    for (const o of options) expect(o).toEqual([...new Set(o)]);
    expect(errors).toEqual([]);
  });

  it("does not scroll sideways on a phone", async () => {
    const { page, errors } = await openYear(YEAR, { viewport: { width: 375, height: 800 } });
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(wide).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });

  it("shows every tile of a year without one covered day as n/a, with no error", async () => {
    const { page, errors } = await openYear(EMPTY);
    expect(await tiles(page)).toEqual(IDS);
    expect(await page.$$(".tile .error")).toEqual([]);
    const na = ["yearSports", "yearRhythm", "yearHighlights", "yearStreaks", "yearRecords"];
    for (const id of na) expect(await text(page, id), id).toContain("n/a");
    expect(await page.$$("canvas")).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("shows every tile of a year without one session, with no error", async () => {
    const { page, errors } = await openYear(IDLE);
    expect(await tiles(page)).toEqual(IDS);
    expect(await page.$$(".tile .error")).toEqual([]);
    for (const id of ["yearSports", "yearRhythm"]) {
      expect(await text(page, id), id).toBe("No sessions in the days of the recap.");
    }
    expect(errors).toEqual([]);
  });
});

describe("the texts of the Year tab", () => {
  it.each(["en", "de", "es", "fr", "it", "pt"])(
    "are all in the page language: %s",
    async (lang) => {
      const texts = JSON.parse(readFileSync(`src/page/i18n/locales/${lang}.json`, "utf8"));
      const settings: Settings = { yearReview: true, language: lang, languages: ["en", lang] };
      const { page, errors } = await openYear(
        {
          ...YEAR,
          coverage: { ...YEAR.coverage, complete: false },
          totals: { ...YEAR.totals, estimatedLoads: 2, unlikelyTimes: 2 },
          months: YEAR.months.map((m) => ({ ...m, covered: "part" })),
        },
        { settings },
      );
      const of = (selector: string) =>
        page.$$eval(selector, (els) => els.map((e) => (e.textContent ?? "").trim()));
      const keyed = (keys: string[]) => keys.map((k) => texts[k]);
      const many = (key: string, n: number) => texts[key].split("|")[1].replace("{n}", String(n));

      expect((await of("[data-tab=year]"))[0]).toBe(texts["type.year"]);
      expect(await of(".tile h2, .tile h3")).toEqual(keyed(IDS.map((id) => `w.${id}`)));
      expect(await of(".board-note")).toEqual([
        `${texts["yr.board"].replace("{year}", "2026")} ${texts["yr.fill"]}`,
      ]);
      expect(await of(".kpi-label")).toEqual(
        keyed([
          "pc.sessions",
          "yr.activeDays",
          "pc.distance",
          "pc.time",
          "col.ascent",
          "yr.calories",
          "pc.load",
          "yr.weekday",
          "yr.timeOfDay",
          "yr.bigMonth",
          "yr.bigWeek",
          "yr.block",
          "yr.consistent",
          "yr.longest",
          "yr.biggest",
          "yr.dayStreak",
          "yr.weekStreak",
        ]),
      );
      expect((await kpis(page, "yearTotals")).at(-1)?.at(-1)).toBe(many("yr.estimates", 2));
      const [covered, unlikely] = await notes(page, "yearTotals");
      const [before, between, after] = texts["yr.covered"].split(/\{from\}|\{to\}/);
      expect(covered?.startsWith(before)).toBe(true);
      expect(covered).toContain(between);
      expect(covered?.endsWith(after)).toBe(true);
      expect(unlikely).toBe(many("yr.unlikely", 2));
      expect((await rows(page, "yearMonths"))[0][0]).toContain(` · ${many("yr.partDays", 31)}`);
      expect(await of("[data-id=yearSports] .totals")).toEqual([
        texts["yr.topSport"].replace("{sport}", texts["type.running"]),
      ]);
      expect((await rows(page, "yearRhythm")).slice(7).map((r) => r[0])).toEqual([
        `${texts["yr.night"]} (22:00-4:59)`,
        `${texts["yr.morning"]} (5:00-11:59)`,
        `${texts["yr.afternoon"]} (12:00-17:59)`,
        `${texts["yr.evening"]} (18:00-21:59)`,
      ]);
      const highlights = (await kpis(page, "yearHighlights")).map((k) => k[2]);
      expect(highlights[2]).toContain(many("yr.sessions", 14));
      expect(highlights[3]).toBe(
        texts["yr.daysOf"].replace("{n}", "10").replace("{days}", "28").replace("{pct}", "36"),
      );
      expect(highlights[5]).toBe(`${texts["type.running"]} · ${texts["yr.estimate"]}`);
      expect(await notes(page, "yearHighlights")).toEqual([texts["yr.byLoad"]]);
      expect((await kpis(page, "yearStreaks")).map((k) => k[1])).toEqual([
        many("yr.days", 5),
        texts["yr.weeks"].split("|")[0].replace("{n}", "1"),
      ]);
      expect(await notes(page, "yearStreaks")).toEqual([texts["yr.streakNote"]]);
      expect(await notes(page, "yearRecords")).toEqual([texts["yr.recordsNote"]]);
      expect(await notes(page, "yearRecovery")).toEqual([texts["yr.meanNote"]]);
      const heads = async (id: string) =>
        page.$$eval(`[data-id=${id}] table.data:not(.sr-only *) th`, (els) =>
          els.map((e) => e.textContent),
        );
      expect(await heads("yearMonths")).toEqual(
        keyed(["yr.month", "pc.sessions", "yr.activeDays", "pc.distance", "pc.time", "pc.load"]),
      );
      expect(await heads("yearSports")).toEqual(
        keyed(["col.sport", "pc.sessions", "pc.distance", "pc.time", "pc.load"]),
      );
      expect(await heads("yearRhythm")).toEqual(
        keyed(["yr.weekday", "pc.sessions", "yr.timeOfDay", "pc.sessions"]),
      );
      expect(await heads("yearRecords")).toEqual(
        keyed(["be.distance", "be.activity", "col.time", "yr.before"]),
      );
      expect(await heads("yearRecovery")).toEqual(
        keyed(["yr.month", "hrv.nightly", "yr.nights", "w.restingHr", "yr.dayCount"]),
      );
      expect(errors).toEqual([]);
    },
  );

  it.each(["de", "es", "fr", "it", "pt"])(
    "are in the page language when empty: %s",
    async (lang) => {
      const texts = JSON.parse(readFileSync(`src/page/i18n/locales/${lang}.json`, "utf8"));
      const settings: Settings = { yearReview: true, language: lang, languages: ["en", lang] };
      const empty = await openYear(EMPTY, { settings });
      expect(await notes(empty.page, "yearTotals")).toEqual([
        texts["yr.noDays"].replace("{year}", "2026"),
      ]);
      expect(await notes(empty.page, "yearHighlights")).toEqual([texts["yr.byTime"]]);
      expect(await text(empty.page, "yearRecovery")).toBe(texts["yr.noRecovery"]);
      const idle = await openYear(IDLE, { settings });
      expect(await text(idle.page, "yearSports")).toBe(texts["yr.noSessions"]);
      expect(await text(idle.page, "yearRecords")).toBe(texts["yr.noRecords"]);
      const none = await openWithout({ settings });
      expect(await none.page.textContent(".board-note")).toBe(texts["yr.none"]);
    },
  );
});

describe("Totals of the year", () => {
  it("shows the totals", async () => {
    const { page } = await openYear();
    expect(await kpis(page, "yearTotals")).toEqual([
      ["Sessions", "1,234"],
      ["Active days", "60"],
      ["Distance", "812.4 km"],
      ["Time", "95.5 h"],
      ["Ascent", "5,400 m"],
      ["Calories", "45,000 kcal"],
      ["Load", "6,200"],
    ]);
    expect(await notes(page, "yearTotals")).toEqual([]);
  });

  it("shows them in the units of the profile", async () => {
    const { page } = await openYear(YEAR, { extra: { units: "statute_us" } });
    const values = await kpis(page, "yearTotals");
    expect(values[2]).toEqual(["Distance", "504.8 mi"]);
    expect(values[4]).toEqual(["Ascent", "17,717 ft"]);
  });

  it("shows n/a for a value that is not there, with no unit", async () => {
    const { page } = await openYear(EMPTY);
    expect((await kpis(page, "yearTotals")).map((k) => k.slice(1))).toEqual(
      Array.from({ length: 7 }, () => ["n/a"]),
    );
    expect(await notes(page, "yearTotals")).toEqual(["The recap has no day of 2026 yet."]);
  });

  it.each([
    [1, "1 estimate"],
    [3, "3 estimates"],
  ])("says that %i loads are estimates", async (estimatedLoads, label) => {
    const { page } = await openYear({ ...YEAR, totals: { ...YEAR.totals, estimatedLoads } });
    expect((await kpis(page, "yearTotals")).at(-1)).toEqual(["Load", "6,200", label]);
  });

  it("shows the days that the recap has when some are missing", async () => {
    const { page } = await openYear({
      ...YEAR,
      coverage: {
        ...YEAR.coverage,
        activities: { from: "2026-02-10", to: "2026-03-20" },
        complete: false,
      },
    });
    expect(await notes(page, "yearTotals")).toEqual([
      "The recap has the days from Feb 10 to Mar 20, 2026 only. It counts nothing for the other days.",
    ]);
  });

  it.each([
    [1, "1 session has a time of over 12 hours at under 1 km/h: its time does not count."],
    [2, "2 sessions have a time of over 12 hours at under 1 km/h: their time does not count."],
  ])("says that the time of %i sessions does not count", async (unlikelyTimes, message) => {
    const { page } = await openYear({ ...YEAR, totals: { ...YEAR.totals, unlikelyTimes } });
    expect(await notes(page, "yearTotals")).toEqual([message]);
  });
});

describe("Month by month", () => {
  it("draws the load of each month, and lists each month", async () => {
    const { page } = await openYear();
    expect((await chartDataset(page, "yearMonths", "Load")).data).toEqual([1500, 1300, 1100]);
    expect(await rows(page, "yearMonths")).toEqual([
      ["Jan 2026", "13", "12", "1,200.5 km", "18.0 h", "1,500"],
      ["Feb 2026", "11", "10", "90.2 km", "15.0 h", "1,300"],
      ["Mar 2026", "9", "8", "n/a", "12.0 h", "1,100"],
    ]);
    expect(await chartRows(page, "yearMonths")).toEqual([
      ["Jan 2026", "1,500"],
      ["Feb 2026", "1,300"],
      ["Mar 2026", "1,100"],
    ]);
  });

  it("draws the time of each month when no session has a load", async () => {
    const months = YEAR.months.map((m) => ({ ...m, load: null }));
    const { page } = await openYear({ ...YEAR, measure: "hours", months });
    expect((await chartDataset(page, "yearMonths", "Time")).data).toEqual([18, 15, 12]);
    expect(await axes(page, "yearMonths")).toEqual([["y", true, "h", true]]);
    expect((await rows(page, "yearMonths"))[0].at(-1)).toBe("n/a");
  });

  it("draws no bar for a month without data, and shows n/a in its row", async () => {
    const { page, errors } = await openYear({
      ...YEAR,
      months: [EMPTY.months[0], YEAR.months[1], YEAR.months[2]],
    });
    expect((await chartDataset(page, "yearMonths", "Load")).data).toEqual([null, 1300, 1100]);
    expect((await rows(page, "yearMonths"))[0]).toEqual([
      "Jan 2026",
      "n/a",
      "n/a",
      "n/a",
      "n/a",
      "n/a",
    ]);
    expect(errors).toEqual([]);
  });

  it("draws a bar of 0 for a month with its days and no session", async () => {
    const { page } = await openYear({ ...YEAR, months: [IDLE.months[0], YEAR.months[1]] });
    expect((await chartDataset(page, "yearMonths", "Load")).data).toEqual([0, 1300]);
    expect((await rows(page, "yearMonths"))[0]).toEqual([
      "Jan 2026",
      "0",
      "0",
      "0.0 km",
      "0.0 h",
      "0",
    ]);
  });

  it.each([
    [1, "Jan 2026 · 1 day of data"],
    [9, "Jan 2026 · 9 days of data"],
  ])("says how many days a month has that is there in part: %i", async (days, label) => {
    const [first, ...others] = YEAR.months;
    const { page } = await openYear({
      ...YEAR,
      months: [{ ...first, covered: "part", days }, ...others],
    });
    expect((await rows(page, "yearMonths"))[0][0]).toBe(label);
    // the chart has no place for it
    expect((await chartRows(page, "yearMonths"))[0][0]).toBe("Jan 2026");
  });

  it.each([
    ["one month", [YEAR.months[0]]],
    ["one month with data", [EMPTY.months[0], YEAR.months[1]]],
    ["one month with a load", [{ ...YEAR.months[0], load: null }, YEAR.months[1]]],
  ])("shows the rows and no chart for %s", async (_, months) => {
    const { page, errors } = await openYear({ ...YEAR, months });
    expect(await page.$("[data-id=yearMonths] canvas")).toBeNull();
    expect(await rows(page, "yearMonths")).toHaveLength(months.length);
    expect(errors).toEqual([]);
  });

  it("reads in the page language", async () => {
    const page = (
      await open(
        browser,
        pageFile({
          data: { ...data, v: DASHBOARD_VERSION, year: YEAR },
          settings: { yearReview: true, language: "de", languages: ["en", "de"] },
        }),
        { hash: "#year" },
      )
    ).page;
    expect(await page.textContent("[data-tab=year]")).toBe("Jahr");
    expect((await rows(page, "yearMonths"))[0]).toEqual([
      "Jan. 2026",
      "13",
      "12",
      "1.200,5 km",
      "18,0 h",
      "1.500",
    ]);
    expect((await chartRows(page, "yearMonths"))[0]).toEqual(["Jan. 2026", "1.500"]);
    expect((await rows(page, "yearRhythm"))[0]).toEqual(["Montag", "3"]);
  });
});

it("names the months and the weekdays as they are, west of Greenwich", async () => {
  const { page } = await openYear(YEAR, { timezoneId: "America/Los_Angeles" });
  expect((await rows(page, "yearMonths")).map((r) => r[0])).toEqual([
    "Jan 2026",
    "Feb 2026",
    "Mar 2026",
  ]);
  expect((await rows(page, "yearRhythm"))[0][0]).toBe("Monday");
});

describe("Sports of the year", () => {
  it("lists each sport, and names the top one", async () => {
    const { page } = await openYear();
    expect(await rows(page, "yearSports")).toEqual([
      ["Run", "40", "400.5 km", "40.2 h", "4,000"],
      ["Alpine skiing", "1", "n/a", "2.0 h", "n/a"],
    ]);
    expect(await page.textContent("[data-id=yearSports] .totals")).toBe("Top sport: Run");
  });

  it("names no top sport when there is none", async () => {
    const { page } = await openYear({ ...YEAR, topSport: null });
    expect(await page.$("[data-id=yearSports] .totals")).toBeNull();
  });

  it("shows a sport that the page does not know by its own name", async () => {
    const { page, errors } = await openYear({
      ...YEAR,
      sports: [{ ...YEAR.sports[0], sport: "quidditch" }],
      topSport: "quidditch",
    });
    expect((await rows(page, "yearSports"))[0][0]).toBe("quidditch");
    expect(errors).toEqual([]);
  });
});

describe("Weekdays and times", () => {
  it("shows the top weekday and time of day, and every count with the hours of its band", async () => {
    const { page } = await openYear();
    expect(await kpis(page, "yearRhythm")).toEqual([
      ["Weekday", "Saturday"],
      ["Time of day", "Morning", "5:00-11:59"],
    ]);
    expect(await rows(page, "yearRhythm")).toEqual([
      ["Monday", "3"],
      ["Tuesday", "0"],
      ["Wednesday", "5"],
      ["Thursday", "1"],
      ["Friday", "2"],
      ["Saturday", "9"],
      ["Sunday", "7"],
      ["Night (22:00-4:59)", "1"],
      ["Morning (5:00-11:59)", "14"],
      ["Afternoon (12:00-17:59)", "2"],
      ["Evening (18:00-21:59)", "10"],
    ]);
  });

  it.each([
    ["night", "Night", "22:00-4:59"],
    ["afternoon", "Afternoon", "12:00-17:59"],
    ["evening", "Evening", "18:00-21:59"],
  ] as const)("names the band of a top time of day in the %s", async (part, label, band) => {
    const { page } = await openYear({
      ...YEAR,
      rhythm: { ...YEAR.rhythm, topTimeOfDay: part, topWeekday: 0 },
    });
    expect(await kpis(page, "yearRhythm")).toEqual([
      ["Weekday", "Monday"],
      ["Time of day", label, band],
    ]);
  });

  it("shows n/a when no session has a time of day", async () => {
    const { page } = await openYear({
      ...YEAR,
      rhythm: {
        ...YEAR.rhythm,
        timeOfDay: { night: 0, morning: 0, afternoon: 0, evening: 0 },
        topTimeOfDay: null,
        topWeekday: null,
      },
    });
    expect(await kpis(page, "yearRhythm")).toEqual([
      ["Weekday", "n/a"],
      ["Time of day", "n/a"],
    ]);
  });
});

describe("Highlights of the year", () => {
  it("shows each highlight with its details", async () => {
    const { page } = await openYear();
    expect(await kpis(page, "yearHighlights")).toEqual([
      ["Biggest month", "Jan 2026", "1,200.5 km · 18.0 h · Load 1,500"],
      ["Biggest week", "from Jan 12, 2026", "41.2 km · 5.5 h · Load 480"],
      ["Best 4 weeks", "Jan 5 to Feb 1, 2026", "Load 1,456 · 14 sessions"],
      ["Most consistent month", "Feb 2026", "10 of 28 days active (36%)"],
      ["Longest session", "3.2 h", "Run · 30.1 km", "Jan 18, 2026 · Long <b>run</b>"],
      ["Highest load", "222", "Run · estimate", "Feb 15, 2026 · Hills"],
    ]);
    expect(await notes(page, "yearHighlights")).toEqual([
      "The biggest month, the biggest week and the best 4 weeks compare the load.",
    ]);
  });

  it("compares the time when no session has a load", async () => {
    const { page } = await openYear({
      ...YEAR,
      measure: "hours",
      bestBlock: { from: "2026-01-05", to: "2026-02-01", value: 33.5, sessions: 1 },
      biggest: null,
    });
    const shown = await kpis(page, "yearHighlights");
    expect(shown[2]).toEqual(["Best 4 weeks", "Jan 5 to Feb 1, 2026", "33.5 h · 1 session"]);
    expect(shown[5]).toEqual(["Highest load", "n/a"]);
    expect(await notes(page, "yearHighlights")).toEqual([
      "The biggest month, the biggest week and the best 4 weeks compare the time: no session has a load.",
    ]);
  });

  it("shows n/a for each value that a highlight lacks", async () => {
    const { page } = await openYear({
      ...YEAR,
      biggestMonth: { month: "2026-01", km: null, hours: null, load: null },
      biggestWeek: { monday: "2026-01-12", km: null, hours: null, load: null },
      longest: { date: "2026-01-18", sport: "running", hours: 3.2, km: null },
      biggest: { date: "2026-02-15", sport: "running", load: 222, estimate: false },
    });
    const shown = await kpis(page, "yearHighlights");
    expect(shown[0]).toEqual(["Biggest month", "Jan 2026", "n/a · n/a · Load n/a"]);
    expect(shown[1]).toEqual(["Biggest week", "from Jan 12, 2026", "n/a · n/a · Load n/a"]);
    // a page that leaves out the names has none
    expect(shown[4]).toEqual(["Longest session", "3.2 h", "Run · n/a", "Jan 18, 2026"]);
    expect(shown[5]).toEqual(["Highest load", "222", "Run", "Feb 15, 2026"]);
  });

  it("shows n/a for each highlight that is not there", async () => {
    const { page } = await openYear(EMPTY);
    expect((await kpis(page, "yearHighlights")).map((k) => k.slice(1))).toEqual(
      Array.from({ length: 6 }, () => ["n/a"]),
    );
  });
});

describe("Longest streaks", () => {
  it("shows the days and the weeks in a row with their dates", async () => {
    const { page } = await openYear();
    expect(await kpis(page, "yearStreaks")).toEqual([
      ["Days in a row", "5 days", "Jan 3 to Jan 7, 2026"],
      ["Weeks in a row", "1 week", "Feb 2 to Feb 8, 2026"],
    ]);
    expect(await notes(page, "yearStreaks")).toEqual([
      "A day or a week counts when it has a session.",
    ]);
  });

  it("shows one day and more weeks", async () => {
    const { page } = await openYear({
      ...YEAR,
      streaks: {
        days: { from: "2026-01-03", to: "2026-01-03", length: 1 },
        weeks: { from: "2026-01-05", to: "2026-02-08", length: 5 },
      },
    });
    expect((await kpis(page, "yearStreaks")).map((k) => k[1])).toEqual(["1 day", "5 weeks"]);
  });

  it("shows n/a for a streak that is not there", async () => {
    const { page } = await openYear(EMPTY);
    expect(await kpis(page, "yearStreaks")).toEqual([
      ["Days in a row", "n/a"],
      ["Weeks in a row", "n/a"],
    ]);
  });
});

describe("Records of the year", () => {
  it("lists the records of each distance, the shorter distance first, the older time first", async () => {
    const { page } = await openYear();
    expect(await rows(page, "yearRecords")).toEqual([
      ["5 km", "Jan 10, 2026 · First", "25:00", "n/a"],
      ["5 km", "Feb 10, 2026", "24:10", "25:00"],
      ["half marathon", "Mar 1, 2026 · Race", "1:55:00", "n/a"],
    ]);
    expect(await notes(page, "yearRecords")).toEqual([
      "Each row is faster than all the runs before it in the days of the recap. The first row of a distance has no time before it.",
    ]);
  });

  it("orders the distances, whatever their order in the data", async () => {
    const { page } = await openYear({
      ...YEAR,
      records: {
        marathon: one("4:00:00"),
        half: one("1:55:00"),
        "10k": one("50:00"),
        "5k": one("25:00"),
        mile: one("7:30"),
        "1k": one("4:30"),
      },
    });
    expect((await rows(page, "yearRecords")).map((r) => r[0])).toEqual([
      "1 km",
      "mile",
      "5 km",
      "10 km",
      "half marathon",
      "marathon",
    ]);
  });

  it("shows the first 10 rows of a long list", async () => {
    const list = Array.from({ length: 14 }, (_, i) => ({
      date: "2026-01-10",
      time: `${40 - i}:00`,
      previous: null,
    }));
    const { page } = await openYear({ ...YEAR, records: { "5k": list } });
    const visible = () => page.locator("[data-id=yearRecords] tbody tr:visible").count();
    expect(await visible()).toBe(10);
    await page.click("[data-id=yearRecords] .more");
    expect(await visible()).toBe(14);
  });

  it("says that no run has a best effort", async () => {
    const { page, errors } = await openYear({ ...YEAR, records: {} });
    expect(await text(page, "yearRecords")).toBe(
      "No best effort of a run in the days of the recap.",
    );
    expect(errors).toEqual([]);
  });
});

describe("HRV and resting HR by month", () => {
  it("lists the months, and draws the HRV that has more than one mean", async () => {
    const { page } = await openYear();
    expect(await rows(page, "yearRecovery")).toEqual([
      ["Jan 2026", "61", "31", "n/a", "n/a"],
      ["Feb 2026", "58", "28", "n/a", "n/a"],
      ["Mar 2026", "n/a", "3", "48", "14"],
    ]);
    expect(await chartRows(page, "yearRecovery")).toEqual([
      ["Jan 2026", "61"],
      ["Feb 2026", "58"],
      ["Mar 2026", ""],
    ]);
    expect((await chartDataset(page, "yearRecovery", "Nightly HRV")).data).toEqual([61, 58, null]);
    expect(await axes(page, "yearRecovery")).toEqual([
      ["y", true, "ms", true],
      ["y1", false, "bpm", false],
    ]);
    expect(await notes(page, "yearRecovery")).toEqual(["A mean needs 7 values in its month."]);
  });

  it("draws both on their own axis, in the colours of their own widgets", async () => {
    const { page, errors } = await openYear({
      ...YEAR,
      rhr: [
        { month: "2026-01", mean: 50, days: 31 },
        { month: "2026-03", mean: 48, days: 14 },
      ],
    });
    const sets = await page.evaluate(() =>
      Object.values(window.Chart!.instances)
        .filter((c) => c.canvas.closest("[data-widget=yearRecovery]"))
        .flatMap((c) =>
          c.data.datasets.map((d) => [
            d.label,
            d.data,
            (d as { yAxisID?: string }).yAxisID,
            (d as { spanGaps?: boolean }).spanGaps,
            String(d.borderColor),
          ]),
        ),
    );
    expect(sets.map((s) => s.slice(0, 4))).toEqual([
      ["Nightly HRV", [61, 58, null], "y", true],
      ["Resting HR", [50, null, 48], "y1", true],
    ]);
    await page.click("[data-tab=recovery]");
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
    expect(sets.map((s) => s[4])).toEqual([
      await colour("hrv", "Nightly HRV"),
      await colour("restingHr", "Resting HR"),
    ]);
    expect(errors).toEqual([]);
  });

  it("shows the resting HR alone, with its chart", async () => {
    const { page, errors } = await openYear({
      ...YEAR,
      hrv: undefined,
      rhr: [
        { month: "2026-01", mean: 50, days: 31 },
        { month: "2026-02", mean: 49, days: 28 },
      ],
    });
    expect(await rows(page, "yearRecovery")).toEqual([
      ["Jan 2026", "n/a", "n/a", "50", "31"],
      ["Feb 2026", "n/a", "n/a", "49", "28"],
    ]);
    expect((await chartDataset(page, "yearRecovery", "Resting HR")).data).toEqual([50, 49]);
    expect(await axes(page, "yearRecovery")).toEqual([
      ["y", false, "ms", true],
      ["y1", true, "bpm", false],
    ]);
    expect(errors).toEqual([]);
  });

  it("shows the rows and no chart when no measure has more than one mean", async () => {
    const { page } = await openYear({
      ...YEAR,
      hrv: [
        { month: "2026-01", mean: 61, nights: 31 },
        { month: "2026-02", mean: null, nights: 4 },
      ],
      rhr: undefined,
    });
    expect(await page.$("[data-id=yearRecovery] canvas")).toBeNull();
    expect(await rows(page, "yearRecovery")).toHaveLength(2);
  });

  it("says that the recap has no HRV and no resting HR", async () => {
    const { page, errors } = await openYear({ ...YEAR, hrv: undefined, rhr: undefined });
    expect(await text(page, "yearRecovery")).toBe("The recap has no HRV and no resting HR.");
    expect(errors).toEqual([]);
  });
});
