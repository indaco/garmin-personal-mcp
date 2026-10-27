import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// stdio transport: stdout carries MCP messages only, so the log goes to a file.
const LOG_FILE = join(homedir(), ".cache/garmin-personal-mcp/garmin-personal-mcp.log");

// shortcut: no rotation, the Java log grew ~40 KB in weeks; add it if the file gets large.
export function log(level: "INFO" | "WARN", message: string): void {
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${level} ${message}\n`);
  } catch {
    // a log that cannot be written must never break the server
  }
}
