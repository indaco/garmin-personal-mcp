import { describe, expect, it } from "vitest";
import { GROUPS } from "../../src/analytics/calc";
import { CATALOGUE, inPage } from "../../src/page/catalogue";
import { ABOUT } from "../../src/page/catalogue-about";
import { en } from "../../src/page/i18n/en";
import { preset } from "../../src/page/presets";
import { allWidgets } from "../../src/page/registry";
import "../../src/page/widgets";

describe("widget catalogue", () => {
  it("has exactly the registered widgets", () => {
    expect(
      allWidgets()
        .map((w) => w.id)
        .toSorted(),
    ).toEqual(CATALOGUE.map((c) => c.id).toSorted());
  });

  it("has a title in the English catalogue and a description for each widget", () => {
    for (const c of CATALOGUE) {
      expect([c.id, c.title in en, (ABOUT[c.id] ?? "").length > 20]).toEqual([c.id, true, true]);
    }
  });

  it("describes the weekly chart of Load safety", () => {
    expect(ABOUT.loadSafety).toBe(
      "Weekly load with its change against the week before (flagged above +10%), and 7-day monotony and strain (Foster). A second chart gives the monotony and strain of each week; a monotony above 2 is red.",
    );
  });

  it("has the Ride efficiency right after Intensity share, full width, only for rides", () => {
    const at = CATALOGUE.findIndex((c) => c.id === "rideEfficiency");
    expect(CATALOGUE[at - 1]?.id).toBe("intensityShare");
    expect(CATALOGUE[at]).toEqual({
      id: "rideEfficiency",
      title: "w.rideEfficiency",
      types: ["cycling"],
      span: 3,
    });
    expect(ABOUT.rideEfficiency).toBe(
      "The efficiency (normalized power per heartbeat) of the rides below Z4: each ride, the weekly mean and the last weeks against the first. It needs a power meter.",
    );
  });

  it("has a description for exactly the catalogue widgets", () => {
    expect(Object.keys(ABOUT).toSorted()).toEqual(CATALOGUE.map((c) => c.id).toSorted());
  });

  it("names the setting in the description of each opt-in widget", () => {
    const optIn = CATALOGUE.flatMap((c) => (c.optIn && c.optIn !== "workouts" ? [c] : []));
    expect(optIn).toHaveLength(9);
    for (const c of optIn) expect(ABOUT[c.id]).toContain(`Needs the setting ${c.optIn}.`);
  });

  it("names the bands of the day in the description of the weekdays and times", () => {
    expect(ABOUT.yearRhythm).toContain(
      "night 22:00-4:59, morning 5:00-11:59, afternoon 12:00-17:59, evening 18:00-21:59.",
    );
  });

  it("has an opt-in widget only on a page that turns it on and keeps its data", () => {
    const trend = CATALOGUE.find((c) => c.id === "workoutTrend")!;
    expect(inPage(trend, {})).toBe(false);
    expect(inPage(trend, { workouts: true })).toBe(true);
    expect(inPage(trend, { workouts: true, exclude: ["names"] })).toBe(false);
    expect(
      inPage(
        CATALOGUE.find((c) => c.id === "kpis")!,
        {},
      ),
    ).toBe(true);
  });

  it("has the Recovery trend only on a page that keeps the recovery rows of the period", () => {
    const trend = CATALOGUE.find((c) => c.id === "recoveryTrend")!;
    expect(inPage(trend, {})).toBe(false);
    expect(inPage(trend, { recoveryHistory: false })).toBe(false);
    expect(inPage(trend, { recoveryHistory: true })).toBe(true);
    expect(inPage(trend, { recoveryHistory: true, exclude: ["recovery"] })).toBe(false);
  });

  it("has the Year widgets last, only on a page that asks for the recap of the year", () => {
    expect(CATALOGUE.slice(-8)).toEqual([
      { id: "yearTotals", title: "w.yearTotals", optIn: "yearReview", span: 3 },
      { id: "yearMonths", title: "w.yearMonths", optIn: "yearReview", span: 3 },
      { id: "yearSports", title: "w.yearSports", optIn: "yearReview", span: 2 },
      { id: "yearRhythm", title: "w.yearRhythm", optIn: "yearReview", span: 1 },
      { id: "yearHighlights", title: "w.yearHighlights", optIn: "yearReview", span: 2 },
      { id: "yearStreaks", title: "w.yearStreaks", optIn: "yearReview", span: 1 },
      { id: "yearRecords", title: "w.yearRecords", optIn: "yearReview", span: 3 },
      {
        id: "yearRecovery",
        title: "w.yearRecovery",
        needs: "recovery",
        optIn: "yearReview",
        span: 3,
      },
    ]);
  });

  it.each([
    [{}, []],
    [{ yearReview: false }, []],
    [
      { yearReview: true },
      [
        "yearTotals",
        "yearMonths",
        "yearSports",
        "yearRhythm",
        "yearHighlights",
        "yearStreaks",
        "yearRecords",
        "yearRecovery",
      ],
    ],
    [
      { yearReview: true, exclude: ["recovery" as const] },
      [
        "yearTotals",
        "yearMonths",
        "yearSports",
        "yearRhythm",
        "yearHighlights",
        "yearStreaks",
        "yearRecords",
      ],
    ],
  ])("has these Year widgets with the settings %j", (settings, ids) => {
    const shown = CATALOGUE.filter((c) => c.optIn === "yearReview" && inPage(c, settings));
    expect(shown.map((c) => c.id)).toEqual(ids);
  });

  it("has the Warning signs right after Readiness, full width, only on a page with the recovery data", () => {
    const at = CATALOGUE.findIndex((c) => c.id === "warningSigns");
    expect(CATALOGUE[at - 1]?.id).toBe("readiness");
    expect(CATALOGUE[at]).toEqual({
      id: "warningSigns",
      title: "w.warningSigns",
      needs: "recovery",
      span: 3,
    });
    expect(ABOUT.warningSigns).toBe(
      "The days in a row with warning signs, up to the newest day: a day has them when 2 or more of resting HR 5 bpm or more above its 7-day average, last night's HRV under its range and a sleep score under 60 are true. One day is a note, 2 in a row a warning. The numbers of that day and a 7-day strip. The dashboard's own rule, not a diagnosis.",
    );
    expect(inPage(CATALOGUE[at]!, {})).toBe(true);
    expect(inPage(CATALOGUE[at]!, { exclude: ["recovery"] })).toBe(false);
  });

  it("gives a board of any other SDK sport the preset of the Other board", () => {
    expect(preset("alpineSkiing")).toEqual(preset("generic"));
    expect(preset("generic").length).toBeGreaterThan(0);
  });

  it("has every widget of the presets", () => {
    const boards = ["all", "recovery", "year", ...GROUPS];
    const ids = new Set(CATALOGUE.map((c) => c.id));
    for (const board of boards) {
      for (const inst of preset(board))
        expect([board, ids.has(inst.widget)]).toEqual([board, true]);
    }
  });
});
