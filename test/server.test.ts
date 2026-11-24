import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { GarminDashboard } from "../src/dashboard";
import { readBlock } from "../src/dashboard-page";
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

it("gives the page writer the year review of the same data folder", async () => {
  const data = { start: "2026-10-19", end: "2026-10-26", activities: [], previousActivities: [] };
  const getData = vi
    .spyOn(GarminDashboard.prototype, "getDashboardData")
    .mockResolvedValue(JSON.stringify(data));
  vi.useFakeTimers({ now: new Date("2026-10-26T12:00:00"), toFake: ["Date"] });
  const dataDir = mkdtempSync(join(tmpdir(), "server-"));
  const run = { id: 1, name: "Run", start: "2026-03-02 07:00:00", type: "running", km: 10 };
  writeFileSync(
    join(dataDir, "dashboard-cache.json"),
    JSON.stringify({
      activitiesSummary: 3,
      activitiesFrom: "2026-01-01",
      activitiesTo: "2026-10-26",
      activities: { 1: { ...run, sport: "running", duration: "1:00:00" } },
    }),
  );
  const { writer } = createParts({ baseUrl: "https://api.test", apiKeyFile: "/none", dataDir });
  // the built template is not in src/
  Object.assign(writer, {
    template: async () => '<head><meta name="garmin-template" content="0123456789abcdef"></head>',
  });
  const page = `<script>/* garmin-data:start */null/* garmin-data:end */;/* garmin-settings:start */null/* garmin-settings:end */</script>`;
  const { path } = await writer.write({ page, settings: { yearReview: true } });
  expect(readBlock(readFileSync(path, "utf8"), "data")).toMatchObject({
    year: { year: 2026, totals: { activities: 1 } },
  });
  getData.mockRestore();
  vi.useRealTimers();
});
