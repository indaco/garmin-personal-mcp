import { describe, expect, it } from "vitest";
import {
  activitiesIn,
  dayOf,
  groupOf,
  isIndoor,
  mondayOf,
  seconds,
  sessionSeconds,
  sportOf,
  weeksOf,
} from "../../src/page/calc";
import { formatHash, parseHash } from "../../src/page/state";

describe("activity types", () => {
  it.each([
    ["running", "run"],
    ["trail_running", "run"],
    ["treadmill_running", "run"],
    ["strength_training", "strength"],
    ["walking", "walk"],
    ["casual_walking", "walk"],
    ["hiking", "hike"],
    ["mountaineering", "hike"],
    ["road_biking", "bike"],
    ["indoor_cycling", "bike"],
    ["virtual_ride", "bike"],
    ["lap_swimming", "swim"],
    ["open_water_swimming", "swim"],
    ["paddelball", "racket"],
    ["padel", "racket"],
    ["tennis", "racket"],
    ["pickleball", "racket"],
    ["racquetball", "racket"],
    ["squash", "racket"],
    ["badminton", "racket"],
    ["table_tennis", "racket"],
    ["platform_tennis", "racket"],
    ["yoga", "other"],
    ["", "other"],
  ])("%s is %s", (key, group) => {
    expect(groupOf(key)).toBe(group);
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
    expect(sessionSeconds({ type: "paddelball", duration: "20:00", elapsed: "1:30:00" })).toBe(
      5400,
    );
    expect(sessionSeconds({ type: "tennis", duration: "20:00", elapsed: "1:00:00" })).toBe(3600);
    expect(sessionSeconds({ type: "running", duration: "30:00", elapsed: "31:30" })).toBe(1800);
    expect(sessionSeconds({ type: "strength_training", duration: "40:00" })).toBe(2400);
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
  const tabs = ["all", "run", "strength"];
  const weeks = ["2026-10-05", "2026-10-12", "2026-10-19"];

  it("reads tab, window and item", () => {
    expect(parseHash("#run@2026-10-12_2026-10-19", tabs, weeks)).toEqual({
      tab: "run",
      from: "2026-10-12",
      to: "2026-10-19",
    });
    expect(parseHash("#strength/back-squat", tabs, weeks)).toEqual({
      tab: "strength",
      from: "2026-10-05",
      to: "2026-10-19",
      item: "back-squat",
    });
  });

  it("falls back to the All tab and every week", () => {
    const all = { tab: "all", from: "2026-10-05", to: "2026-10-19" };
    expect(parseHash("", tabs, weeks)).toEqual(all);
    expect(parseHash("#swim@1999-01-04_2026-10-19", tabs, weeks)).toEqual(all);
    expect(parseHash("#run@2026-10-19_2026-10-05", tabs, weeks)).toEqual({ ...all, tab: "run" });
  });

  it("writes the hash that it reads", () => {
    const s = { tab: "run", from: "2026-10-12", to: "2026-10-19", item: "x" };
    expect(parseHash(formatHash(s), tabs, weeks)).toEqual(s);
    expect(formatHash({ tab: "all", from: "2026-10-05", to: "2026-10-19" })).toBe(
      "#all@2026-10-05_2026-10-19",
    );
  });
});
