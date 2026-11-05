import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { version } from "../package.json";
import {
  cli,
  COMMAND_HELP,
  doctor,
  HELP,
  hideHome,
  info,
  promptKey,
  RETRY_MS,
  setup,
  summary,
} from "../src/cli";
import type { Config } from "../src/config";
import type { LastRun, Status } from "../src/schedule";

const on: Status = {
  scheduled: true,
  cron: "0 7 * * 1",
  next: ["2026-11-02 07:00", "2026-11-09 07:00"],
  pages: ["/d/garmin-dashboard.html"],
  scheduler: "launchd",
  installed: true,
  log: "/h/refresh.log",
};

function fakes() {
  const auto = {
    pages: vi.fn(async () => ["a.html", "b.html"]),
    status: vi.fn(async () => on),
    set: vi.fn(async () => on),
    off: vi.fn(async (): Promise<Status> => ({ scheduled: false })),
    missed: vi.fn(async () => true),
    saveRun: vi.fn<(last: LastRun) => Promise<void>>(async () => {}),
  };
  const written: (string | undefined)[] = [];
  const writer = () => ({
    write: async (o: { path?: string }) => {
      written.push(o.path);
      if (o.path === "b.html") throw new Error("gone");
      return {} as never;
    },
  });
  return { auto, writer, written };
}

/** A writer whose pages fail with the next error of their list; a page with no error left works. */
function flaky(errors: Record<string, string[]>) {
  const written: string[] = [];
  const writer = () => ({
    write: async (o: { path?: string }) => {
      written.push(o.path!);
      const error = errors[o.path!]?.shift();
      if (error) throw new Error(error);
      return {} as never;
    },
  });
  return { writer, written };
}

/** A sleep that only records how long it would wait. */
function sleeper() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

const OFFLINE = "Network error obtaining token: fetch failed";

describe("cli", () => {
  it("prints the version with --version or -v", async () => {
    const f = fakes();
    for (const flag of ["--version", "-v"])
      expect(await cli(flag, [], f.auto, f.writer)).toEqual({ code: 0, stdout: version });
  });

  it("prints the help with --help or -h", async () => {
    const f = fakes();
    for (const flag of ["--help", "-h"])
      expect(await cli(flag, [], f.auto, f.writer)).toEqual({ code: 0, stdout: HELP });
    expect(HELP).toMatch(/^Usage: garmin-personal-mcp/);
  });

  it.each([
    "foo",
    "--foo",
    "-x",
    "-",
    "--",
    "",
    " ",
    // a command is exact: no other case, no value, no extra space
    "INFO",
    "--HELP",
    "-V",
    "-help",
    "--help=1",
    "--version=1",
    " info",
    // COMMANDS is a list, so a name that every object has is not a command
    "constructor",
    "__proto__",
  ])("prints the help on stderr for command '%s'", async (word) => {
    const f = fakes();
    const write = vi.fn(f.writer);
    expect(await cli(word, [], f.auto, write)).toEqual({
      code: 1,
      stderr: `Unknown command\n\n${HELP}`,
    });
    expect(f.auto.status).not.toHaveBeenCalled();
    expect(f.auto.set).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("gives no word of the wrong command in the error", async () => {
    const f = fakes();
    expect(await cli("foo", ["--bar", "a.html"], f.auto, f.writer)).toEqual({
      code: 1,
      stderr: `Unknown command\n\n${HELP}`,
    });
  });

  it.each([
    ["refresh", ["--foo"]],
    ["refresh", ["-x"]],
    ["refresh", ["-"]],
    ["refresh", ["--"]],
    // --auto is exact, it comes first and only refresh has it
    ["refresh", ["--AUTO"]],
    ["refresh", ["--auto=1"]],
    ["refresh", ["-auto"]],
    ["refresh", ["--auto", "--foo"]],
    ["refresh", ["--auto", "--auto"]],
    ["refresh", ["a.html", "--auto"]],
    ["schedule", ["--auto"]],
    ["info", ["--auto"]],
    ["doctor", ["--auto"]],
    ["doctor", ["--foo"]],
    ["doctor", ["--force"]],
    // --force is exact, it comes first and only setup has it
    ["refresh", ["--force"]],
    ["schedule", ["--force"]],
    // the help flag of a command is exact
    ["refresh", ["--HELP"]],
    ["schedule", ["-H"]],
    ["info", ["--help=1"]],
    ["info", ["-help"]],
    // a flag never reaches the command, and --help and --version have no help of their own
    ["info", ["--version"]],
    ["--help", ["--foo"]],
    ["--help", ["--help"]],
    ["-h", ["-x"]],
    ["--version", ["--foo"]],
    ["--version", ["--help"]],
    ["-v", ["-h"]],
    ["-v", ["-x"]],
    // a word before the flag does not hide it
    ["schedule", ["--foo"]],
    ["schedule", ["off", "--foo"]],
    ["schedule", ["off", "a.html", "--foo"]],
    ["schedule", ["weekly", "--day", "monday"]],
    // several flags: the first one is refused
    ["refresh", ["--foo", "--bar"]],
    ["schedule", ["off", "--page", "a.html", "--foo"]],
    // a path or a cron expression that starts with a dash reads as a flag
    ["refresh", ["-old.html"]],
    ["schedule", ["-old.html"]],
    ["schedule", ["-1 * * * *"]],
  ])("prints the help on stderr for %s %j", async (command, args) => {
    const f = fakes();
    const write = vi.fn(f.writer);
    expect(await cli(command, args, f.auto, write)).toEqual({
      code: 1,
      stderr: `Unknown flag\n\n${HELP}`,
    });
    // a wrong flag must not stop the schedule: `schedule off --foo` once stopped all of it
    expect(f.auto.off).not.toHaveBeenCalled();
    expect(f.auto.set).not.toHaveBeenCalled();
    expect(f.auto.status).not.toHaveBeenCalled();
    expect(f.auto.pages).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    ["--foo"],
    ["--FORCE"],
    ["-f"],
    ["--force", "--force"],
    ["word", "--force"],
    ["--auto"],
    ["--key=not-a-real-key"],
    ["-not-a-real-key"],
    ["--force", "--key=not-a-real-key"],
  ])("setup %j refuses the arguments and never prints them", async (...args) => {
    const { apiKeyFile, config } = newHome();
    const f = fakes();
    const r = await cli("setup", args, f.auto, f.writer, undefined, config);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("setup does not take the key as an argument");
    for (const x of args.filter((y) => y !== "--force")) expect(r.stderr).not.toContain(x);
    expect(existsSync(apiKeyFile)).toBe(false);
  });

  it.each([
    [["off", "coach"]],
    [["off", "coach.htm"]],
    [["off", "a.html", "b.html"]],
    [["off", "coach.html", "extra"]],
    [["off", ""]],
  ])("schedule %j refuses a page it cannot use", async (args) => {
    const f = fakes();
    const r = await cli("schedule", args, f.auto, f.writer);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^schedule off takes one page/);
    expect(f.auto.off).not.toHaveBeenCalled();
  });

  it.each([[["a.html", "b.html"]], [["--auto", "x.html"]]])(
    "refresh %j refuses more than one argument",
    async (args) => {
      const f = fakes();
      const write = vi.fn(f.writer);
      const r = await cli("refresh", args, f.auto, write);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/^refresh takes one page/);
      expect(write).not.toHaveBeenCalled();
      expect(f.auto.saveRun).not.toHaveBeenCalled();
      expect(f.auto.missed).not.toHaveBeenCalled();
    },
  );

  it("takes a page with a capital extension in schedule off", async () => {
    const f = fakes();
    expect((await cli("schedule", ["off", "COACH.HTML"], f.auto, f.writer)).code).toBe(0);
    expect(f.auto.off).toHaveBeenCalledWith("COACH.HTML");
  });

  it.each(["--help", "-h"])("prints the help of setup for %s and never the key", async (flag) => {
    const { config } = newHome();
    const f = fakes();
    const r = await cli(
      "setup",
      ["--key=not-a-real-key", flag],
      f.auto,
      f.writer,
      undefined,
      config,
    );
    expect(r).toEqual({ code: 0, stdout: COMMAND_HELP.setup });
    expect(`${r.stdout}${r.stderr}`).not.toContain("not-a-real-key");
  });

  it("refuses a key argument with --force and keeps the key file", async () => {
    const { apiKeyFile, config } = newHome();
    mkdirSync(dirname(apiKeyFile), { recursive: true });
    writeFileSync(apiKeyFile, "old-fake-key\n");
    const f = fakes();
    const args = ["--force", "--key=not-a-real-key"];
    const r = await cli("setup", args, f.auto, f.writer, undefined, config);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("setup does not take the key as an argument");
    expect(r.stderr).not.toContain("not-a-real-key");
    expect(readFileSync(apiKeyFile, "utf8")).toBe("old-fake-key\n");
  });

  it.each([
    ["the command", "not-a-real-key", []],
    ["a command that starts with a dash", "--not-a-real-key", []],
    ["a flag of info", "info", ["--key=not-a-real-key"]],
    ["a flag of doctor", "doctor", ["-not-a-real-key"]],
    ["a flag of refresh", "refresh", ["--key=not-a-real-key"]],
    ["a flag of schedule", "schedule", ["--key=not-a-real-key"]],
    ["a flag after a page", "refresh", ["a.html", "--key=not-a-real-key"]],
    ["the page of refresh", "refresh", ["not-a-real-key"]],
    ["a word after a page of refresh", "refresh", ["a.html", "not-a-real-key"]],
    ["the schedule", "schedule", ["not-a-real-key"]],
    ["a word after schedule off", "schedule", ["off", "not-a-real-key"]],
  ])("does not print %s, which can be the key", async (_name, command, args) => {
    const f = fakes();
    const write = vi.fn(f.writer);
    const r = await cli(command, args, f.auto, write);
    expect(r.code).toBe(1);
    expect(`${r.stdout}${r.stderr}`).not.toContain("not-a-real-key");
    expect(write).not.toHaveBeenCalled();
    expect(f.auto.set).not.toHaveBeenCalled();
    expect(f.auto.off).not.toHaveBeenCalled();
    expect(f.auto.missed).not.toHaveBeenCalled();
  });

  it("refuses a page of refresh that is not an .html file, before any work", async () => {
    const f = fakes();
    const write = vi.fn(f.writer);
    expect(await cli("refresh", ["coach"], f.auto, write)).toEqual({
      code: 1,
      stderr: `refresh takes one page, a file that ends in .html, or --auto\n\n${HELP}`,
    });
    expect(write).not.toHaveBeenCalled();
  });

  it.each([["a.html"], ["A.HTML"], ["./-old.html"], ["~/pages/a.html"], [""]])(
    "still refreshes the page %j",
    async (page) => {
      const f = fakes();
      expect((await cli("refresh", [page], f.auto, f.writer)).code).toBe(0);
    },
  );

  it("keeps the working forms of schedule off and refresh", async () => {
    const f = fakes();
    expect((await cli("schedule", ["off"], f.auto, f.writer)).code).toBe(0);
    expect(f.auto.off).toHaveBeenLastCalledWith(undefined);
    expect((await cli("schedule", ["off", "coach.html"], f.auto, f.writer)).code).toBe(0);
    expect(f.auto.off).toHaveBeenLastCalledWith("coach.html");
    expect((await cli("refresh", [], f.auto, f.writer)).code).toBe(0);
    expect((await cli("refresh", ["a.html"], f.auto, f.writer)).code).toBe(0);
    expect(f.written).toEqual(["", "a.html"]);
    expect((await cli("refresh", ["--auto"], f.auto, f.writer)).code).toBe(1);
    expect(f.auto.pages).toHaveBeenCalled();
  });

  it.each(["info", "doctor", "setup", "refresh", "schedule"])(
    "prints the help of %s",
    async (command) => {
      const f = fakes();
      const write = vi.fn(f.writer);
      const help = COMMAND_HELP[command];
      expect(help).toMatch(new RegExp(`^Usage: garmin-personal-mcp ${command}\\b`));
      for (const flag of ["--help", "-h"])
        expect(await cli(command, [flag], f.auto, write)).toEqual({ code: 0, stdout: help });
      expect(f.auto.status).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    },
  );

  it("tells each form and default of a command in its help", () => {
    expect(COMMAND_HELP.refresh).toContain("refresh --auto");
    expect(COMMAND_HELP.refresh).toContain("garmin-dashboard.html");
    for (const word of ["daily", "weekdays", "weekly <day>", '"<cron>"', "off", "07:00", "Monday"])
      expect(COMMAND_HELP.schedule).toContain(word);
    // only the three commands have a help: the others are flags without arguments
    expect(Object.keys(COMMAND_HELP)).toEqual(["info", "doctor", "setup", "refresh", "schedule"]);
  });

  it("tells in the main help how to get the help of a command", () => {
    expect(HELP).toContain("<command> --help");
  });

  it.each(Object.keys(COMMAND_HELP))("lists %s in the main help", (command) => {
    expect(HELP).toMatch(new RegExp(`^  ${command}\\b`, "m"));
  });

  it("has the main help in the guide", () => {
    expect(readFileSync(new URL("../guide/cli.md", import.meta.url), "utf8")).toContain(HELP);
  });

  // a help request must not do the task: `schedule off --help` must not stop the schedule
  it.each([
    ["schedule", ["off", "--help"]],
    ["schedule", ["off", "a.html", "-h"]],
    ["schedule", ["daily", "07:00", "--help"]],
    ["schedule", ["--help", "off"]],
    ["refresh", ["--auto", "--help"]],
    ["refresh", ["a.html", "-h"]],
    ["refresh", ["-h", "a.html"]],
    // the help wins over a wrong flag, on both sides
    ["refresh", ["--foo", "--help"]],
    ["info", ["--help", "--foo"]],
    ["info", ["word", "-h"]],
  ])("prints only the help for %s %j", async (command, args) => {
    const f = fakes();
    const write = vi.fn(f.writer);
    expect(await cli(command, args, f.auto, write)).toEqual({
      code: 0,
      stdout: COMMAND_HELP[command],
    });
    expect(f.auto.off).not.toHaveBeenCalled();
    expect(f.auto.set).not.toHaveBeenCalled();
    expect(f.auto.status).not.toHaveBeenCalled();
    expect(f.auto.missed).not.toHaveBeenCalled();
    expect(f.auto.pages).not.toHaveBeenCalled();
    expect(f.auto.saveRun).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("does not read a dash inside a word as a flag", async () => {
    const f = fakes();
    expect(await cli("refresh", ["./-old.html"], f.auto, f.writer)).toMatchObject({ code: 0 });
    expect(await cli("refresh", ["my-page.html"], f.auto, f.writer)).toMatchObject({ code: 0 });
    expect(f.written).toEqual(["./-old.html", "my-page.html"]);
    await cli("schedule", ["*/5 * * * 1-5"], f.auto, f.writer);
    expect(f.auto.set).toHaveBeenLastCalledWith({ cron: "*/5 * * * 1-5", path: undefined });
    await cli("schedule", ["daily", "my-page.html"], f.auto, f.writer);
    expect(f.auto.set).toHaveBeenLastCalledWith({ cron: "0 7 * * *", path: "my-page.html" });
  });

  it("stops the whole schedule only with a plain off", async () => {
    const f = fakes();
    expect(await cli("schedule", ["off"], f.auto, f.writer)).toMatchObject({ code: 0 });
    expect(f.auto.off).toHaveBeenCalledWith(undefined);
  });

  it("refreshes one page, or the scheduled pages, and exits with 1 when one fails", async () => {
    const f = fakes();
    const one = await cli("refresh", ["a.html"], f.auto, f.writer);
    expect(one.code).toBe(0);
    expect(one.stdout).toMatch(/updated a\.html$/);
    expect(await cli("refresh", [], f.auto, f.writer)).toMatchObject({ code: 0 });
    expect(f.written).toEqual(["a.html", ""]);

    expect(f.auto.saveRun).not.toHaveBeenCalled();

    const all = await cli("refresh", ["--auto"], f.auto, f.writer);
    expect(all.code).toBe(1);
    expect(all.stdout).toMatch(/updated a\.html\n.*failed b\.html: gone$/);
    expect(f.auto.saveRun).toHaveBeenCalledWith({
      at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      failed: [{ path: "b.html", error: "gone" }],
    });
  });

  it("saves a run of --auto with no failed page, and exits with 0", async () => {
    const f = fakes();
    f.auto.pages.mockResolvedValue(["a.html"]);
    expect(await cli("refresh", ["--auto"], f.auto, f.writer)).toMatchObject({ code: 0 });
    expect(f.auto.saveRun).toHaveBeenCalledWith({ at: expect.any(String), failed: [] });
  });

  it("does nothing with --auto when no run time was missed", async () => {
    const f = fakes();
    f.auto.missed.mockResolvedValue(false);
    const r = await cli("refresh", ["--auto"], f.auto, f.writer);
    expect(r).toEqual({ code: 0, stdout: expect.stringMatching(/ no run due$/) });
    expect(f.written).toEqual([]);
    expect(f.auto.saveRun).not.toHaveBeenCalled();
  });

  it("waits for the network after a network error, then saves the run that worked", async () => {
    const f = fakes();
    f.auto.pages.mockResolvedValue(["a.html"]);
    const w = flaky({ "a.html": [OFFLINE, OFFLINE] });
    const s = sleeper();
    const r = await cli("refresh", ["--auto"], f.auto, w.writer, s.sleep);
    expect(s.waits).toEqual([30_000, 60_000]);
    expect(w.written).toEqual(["a.html", "a.html", "a.html"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("network not ready: trying 1 page(s) again in 30 s");
    expect(r.stdout).toMatch(/updated a\.html$/);
    expect(f.auto.saveRun).toHaveBeenCalledWith({ at: expect.any(String), failed: [] });
  });

  it("stops after the last wait and saves the network error", async () => {
    const f = fakes();
    f.auto.pages.mockResolvedValue(["a.html"]);
    const w = flaky({ "a.html": Array.from({ length: 9 }, () => OFFLINE) });
    const s = sleeper();
    const r = await cli("refresh", ["--auto"], f.auto, w.writer, s.sleep);
    expect(s.waits).toEqual(RETRY_MS);
    expect(w.written).toHaveLength(RETRY_MS.length + 1);
    expect(r.code).toBe(1);
    expect(f.auto.saveRun).toHaveBeenCalledWith({
      at: expect.any(String),
      failed: [{ path: "a.html", error: OFFLINE }],
    });
  });

  it("tries again only the pages with a network error", async () => {
    const f = fakes();
    f.auto.pages.mockResolvedValue(["a.html", "b.html"]);
    const w = flaky({ "a.html": ["GET /token -> HTTP 401"], "b.html": [OFFLINE] });
    const s = sleeper();
    const r = await cli("refresh", ["--auto"], f.auto, w.writer, s.sleep);
    expect(s.waits).toEqual([30_000]);
    expect(w.written).toEqual(["a.html", "b.html", "b.html"]);
    expect(r.code).toBe(1);
    expect(f.auto.saveRun).toHaveBeenCalledWith({
      at: expect.any(String),
      failed: [{ path: "a.html", error: "GET /token -> HTTP 401" }],
    });
  });

  it("waits with a real timer when no sleep is given", async () => {
    vi.useFakeTimers();
    try {
      const f = fakes();
      f.auto.pages.mockResolvedValue(["a.html"]);
      const w = flaky({ "a.html": [OFFLINE] });
      const run = cli("refresh", ["--auto"], f.auto, w.writer);
      await vi.advanceTimersByTimeAsync(29_999);
      expect(w.written).toEqual(["a.html"]);
      await vi.advanceTimersByTimeAsync(1);
      expect((await run).code).toBe(0);
      expect(w.written).toEqual(["a.html", "a.html"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never waits for an error that is not the network, or for a refresh by hand", async () => {
    const f = fakes();
    f.auto.pages.mockResolvedValue(["a.html"]);
    const s = sleeper();
    const denied = flaky({ "a.html": ["GET /token -> HTTP 401"] });
    expect((await cli("refresh", ["--auto"], f.auto, denied.writer, s.sleep)).code).toBe(1);
    const byHand = flaky({ "a.html": [OFFLINE] });
    expect((await cli("refresh", ["a.html"], f.auto, byHand.writer, s.sleep)).code).toBe(1);
    expect(byHand.written).toEqual(["a.html"]);
    expect(s.waits).toEqual([]);
  });

  it("reads, sets and stops the schedule, with a page as the last word", async () => {
    const f = fakes();
    expect((await cli("schedule", [], f.auto, f.writer)).stdout).toContain('"0 7 * * 1"');
    await cli("schedule", ["weekly", "friday", "18:00", "Coach.HTML"], f.auto, f.writer);
    expect(f.auto.set).toHaveBeenLastCalledWith({ cron: "0 18 * * 5", path: "Coach.HTML" });
    await cli("schedule", ["coach.html"], f.auto, f.writer);
    expect(f.auto.set).toHaveBeenLastCalledWith({ path: "coach.html" });
    await cli("schedule", ["0 6 * * *"], f.auto, f.writer);
    expect(f.auto.set).toHaveBeenLastCalledWith({ cron: "0 6 * * *", path: undefined });
    expect(await cli("schedule", ["off", "coach.html"], f.auto, f.writer)).toEqual({
      code: 0,
      stdout: "Automatic refresh is off.",
    });
    expect(f.auto.off).toHaveBeenCalledWith("coach.html");
  });

  it("gives an error on stderr with exit code 1", async () => {
    const f = fakes();
    expect(await cli("schedule", ["hourly"], f.auto, f.writer)).toMatchObject({
      code: 1,
      stderr: expect.stringMatching(/^schedule failed: Schedule: daily/),
    });
    expect(f.auto.set).not.toHaveBeenCalled();
  });

  it("shows the settings and the files, never the API key", async () => {
    const dir = mkdtempSync(join(tmpdir(), "garmin-info-"));
    const data = join(dir, "data");
    mkdirSync(join(data, "fit"), { recursive: true });
    writeFileSync(join(data, "fit", "1.fit"), "");
    writeFileSync(join(data, "fit", "2.FIT"), "");
    writeFileSync(join(data, "fit", "notes.txt"), "");
    writeFileSync(join(data, "garmin-dashboard.html"), "");
    writeFileSync(join(data, "Coach.HTML"), "");
    writeFileSync(join(data, "widgets.json"), "[]");
    const config = { baseUrl: "https://api.test", apiKeyFile: join(dir, "api-key"), dataDir: data };
    const text = info(config, "off", { GARMIN_PERSONAL_API_KEY: "s3cret-key" }, dir);
    expect(text).not.toContain("s3cret-key");
    expect(text).toMatch(new RegExp(`^garmin-personal-mcp ${version}\\n`));
    expect(text).toContain(`\nNode.js:      ${process.version} on ${process.platform}\n`);
    expect(text).toContain("API host:     https://api.test");
    expect(text).toContain("API key:      from GARMIN_PERSONAL_API_KEY");
    expect(text).toContain(`Key file:     ${join("~", "api-key")} (missing)`);
    expect(text).toContain(`Data folder:  ${join("~", "data")} (found)`);
    expect(text).toContain("  .FIT files: 2");
    expect(text).toContain("  pages:      Coach.HTML, garmin-dashboard.html\n");
    expect(text).toContain("  widgets.json: found\n  auto-refresh.json: missing");
    expect(text).toContain(
      `Server log:   ${join("~", ".cache/garmin-personal-mcp/garmin-personal-mcp.log")}`,
    );
    expect(text).toContain(`Refresh log:  ${join("~", ".cache/garmin-personal-mcp/refresh.log")}`);
    expect(text).not.toContain(dir);
    expect(text).toMatch(/Schedule:     off$/);

    writeFileSync(join(dir, "api-key"), "k");
    const noData = { ...config, dataDir: join(dir, "none") };
    // a key of only spaces is no key, as in the API client: the key file is used
    const other = info(noData, "off", { GARMIN_PERSONAL_API_KEY: " \n" }, dir);
    expect(other).toContain("API key:      from the key file");
    expect(other).toContain(`Key file:     ${join("~", "api-key")} (found)`);
    expect(other).toContain(`Data folder:  ${join("~", "none")} (missing)`);
    expect(other).toContain("  .FIT files: 0\n  pages:      none");
  });

  it("hides the home folder in the schedule error of info, and keeps a path outside it", () => {
    const home = mkdtempSync(join(tmpdir(), "garmin-info-"));
    const outside = mkdtempSync(join(tmpdir(), "garmin-data-"));
    const config = {
      baseUrl: "https://api.test",
      apiKeyFile: join(outside, "k"),
      dataDir: outside,
    };
    const text = info(config, `cannot read it: open '${join(home, "a.json")}'`, {}, home);
    expect(text).toContain(`cannot read it: open '${join("~", "a.json")}'`);
    expect(text).toContain(`Key file:     ${join(outside, "k")} (missing)`);
    expect(text).toContain(`Data folder:  ${outside} (found)`);
  });

  it.each([
    ["/home/you", "/home/you", "~"],
    ["/home/you/a.html", "/home/you", "~/a.html"],
    ["/home/you/", "/home/you/", "~/"],
    ["/home/you/a", "/home/you/", "~/a"],
    ["Key: /home/you/a (found)", "/home/you", "Key: ~/a (found)"],
    ["open '/home/you/a'", "/home/you", "open '~/a'"],
    ['open "/home/you/a"', "/home/you", 'open "~/a"'],
    ["(/home/you/a)", "/home/you", "(~/a)"],
    ["/home/you/a, /home/you/b", "/home/you", "~/a, ~/b"],
    ["C:\\Users\\you\\a", "C:\\Users\\you", "~\\a"],
    ["/home/my name/a", "/home/my name", "~/a"],
    // Windows: either slash, no case, a drive or a network folder
    ["C:/Users/you/a", "C:\\Users\\you", "~/a"],
    ["C:\\Users\\you\\a", "C:/Users/you", "~\\a"],
    ["c:\\users\\YOU\\a", "C:\\Users\\you", "~\\a"],
    ["open 'C:\\Users\\you\\a'", "C:\\Users\\you", "open '~\\a'"],
    ["\\\\server\\Home\\you\\a", "\\\\server\\home\\you", "~\\a"],
    ["C:\\Users\\you2\\a", "C:\\Users\\you", "C:\\Users\\you2\\a"],
    ["D:\\Users\\you\\a", "C:\\Users\\you", "D:\\Users\\you\\a"],
    // POSIX keeps the case
    ["/home/YOU/a", "/home/you", "/home/YOU/a"],
    // the characters of a regular expression in the home folder are plain characters
    ["/home/a.b+c/d", "/home/a.b+c", "~/d"],
    ["/home/axb+c/d", "/home/a.b+c", "/home/axb+c/d"],
    ["/home/$&/d", "/home/$&", "~/d"],
    // another folder that only looks like the home folder stays as it is
    ["/home/you2/a", "/home/you", "/home/you2/a"],
    ["/home/you.old", "/home/you", "/home/you.old"],
    ["/mnt/backup/home/you/a", "/home/you", "/mnt/backup/home/you/a"],
    ["https://x/home/you/a", "/home/you", "https://x/home/you/a"],
    // a home folder that is the root or empty hides nothing
    ["/etc/a", "/", "/etc/a"],
    ["/etc/a", "", "/etc/a"],
    ["C:\\a", "C:\\", "C:\\a"],
  ])("hideHome of %j with home %j gives %j", (text, home, expected) => {
    expect(hideHome(text, home)).toBe(expected);
  });

  it("runs info with the first line of the schedule, or the error when it cannot read the schedule", async () => {
    const f = fakes();
    const config = { baseUrl: "b", apiKeyFile: "/no/key", dataDir: "/no/data" };
    const r = await cli("info", [], f.auto, f.writer, undefined, config);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Schedule:     Automatic refresh "0 7 \* \* 1" with launchd/);
    f.auto.status.mockRejectedValueOnce(new Error("bad JSON"));
    const bad = await cli("info", [], f.auto, f.writer, undefined, config);
    expect(bad).toMatchObject({ code: 0 });
    expect(bad.stdout).toMatch(/Schedule:     cannot read it: bad JSON$/);
    expect(HELP).toContain("  info ");
  });

  it("says when the job is missing from the scheduler", () => {
    expect(summary(on)).toBe(
      [
        'Automatic refresh "0 7 * * 1" with launchd, next: 2026-11-02 07:00, 2026-11-09 07:00',
        "Pages:",
        "  /d/garmin-dashboard.html",
        "Log: /h/refresh.log",
      ].join("\n"),
    );
    expect(summary({ ...on, installed: false })).toContain(
      "The job is missing from launchd or cannot start (its Node.js or server file is gone): run the schedule again.",
    );
  });

  it("prints the last run and the pages it could not update", () => {
    const ok = { at: "2026-11-02T06:00:00.000Z", failed: [] };
    expect(summary({ ...on, last: ok })).toContain(
      "Last run: 2026-11-02T06:00:00.000Z, every page updated\nLog:",
    );
    const bad = { ...ok, failed: [{ path: "/d/a.html", error: "HTTP 401" }] };
    expect(summary({ ...on, last: bad })).toContain(
      "Last run: 2026-11-02T06:00:00.000Z, failed:\n  /d/a.html: HTTP 401\nLog:",
    );
  });
});

/** Imports the entry point with these arguments, the transport and the commands mocked. */
async function start(
  args: string[],
  result: { code: number; stdout?: string; stderr?: string } = {
    code: 3,
    stdout: "out",
    stderr: "err",
  },
) {
  // the factory runs as the real transport runs it: it makes the server
  const serveStdio = vi.fn((factory: () => unknown) => factory());
  const run = vi.fn(async () => result);
  vi.doMock("@modelcontextprotocol/server/stdio", () => ({ serveStdio }));
  vi.doMock("../src/cli", async (original) => ({
    ...(await original<typeof import("../src/cli")>()),
    cli: run,
  }));
  const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  process.argv = ["node", "index.js", ...args];
  await import("../src/index");
  return { serveStdio, run, stdout, stderr };
}

/** Garmin answers the token request with this status and body. */
function garmin(status = 200, body = `{"access_token":"t0ken"}`) {
  const fetch = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const off = () => ({ ...fakes().auto, status: vi.fn(async () => ({ scheduled: false })) });

const run = (config: Config, home: string, auto = fakes().auto) =>
  doctor(config, auto, process.platform, home);

describe("doctor", () => {
  const KEY = "s3cret-key";

  /** A home folder with a good key file and a data folder. */
  function setUp(mode = 0o600) {
    const home = mkdtempSync(join(tmpdir(), "garmin-doctor-"));
    const dataDir = join(home, "data");
    mkdirSync(dataDir);
    const apiKeyFile = join(home, "api-key");
    writeFileSync(apiKeyFile, KEY);
    chmodSync(apiKeyFile, mode);
    return { home, config: { baseUrl: "https://api.test", apiKeyFile, dataDir } };
  }

  const skipIfNoMode = it.skipIf(process.platform === "win32" || process.getuid?.() === 0);

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("passes all the checks, with the key in the request only", async () => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "");
    const fetch = garmin();
    const { home, config } = setUp();
    const r = await doctor(config, off(), process.platform, home);
    expect(r.code).toBe(0);
    expect(r.stdout!.split("\n")).toEqual([
      `ok      Key file: ${join("~", "api-key")}${process.platform === "win32" ? " (who can read it is not checked on Windows)" : ""}`,
      "ok      API key: Garmin accepts it (from the key file)",
      `ok      Data folder: ${join("~", "data")}`,
      `ok      Log folder: ${join("~", ".cache/garmin-personal-mcp")} is missing, the server makes it when it needs it`,
      "ok      Schedule: off",
      "All checks passed.",
    ]);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://api.test/personalapitoken-service/personal-api/personal-api-key/token",
    );
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: `ApiKey ${KEY}` });
    expect(r.stdout).not.toContain(KEY);
    expect(r.stdout).not.toContain("t0ken");
    expect(r.stdout).not.toContain(home);
  });

  it("runs from the command line and gives the exit code of the checks", async () => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "");
    garmin(401);
    const { config } = setUp();
    const r = await cli("doctor", [], off(), fakes().writer, undefined, config);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/1 check failed\.$/);
    expect(r.stderr).toBeUndefined();
  });

  it.each([
    [401, "the personal API key is incorrect, expired or revoked"],
    [403, "the personal API key is incorrect, expired or revoked"],
    [503, "did not answer correctly"],
  ])("fails with the reason and no key when Garmin answers %i", async (status, reason) => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "");
    // a server can echo the request
    garmin(status, `bad key ${KEY}`);
    const { home, config } = setUp();
    const r = await doctor(config, off(), process.platform, home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^failed {2}API key: Token request failed: HTTP \d+/m);
    expect(r.stdout).toContain(reason);
    expect(r.stdout).not.toContain(KEY);
    expect(r.stdout).not.toContain(home);
  });

  it("fails on a network error, without the key that a fetch error can quote", async () => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError(`bad header ApiKey ${KEY}`)));
    const { home, config } = setUp();
    const r = await doctor(config, off(), process.platform, home);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("failed  API key: Network error obtaining token: bad header");
    expect(r.stdout).not.toContain(KEY);
  });

  it("fails without a key, and does not call Garmin", async () => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "");
    const fetch = garmin();
    const { home, config } = setUp();
    const none = { ...config, apiKeyFile: join(home, "no-key") };
    const r = await doctor(none, off(), process.platform, home);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(
      `failed  Key file: ${join("~", "no-key")} is missing. Run: npx -y @indaco/garmin-personal-mcp@latest setup`,
    );
    expect(r.stdout).toContain("failed  API key: No API key");
    expect(r.stdout).toMatch(/2 checks failed\.$/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails on an empty key file and on a file with more than the key", async () => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "");
    garmin();
    const { home, config } = setUp();
    writeFileSync(config.apiKeyFile, "  \n");
    expect((await doctor(config, off(), process.platform, home)).stdout).toContain(
      "failed  API key: API key file is empty",
    );
    writeFileSync(config.apiKeyFile, `${KEY}\nmore text`);
    const r = await doctor(config, off(), process.platform, home);
    expect(r.stdout).toContain("failed  API key: The API key file has more than the key");
    expect(r.stdout).not.toContain(KEY);
  });

  it("tests the key of the environment, and needs no key file for it", async () => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "env-key");
    const fetch = garmin();
    const { home, config } = setUp();
    const none = { ...config, apiKeyFile: join(home, "no-key") };
    const r = await doctor(none, off(), process.platform, home);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      `ok      Key file: ${join("~", "no-key")} is missing, the key comes from GARMIN_PERSONAL_API_KEY`,
    );
    expect(r.stdout).toContain("ok      API key: Garmin accepts it (from GARMIN_PERSONAL_API_KEY)");
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: "ApiKey env-key" });
    expect(r.stdout).not.toContain("env-key");
  });

  it("needs the key file for a schedule, also with a key in the environment", async () => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "env-key");
    garmin();
    const { home, config } = setUp();
    const none = { ...config, apiKeyFile: join(home, "no-key") };
    const r = await doctor(none, fakes().auto, process.platform, home);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(
      "the automatic update reads only the key file. Run: npx -y @indaco/garmin-personal-mcp@latest setup",
    );
  });

  describe("the key of the schedule", () => {
    const ENV = "env-key-ok";
    const BAD = "file-key-refused";
    const GOOD = "file-key-ok";
    const LINE = /^(ok {4}|failed {2})Key of the schedule:/m;
    const accepted = new Set<string>();

    /** Garmin accepts the keys in `accepted` and refuses the others. */
    function stubGarmin() {
      const fetch = vi.fn(async (_url: string, init: RequestInit) => {
        const key = (init.headers as Record<string, string>).Authorization.replace("ApiKey ", "");
        return accepted.has(key)
          ? new Response(`{"access_token":"t0ken"}`)
          : new Response(`bad key ${key}`, { status: 401 });
      });
      vi.stubGlobal("fetch", fetch);
      return fetch;
    }
    const keysOf = (r: { stdout?: string }) =>
      [ENV, BAD, GOOD].filter((k) => r.stdout!.includes(k));

    beforeEach(() => {
      accepted.clear();
      accepted.add(ENV);
    });

    it("fails when the key file is refused, though the key in the environment works", async () => {
      vi.stubEnv("GARMIN_PERSONAL_API_KEY", ENV);
      const fetch = stubGarmin();
      const { home, config } = setUp();
      writeFileSync(config.apiKeyFile, BAD);
      const r = await run(config, home);
      expect(r.code).toBe(1);
      expect(r.stdout).toMatch(/^failed {2}Key of the schedule: Token request failed: HTTP 401/m);
      expect(r.stdout).toMatch(/^failed {2}Key of the schedule: .*and run setup --force\.$/m);
      expect(r.stdout).toMatch(/^1 check failed\.$/m);
      expect(keysOf(r)).toEqual([]);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("passes when both keys work", async () => {
      vi.stubEnv("GARMIN_PERSONAL_API_KEY", ENV);
      accepted.add(GOOD);
      stubGarmin();
      const { home, config } = setUp();
      writeFileSync(config.apiKeyFile, GOOD);
      const r = await run(config, home);
      expect(r.stdout).toContain(
        "ok      Key of the schedule: Garmin accepts the key in the key file",
      );
      expect(r.stdout).not.toContain("failed  Key of the schedule");
      expect(keysOf(r)).toEqual([]);
    });

    it("is not tested when no schedule is on", async () => {
      vi.stubEnv("GARMIN_PERSONAL_API_KEY", ENV);
      const fetch = stubGarmin();
      const { home, config } = setUp();
      writeFileSync(config.apiKeyFile, BAD);
      const r = await run(config, home, off());
      expect(r.stdout).not.toMatch(LINE);
      expect(r.code).toBe(0);
      expect(fetch).toHaveBeenCalledOnce();
    });

    it("is not tested without a key in the environment: the API key check did it", async () => {
      vi.stubEnv("GARMIN_PERSONAL_API_KEY", "");
      accepted.add(GOOD);
      const fetch = stubGarmin();
      const { home, config } = setUp();
      writeFileSync(config.apiKeyFile, GOOD);
      const r = await run(config, home);
      expect(r.stdout).not.toMatch(LINE);
      expect(fetch).toHaveBeenCalledOnce();
    });

    it("is not tested when the key file is missing: the key file check says so", async () => {
      vi.stubEnv("GARMIN_PERSONAL_API_KEY", ENV);
      const fetch = stubGarmin();
      const { home, config } = setUp();
      const none = { ...config, apiKeyFile: join(home, "no-key") };
      const r = await run(none, home);
      expect(r.stdout).not.toMatch(LINE);
      expect(fetch).toHaveBeenCalledOnce();
    });

    it("fails on an empty key file, and shows its path with ~", async () => {
      vi.stubEnv("GARMIN_PERSONAL_API_KEY", ENV);
      const fetch = stubGarmin();
      const { home, config } = setUp();
      writeFileSync(config.apiKeyFile, " \n");
      const r = await run(config, home);
      expect(r.stdout).toContain(`failed  Key of the schedule: ${join("~", "api-key")} has no key`);
      expect(r.stdout).not.toContain(home);
      expect(fetch).toHaveBeenCalledOnce();
    });

    it("fails on a key file that cannot be read", async () => {
      vi.stubEnv("GARMIN_PERSONAL_API_KEY", ENV);
      const fetch = stubGarmin();
      const { home, config } = setUp();
      const asFolder = { ...config, apiKeyFile: join(home, "folder") };
      mkdirSync(asFolder.apiKeyFile);
      const r = await run(asFolder, home);
      expect(r.stdout).toContain(`failed  Key of the schedule: ${join("~", "folder")} has no key`);
      expect(fetch).toHaveBeenCalledOnce();
    });

    it("does not count a key of only spaces in the environment", async () => {
      vi.stubEnv("GARMIN_PERSONAL_API_KEY", "   ");
      accepted.add(GOOD);
      const fetch = stubGarmin();
      const { home, config } = setUp();
      writeFileSync(config.apiKeyFile, GOOD);
      const r = await run(config, home);
      expect(r.stdout).not.toMatch(LINE);
      expect(fetch).toHaveBeenCalledOnce();
    });

    it("fails on a key file with a space inside, without a request for it or the key", async () => {
      vi.stubEnv("GARMIN_PERSONAL_API_KEY", ENV);
      const fetch = stubGarmin();
      const { home, config } = setUp();
      writeFileSync(config.apiKeyFile, "file-key bad");
      const r = await run(config, home);
      expect(r.stdout).toMatch(/^failed {2}Key of the schedule: The key has spaces/m);
      expect(r.stdout).not.toContain("file-key");
      expect(fetch).toHaveBeenCalledOnce();
    });

    it("fails on a network error for the key file, without the key", async () => {
      vi.stubEnv("GARMIN_PERSONAL_API_KEY", ENV);
      const fetch = vi.fn(async (_url: string, init: RequestInit) => {
        const key = (init.headers as Record<string, string>).Authorization;
        if (key.endsWith(BAD)) throw new TypeError(`bad header ${key}`);
        return new Response(`{"access_token":"t0ken"}`);
      });
      vi.stubGlobal("fetch", fetch);
      const { home, config } = setUp();
      writeFileSync(config.apiKeyFile, BAD);
      const r = await run(config, home);
      expect(r.stdout).toContain("failed  Key of the schedule: Network error obtaining token");
      expect(keysOf(r)).toEqual([]);
    });
  });

  skipIfNoMode.each([0o644, 0o640, 0o604, 0o666])(
    "fails on a key file with mode %o, with the command that fixes it",
    async (mode) => {
      vi.stubEnv("GARMIN_PERSONAL_API_KEY", "");
      garmin();
      const { home, config } = setUp(mode);
      const r = await doctor(config, off(), process.platform, home);
      expect(r.code).toBe(1);
      expect(r.stdout).toContain(
        `failed  Key file: other users can read it. Run: chmod 600 ${join("~", "api-key")}`,
      );
    },
  );

  skipIfNoMode.each([0o600, 0o400])("accepts a key file with mode %o", async (mode) => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "");
    garmin();
    const { home, config } = setUp(mode);
    expect((await doctor(config, off(), process.platform, home)).code).toBe(0);
  });

  skipIfNoMode.each([
    ["my keys/api-key", "~/'my keys/api-key'"],
    ["it's/api-key", "~/'it'\\''s/api-key'"],
  ])("quotes the path %s in the chmod command", async (name, arg) => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "");
    garmin();
    const { home, config } = setUp();
    const apiKeyFile = join(home, name);
    mkdirSync(join(apiKeyFile, ".."), { recursive: true });
    writeFileSync(apiKeyFile, KEY, { mode: 0o644 });
    chmodSync(apiKeyFile, 0o644);
    const r = await doctor({ ...config, apiKeyFile }, off(), process.platform, home);
    expect(r.stdout).toContain(`Run: chmod 600 ${arg}`);
  });

  skipIfNoMode("quotes a path outside the home folder in the chmod command", async () => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "");
    garmin();
    const { config } = setUp();
    const apiKeyFile = join(mkdtempSync(join(tmpdir(), "garmin other-")), "api-key");
    writeFileSync(apiKeyFile, KEY);
    chmodSync(apiKeyFile, 0o644);
    const home = mkdtempSync(join(tmpdir(), "garmin-home-"));
    const r = await doctor({ ...config, apiKeyFile }, off(), process.platform, home);
    expect(r.stdout).toContain(`chmod 600 '${apiKeyFile}'`);
  });

  it("does not check the mode of the key file on Windows, and gives no chmod", async () => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "");
    garmin();
    const { home, config } = setUp(0o644);
    const r = await doctor(config, off(), "win32", home);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      `ok      Key file: ${join("~", "api-key")} (who can read it is not checked on Windows)`,
    );
    expect(r.stdout).not.toContain("chmod");
  });

  it("fails on a key file that it cannot look at", async () => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "");
    garmin();
    const { home, config } = setUp();
    const bad = { ...config, apiKeyFile: `${config.apiKeyFile}\0` };
    const r = await doctor(bad, off(), process.platform, home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^failed {2}Key file: cannot read it: /m);
  });

  it("does not make a missing folder and leaves nothing in a folder that it tests", async () => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "");
    garmin();
    const { home, config } = setUp();
    const dataDir = join(home, "a", "b", "data");
    const r = await doctor({ ...config, dataDir }, off(), process.platform, home);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      `ok      Data folder: ${join("~", "a", "b", "data")} is missing, the server makes it when it needs it`,
    );
    expect(existsSync(join(home, "a"))).toBe(false);
    expect(readdirSync(home).toSorted()).toEqual(["api-key", "data"]);
    expect(readdirSync(config.dataDir)).toEqual([]);
  });

  it("fails on a folder under a file", async () => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "");
    garmin();
    const { home, config } = setUp();
    const dataDir = join(config.apiKeyFile, "data");
    const r = await doctor({ ...config, dataDir }, off(), process.platform, home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^failed {2}Data folder: cannot write in .*api-key: /m);
  });

  skipIfNoMode("fails on a folder that it cannot write in, and on the log folder", async () => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "");
    garmin();
    const { home, config } = setUp();
    chmodSync(config.dataDir, 0o500);
    const logs = join(home, ".cache");
    mkdirSync(logs);
    chmodSync(logs, 0o500);
    const r = await doctor(config, off(), process.platform, home);
    chmodSync(config.dataDir, 0o700);
    chmodSync(logs, 0o700);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^failed {2}Data folder: cannot write in ~\/data: /m);
    expect(r.stdout).toMatch(/^failed {2}Log folder: cannot write in ~\/\.cache: /m);
    expect(r.stdout).toMatch(/2 checks failed\.$/);
  });

  it("shows a schedule that works", async () => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "");
    garmin();
    const { home, config } = setUp();
    const r = await doctor(config, fakes().auto, process.platform, home);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('ok      Schedule: Automatic refresh "0 7 * * 1" with launchd');
  });

  it("fails when the job is missing from the scheduler", async () => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "");
    garmin();
    const { home, config } = setUp();
    const auto = { ...fakes().auto, status: vi.fn(async () => ({ ...on, installed: false })) };
    const r = await doctor(config, auto, process.platform, home);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(
      "failed  Schedule: the job is missing from launchd. Set the schedule again.",
    );
  });

  it("fails when the last run could not update a page", async () => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "");
    garmin();
    const { home, config } = setUp();
    const last = {
      at: "2026-11-02T07:00:00Z",
      failed: [{ path: join(home, "a.html"), error: "gone" }],
    };
    const auto = { ...fakes().auto, status: vi.fn(async () => ({ ...on, last })) };
    const r = await doctor(config, auto, process.platform, home);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(
      `failed  Schedule: the last run (2026-11-02T07:00:00Z) could not update ${join("~", "a.html")}: gone`,
    );
  });

  it("accepts a last run that updated every page", async () => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "");
    garmin();
    const { home, config } = setUp();
    const last = { at: "2026-11-02T07:00:00Z", failed: [] };
    const auto = { ...fakes().auto, status: vi.fn(async () => ({ ...on, last })) };
    expect((await doctor(config, auto, process.platform, home)).code).toBe(0);
  });

  it("fails on a damaged schedule file and still does the other checks", async () => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "");
    garmin();
    const { home, config } = setUp();
    const auto = { ...fakes().auto, status: vi.fn().mockRejectedValue(new Error("bad JSON")) };
    const r = await doctor(config, auto, process.platform, home);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("failed  Schedule: cannot read it: bad JSON");
    expect(r.stdout).toContain("ok      API key:");
    expect(r.stdout).toMatch(/1 check failed\.$/);
  });
});

const never = () =>
  vi.fn(async (): Promise<string> => {
    throw new Error("must not ask");
  });
const noExec = () =>
  vi.fn(async () => {
    throw new Error("must not run");
  });
const icacls = (code = 0) => vi.fn(async () => ({ code, stdout: "", stderr: "" }));

const answer = (key: string) => vi.fn(async () => key);

function newHome() {
  const home = mkdtempSync(join(tmpdir(), "garmin-setup-"));
  const apiKeyFile = join(home, ".config", "garmin-mcp", "api-key");
  const config = { baseUrl: "https://api.test", apiKeyFile, dataDir: join(home, "data") };
  return { home, apiKeyFile, config };
}

describe("setup", () => {
  const KEY = "s3cret-key";

  const skipIfNoMode = it.skipIf(process.platform === "win32" || process.getuid?.() === 0);

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "");
    vi.stubEnv("GARMIN_API_KEY_FILE", "");
  });

  it("tests the key, saves it and tells how to connect the client", async () => {
    const fetch = garmin();
    const { home, apiKeyFile, config } = newHome();
    const r = await setup([], config, answer(KEY), "linux", noExec(), home);
    expect(r.code).toBe(0);
    expect(r.stderr).toBeUndefined();
    expect(readFileSync(apiKeyFile, "utf8")).toBe(`${KEY}\n`);
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: `ApiKey ${KEY}` });
    expect(r.stdout).toContain(
      `The key works. It is saved in ${join("~", ".config", "garmin-mcp", "api-key")}, and only you can read it.`,
    );
    expect(r.stdout).toContain("command: npx");
    expect(r.stdout).toContain("args:    -y @indaco/garmin-personal-mcp@latest");
    expect(r.stdout).toContain(
      "https://github.com/indaco/garmin-personal-mcp#2-connect-your-client",
    );
    expect(r.stdout).toContain("@latest doctor");
    expect(r.stdout).not.toContain(KEY);
    expect(r.stdout).not.toContain(home);
    expect(readdirSync(join(home, ".config", "garmin-mcp"))).toEqual(["api-key"]);
  });

  skipIfNoMode("makes a key file and a folder that only the user can read", async () => {
    garmin();
    const { home, apiKeyFile, config } = newHome();
    const umask = process.umask(0);
    try {
      await setup([], config, answer(KEY), "linux", noExec(), home);
    } finally {
      process.umask(umask);
    }
    expect(statSync(apiKeyFile).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, ".config", "garmin-mcp")).mode & 0o777).toBe(0o700);
  });

  describe("a key file that appears while setup waits at the prompt", () => {
    const FIRST = "first-key-text";
    const NEWER = "newer-fake-key";
    /** A prompt that makes the key file, as a second terminal does, then answers with the new key. */
    const racing = (file: string) =>
      vi.fn(async () => {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, FIRST);
        return NEWER;
      });

    it("stays as it is, and the new key is not saved", async () => {
      garmin();
      const { home, apiKeyFile, config } = newHome();
      const r = await setup([], config, racing(apiKeyFile), "linux", noExec(), home);
      expect(r.code).toBe(1);
      expect(readFileSync(apiKeyFile, "utf8")).toBe(FIRST);
      expect(r.stderr).toContain("appeared while setup ran");
      expect(r.stderr).toContain("The new key is not saved.");
      expect(r.stderr).toContain("setup --force");
      expect(r.stderr).not.toContain(FIRST);
      expect(r.stderr).not.toContain(NEWER);
      expect(readdirSync(dirname(apiKeyFile))).toEqual(["api-key"]);
    });

    it("is replaced with --force", async () => {
      garmin();
      const { home, apiKeyFile, config } = newHome();
      const r = await setup(["--force"], config, racing(apiKeyFile), "linux", noExec(), home);
      expect(r.code).toBe(0);
      expect(readFileSync(apiKeyFile, "utf8")).toBe(`${NEWER}\n`);
    });

    it("stays as it is when Garmin refuses the new key", async () => {
      garmin(401, "bad");
      const { home, apiKeyFile, config } = newHome();
      const r = await setup([], config, racing(apiKeyFile), "linux", noExec(), home);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("The key is not saved.");
      expect(r.stderr).not.toContain("appeared");
      expect(readFileSync(apiKeyFile, "utf8")).toBe(FIRST);
    });

    it("stays as it is on a network error in the test of the key, and leaves no temporary file", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
      const { home, apiKeyFile, config } = newHome();
      const r = await setup([], config, racing(apiKeyFile), "linux", noExec(), home);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("The new key is not saved.");
      expect(r.stderr).not.toContain(NEWER);
      expect(readFileSync(apiKeyFile, "utf8")).toBe(FIRST);
      expect(readdirSync(dirname(apiKeyFile))).toEqual(["api-key"]);
    });
  });

  it.each([[`  ${KEY}  `], [`${KEY}\r`], [`﻿${KEY}`], [`\t${KEY}\n`]])(
    "saves only the key from %j",
    async (input) => {
      garmin();
      const { home, apiKeyFile, config } = newHome();
      expect((await setup([], config, answer(input), "linux", noExec(), home)).code).toBe(0);
      expect(readFileSync(apiKeyFile, "utf8")).toBe(`${KEY}\n`);
    },
  );

  it.each(["", "   ", "\r", "﻿"])("saves nothing without a key: %j", async (input) => {
    const fetch = garmin();
    const { home, apiKeyFile, config } = newHome();
    const r = await setup([], config, answer(input), "linux", noExec(), home);
    expect(r).toEqual({ code: 1, stderr: "No key given. Nothing changed." });
    expect(existsSync(apiKeyFile)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["two words", "a\nb", "a\tb", "ключ", "a\u0000b"])(
    "refuses %j without a request, and does not repeat it",
    async (input) => {
      const fetch = garmin();
      const { home, apiKeyFile, config } = newHome();
      const r = await setup([], config, answer(input), "linux", noExec(), home);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("spaces, line breaks or other characters");
      expect(r.stderr).toContain("The key is not saved.");
      expect(r.stderr).not.toContain(input);
      expect(existsSync(apiKeyFile)).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([401, 403])("does not save a key that Garmin refuses with %i", async (status) => {
    // a server can echo the request
    garmin(status, `bad ${KEY}`);
    const { home, apiKeyFile, config } = newHome();
    const r = await setup([], config, answer(KEY), "linux", noExec(), home);
    expect(r.code).toBe(1);
    expect(r.stdout).toBeUndefined();
    expect(r.stderr).toContain("the personal API key is incorrect, expired or revoked");
    expect(r.stderr).toContain("and run setup --force.");
    expect(r.stderr).not.toContain("setup again");
    expect(r.stderr).toContain("The key is not saved.");
    expect(r.stderr).not.toContain(KEY);
    expect(existsSync(apiKeyFile)).toBe(false);
  });

  it("keeps the old key when Garmin refuses the new one", async () => {
    garmin(401);
    const { home, apiKeyFile, config } = newHome();
    mkdirSync(join(apiKeyFile, ".."), { recursive: true });
    writeFileSync(apiKeyFile, "old-key");
    const r = await setup(["--force"], config, answer(KEY), "linux", noExec(), home);
    expect(r.code).toBe(1);
    expect(readFileSync(apiKeyFile, "utf8")).toBe("old-key");
    expect(r.stderr).toContain("and run setup --force.");
  });

  // Garmin shows a key only one time: an answer that says nothing about the key must not lose it
  it.each([
    ["a network error", () => vi.fn().mockRejectedValue(new TypeError(`no route ApiKey ${KEY}`))],
    ["an error of Garmin", () => vi.fn(async () => new Response(`down ${KEY}`, { status: 503 }))],
    ["an empty answer", () => vi.fn(async () => new Response("", { status: 200 }))],
  ])("saves the key after %s, says that it is not tested and gives 1", async (_name, fetch) => {
    vi.stubGlobal("fetch", fetch());
    const { home, apiKeyFile, config } = newHome();
    const r = await setup([], config, answer(KEY), "linux", noExec(), home);
    expect(r.code).toBe(1);
    expect(r.stdout).toBeUndefined();
    expect(readFileSync(apiKeyFile, "utf8")).toBe(`${KEY}\n`);
    expect(r.stderr).toContain("The key is saved");
    expect(r.stderr).toContain("but it is not tested, and only you can read it.");
    expect(r.stderr).toContain("@latest doctor");
    expect(r.stderr).not.toContain(KEY);
    expect(r.stderr).not.toContain(home);
  });

  it("does not ask and changes nothing when the key file exists", async () => {
    const fetch = garmin();
    const { home, apiKeyFile, config } = newHome();
    mkdirSync(join(apiKeyFile, ".."), { recursive: true });
    writeFileSync(apiKeyFile, "old-key");
    const ask = never();
    const r = await setup([], config, ask, "linux", noExec(), home);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`${join("~", ".config", "garmin-mcp", "api-key")} exists`);
    expect(r.stderr).toContain("--force");
    expect(ask).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(readFileSync(apiKeyFile, "utf8")).toBe("old-key");
  });

  skipIfNoMode(
    "replaces the key with --force and closes a file that others could read",
    async () => {
      garmin();
      const { home, apiKeyFile, config } = newHome();
      mkdirSync(join(apiKeyFile, ".."), { recursive: true });
      writeFileSync(apiKeyFile, "old-key");
      chmodSync(apiKeyFile, 0o644);
      const r = await setup(["--force"], config, answer(KEY), "linux", noExec(), home);
      expect(r.code).toBe(0);
      expect(readFileSync(apiKeyFile, "utf8")).toBe(`${KEY}\n`);
      expect(statSync(apiKeyFile).mode & 0o777).toBe(0o600);
    },
  );

  it.each([[[KEY]], [["--force", KEY]], [["a", "b"]]])(
    "does not read the key from the arguments %j, and does not repeat them",
    async (args) => {
      const fetch = garmin();
      const { home, apiKeyFile, config } = newHome();
      const ask = never();
      const r = await setup(args, config, ask, "linux", noExec(), home);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("does not take the key as an argument");
      expect(r.stderr).toContain("shell history");
      expect(r.stderr).not.toContain(args.at(-1));
      expect(ask).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(existsSync(apiKeyFile)).toBe(false);
    },
  );

  it("tests the new key, not the key of the environment, and warns about its priority", async () => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "env-key");
    const fetch = garmin();
    const { home, config } = newHome();
    const r = await setup([], config, answer(KEY), "linux", noExec(), home);
    expect(r.code).toBe(0);
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: `ApiKey ${KEY}` });
    expect(r.stdout).toContain(
      "GARMIN_PERSONAL_API_KEY is set, and it has priority over this file",
    );
    expect(r.stdout).not.toContain("env-key");
  });

  it("says that the client needs a key file from the environment too", async () => {
    garmin();
    const { home, config } = newHome();
    const plain = await setup([], config, answer(KEY), "linux", noExec(), home);
    expect(plain.stdout).not.toContain("GARMIN_API_KEY_FILE");
    const again = newHome();
    vi.stubEnv("GARMIN_API_KEY_FILE", again.apiKeyFile);
    const r = await setup([], again.config, answer(KEY), "linux", noExec(), again.home);
    expect(r.stdout).toContain("Set GARMIN_API_KEY_FILE in your MCP client too");
  });

  it("saves in a path with spaces and quotes", async () => {
    garmin();
    const { home, config } = newHome();
    const apiKeyFile = join(home, "my keys", "it's", "api key");
    const r = await setup([], { ...config, apiKeyFile }, answer(KEY), "linux", noExec(), home);
    expect(r.code).toBe(0);
    expect(readFileSync(apiKeyFile, "utf8")).toBe(`${KEY}\n`);
  });

  it("gives the reason and leaves no key behind when it cannot save", async () => {
    garmin();
    const { home, config } = newHome();
    // the folder of the key file is a file
    writeFileSync(join(home, "file"), "");
    const under = { ...config, apiKeyFile: join(home, "file", "api-key") };
    const r = await setup([], under, answer(KEY), "linux", noExec(), home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^Cannot save the key in ~.file.api-key: /);
    expect(r.stderr).not.toContain(KEY);
    expect(r.stderr).not.toContain(home);
  });

  it("removes the temporary file when the last step fails", async () => {
    garmin();
    const { home, config } = newHome();
    // the key file is a folder that has a file, so the rename fails with --force
    const apiKeyFile = join(home, "api-key");
    mkdirSync(apiKeyFile);
    writeFileSync(join(apiKeyFile, "x"), "");
    const r = await setup(
      ["--force"],
      { ...config, apiKeyFile },
      answer(KEY),
      "linux",
      noExec(),
      home,
    );
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^Cannot save the key in /);
    expect(r.stderr).not.toContain(KEY);
    expect(readdirSync(home)).toEqual(["api-key"]);
  });

  describe("on Windows", () => {
    it("limits the file to the user with icacls before the key is in it", async () => {
      garmin();
      const { home, apiKeyFile, config } = newHome();
      let during: string | undefined;
      const exec = vi.fn(async (_cmd: string, args: string[]) => {
        during = readFileSync(args[0], "utf8");
        return { code: 0, stdout: "", stderr: "" };
      });
      const r = await setup([], config, answer(KEY), "win32", exec, home);
      expect(r.code).toBe(0);
      expect(exec).toHaveBeenCalledOnce();
      const [cmd, args] = exec.mock.calls[0];
      expect(cmd).toBe("icacls");
      expect(args).toEqual([
        expect.stringContaining("api-key."),
        "/inheritance:r",
        "/grant:r",
        `${userInfo().username}:F`,
      ]);
      expect(during).toBe("");
      expect(readFileSync(apiKeyFile, "utf8")).toBe(`${KEY}\n`);
      expect(r.stdout).toContain("and only you can read it.");
      expect(r.stdout).not.toContain("chmod");
    });

    it.each([
      ["a failed command", icacls(5)],
      ["a missing command", vi.fn().mockRejectedValue(new Error("spawn icacls ENOENT"))],
    ])("saves the key after %s, and tells how to limit the file", async (_name, exec) => {
      garmin();
      const { home, apiKeyFile, config } = newHome();
      const r = await setup([], config, answer(KEY), "win32", exec, home);
      expect(r.code).toBe(0);
      expect(readFileSync(apiKeyFile, "utf8")).toBe(`${KEY}\n`);
      expect(r.stdout).not.toContain("only you can read it");
      expect(r.stdout).toContain("Other users may be able to read it");
      // the real path: icacls does not read `~`
      expect(r.stdout).toContain(`icacls "${apiKeyFile}"`);
      expect(r.stdout).toContain(`/inheritance:r /grant:r "${userInfo().username}:F"`);
    });

    it("does not run icacls on macOS or Linux", async () => {
      garmin();
      const { home, config } = newHome();
      const exec = noExec();
      await setup([], config, answer(KEY), "darwin", exec, home);
      expect(exec).not.toHaveBeenCalled();
    });
  });

  it("runs from the command line: it stops on a key in the arguments and on a key file", async () => {
    const { apiKeyFile, config } = newHome();
    const f = fakes();
    const arg = await cli("setup", ["a-key"], f.auto, f.writer, undefined, config);
    expect(arg.stderr).toContain("does not take the key as an argument");
    mkdirSync(join(apiKeyFile, ".."), { recursive: true });
    writeFileSync(apiKeyFile, "old-key");
    const exists = await cli("setup", [], f.auto, f.writer, undefined, config);
    expect(exists.stderr).toContain("exists");
  });

  it("takes --force from the command line", async () => {
    const { config } = newHome();
    const f = fakes();
    // the flag passes, so setup stops on the word after it and not on an unknown flag
    const r = await cli("setup", ["--force", "a-key"], f.auto, f.writer, undefined, config);
    expect(r.stderr).toContain("does not take the key as an argument");
  });

  it("prints the help without asking for the key", async () => {
    const { config } = newHome();
    const f = fakes();
    expect(await cli("setup", ["--force", "--help"], f.auto, f.writer, undefined, config)).toEqual({
      code: 0,
      stdout: COMMAND_HELP.setup,
    });
  });
});

/** The input and all that the prompt writes. `tty` makes it read as a terminal does. */
function streams(tty = false) {
  const input = new PassThrough() as PassThrough & { isTTY?: boolean };
  if (tty) input.isTTY = true;
  const output = new PassThrough();
  let written = "";
  output.on("data", (d) => (written += d));
  return { input, output, written: () => written };
}

describe("promptKey", () => {
  it.each([
    ["a line", "k3y\n", "k3y"],
    ["Windows line endings", "k3y\r\n", "k3y"],
    ["no line ending", "k3y", "k3y"],
    ["more lines", "k3y\nother\n", "k3y"],
    ["no text", "", ""],
    ["an empty line", "\n", ""],
  ])("reads the first line from a pipe: %s", async (_name, text, key) => {
    const s = streams();
    const read = promptKey(s.input, s.output);
    s.input.end(text);
    expect(await read).toBe(key);
    expect(s.written()).toContain("Paste the personal API key");
    expect(s.written()).not.toContain("k3y");
    expect(s.written()).toMatch(/\n$/);
  });

  it("stops the echo of a terminal before the prompt, because a paste can come at once", async () => {
    const s = streams(true);
    const order: string[] = [];
    Object.assign(s.input, {
      setRawMode: (raw: boolean) => order.push(`raw ${raw} after ${s.written().length} characters`),
    });
    s.output.on("data", () => order.push("prompt"));
    const read = promptKey(s.input, s.output);
    s.input.write("k3y\r");
    await read;
    expect(order[0]).toBe("raw true after 0 characters");
    expect(order).toContain("prompt");
    // the terminal shows what you type again after the prompt
    expect(order.some((step) => step.startsWith("raw false"))).toBe(true);
  });

  it("does not show the key in a terminal", async () => {
    const s = streams(true);
    const read = promptKey(s.input, s.output);
    s.input.write("k3y\r");
    expect(await read).toBe("k3y");
    expect(s.written()).not.toContain("k3y");
  });

  it("removes a character with backspace in a terminal", async () => {
    const s = streams(true);
    const read = promptKey(s.input, s.output);
    s.input.write("k3yy\x7f\r");
    expect(await read).toBe("k3y");
  });

  it.each([
    ["Ctrl-C", "abc\x03"],
    ["Ctrl-D", "\x04"],
  ])("gives no key after %s in a terminal", async (_name, keys) => {
    const s = streams(true);
    const read = promptKey(s.input, s.output);
    s.input.write(keys);
    expect(await read).toBe("");
    expect(s.written()).not.toContain("abc");
  });
});

describe("the entry point", () => {
  const argv = process.argv;
  afterEach(() => {
    process.argv = argv;
    process.exitCode = undefined;
    vi.resetModules();
    vi.doUnmock("@modelcontextprotocol/server/stdio");
    vi.doUnmock("../src/cli");
    vi.restoreAllMocks();
  });

  it("serves MCP on stdio without a command, and writes nothing", async () => {
    const s = await start([]);
    expect(s.serveStdio).toHaveBeenCalledOnce();
    expect(s.serveStdio.mock.results[0].value).toHaveProperty("server");
    expect(s.run).not.toHaveBeenCalled();
    expect(s.stdout).not.toHaveBeenCalled();
  });

  it.each(["--version", "-v", "--help", "-h", "info", "doctor", "setup"])(
    "runs %s without the server",
    async (flag) => {
      const s = await start([flag]);
      expect(s.serveStdio).not.toHaveBeenCalled();
      expect(s.run).toHaveBeenCalledWith(flag, [], expect.anything(), expect.any(Function));
    },
  );

  it.each(["foo", "--foo", ""])(
    "gives '%s' to the command line, not to the server",
    async (word) => {
      const s = await start([word]);
      expect(s.serveStdio).not.toHaveBeenCalled();
      expect(s.run).toHaveBeenCalledWith(word, [], expect.anything(), expect.any(Function));
    },
  );

  it("gives the words after a wrong command to the command line too", async () => {
    const s = await start(["foo", "bar", "--baz"]);
    expect(s.serveStdio).not.toHaveBeenCalled();
    expect(s.run).toHaveBeenCalledWith(
      "foo",
      ["bar", "--baz"],
      expect.anything(),
      expect.any(Function),
    );
  });

  // no mock of the command line: an MCP client that passes a wrong argument gets nothing on stdout
  it.each([
    [["foo"], "Unknown command"],
    [["--foo"], "Unknown command"],
    [[""], "Unknown command"],
    [["info", "--foo"], "Unknown flag"],
    [["schedule", "off", "--foo"], "Unknown flag"],
  ])("writes the help only on stderr and exits with 1 for %j", async (args, error) => {
    const serveStdio = vi.fn();
    vi.doMock("@modelcontextprotocol/server/stdio", () => ({ serveStdio }));
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    process.argv = ["node", "index.js", ...args];
    await import("../src/index");
    expect(serveStdio).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(`${error}\n\n${HELP}\n`);
    expect(process.exitCode).toBe(1);
  });

  it.each(["info", "refresh", "schedule"])(
    "writes the help of %s on stdout and exits with 0",
    async (command) => {
      const serveStdio = vi.fn();
      vi.doMock("@modelcontextprotocol/server/stdio", () => ({ serveStdio }));
      const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
      const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      process.argv = ["node", "index.js", command, "--help"];
      await import("../src/index");
      expect(serveStdio).not.toHaveBeenCalled();
      expect(stdout).toHaveBeenCalledWith(`${COMMAND_HELP[command]}\n`);
      expect(stderr).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(0);
    },
  );

  it("runs a command: its output, its errors and its exit code", async () => {
    const s = await start(["schedule", "daily"]);
    expect(s.serveStdio).not.toHaveBeenCalled();
    expect(s.run).toHaveBeenCalledWith(
      "schedule",
      ["daily"],
      expect.anything(),
      expect.any(Function),
    );
    expect(s.stdout).toHaveBeenCalledWith("out\n");
    expect(s.stderr).toHaveBeenCalledWith("err\n");
    expect(process.exitCode).toBe(3);
    // the writer is made only when a command needs it
    const writer = (s.run.mock.calls[0] as unknown[])[3] as () => { write: unknown };
    expect(typeof writer().write).toBe("function");
  });

  it("writes nothing for a command without output", async () => {
    const s = await start(["refresh", "--auto"], { code: 0 });
    expect(s.stdout).not.toHaveBeenCalled();
    expect(s.stderr).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });
});
