import { describe, expect, it } from "vitest";
import {
  activitiesIn,
  boardOrder,
  dayOf,
  GROUPS,
  groupOf,
  groupsIn,
  isIndoor,
  mondayOf,
  seconds,
  sessionSeconds,
  sportOf,
  timedDistance,
  weeksOf,
} from "../../src/page/calc";
import { formatHash, parseHash } from "../../src/page/state";

describe("activity types", () => {
  // [Garmin type key, SDK sport from sportTypeId, board]
  it.each([
    ["running", "running", "running"],
    ["trail_running", "running", "running"],
    ["treadmill_running", "running", "running"],
    ["strength_training", "training", "strengthTraining"],
    ["strength_training", "fitnessEquipment", "strengthTraining"],
    ["strength_training", undefined, "strengthTraining"],
    ["walking", "walking", "walking"],
    ["hiking", "hiking", "hiking"],
    ["cycling", "cycling", "cycling"],
    ["mountain_biking", "cycling", "cycling"],
    ["lap_swimming", "swimming", "swimming"],
    ["paddelball", "racket", "racket"],
    ["tennis", "racket", "racket"],
    ["pickleball", "hiit", "racket"],
    ["pickleball", undefined, "racket"],
    ["resort_skiing", "alpineSkiing", "alpineSkiing"],
    ["yoga", undefined, "generic"],
    ["running", undefined, "generic"],
    ["running", "all", "generic"],
    ["", "", "generic"],
  ])("%s with the sport %s is on the %s board", (type, sport, board) => {
    expect(groupOf({ type, sport })).toBe(board);
  });

  it("names the sport of a racket type", () => {
    expect(sportOf("paddelball")).toBe("padel");
    expect(sportOf("table_tennis")).toBe("tableTennis");
    expect(sportOf("platform_tennis")).toBe("platformTennis");
    expect(sportOf("tennis")).toBe("tennis");
    expect(sportOf("running")).toBeUndefined();
  });

  it("knows the indoor types", () => {
    expect(
      ["indoor_cycling", "virtual_ride", "treadmill_running", "indoor_rowing"].map(isIndoor),
    ).toEqual([true, true, true, true]);
    expect(isIndoor("running")).toBe(false);
  });
});

describe("time", () => {
  it("reads h:mm:ss and m:ss", () => {
    expect(seconds("1:02:03")).toBe(3723);
    expect(seconds("5:07")).toBe(307);
    expect(seconds("5:07/km")).toBe(307);
    expect(seconds(undefined)).toBe(0);
    expect(seconds("n/a")).toBe(0);
  });

  it("counts elapsed time for strength and racket sports, moving time for the others", () => {
    expect(
      sessionSeconds({ type: "strength_training", duration: "10:00", elapsed: "1:00:00" }),
    ).toBe(3600);
    expect(
      sessionSeconds({
        type: "paddelball",
        sport: "racket",
        duration: "20:00",
        elapsed: "1:30:00",
      }),
    ).toBe(5400);
    expect(
      sessionSeconds({ type: "tennis", sport: "racket", duration: "20:00", elapsed: "1:00:00" }),
    ).toBe(3600);
    expect(sessionSeconds({ type: "running", duration: "30:00", elapsed: "31:30" })).toBe(1800);
    expect(sessionSeconds({ type: "strength_training", duration: "40:00" })).toBe(2400);
  });

  it("counts the elapsed time of a racket type key, whatever its sport", () => {
    const row = { duration: "20:00", elapsed: "1:30:00" };
    expect(sessionSeconds({ ...row, type: "tennis", sport: "tennis" })).toBe(5400);
    expect(sessionSeconds({ ...row, type: "paddelball" })).toBe(5400);
    expect(sessionSeconds({ ...row, type: "running", sport: "running" })).toBe(1200);
  });

  it("gives the day and the Monday of its week", () => {
    expect(dayOf({ start: "2026-10-25 07:00:00" })).toBe("2026-10-25");
    expect(dayOf({})).toBeUndefined();
    expect(mondayOf("2026-10-25")).toBe("2026-10-19");
    expect(mondayOf("2026-10-26")).toBe("2026-10-26");
  });

  it("lists the Mondays from the first to the last week", () => {
    expect(weeksOf("2026-10-07", "2026-10-26")).toEqual([
      "2026-10-05",
      "2026-10-12",
      "2026-10-19",
      "2026-10-26",
    ]);
  });

  it("keeps the activities of the weeks from..to", () => {
    const acts = [
      { start: "2026-10-04 08:00:00" },
      { start: "2026-10-05 08:00:00" },
      { start: "2026-10-18 20:00:00" },
      { start: "2026-10-19 08:00:00" },
      {},
    ];
    expect(activitiesIn(acts, "2026-10-05", "2026-10-12")).toEqual([acts[1], acts[2]]);
  });
});

describe("URL hash", () => {
  const tabs = ["all", "running", "strengthTraining", "alpineSkiing"];
  const weeks = ["2026-10-05", "2026-10-12", "2026-10-19"];

  it("reads tab, window and item", () => {
    expect(parseHash("#running@2026-10-12_2026-10-19", tabs, weeks)).toEqual({
      tab: "running",
      from: "2026-10-12",
      to: "2026-10-19",
    });
    expect(parseHash("#strengthTraining/back-squat", tabs, weeks)).toEqual({
      tab: "strengthTraining",
      from: "2026-10-05",
      to: "2026-10-19",
      item: "back-squat",
    });
  });

  it("drops an item that is not valid URI text", () => {
    expect(parseHash("#strengthTraining/%E0", tabs, weeks)).toEqual({
      tab: "strengthTraining",
      from: "2026-10-05",
      to: "2026-10-19",
    });
  });

  it("falls back to the All tab and every week", () => {
    const all = { tab: "all", from: "2026-10-05", to: "2026-10-19" };
    expect(parseHash("", tabs, weeks)).toEqual(all);
    expect(parseHash("#swimming@1999-01-04_2026-10-19", tabs, weeks)).toEqual(all);
    expect(parseHash("#running@2026-10-19_2026-10-05", tabs, weeks)).toEqual({
      ...all,
      tab: "running",
    });
  });

  it("writes the hash that it reads", () => {
    const s = { tab: "alpineSkiing", from: "2026-10-12", to: "2026-10-19", item: "x" };
    expect(parseHash(formatHash(s), tabs, weeks)).toEqual(s);
    expect(formatHash({ tab: "all", from: "2026-10-05", to: "2026-10-19" })).toBe(
      "#all@2026-10-05_2026-10-19",
    );
  });
});

describe("boards in tab order", () => {
  it("puts other sports, sorted, between the type boards and Other", () => {
    expect(boardOrder(new Set(["rowing", "running", "alpineSkiing"]))).toEqual([
      ...GROUPS.slice(0, -1),
      "alpineSkiing",
      "rowing",
      "generic",
    ]);
  });

  it("lists the boards of the activities in tab order, other sports included", () => {
    expect(
      groupsIn([
        { type: "yoga" },
        { type: "rowing", sport: "rowing" },
        { type: "running", sport: "running" },
      ]),
    ).toEqual(["running", "rowing", "generic"]);
  });
});

describe("distance and time for pace", () => {
  it("adds only the sessions that have both a distance and a time", () => {
    expect(
      timedDistance([
        { km: 10, duration: "50:00" },
        { duration: "1:00:00" }, // no distance: an indoor ride without a sensor
        { km: 5 }, // no time
        { km: 0, duration: "10:00" },
      ]),
    ).toEqual({ km: 10, seconds: 3000 });
  });

  it("gives zero for no session", () => {
    expect(timedDistance([])).toEqual({ km: 0, seconds: 0 });
  });
});
