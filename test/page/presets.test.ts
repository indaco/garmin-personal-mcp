import { describe, expect, it } from "vitest";
import { arrange, parseLayout, withPresetWidgets } from "../../src/page/layout";
import { baseline, PRESET_BOARDS, preset } from "../../src/page/presets";

const FROZEN: Record<string, string[]> = {
  all: [
    "kpis",
    "readiness",
    "calendar",
    "periodComparison",
    "records",
    "weeklyVolume",
    "intensityMinutes",
    "loadSafety",
    "fitnessFatigue",
    "loadVsRecovery",
    "activities",
    "coachNotes",
  ],
  recovery: [
    "readiness",
    "fitnessAge",
    "loadVsRecovery",
    "hrv",
    "restingHr",
    "sleep",
    "sleepNeed",
    "bedtime",
    "bodyBattery",
  ],
  year: [
    "yearTotals",
    "yearMonths",
    "yearSports",
    "yearRhythm",
    "yearHighlights",
    "yearStreaks",
    "yearRecords",
    "yearRecovery",
  ],
  running: [
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
    "workoutTrend",
    "activities",
  ],
  strengthTraining: [
    "typeKpis",
    "typeWeekly",
    "hrZones",
    "setsPerCategory",
    "muscleBalance",
    "exercises",
    "strengthSessions",
  ],
  walking: ["typeKpis", "typeWeekly", "hrZones", "walkDetails", "steps", "activities"],
  hiking: ["typeKpis", "typeWeekly", "hrZones", "hikeVertical", "activities"],
  cycling: ["typeKpis", "typeWeekly", "hrZones", "bikeDetails", "activities"],
  swimming: ["typeKpis", "typeWeekly", "hrZones", "swimDetails", "activities"],
  racket: ["typeKpis", "typeWeekly", "hrZones", "racketDetails", "activities"],
  generic: ["typeKpis", "typeWeekly", "hrZones", "activities"],
};

const INHERITED = ["constructor", "__proto__", "toString", "hasOwnProperty"];
const order = (r: ReturnType<typeof withPresetWidgets>) =>
  r.layout.boards.recovery?.map((i) => [i.widget, i.span]);
const cyclingOrder = (r: ReturnType<typeof withPresetWidgets>) =>
  r.layout.boards.cycling?.map((i) => [i.widget, i.span]);
const names = (board: string) => preset(board).map((i) => i.widget);

describe("preset", () => {
  it("gives the generic widgets to a board name that only the prototype has", () => {
    for (const board of INHERITED) expect(names(board)).toEqual(names("zzz"));
  });

  it("has the plan widget on a row of its own, right after the muscle-group balance", () => {
    const list = preset("strengthTraining");
    const i = list.findIndex((x) => x.widget === "planAdherence");
    expect(list[i - 1]?.widget).toBe("muscleBalance");
    expect(list[i]?.span).toBe(3);
  });

  it("has the ride efficiency on a row of its own on the Bike board, right after Intensity share", () => {
    expect(preset("cycling").map((i) => [i.widget, i.span])).toEqual([
      ["typeKpis", 3],
      ["typeWeekly", 2],
      ["hrZones", 1],
      ["records", 3],
      ["intensityShare", 3],
      ["rideEfficiency", 3],
      ["hikeVertical", 3],
      ["bikeDetails", 3],
      ["activities", 3],
    ]);
  });

  it("has the warning signs on a row of their own on the Recovery board, right after Fitness age", () => {
    expect(preset("recovery").map((i) => [i.widget, i.span])).toEqual([
      ["readiness", 2],
      ["fitnessAge", 1],
      ["warningSigns", 3],
      ["loadVsRecovery", 3],
      ["hrv", 1],
      ["restingHr", 1],
      ["sleep", 1],
      ["sleepNeed", 1],
      ["bedtime", 1],
      ["bodyBattery", 1],
      ["stress", 3],
      ["recoveryTrend", 3],
    ]);
  });

  it("has the recap of the calendar year on the Year board", () => {
    expect(preset("year").map((i) => [i.widget, i.span])).toEqual([
      ["yearTotals", 3],
      ["yearMonths", 3],
      ["yearSports", 1],
      ["yearRhythm", 2],
      ["yearHighlights", 2],
      ["yearStreaks", 1],
      ["yearRecords", 3],
      ["yearRecovery", 3],
    ]);
  });

  it("guard: gives a Year board that lost a tile nothing back", () => {
    const year = preset("year").filter((i) => i.widget !== "yearRhythm");
    const r = withPresetWidgets(parseLayout({ boards: { year } }), preset, baseline);
    expect(r.added).toEqual({});
  });
});

describe("sport boards", () => {
  it("have the records in one place, right after the HR zones", () => {
    const sports = PRESET_BOARDS.filter((b) => b !== "all" && b !== "recovery" && b !== "year");
    expect(sports).toContain("generic");
    for (const board of sports) {
      const list = names(board);
      expect(list.indexOf("records"), board).toBe(list.indexOf("hrZones") + 1);
    }
  });
});

describe("preset rows", () => {
  it.each(PRESET_BOARDS.map((b) => [b]))("%s fills each row of 3 columns", (board) => {
    let used = 0;
    for (const { id, span } of preset(board)) {
      used += span;
      expect(used, `${board}: ${id} passes the row end`).toBeLessThanOrEqual(3);
      if (used === 3) used = 0;
    }
    expect(used, `${board}: the last row`).toBe(0);
  });
});

describe("baseline", () => {
  // A literal copy on purpose: the baseline must not follow the preset when a release adds a widget.
  it("lists the frozen widgets of every preset board", () => {
    expect(PRESET_BOARDS.toSorted()).toEqual(Object.keys(FROZEN).toSorted());
    for (const board of PRESET_BOARDS) expect(baseline(board), board).toEqual(FROZEN[board]);
  });

  it("gives the generic list to an unknown board and to an inherited name", () => {
    for (const board of ["zzz", ...INHERITED]) expect(baseline(board)).toEqual(baseline("generic"));
  });
});

describe("preset record", () => {
  it("fits the limits of the parser, so a saved record is never cut", () => {
    for (const board of PRESET_BOARDS) {
      const seen = { [board]: names(board) };
      expect(parseLayout({ boards: { [board]: [] }, seen }).seen).toEqual(seen);
    }
  });
});

describe("withPresetWidgets with the real preset", () => {
  it("gives a Bike board from an older release the new widgets once", () => {
    const cycling = preset("cycling").filter((i) => baseline("cycling").includes(i.widget));
    const r = withPresetWidgets(parseLayout({ boards: { cycling } }), preset, baseline);
    expect(r.added).toEqual({
      cycling: ["records", "intensityShare", "rideEfficiency", "hikeVertical"],
    });
    expect(withPresetWidgets(r.layout, preset, baseline).added).toEqual({});
  });

  it("gives a Strength board from an older release the plan widget once", () => {
    const strengthTraining = preset("strengthTraining").filter((i) =>
      baseline("strengthTraining").includes(i.widget),
    );
    const r = withPresetWidgets(parseLayout({ boards: { strengthTraining } }), preset, baseline);
    expect(r.added).toEqual({ strengthTraining: ["records", "planAdherence"] });
    expect(withPresetWidgets(r.layout, preset, baseline).added).toEqual({});
  });

  describe("the ride efficiency on an edited Bike board", () => {
    const without = preset("cycling").filter((i) => i.widget !== "rideEfficiency");
    const seen = { cycling: without.map((i) => i.widget) };

    it("adds it once after Intensity share to a board with a record", () => {
      const r = withPresetWidgets(
        parseLayout({ boards: { cycling: without }, seen }),
        preset,
        baseline,
      );
      expect(r.added).toEqual({ cycling: ["rideEfficiency"] });
      expect(cyclingOrder(r)).toEqual(preset("cycling").map((i) => [i.widget, i.span]));
      expect(withPresetWidgets(r.layout, preset, baseline).added).toEqual({});
    });

    it("guard: does not bring it back to a board that removed it", () => {
      const r = withPresetWidgets(
        parseLayout({ boards: { cycling: without }, seen: { cycling: names("cycling") } }),
        preset,
        baseline,
      );
      expect(r.added).toEqual({});
      expect(r.layout.boards.cycling?.map((i) => i.widget)).not.toContain("rideEfficiency");
    });
  });

  describe("the warning signs on an edited Recovery board", () => {
    const without = preset("recovery").filter((i) => i.widget !== "warningSigns");

    it("adds them once after Fitness age to a board with a record", () => {
      const seen = { recovery: without.map((i) => i.widget) };
      const r = withPresetWidgets(
        parseLayout({ boards: { recovery: without }, seen }),
        preset,
        baseline,
      );
      expect(r.added).toEqual({ recovery: ["warningSigns"] });
      expect(order(r)).toEqual(preset("recovery").map((i) => [i.widget, i.span]));
      expect(withPresetWidgets(r.layout, preset, baseline).added).toEqual({});
    });

    it("adds them after Fitness age to a board from before the record", () => {
      const old = without.filter((i) => baseline("recovery").includes(i.widget));
      const r = withPresetWidgets(parseLayout({ boards: { recovery: old } }), preset, baseline);
      expect(r.added).toEqual({ recovery: ["warningSigns", "stress", "recoveryTrend"] });
      expect(order(r)).toEqual(preset("recovery").map((i) => [i.widget, i.span]));
    });

    it("adds them after Fitness age where you moved it, and at the end without it", () => {
      const moved = [...without.filter((i) => i.widget !== "fitnessAge"), without[1]!];
      const seen = { recovery: without.map((i) => i.widget) };
      const r = withPresetWidgets(
        parseLayout({ boards: { recovery: moved }, seen }),
        preset,
        baseline,
      );
      expect(r.layout.boards.recovery?.slice(-2).map((i) => i.widget)).toEqual([
        "fitnessAge",
        "warningSigns",
      ]);
      const gone = without.filter((i) => i.widget !== "fitnessAge" && i.widget !== "readiness");
      const r2 = withPresetWidgets(
        parseLayout({ boards: { recovery: gone }, seen }),
        preset,
        baseline,
      );
      expect(r2.layout.boards.recovery?.at(-1)?.widget).toBe("warningSigns");
    });

    it("guard: does not bring them back to a board that removed them", () => {
      const seen = { recovery: names("recovery") };
      const r = withPresetWidgets(
        parseLayout({ boards: { recovery: without }, seen }),
        preset,
        baseline,
      );
      expect(r.added).toEqual({});
      expect(r.layout.boards.recovery?.map((i) => i.widget)).not.toContain("warningSigns");
    });
  });

  it("does not throw on an inherited board name, and adds only what a release added", () => {
    for (const board of INHERITED) {
      const layout = parseLayout(JSON.parse(`{"boards":{"${board}":[]}}`));
      const r = withPresetWidgets(layout, preset, baseline);
      expect(Object.entries(r.added)).toEqual([[board, ["records"]]]);
    }
  });

  it("gives a page from before the record nothing back that the user removed", () => {
    const all = preset("all").slice(0, 2);
    const r = withPresetWidgets(parseLayout({ boards: { all, running: [] } }), preset, baseline);
    // only a widget that a later release adds to a preset (not in the baseline) comes back
    const later = (board: string, on: string[]) =>
      names(board).filter((w) => !baseline(board).includes(w) && !on.includes(w));
    const added = Object.fromEntries(
      [
        [
          "all",
          later(
            "all",
            all.map((i) => i.widget),
          ),
        ],
        ["running", later("running", [])],
      ].filter(([, ids]) => ids?.length),
    );
    expect(r.added).toEqual(added);
    expect(r.layout.boards.running?.map((i) => i.widget)).toEqual(later("running", []));
    expect(r.layout.seen?.running).toEqual(names("running"));
  });
});

// the order of meaning a preset follows; every widget not named here is analysis
const ZONES = [
  ["kpis", "typeKpis", "readiness", "fitnessAge", "warningSigns", "calendar", "periodComparison"],
  ["weeklyVolume", "typeWeekly", "hrZones", "intensityMinutes"],
  ["records"],
  [],
  ["walkDetails", "bikeDetails", "swimDetails", "racketDetails", "exercises"],
  ["activities", "strengthSessions"],
  ["coachNotes"],
];
const zoneOf = (widget: string) => {
  const zone = ZONES.findIndex((list) => list.includes(widget));
  return zone === -1 ? 3 : zone;
};

describe("the presets", () => {
  it.each(PRESET_BOARDS)(
    "%s lists summary, volume, records, analysis, details, lists, notes",
    (board) => {
      const zones = preset(board).map((i) => zoneOf(i.widget));
      expect(zones).toEqual(zones.toSorted((a, b) => a - b));
    },
  );

  it.each(PRESET_BOARDS)("%s has full rows, so Auto-arrange keeps it as it is", (board) => {
    expect(arrange(preset(board), () => ({ height: 100, min: 1 }))).toEqual(preset(board));
  });
});
