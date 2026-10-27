import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "../src/log";

let home: string;
const logFile = () => join(home, ".cache/garmin-personal-mcp/garmin-personal-mcp.log");

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "garmin-home-"));
  vi.stubEnv("HOME", home);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("log", () => {
  it("appends a timestamped line to the log file", () => {
    log("INFO", "first");
    log("WARN", "second");
    const lines = readFileSync(logFile(), "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z INFO first$/);
    expect(lines[1]).toMatch(/ WARN second$/);
  });

  it("moves a log over 1 MB to .1 and starts a new one", () => {
    log("INFO", "start");
    writeFileSync(logFile(), "x".repeat(1_000_001));
    writeFileSync(`${logFile()}.1`, "older");
    log("INFO", "after");
    expect(readFileSync(logFile(), "utf8")).toMatch(/ INFO after\n$/);
    expect(statSync(`${logFile()}.1`).size).toBe(1_000_001);
  });

  it("keeps a log of 1 MB or less", () => {
    log("INFO", "start");
    writeFileSync(logFile(), "x".repeat(1_000_000));
    log("INFO", "after");
    expect(existsSync(`${logFile()}.1`)).toBe(false);
    expect(statSync(logFile()).size).toBeGreaterThan(1_000_000);
  });

  it("never throws when the log cannot be written", () => {
    mkdirSync(join(home, ".cache"));
    chmodSync(join(home, ".cache"), 0o500);
    expect(() => log("WARN", "lost")).not.toThrow();
    chmodSync(join(home, ".cache"), 0o700);
  });
});
