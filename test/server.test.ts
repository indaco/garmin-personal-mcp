import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { GarminDashboard } from "../src/dashboard";
import { AutoRefresh } from "../src/schedule";
import { createParts } from "../src/server";

vi.mock("../src/log", () => ({ log: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("wires the page writer to the dashboard data and to the built template", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
  vi.stubEnv("GARMIN_PERSONAL_API_KEY", "k");
  const dataDir = mkdtempSync(join(tmpdir(), "server-"));
  const { writer } = createParts({ baseUrl: "https://api.test", apiKeyFile: "/none", dataDir });
  // the data comes from getDashboardData, so from Garmin
  await expect(writer.preview({})).rejects.toThrow("Network error obtaining token: fetch failed");
  // the template is dashboard.html next to the bundle: the build writes it into dist/, not src/
  await expect(writer.write({})).rejects.toThrow(/dashboard\.html/);
});

it("gives the page writer the schedule of the same data folder", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "server-"));
  const { writer, auto } = createParts({
    baseUrl: "https://api.test",
    apiKeyFile: "/none",
    dataDir,
  });
  expect(auto).toBeInstanceOf(AutoRefresh);
  // the writer asks this schedule for the next run of each page it writes
  expect(Object.values(writer)).toContain(auto);
});

it("passes the weeks, workouts and recoveryHistory of a page to the dashboard data", async () => {
  const data = { start: "2026-10-19", end: "2026-10-26", activities: [], previousActivities: [] };
  const getData = vi
    .spyOn(GarminDashboard.prototype, "getDashboardData")
    .mockResolvedValue(JSON.stringify(data));
  const dataDir = mkdtempSync(join(tmpdir(), "server-"));
  const { writer } = createParts({ baseUrl: "https://api.test", apiKeyFile: "/none", dataDir });
  await writer.preview({ weeks: 5, settings: { workouts: true, recoveryHistory: true } });
  expect(getData).toHaveBeenCalledWith(5, true, true);
  getData.mockRestore();
});
