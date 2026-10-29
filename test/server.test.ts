import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
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
