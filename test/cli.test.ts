import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { version } from "../package.json";
import { cli, COMMAND_HELP, HELP, hideHome, info, RETRY_MS, summary } from "../src/cli";
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
      stderr: `Unknown command: ${word}\n\n${HELP}`,
    });
    expect(f.auto.status).not.toHaveBeenCalled();
    expect(f.auto.set).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("gives the wrong command, not its arguments, in the error", async () => {
    const f = fakes();
    expect(await cli("foo", ["--bar", "a.html"], f.auto, f.writer)).toEqual({
      code: 1,
      stderr: `Unknown command: foo\n\n${HELP}`,
    });
  });

  it.each([
    ["refresh", ["--foo"], "--foo"],
    ["refresh", ["-x"], "-x"],
    ["refresh", ["-"], "-"],
    ["refresh", ["--"], "--"],
    // --auto is exact, it comes first and only refresh has it
    ["refresh", ["--AUTO"], "--AUTO"],
    ["refresh", ["--auto=1"], "--auto=1"],
    ["refresh", ["-auto"], "-auto"],
    ["refresh", ["--auto", "--foo"], "--foo"],
    ["refresh", ["--auto", "--auto"], "--auto"],
    ["refresh", ["a.html", "--auto"], "--auto"],
    ["schedule", ["--auto"], "--auto"],
    ["info", ["--auto"], "--auto"],
    // the help flag of a command is exact
    ["refresh", ["--HELP"], "--HELP"],
    ["schedule", ["-H"], "-H"],
    ["info", ["--help=1"], "--help=1"],
    ["info", ["-help"], "-help"],
    // a flag never reaches the command, and --help and --version have no help of their own
    ["info", ["--version"], "--version"],
    ["--help", ["--foo"], "--foo"],
    ["--help", ["--help"], "--help"],
    ["-h", ["-x"], "-x"],
    ["--version", ["--foo"], "--foo"],
    ["--version", ["--help"], "--help"],
    ["-v", ["-h"], "-h"],
    ["-v", ["-x"], "-x"],
    // a word before the flag does not hide it
    ["schedule", ["--foo"], "--foo"],
    ["schedule", ["off", "--foo"], "--foo"],
    ["schedule", ["off", "a.html", "--foo"], "--foo"],
    ["schedule", ["weekly", "--day", "monday"], "--day"],
    // several flags: the first one is in the error
    ["refresh", ["--foo", "--bar"], "--foo"],
    ["schedule", ["off", "--page", "a.html", "--foo"], "--page"],
    // a path or a cron expression that starts with a dash reads as a flag
    ["refresh", ["-old.html"], "-old.html"],
    ["schedule", ["-old.html"], "-old.html"],
    ["schedule", ["-1 * * * *"], "-1 * * * *"],
  ])("prints the help on stderr for %s %j", async (command, args, flag) => {
    const f = fakes();
    const write = vi.fn(f.writer);
    expect(await cli(command, args, f.auto, write)).toEqual({
      code: 1,
      stderr: `Unknown flag: ${flag}\n\n${HELP}`,
    });
    // a wrong flag must not stop the schedule: `schedule off --foo` once stopped all of it
    expect(f.auto.off).not.toHaveBeenCalled();
    expect(f.auto.set).not.toHaveBeenCalled();
    expect(f.auto.status).not.toHaveBeenCalled();
    expect(f.auto.pages).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it.each(["info", "refresh", "schedule"])("prints the help of %s", async (command) => {
    const f = fakes();
    const write = vi.fn(f.writer);
    const help = COMMAND_HELP[command];
    expect(help).toMatch(new RegExp(`^Usage: garmin-personal-mcp ${command}\\b`));
    for (const flag of ["--help", "-h"])
      expect(await cli(command, [flag], f.auto, write)).toEqual({ code: 0, stdout: help });
    expect(f.auto.status).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("tells each form and default of a command in its help", () => {
    expect(COMMAND_HELP.refresh).toContain("refresh --auto");
    expect(COMMAND_HELP.refresh).toContain("garmin-dashboard.html");
    for (const word of ["daily", "weekdays", "weekly <day>", '"<cron>"', "off", "07:00", "Monday"])
      expect(COMMAND_HELP.schedule).toContain(word);
    // only the three commands have a help: the others are flags without arguments
    expect(Object.keys(COMMAND_HELP)).toEqual(["info", "refresh", "schedule"]);
  });

  it("tells in the main help how to get the help of a command", () => {
    expect(HELP).toContain("<command> --help");
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

  it.each(["--version", "-v", "--help", "-h", "info"])(
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
    [["foo"], "Unknown command: foo"],
    [["--foo"], "Unknown command: --foo"],
    [[""], "Unknown command: "],
    [["info", "--foo"], "Unknown flag: --foo"],
    [["schedule", "off", "--foo"], "Unknown flag: --foo"],
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
