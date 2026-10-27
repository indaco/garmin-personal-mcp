import { describe, expect, it } from "vitest";
import {
  perHour,
  runLoadPerMinute,
  swimPace,
  verticalPerHour,
  zoneShare,
} from "../../src/page/sports";

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
    expect(perHour(900, { type: "paddelball", duration: "30:00", elapsed: "1:30:00" })).toBe(600);
  });

  it("gives the share of zone time in some zones", () => {
    expect(zoneShare([10, 10, 20, 40, 20], [3, 4])).toBe(60);
    expect(zoneShare([0, 0, 0, 0, 0], [3, 4])).toBeNull();
  });

  it("gives the average load per minute of the runs", () => {
    const runs = [
      { type: "running", duration: "30:00", trainingLoad: 60 },
      { type: "running", duration: "60:00", trainingLoad: 90 },
      { type: "walking", duration: "60:00", trainingLoad: 10 },
    ];
    // (60 + 90) / 90 min
    expect(runLoadPerMinute(runs)).toBeCloseTo(150 / 90, 6);
    expect(runLoadPerMinute([])).toBeNull();
  });
});
