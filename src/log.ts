import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Past this size the log moves to `<file>.1`, replacing the one before, and a new log starts. */
const MAX_BYTES = 1_000_000;

// stdio transport: stdout carries MCP messages only, so the log goes to a file.
export function log(level: "INFO" | "WARN", message: string): void {
  const file = join(homedir(), ".cache/garmin-personal-mcp/garmin-personal-mcp.log");
  try {
    mkdirSync(dirname(file), { recursive: true });
    if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > MAX_BYTES) {
      renameSync(file, `${file}.1`);
    }
    appendFileSync(file, `${new Date().toISOString()} ${level} ${message}\n`);
  } catch {
    // a log that cannot be written must never break the server
  }
}
