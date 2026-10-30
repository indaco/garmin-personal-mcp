import { describe, expect, it } from "vitest";
import {
  efficiency,
  paceSeconds,
  predictRaces,
  splitOf,
  zoneOf,
  zoneSeconds,
} from "../../src/page/running";

const floors = [94, 113, 132, 150, 169];

describe("pace and efficiency", () => {
  it("reads the pace, or works it out from distance and moving time", () => {
    expect(paceSeconds({ pace: "5:07/km" })).toBe(307);
    expect(paceSeconds({ km: 10, duration: "50:00" })).toBe(300);
    expect(paceSeconds({ duration: "50:00" })).toBeUndefined();
  });

  it("gives metres per heartbeat", () => {
    // 10 km in 50 min = 200 m/min, at 160 bpm
    expect(efficiency({ km: 10, duration: "50:00", avgHR: 160 })).toBe(1.25);
    expect(efficiency({ km: 10, duration: "50:00" })).toBeUndefined();
  });
});

describe("HR zones", () => {
  it("finds the zone of a heart rate", () => {
    expect(zoneOf(90, floors)).toBe(0);
    expect(zoneOf(94, floors)).toBe(0);
    expect(zoneOf(140, floors)).toBe(2);
    expect(zoneOf(180, floors)).toBe(4);
  });

  it("uses the zone seconds of the activity", () => {
    expect(zoneSeconds({ hrZonesSec: [1, 2, 3, 4, 5] }, floors)).toEqual({
      sec: [1, 2, 3, 4, 5],
      approximate: false,
    });
  });

  it("puts all minutes in the zone of the average HR when the activity has no zone seconds", () => {
    expect(zoneSeconds({ duration: "10:00", avgHR: 140 }, floors)).toEqual({
      sec: [0, 0, 600, 0, 0],
      approximate: true,
    });
    expect(zoneSeconds({ duration: "10:00" }, floors)).toBeUndefined();
  });
});

const lap = (km: number, time: string) => ({ km, time });
const hr = (km: number, time: string, avgHR: number) => ({ km, time, avgHR });

describe("pace split", () => {
  it("compares the pace of the first and the second half", () => {
    const negative = splitOf([lap(1, "5:10"), lap(1, "5:10"), lap(1, "5:00"), lap(1, "4:50")]);
    expect(negative).toEqual({ first: 310, second: 295, kind: "negative" });
    expect(splitOf([lap(1, "5:00"), lap(1, "5:01")])?.kind).toBe("even");
    expect(splitOf([lap(1, "5:00"), lap(1, "5:20")])?.kind).toBe("positive");
  });

  it("gives the HR drift: the drop of pace per heartbeat from the first to the second half", () => {
    // same pace, HR 150 then 159: efficiency drops by 1 - 150/159 = 5.66 %
    const s = splitOf([
      hr(1, "5:00", 150),
      hr(1, "5:00", 150),
      hr(1, "5:00", 159),
      hr(1, "5:00", 159),
    ]);
    expect(s?.drift).toBeCloseTo((1 - 150 / 159) * 100, 6);
    // a lap across the middle counts for its share of time on each side
    const across = splitOf([hr(1, "5:00", 150), hr(1, "5:00", 160), hr(1, "5:00", 160)]);
    expect(across?.drift).toBeCloseTo((1 - (150 * 2 + 160) / 3 / 160) * 100, 6);
  });

  it("has no drift when a lap has no HR", () => {
    expect(splitOf([hr(1, "5:00", 150), lap(1, "5:00")])?.drift).toBeUndefined();
  });

  it("has no split without two laps of distance", () => {
    expect(splitOf([lap(1, "5:00")])).toBeUndefined();
    expect(splitOf([])).toBeUndefined();
  });
});

describe("race predictor", () => {
  it("uses the best effort of 5 km or more that predicts the fastest times", () => {
    const p = predictRaces({ "1k": 200, "5k": 1500, "10k": 3200 });
    // 5 km in 25:00 predicts 10 km in 52:07, faster than the 53:20 10 km: it uses the 5 km
    expect(p?.from).toEqual({ distance: "5k", seconds: 1500 });
    expect(p?.times["10k"]).toBeCloseTo(1500 * 2 ** 1.06, 6);
    expect(p?.times.marathon).toBeCloseTo(1500 * (42.195 / 5) ** 1.06, 6);
  });

  it("has no prediction from efforts under 5 km", () => {
    expect(predictRaces({ "1k": 200, mile: 330 })).toBeUndefined();
  });
});
