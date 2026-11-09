import { describe, expect, it } from "vitest";
import type { Activity } from "../../src/analytics/calc";
import {
  distancePerStroke,
  perHour,
  runLoadPerMinute,
  strokesPerLength,
  swimPace,
  swimTrend,
  verticalPerHour,
  zoneShare,
} from "../../src/analytics/sports";

/** A 1 km swim on this day: 40 lengths of 25 m in `sec` seconds, with this many strokes per length. */
const poolSwim = (date: string, sec: number, perLength: number, poolLengthM = 25): Activity => ({
  sport: "swimming",
  type: "lap_swimming",
  start: `${date} 07:00:00`,
  km: 1,
  duration: `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`,
  lengths: 1000 / poolLengthM,
  strokes: (perLength * 1000) / poolLengthM,
  poolLengthM,
});

describe("swim numbers", () => {
  it("gives the strokes per length and the distance per stroke", () => {
    expect(strokesPerLength({ strokes: 900, lengths: 60 })).toBe(15);
    expect(distancePerStroke({ km: 1.5, strokes: 900 })).toBeCloseTo(1.667, 3);
  });

  it.each([
    [{ lengths: 60 }, "no strokes"],
    [{ strokes: 0, lengths: 60 }, "0 strokes"],
    [{ strokes: 900, lengths: 0 }, "0 lengths"],
    [{ strokes: 900 }, "open water: no lengths"],
  ])("gives no strokes per length for %j (%s)", (a, _why) => {
    expect(strokesPerLength(a)).toBeUndefined();
  });

  it("gives no distance per stroke without a distance or strokes", () => {
    expect(distancePerStroke({ strokes: 900 })).toBeUndefined();
    expect(distancePerStroke({ km: 1.5, strokes: 0 })).toBeUndefined();
  });
});

describe("swim trend", () => {
  const openWater: Activity = {
    sport: "swimming",
    type: "open_water_swimming",
    start: "2026-06-01 07:00:00",
    km: 2,
    duration: "50:00",
    strokes: 1800,
  };

  it("has no trend without a pool swim that compares", () => {
    expect(swimTrend([openWater])).toBeUndefined();
    expect(swimTrend([])).toBeUndefined();
  });

  it("keeps the pool length with the most swims, oldest first, and counts the others", () => {
    const t = swimTrend([
      poolSwim("2026-06-10", 1200, 18),
      poolSwim("2026-06-09", 1100, 30, 50),
      openWater,
      poolSwim("2026-06-05", 1260, 19),
    ])!;
    expect(t.poolLengthM).toBe(25);
    expect(t.sessions.map((s) => s.date)).toEqual(["2026-06-05", "2026-06-10"]);
    expect(t.sessions[1]).toMatchObject({ pace: 120, strokes: 18 });
    expect(t.left).toBe(2);
  });

  it("takes the newest pool length on a tie", () => {
    const t = swimTrend([poolSwim("2026-06-10", 1200, 18, 50), poolSwim("2026-06-05", 1200, 18)])!;
    expect(t.poolLengthM).toBe(50);
  });

  it("does not count another sport as left out", () => {
    const run: Activity = { sport: "running", type: "running", start: "2026-06-06 07:00:00" };
    expect(swimTrend([poolSwim("2026-06-10", 1200, 18), run])!.left).toBe(0);
  });

  it("compares the newest swims over 14 days with as many before them", () => {
    const { window } = swimTrend([
      poolSwim("2026-05-01", 1300, 20),
      poolSwim("2026-05-08", 1300, 20),
      poolSwim("2026-05-15", 1300, 20),
      poolSwim("2026-05-22", 1200, 18),
      poolSwim("2026-05-29", 1200, 18),
      poolSwim("2026-06-05", 1200, 18),
    ])!;
    expect(window).toEqual({
      swims: 3,
      pace: { recent: 120, before: 130 },
      strokes: { recent: 18, before: 20 },
    });
  });

  it.each([4, 5])("has no comparison with %i weekly swims: 3 against fewer than 3", (n) => {
    const weekly = ["05-01", "05-08", "05-15", "05-22", "05-29"]
      .slice(0, n)
      .map((d) => poolSwim(`2026-${d}`, 1200, 18));
    expect(swimTrend(weekly)!.window).toBeNull();
  });

  it("needs as many swims before a longer window, for 3 swims a week", () => {
    const days = ["01", "03", "05", "08", "10", "12", "15", "17", "19", "22"];
    const swims = days.map((d) => poolSwim(`2026-06-${d}`, 1200, 18));
    // the 14 days back from the 22nd take 7 swims, so 7 swims must come before them
    expect(swimTrend(swims)!.window).toBeNull();
    const more = ["05-11", "05-13", "05-15", "05-18"].map((d) => poolSwim(`2026-${d}`, 1200, 18));
    expect(swimTrend([...more, ...swims])!.window?.swims).toBe(7);
  });

  it("leaves out a pool swim without strokes, and counts it", () => {
    const { strokes: _strokes, ...noStrokes } = poolSwim("2026-06-11", 1200, 18);
    const t = swimTrend([poolSwim("2026-06-10", 1200, 18), noStrokes])!;
    expect(t.sessions).toHaveLength(1);
    expect(t.left).toBe(1);
  });

  it("has no comparison when the swims are too few or too close", () => {
    const close = ["01", "02", "03", "04", "05", "06"].map((d) =>
      poolSwim(`2026-06-${d}`, 1200, 18),
    );
    expect(swimTrend(close)!.window).toBeNull();
    expect(swimTrend(close.slice(0, 3))!.window).toBeNull();
  });
});

describe("sport numbers", () => {
  it("gives the swim pace per 100 m", () => {
    // 1.5 km in 30:00 -> 2:00 per 100 m
    expect(swimPace({ km: 1.5, duration: "30:00" })).toBe(120);
    expect(swimPace({ duration: "30:00" })).toBeUndefined();
  });

  it("gives vertical metres per hour", () => {
    expect(verticalPerHour({ ascentM: 600, duration: "1:30:00" })).toBe(400);
    expect(verticalPerHour({ duration: "1:30:00" })).toBeUndefined();
  });

  it("gives a value per hour of session time", () => {
    expect(
      perHour(900, { type: "paddelball", sport: "racket", duration: "30:00", elapsed: "1:30:00" }),
    ).toBe(600);
  });

  it("gives the share of zone time in some zones", () => {
    expect(zoneShare([10, 10, 20, 40, 20], [3, 4])).toBe(60);
    expect(zoneShare([0, 0, 0, 0, 0], [3, 4])).toBeNull();
  });

  it("gives the average load per minute of the runs", () => {
    const runs = [
      { type: "running", sport: "running", duration: "30:00", trainingLoad: 60 },
      { type: "running", sport: "running", duration: "60:00", trainingLoad: 90 },
      { type: "walking", sport: "walking", duration: "60:00", trainingLoad: 10 },
    ];
    // (60 + 90) / 90 min
    expect(runLoadPerMinute(runs)).toBeCloseTo(150 / 90, 6);
    expect(runLoadPerMinute([])).toBeNull();
  });
});
