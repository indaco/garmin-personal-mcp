import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("defaults to ~/.config/garmin-mcp/api-key and ~/workspace/garmin-data", () => {
    expect(loadConfig({})).toEqual({
      baseUrl: "https://personal.connectapi.garmin.com",
      apiKeyFile: join(homedir(), ".config/garmin-mcp/api-key"),
      dataDir: join(homedir(), "workspace/garmin-data"),
    });
  });

  it("reads the env vars", () => {
    expect(
      loadConfig({
        GARMIN_BASE_URL: "https://example.test",
        GARMIN_API_KEY_FILE: "/k",
        GARMIN_DATA_DIR: "/d",
      }),
    ).toEqual({ baseUrl: "https://example.test", apiKeyFile: "/k", dataDir: "/d" });
  });

  it("ignores empty env vars", () => {
    expect(loadConfig({ GARMIN_DATA_DIR: "" }).dataDir).toBe(
      join(homedir(), "workspace/garmin-data"),
    );
  });
});
