import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  /** Personal API host */
  baseUrl: string;
  /** File with the personal API key, used when env GARMIN_PERSONAL_API_KEY is not set */
  apiKeyFile: string;
  /** Folder for .FIT files, the dashboard cache and the exercise catalogue */
  dataDir: string;
}

/** Defaults reuse an existing ~/.config/garmin-mcp/api-key and ~/workspace/garmin-data. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    baseUrl: env.GARMIN_BASE_URL || "https://personal.connectapi.garmin.com",
    apiKeyFile: env.GARMIN_API_KEY_FILE || join(homedir(), ".config/garmin-mcp/api-key"),
    dataDir: env.GARMIN_DATA_DIR || join(homedir(), "workspace/garmin-data"),
  };
}
