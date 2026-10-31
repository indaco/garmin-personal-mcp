import { afterEach, describe, expect, it, vi } from "vitest";
import { version } from "../package.json";
import { cli, HELP, summary } from "../src/cli";
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
      "The job is missing from launchd: run the schedule again.",
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

  it.each(["--version", "-v", "--help", "-h"])("runs %s without the server", async (flag) => {
    const s = await start([flag]);
    expect(s.serveStdio).not.toHaveBeenCalled();
    expect(s.run).toHaveBeenCalledWith(flag, [], expect.anything(), expect.any(Function));
  });

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
