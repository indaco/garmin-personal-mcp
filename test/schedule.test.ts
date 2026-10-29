import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config";
import {
  AutoRefresh,
  cronLine,
  cronOf,
  type Job,
  nextRuns,
  parseCron,
  plist,
  realEntry,
  refreshPages,
  registerSchedule,
  run,
  type Run,
  type Status,
  taskXml,
  withCronLine,
} from "../src/schedule";

const job: Job = {
  program: "/opt/node/bin/npx",
  args: ["-y", "pkg@latest", "refresh", "--auto"],
  env: { GARMIN_DATA_DIR: "/data/it's 100%", PATH: "/opt/node/bin:/usr/bin:/bin" },
  log: "/home/u/.cache/garmin-personal-mcp/refresh.log",
};

const NPX_ENTRY = "/home/u/.npm/_npx/1a2b/node_modules/pkg/dist/index.js";

/** A crontab that fails with its message on stdout only. */
const noStderr: Run = async (cmd, args) =>
  cmd === "crontab" && args[0] === "-"
    ? { code: 2, stdout: "crontab: no permission\n", stderr: "" }
    : { code: 1, stdout: "", stderr: "" };

const failing: Run = async () => ({ code: 5, stdout: "", stderr: "Bootstrap failed: 5" });

describe("cron", () => {
  it("reads lists, ranges and steps; 7 is Sunday", () => {
    expect(parseCron(" 30  6,18 * * 1-5 ")).toEqual({
      text: "30 6,18 * * 1-5",
      times: [6 * 60 + 30, 18 * 60 + 30],
      weekdays: [1, 2, 3, 4, 5],
    });
    expect(parseCron("0 */6 1,15 1-12/3 7")).toMatchObject({
      times: [0, 360, 720, 1080],
      days: [1, 15],
      months: [1, 4, 7, 10],
      weekdays: [0],
    });
    expect(parseCron("0 7 * * *").days).toBeUndefined();
  });

  it("refuses a bad expression, runs less than an hour apart, and a date that never comes", () => {
    for (const bad of [
      "0 7 * *",
      "60 7 * * *",
      "0 7 * * MON",
      "0 7 0 * *",
      "0 5-3 * * *",
      "0 7 * * */0",
    ]) {
      expect(() => parseCron(bad), bad).toThrow(/^Cron/);
    }
    expect(() => parseCron("*/30 * * * *")).toThrow(/1 hour apart/);
    expect(() => parseCron("30 23 * * *, 0 0")).toThrow(/^Cron/);
    // 23:30 and 00:00 are 30 minutes apart across midnight
    expect(() => parseCron("0,30 0,23 * * *")).toThrow(/1 hour apart/);
    expect(() => parseCron("0 * * * *").times).not.toThrow();
    expect(() => parseCron("0 7 31 2 *")).toThrow(/never comes/);
  });

  it("gives the next runs in local time; with day of month and weekday, either one runs", () => {
    const from = new Date(2026, 9, 29, 12, 0); // Thursday
    expect(nextRuns(parseCron("0 7,18 * * *"), from, 3)).toEqual([
      "2026-10-29 18:00",
      "2026-10-30 07:00",
      "2026-10-30 18:00",
    ]);
    expect(nextRuns(parseCron("0 8 1 * 1"), from, 3)).toEqual([
      "2026-11-01 08:00",
      "2026-11-02 08:00",
      "2026-11-09 08:00",
    ]);
    expect(nextRuns(parseCron("0 7 29 2 *"), from, 1)).toEqual(["2028-02-29 07:00"]);
  });

  it("reads the CLI forms, with 07:00 and Monday as defaults", () => {
    expect(cronOf(["daily"])).toBe("0 7 * * *");
    expect(cronOf(["weekdays", "6:30"])).toBe("30 6 * * 1-5");
    expect(cronOf(["weekly"])).toBe("0 7 * * 1");
    expect(cronOf(["Weekly", "Friday", "18:05"])).toBe("5 18 * * 5");
    expect(cronOf(["0 18 * * 1,4"])).toBe("0 18 * * 1,4");
    for (const words of [
      [],
      ["hourly"],
      ["daily", "25:00"],
      ["daily", "7"],
      ["weekly", "someday"],
    ]) {
      expect(() => cronOf(words), words.join(" ")).toThrow(/daily \[HH:MM\]/);
    }
  });

  it("writes launchd times: one dict per time, month and day", () => {
    const daily = plist(job, parseCron("5 7 * * *"));
    expect(daily).toContain(
      "<dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>5</integer></dict>",
    );
    expect(daily).toContain("<string>/opt/node/bin/npx</string>");
    expect(plist(job, parseCron("0 7 * * 1-5")).match(/<key>Weekday<\/key>/g)).toHaveLength(5);
    expect(plist(job, parseCron("0 8 1 1,7 *"))).toContain(
      "<dict><key>Month</key><integer>7</integer><key>Day</key><integer>1</integer><key>Hour</key><integer>8</integer><key>Minute</key><integer>0</integer></dict>",
    );
    // day of month or weekday: both kinds of dict
    const either = plist(job, parseCron("0 8 1 * 1"));
    expect(either).toContain("<key>Day</key><integer>1</integer>");
    expect(either).toContain("<key>Weekday</key><integer>1</integer>");
  });

  it("writes cron lines with the user's paths quoted and % escaped", () => {
    expect(cronLine(job, parseCron("30 6 * * 1-5"))).toMatch(
      /^30 6 \* \* 1-5 GARMIN_DATA_DIR='\/data\/it'\\''s 100\\%' .*>> '.*refresh\.log' 2>&1 # garmin-personal-mcp refresh$/,
    );
  });

  it("replaces only its own crontab line", () => {
    const mine = "0 7 * * * x # garmin-personal-mcp refresh";
    const other = "15 3 * * * backup.sh";
    expect(withCronLine(`${other}\n${mine}\n`, "1 8 * * * y # garmin-personal-mcp refresh")).toBe(
      `${other}\n1 8 * * * y # garmin-personal-mcp refresh\n`,
    );
    expect(withCronLine(`${other}\n${mine}\n`, undefined)).toBe(`${other}\n`);
  });

  it("writes Task Scheduler triggers for each time, and runs a missed time", () => {
    const week = taskXml("C:\\d\\a.cmd", parseCron("0 7,19 * * 1,5"));
    expect(week.match(/<CalendarTrigger>/g)).toHaveLength(2);
    expect(week).toContain("<StartBoundary>2026-01-01T19:00:00</StartBoundary>");
    expect(week).toContain(
      "<ScheduleByWeek><WeeksInterval>1</WeeksInterval><DaysOfWeek><Monday /><Friday /></DaysOfWeek></ScheduleByWeek>",
    );
    expect(week).toContain("<StartWhenAvailable>true</StartWhenAvailable>");
    expect(taskXml("a.cmd", parseCron("0 7 * * *"))).toContain(
      "<ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>",
    );
    expect(taskXml("a.cmd", parseCron("0 7 1,15 3 *"))).toContain(
      "<ScheduleByMonth><DaysOfMonth><Day>1</Day><Day>15</Day></DaysOfMonth><Months><March /></Months></ScheduleByMonth>",
    );
    // months only: every day of those months
    expect(taskXml("a.cmd", parseCron("0 7 * 6 *"))).toContain(
      "<Day>31</Day></DaysOfMonth><Months><June /></Months></ScheduleByMonth>",
    );
    expect(taskXml("a.cmd", parseCron("0 7 * 12 6"))).toContain(
      "<DaysOfWeek><Saturday /></DaysOfWeek><Months><December /></Months></ScheduleByMonthDayOfWeek>",
    );
  });
});

describe("AutoRefresh", () => {
  let dir: string;
  let config: Config;
  let calls: { cmd: string; args: string[]; input?: string }[];
  let crontab: string;
  const exec: Run = async (cmd, args, input) => {
    calls.push({ cmd, args, input });
    if (cmd === "crontab" && args[0] === "-l")
      return { code: crontab ? 0 : 1, stdout: crontab, stderr: "" };
    if (cmd === "crontab") crontab = input ?? "";
    return { code: 0, stdout: "", stderr: "" };
  };
  const auto = (platform: NodeJS.Platform) =>
    new AutoRefresh(config, platform, join(dir, "home"), exec, "/opt/node/bin", NPX_ENTRY);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "schedule-"));
    config = {
      baseUrl: "https://example.test",
      apiKeyFile: join(dir, "api-key"),
      dataDir: join(dir, "data"),
    };
    calls = [];
    crontab = "";
    writeFileSync(config.apiKeyFile, "secret-key");
    mkdirSync(config.dataDir);
    writeFileSync(join(config.dataDir, "garmin-dashboard.html"), "page");
    writeFileSync(join(config.dataDir, "coach.html"), "page");
  });

  it("is off until the user turns it on", async () => {
    const a = auto("darwin");
    expect(await a.status()).toEqual({ scheduled: false });
    expect(await a.pages()).toEqual([]);
    expect(await a.off()).toEqual({ scheduled: false });
    expect(calls).toEqual([]);
    await a.set({});
    expect(await a.pages()).toEqual([join(config.dataDir, "garmin-dashboard.html")]);
  });

  it("installs one launchd job, and a second page or schedule replaces it", async () => {
    const a = auto("darwin");
    const plistFile = join(
      dir,
      "home/Library/LaunchAgents/com.indaco.garmin-personal-mcp.refresh.plist",
    );
    await a.set({ cron: "0 7 * * 1" });
    expect(readFileSync(plistFile, "utf8")).toContain("<key>Weekday</key><integer>1</integer>");
    const s = await a.set({ path: "coach.html", cron: "0 6 * * *" });
    expect(s).toMatchObject({
      scheduled: true,
      cron: "0 6 * * *",
      pages: [join(config.dataDir, "garmin-dashboard.html"), join(config.dataDir, "coach.html")],
      scheduler: "launchd",
      installed: true,
    });
    expect(s.next).toHaveLength(3);
    expect(s.next![0]).toMatch(/^\d{4}-\d\d-\d\d 06:00$/);
    expect(calls.filter((c) => c.args[0] === "bootstrap")).toHaveLength(2);
    expect(readFileSync(plistFile, "utf8")).not.toContain("Weekday");

    // one page off keeps the job; the last page off removes it
    expect((await a.off("coach.html")).pages).toEqual([
      join(config.dataDir, "garmin-dashboard.html"),
    ]);
    expect(await a.off()).toEqual({ scheduled: false });
    expect(existsSync(plistFile)).toBe(false);
    expect(existsSync(join(config.dataDir, "auto-refresh.json"))).toBe(false);
  });

  it("keeps the schedule when only a page is added", async () => {
    const a = auto("linux");
    await a.set({ cron: "45 5 * * 1-5" });
    expect((await a.set({ path: "coach.html" })).cron).toBe("45 5 * * 1-5");
  });

  it("keeps the other lines of the user's crontab", async () => {
    crontab = "15 3 * * * backup.sh\n";
    const a = auto("linux");
    await a.set({});
    expect(crontab).toMatch(
      /^15 3 \* \* \* backup\.sh\n0 7 \* \* \* .*# garmin-personal-mcp refresh\n$/,
    );
    expect((await a.status()).installed).toBe(true);
    await a.off();
    expect(crontab).toBe("15 3 * * * backup.sh\n");
  });

  it("runs an installed copy with its node, and a copy in the npx cache with npx", async () => {
    const installed = "/usr/local/lib/node_modules/pkg/dist/index.js";
    await new AutoRefresh(config, "linux", join(dir, "home"), exec, "/opt/node/bin", installed).set(
      {},
    );
    expect(crontab).toContain(`'/opt/node/bin/node' '${installed}' 'refresh' '--auto'`);
    await auto("linux").set({});
    expect(crontab).toMatch(
      /'\/opt\/node\/bin\/npx' '-y' '@indaco\/garmin-personal-mcp@latest' 'refresh' '--auto'/,
    );
  });

  it("runs an installed copy with node.exe on Windows", async () => {
    const installed = "C:\\npm\\node_modules\\pkg\\dist\\index.js";
    await new AutoRefresh(config, "win32", join(dir, "home"), exec, "C:\\node", installed).set({});
    expect(readFileSync(join(config.dataDir, "auto-refresh.cmd"), "utf8")).toContain(
      `call "${join("C:\\node", "node.exe")}" "${installed}" "refresh" "--auto"`,
    );
  });

  it("names the output of a command that fails without an error text", async () => {
    await expect(
      new AutoRefresh(config, "linux", join(dir, "home"), noStderr, "/n", NPX_ENTRY).set({}),
    ).rejects.toThrow("crontab failed (2): crontab: no permission");
  });

  it("writes a script and a UTF-16 task file for the Windows task", async () => {
    const a = auto("win32");
    await a.set({ cron: "0 20 * * 5" });
    const script = readFileSync(join(config.dataDir, "auto-refresh.cmd"), "utf8");
    expect(script).toContain('set "PATH=/opt/node/bin;%PATH%"');
    expect(script).toContain("npx.cmd");
    const taskFile = join(config.dataDir, "auto-refresh-task.xml");
    const task = readFileSync(taskFile, "utf16le");
    expect(task.startsWith("\ufeff<?xml")).toBe(true);
    expect(task).toContain("<Friday />");
    expect(calls.find((c) => c.args[0] === "/Create")?.args).toEqual([
      "/Create",
      "/F",
      "/TN",
      "garmin-personal-mcp refresh",
      "/XML",
      taskFile,
    ]);
    await a.off();
    expect(existsSync(taskFile)).toBe(false);
  });

  it("refuses a bad cron before it changes anything", async () => {
    await expect(auto("linux").set({ cron: "*/15 * * * *" })).rejects.toThrow(/1 hour apart/);
    expect(calls).toEqual([]);
  });

  it("never puts the API key in the job", async () => {
    process.env.GARMIN_PERSONAL_API_KEY = "env-secret";
    try {
      for (const p of ["darwin", "linux", "win32"] as const) await auto(p).set({});
    } finally {
      delete process.env.GARMIN_PERSONAL_API_KEY;
    }
    const written = [
      crontab,
      readFileSync(
        join(dir, "home/Library/LaunchAgents/com.indaco.garmin-personal-mcp.refresh.plist"),
        "utf8",
      ),
      readFileSync(join(config.dataDir, "auto-refresh.cmd"), "utf8"),
      JSON.stringify(calls),
    ].join("\n");
    expect(written).not.toMatch(/secret/);
  });

  it("refuses without a key file, without the page, or on another system", async () => {
    await expect(auto("darwin").set({ path: "nope.html" })).rejects.toThrow(/does not exist/);
    await expect(auto("freebsd").set({})).rejects.toThrow(/macOS, Linux and Windows/);
    rmSync(config.apiKeyFile);
    await expect(auto("darwin").set({})).rejects.toThrow(/Save the API key/);
    expect(calls).toEqual([]);
  });

  it("reports an error of the scheduler", async () => {
    await expect(
      new AutoRefresh(config, "darwin", join(dir, "home"), failing, "/n").set({}),
    ).rejects.toThrow(/launchctl failed \(5\): Bootstrap failed/);
    expect(existsSync(join(config.dataDir, "auto-refresh.json"))).toBe(false);
  });
});

it("refreshPages goes on after a page fails", async () => {
  const written: (string | undefined)[] = [];
  const writer = {
    write: async (o: { path?: string }) => {
      written.push(o.path);
      if (o.path === "a.html") throw new Error("gone");
      return {} as never;
    },
  };
  const r = await refreshPages(writer, ["a.html", "b.html"]);
  expect(written).toEqual(["a.html", "b.html"]);
  expect(r.failed).toBe(true);
  expect(r.lines[0]).toMatch(/failed a\.html: gone$/);
  expect(r.lines[1]).toMatch(/updated b\.html$/);
});

describe("run", () => {
  it("passes the input and gives the exit code, stdout and stderr, without a shell", async () => {
    const code =
      "process.stdin.pipe(process.stdout); process.stderr.write('e'); process.exitCode = 3";
    expect(await run(process.execPath, ["-e", code], "in $HOME")).toEqual({
      code: 3,
      stdout: "in $HOME",
      stderr: "e",
    });
    expect((await run(process.execPath, ["-e", ""])).code).toBe(0);
    // a process killed by a signal has no exit code: it counts as a failure
    expect((await run(process.execPath, ["-e", "process.kill(process.pid, 'SIGTERM')"])).code).toBe(
      1,
    );
  });

  it("rejects a command that does not exist", async () => {
    await expect(run("garmin-no-such-command", [])).rejects.toThrow(/ENOENT/);
  });
});

it("realEntry gives the real path of the script, or nothing", () => {
  const d = mkdtempSync(join(tmpdir(), "entry-"));
  writeFileSync(join(d, "index.js"), "");
  expect(realEntry(join(d, "index.js"))).toMatch(/[/\\]index\.js$/);
  expect(realEntry(join(d, "missing.js"))).toBe("");
  expect(realEntry(undefined)).toBe("");
});

describe("scheduleDashboardRefresh", () => {
  const status: Status = { scheduled: true, cron: "0 7 * * *", pages: ["p"] };
  const fake = {
    status: vi.fn(async () => status),
    set: vi.fn(async () => status),
    off: vi.fn(async (): Promise<Status> => ({ scheduled: false })),
  };

  async function call(args: Record<string, unknown>): Promise<unknown> {
    const server = new McpServer({ name: "t", version: "1" });
    registerSchedule(server, fake as unknown as AutoRefresh);
    const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "1" });
    await server.connect(serverEnd);
    await client.connect(clientEnd);
    const r = await client.callTool({ name: "scheduleDashboardRefresh", arguments: args });
    return JSON.parse((r.content as { text: string }[])[0].text);
  }

  it("reads without arguments, sets with a cron or a page, and stops with off", async () => {
    expect(await call({})).toEqual(status);
    expect(fake.status).toHaveBeenCalledOnce();
    await call({ cron: "0 18 * * 1,4" });
    expect(fake.set).toHaveBeenLastCalledWith({ cron: "0 18 * * 1,4", path: undefined });
    await call({ path: "coach.html" });
    expect(fake.set).toHaveBeenLastCalledWith({ cron: undefined, path: "coach.html" });
    expect(await call({ off: true, path: "coach.html" })).toEqual({ scheduled: false });
    expect(fake.off).toHaveBeenCalledWith("coach.html");
  });
});
