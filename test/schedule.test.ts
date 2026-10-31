import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config";
import { log } from "../src/log";
import {
  AutoRefresh,
  cronLine,
  cronOf,
  type Job,
  lastRunTime,
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

vi.mock("../src/log", () => ({ log: vi.fn() }));

const job: Job = {
  program: "/opt/node/bin/npx",
  args: ["-y", "pkg@latest", "refresh", "--auto"],
  env: { GARMIN_DATA_DIR: "/data/it's 100%", PATH: "/opt/node/bin:/usr/bin:/bin" },
  log: "/home/u/.cache/garmin-personal-mcp/refresh.log",
};

const NPX_ENTRY = "/home/u/.npm/_npx/1a2b/node_modules/pkg/dist/index.js";

/** What cron prints for `crontab -l` when the user has no crontab. */
const NO_CRONTAB = { code: 1, stdout: "", stderr: "no crontab for u\n" };

/** A crontab that fails with its message on stdout only. */
const noStderr: Run = async (cmd, args) =>
  cmd === "crontab" && args[0] === "-"
    ? { code: 2, stdout: "crontab: no permission\n", stderr: "" }
    : NO_CRONTAB;

/** A crontab -l that fails for another reason, with its message on stdout only. */
const onStdout: Run = async () => ({ code: 2, stdout: "crontab: spool busy\n", stderr: "" });

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
    // the job also starts at login, so a time missed while the Mac was off runs then
    expect(daily).toContain("<key>RunAtLoad</key><true/>");
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

  it("keeps the values of a step in the day, month and weekday fields", () => {
    const everyOther = parseCron("0 7 */2 * *");
    expect(everyOther.days).toEqual(Array.from({ length: 16 }, (_, i) => 1 + 2 * i));
    expect(everyOther.months).toBeUndefined();
    expect(everyOther.weekdays).toBeUndefined();
    expect(parseCron("0 7 1 */3 *").months).toEqual([1, 4, 7, 10]);
    expect(parseCron("0 7 * * */2").weekdays).toEqual([0, 2, 4, 6]);
    // a step that does not divide the range stops at the last value it reaches
    expect(parseCron("0 7 */7 * *").days).toEqual([1, 8, 15, 22, 29]);
    expect(parseCron("0 7 1 */5 *").months).toEqual([1, 6, 11]);
    expect(parseCron("0 7 * * */4").weekdays).toEqual([0, 4]);
    // the weekday range is 0-7, so */7 is Sunday twice: Sunday only
    expect(parseCron("0 7 * * */7").weekdays).toEqual([0]);
    expect(parseCron("0 7 * * *")).toEqual({ text: "0 7 * * *", times: [420] });
  });

  it("reads a field that covers every value as every", () => {
    for (const every of ["0 7 */1 * *", "0 7 * */1 *", "0 7 * * */1", "0 7 1-31 1-12 0-7"]) {
      expect(parseCron(every), every).toEqual({ text: every, times: [420] });
    }
    // 0-6 and 1-7 are every weekday too, and a range that misses one value is not every
    expect(parseCron("0 7 * * 0-6").weekdays).toBeUndefined();
    expect(parseCron("0 7 * * 1-7").weekdays).toBeUndefined();
    expect(parseCron("0 7 2-31 * *").days).toHaveLength(30);
    expect(parseCron("0 7 * 1-11 *").months).toHaveLength(11);
    expect(parseCron("0 7 * * 1-6").weekdays).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("gives the next runs of a step on the right days only", () => {
    const from = new Date(2026, 9, 29, 12, 0); // Thursday
    // 31 October and 1 November are both odd days
    expect(nextRuns(parseCron("0 7 */2 * *"), from, 3)).toEqual([
      "2026-10-31 07:00",
      "2026-11-01 07:00",
      "2026-11-03 07:00",
    ]);
    expect(nextRuns(parseCron("0 7 1 */3 *"), from, 1)).toEqual(["2027-01-01 07:00"]);
    // months 1, 6 and 11
    expect(nextRuns(parseCron("0 7 1 */5 *"), from, 3)).toEqual([
      "2026-11-01 07:00",
      "2027-01-01 07:00",
      "2027-06-01 07:00",
    ]);
    // Saturday, Sunday, Tuesday
    expect(nextRuns(parseCron("0 7 * * */2"), from, 3)).toEqual([
      "2026-10-31 07:00",
      "2026-11-01 07:00",
      "2026-11-03 07:00",
    ]);
  });

  it("writes a step into the launchd and Task Scheduler triggers", () => {
    expect(plist(job, parseCron("0 7 */2 * *")).match(/<key>Day<\/key>/g)).toHaveLength(16);
    expect(plist(job, parseCron("0 7 * * */2")).match(/<key>Weekday<\/key>/g)).toHaveLength(4);
    expect(plist(job, parseCron("0 7 1 */3 *")).match(/<key>Month<\/key>/g)).toHaveLength(4);
    expect(taskXml("a.cmd", parseCron("0 7 1 */3 *"))).toContain(
      "<Months><January /><April /><July /><October /></Months>",
    );
    expect(taskXml("a.cmd", parseCron("0 7 * * */2"))).toContain(
      "<DaysOfWeek><Sunday /><Tuesday /><Thursday /><Saturday /></DaysOfWeek>",
    );
    expect(taskXml("a.cmd", parseCron("0 7 */2 * *"))).toContain(
      "<DaysOfMonth><Day>1</Day><Day>3</Day>",
    );
    // cron gets the expression as it is
    expect(cronLine(job, parseCron("0 7 */2 * *")).startsWith("0 7 */2 * * ")).toBe(true);
  });

  it("refuses a step in day of month or weekday when both fields are set", () => {
    for (const both of ["0 7 */2 * 1", "0 7 1 * */2", "0 7 */2 * */3"]) {
      expect(() => parseCron(both), both).toThrow(/day of month and a weekday/);
    }
    // without a *, either field runs, as in cron
    expect(parseCron("0 8 1 * 1")).toMatchObject({ days: [1], weekdays: [1] });
    expect(parseCron("0 7 1-31/2 * 1")).toMatchObject({ weekdays: [1] });
  });

  it("reads day of month and weekday as cron does when one of them covers every day", () => {
    const from = new Date(2026, 9, 29, 12, 0); // Thursday
    // with a *, both must match: every day and Monday is Monday
    expect(nextRuns(parseCron("0 7 */1 * 1"), from, 2)).toEqual([
      "2026-11-02 07:00",
      "2026-11-09 07:00",
    ]);
    expect(nextRuns(parseCron("0 7 */2 * 0-6"), from, 2)).toEqual([
      "2026-10-31 07:00",
      "2026-11-01 07:00",
    ]);
    // without a *, either one runs: every day or Monday is every day
    for (const every of ["0 7 1-31 * 1", "0 7 1 * 0-6"]) {
      expect(parseCron(every), every).toEqual({ text: every, times: [420] });
      expect(nextRuns(parseCron(every), from, 2), every).toEqual([
        "2026-10-30 07:00",
        "2026-10-31 07:00",
      ]);
    }
  });
});

const at = (s: string) => new Date(s);

it("lastRunTime gives the last run time at or before now", () => {
  const c = parseCron("0 7,19 * * 1");
  // Monday 2 November 2026
  expect(lastRunTime(c, at("2026-11-02T07:00:00"))).toEqual(at("2026-11-02T07:00:00"));
  expect(lastRunTime(c, at("2026-11-02T18:59:00"))).toEqual(at("2026-11-02T07:00:00"));
  expect(lastRunTime(c, at("2026-11-08T12:00:00"))).toEqual(at("2026-11-02T19:00:00"));
  // a day of the month, a new year, and day or weekday as cron reads both
  expect(lastRunTime(parseCron("0 7 1 * *"), at("2026-11-15T12:00:00"))).toEqual(
    at("2026-11-01T07:00:00"),
  );
  expect(lastRunTime(parseCron("30 6 1 1 *"), at("2026-11-02T07:00:00"))).toEqual(
    at("2026-01-01T06:30:00"),
  );
  expect(lastRunTime(parseCron("0 7 1 1 *"), at("2026-01-01T06:59:00"))).toEqual(
    at("2025-01-01T07:00:00"),
  );
  // parseCron refuses a date that never comes, so a hand-made one shows the 8-year limit
  expect(
    lastRunTime(
      { text: "0 7 30 2 *", times: [420], days: [30], months: [2] },
      at("2026-11-02T07:00:00"),
    ),
  ).toBeUndefined();
  // Tuesday 3 November: the Monday before comes after the 1st of the month
  expect(lastRunTime(parseCron("0 8 1 * 1"), at("2026-11-03T12:00:00"))).toEqual(
    at("2026-11-02T08:00:00"),
  );
});

/** The ISO time n days ago. */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

/** A page with a data block, as the writer makes it. */
const dashboard = (data: object) =>
  `<script>window.GARMIN = /* garmin-data:start */${JSON.stringify(data)}/* garmin-data:end */;</script>`;
const dataOf = (file: string) =>
  JSON.parse(
    /garmin-data:start \*\/(.*?)\/\* garmin-data:end/.exec(readFileSync(file, "utf8"))![1],
  );

describe("AutoRefresh", () => {
  let dir: string;
  let config: Config;
  let calls: { cmd: string; args: string[]; input?: string }[];
  let crontab: string;
  const exec: Run = async (cmd, args, input) => {
    calls.push({ cmd, args, input });
    if (cmd === "crontab" && args[0] === "-l")
      return crontab ? { code: 0, stdout: crontab, stderr: "" } : NO_CRONTAB;
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

  it("stops and keeps the user's crontab when crontab -l fails for another reason", async () => {
    const seen: string[][] = [];
    const unreadable: Run = async (cmd, args) => {
      seen.push(args);
      return { code: 1, stdout: "", stderr: "crontab: cannot read spool\n" };
    };
    const a = new AutoRefresh(config, "linux", join(dir, "home"), unreadable, "/n", NPX_ENTRY);
    await expect(a.set({})).rejects.toThrow("crontab -l failed (1): crontab: cannot read spool");
    expect(seen.filter((args) => args[0] === "-")).toEqual([]);
    expect(existsSync(join(config.dataDir, "auto-refresh.json"))).toBe(false);
    // a status, and turning off, must not install an empty crontab either
    await expect(a.status()).resolves.toEqual({ scheduled: false });
    expect(seen.filter((args) => args[0] === "-")).toEqual([]);
    // a crontab that prints its error on stdout only
    await expect(
      new AutoRefresh(config, "linux", join(dir, "home"), onStdout, "/n", NPX_ENTRY).set({}),
    ).rejects.toThrow("crontab -l failed (2): crontab: spool busy");
  });

  it("reads the BusyBox message for a missing crontab as an empty crontab", async () => {
    const lines: string[] = [];
    const busybox: Run = async (cmd, args, input) => {
      if (args[0] === "-l") {
        return {
          code: 1,
          stdout: "",
          stderr: "crontab: can't open 'u': No such file or directory\n",
        };
      }
      lines.push(input ?? "");
      return { code: 0, stdout: "", stderr: "" };
    };
    await new AutoRefresh(config, "linux", join(dir, "home"), busybox, "/n", NPX_ENTRY).set({});
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^0 7 \* \* \* .*# garmin-personal-mcp refresh\n$/);
  });

  it("names a damaged auto-refresh.json, keeps page writes working, and off removes it", async () => {
    const stateFile = join(config.dataDir, "auto-refresh.json");
    const main = join(config.dataDir, "garmin-dashboard.html");
    const damaged = /auto-refresh\.json is damaged: stop the automatic refresh \(off\)/;
    for (const text of ["{ broken", '{"cron":"0 7 * * *"}', '{"pages":[]}', "null"]) {
      writeFileSync(stateFile, text);
      crontab = "15 3 * * * backup.sh\n0 7 * * * x # garmin-personal-mcp refresh\n";
      const a = auto("linux");
      await expect(a.status(), text).rejects.toThrow(damaged);
      await expect(a.set({}), text).rejects.toThrow(damaged);
      await expect(a.missed(), text).rejects.toThrow(damaged);
      await expect(a.pages(), text).rejects.toThrow(damaged);
      await expect(a.saveRun({ at: new Date().toISOString(), failed: [] }), text).rejects.toThrow(
        damaged,
      );
      vi.mocked(log).mockClear();
      // every page write asks for its due time: the damaged file must not stop it
      await expect(a.due(main), text).resolves.toBeUndefined();
      expect(vi.mocked(log)).toHaveBeenCalledWith("WARN", expect.stringMatching(damaged));
      expect(await a.off(), text).toEqual({ scheduled: false });
      expect(existsSync(stateFile), text).toBe(false);
      expect(crontab, text).toBe("15 3 * * * backup.sh\n");
    }
  });

  it("writes auto-refresh.json through a temp file and leaves none behind", async () => {
    const stateFile = join(config.dataDir, "auto-refresh.json");
    await auto("linux").set({ cron: "0 6 * * *" });
    const before = statSync(stateFile).ino;
    await auto("linux").set({ cron: "0 9 * * *" });
    // a rename puts a new file in place: a reader never sees half of one
    expect(statSync(stateFile).ino).not.toBe(before);
    expect(readdirSync(config.dataDir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(JSON.parse(readFileSync(stateFile, "utf8"))).toMatchObject({
      cron: "0 9 * * *",
      pages: [join(config.dataDir, "garmin-dashboard.html")],
    });
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

  it("reports an error of the scheduler, and keeps the schedule it had", async () => {
    const broken = new AutoRefresh(config, "darwin", join(dir, "home"), failing, "/n");
    await expect(broken.set({})).rejects.toThrow(/launchctl failed \(5\): Bootstrap failed/);
    expect(existsSync(join(config.dataDir, "auto-refresh.json"))).toBe(false);
    await auto("darwin").set({ cron: "0 6 * * *" });
    await expect(broken.set({ cron: "0 9 * * *" })).rejects.toThrow(/launchctl failed/);
    expect((await auto("darwin").status()).cron).toBe("0 6 * * *");
  });

  it("writes the next run into each scheduled page as due, and removes it when stopped", async () => {
    const main = join(config.dataDir, "garmin-dashboard.html");
    const coach = join(config.dataDir, "coach.html");
    writeFileSync(main, dashboard({ weeks: 4 }));
    writeFileSync(coach, dashboard({ weeks: 8 }));
    const a = auto("linux");
    await a.set({ cron: "0 7 * * *" });
    await a.set({ path: "coach.html", cron: "0 18 * * *" });
    const due = await a.due(main);
    expect(new Date(due!).getHours()).toBe(18);
    expect(dataOf(main)).toEqual({ weeks: 4, due });
    expect(dataOf(coach)).toEqual({ weeks: 8, due });
    expect(await a.due(join(config.dataDir, "other.html"))).toBeUndefined();

    await a.off("coach.html");
    expect(dataOf(coach)).toEqual({ weeks: 8 });
    expect(dataOf(main)).toEqual({ weeks: 4, due });
    await a.off();
    expect(dataOf(main)).toEqual({ weeks: 4 });
    expect(await a.due(main)).toBeUndefined();
  });

  it("keeps the last run for the status, and a new schedule keeps it too", async () => {
    const a = auto("linux");
    await a.set({});
    expect(await a.status()).not.toHaveProperty("last");
    const last = {
      at: "2026-11-02T06:00:01.000Z",
      failed: [{ path: "a.html", error: "HTTP 401" }],
    };
    await a.saveRun(last);
    expect((await a.status()).last).toEqual(last);
    await a.set({ cron: "0 6 * * *" });
    expect((await a.status()).last).toEqual(last);
  });

  it("runs once for a missed run time, and not for a time before the schedule", async () => {
    const a = auto("darwin");
    expect(await a.missed()).toBe(false);
    await a.set({ cron: "0 7 * * *" });
    // set now: no run time has passed since
    expect(await a.missed()).toBe(false);
    const later = new Date(Date.now() + 2 * 86_400_000);
    expect(await a.missed(later)).toBe(true);
    await a.saveRun({ at: later.toISOString(), failed: [{ path: "a.html", error: "HTTP 401" }] });
    // a failed run counts too: the next try is the next run time, not a loop on a broken key
    expect(await a.missed(later)).toBe(false);
    expect((await a.status()).last).toEqual({
      at: later.toISOString(),
      failed: [{ path: "a.html", error: "HTTP 401" }],
    });
    // the same cron again keeps the last run and the start
    await a.set({ path: "coach.html" });
    expect(await a.missed(later)).toBe(false);
    expect((await a.status()).last?.at).toBe(later.toISOString());
  });

  it("runs a missed time of a schedule saved before the start time existed", async () => {
    const page = join(config.dataDir, "garmin-dashboard.html");
    const file = join(config.dataDir, "auto-refresh.json");
    writeFileSync(file, JSON.stringify({ cron: "0 7 * * *", pages: [page] }));
    expect(await auto("linux").missed()).toBe(true);
  });

  it("does not catch up a time of a new cron set after the last run", async () => {
    const page = join(config.dataDir, "garmin-dashboard.html");
    writeFileSync(
      join(config.dataDir, "auto-refresh.json"),
      JSON.stringify({
        cron: "0 7 * * *",
        pages: [page],
        since: daysAgo(5),
        last: { at: daysAgo(2), failed: [] },
      }),
    );
    const a = auto("darwin");
    expect(await a.missed()).toBe(true);
    // launchd starts the job as it loads the new cron: it must find nothing to do
    await a.set({ cron: "0 6 * * *" });
    expect(await a.missed()).toBe(false);
  });

  it("counts a run at the run time itself as done, and a run just before it as not", async () => {
    const a = auto("linux");
    await a.set({ cron: "0 7 * * *" });
    const seven = new Date(Date.now() + 3 * 86_400_000);
    seven.setHours(7, 0, 0, 0);
    expect(await a.missed(seven)).toBe(true);
    await a.saveRun({ at: seven.toISOString(), failed: [] });
    expect(await a.missed(seven)).toBe(false);
    await a.saveRun({ at: new Date(seven.getTime() - 1).toISOString(), failed: [] });
    expect(await a.missed(seven)).toBe(true);
  });

  it("saves no run when no page has a schedule", async () => {
    await auto("linux").saveRun({ at: new Date().toISOString(), failed: [] });
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
  expect(r.failed).toEqual([{ path: "a.html", error: "gone" }]);
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
