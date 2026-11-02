import { describe, expect, it } from "vitest";
import { parseLayout, withPresetWidgets } from "../../src/page/layout";
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
const names = (board: string) => preset(board).map((i) => i.widget);

describe("preset", () => {
  it("gives the generic widgets to a board name that only the prototype has", () => {
    for (const board of INHERITED) expect(names(board)).toEqual(names("zzz"));
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
    expect(r.added).toEqual({ cycling: ["hikeVertical"] });
    expect(withPresetWidgets(r.layout, preset, baseline).added).toEqual({});
  });

  it("does not throw and adds nothing new for an inherited board name", () => {
    for (const board of INHERITED) {
      const layout = parseLayout(JSON.parse(`{"boards":{"${board}":[]}}`));
      const r = withPresetWidgets(layout, preset, baseline);
      expect(r.added).toEqual({});
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
