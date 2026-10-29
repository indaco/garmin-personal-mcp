import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../src/config";
import {
  AutoRefresh,
  checkSchedule,
  cronLine,
  type Job,
  parseSchedule,
  plist,
  refreshPages,
  type Run,
  schtasksArgs,
  withCronLine,
} from "../src/schedule";

const job: Job = {
  program: "/opt/node/bin/npx",
  args: ["-y", "pkg@latest", "refresh", "--auto"],
  env: { GARMIN_DATA_DIR: "/data/it's 100%", PATH: "/opt/node/bin:/usr/bin:/bin" },
  log: "/home/u/.cache/garmin-personal-mcp/refresh.log",
};

const NPX_ENTRY = "/home/u/.npm/_npx/1a2b/node_modules/pkg/dist/index.js";

const failing: Run = async () => ({ code: 5, stdout: "", stderr: "Bootstrap failed: 5" });

describe("schedules", () => {
  it("reads the CLI forms, with 07:00 and Monday as defaults", () => {
    expect(parseSchedule(["daily"])).toEqual({ every: "day", time: "07:00" });
    expect(parseSchedule(["weekdays", "6:30"])).toEqual({ every: "weekday", time: "06:30" });
    expect(parseSchedule(["weekly"])).toEqual({ every: "week", day: "monday", time: "07:00" });
    expect(parseSchedule(["Weekly", "Friday", "18:05"])).toEqual({
      every: "week",
      day: "friday",
      time: "18:05",
    });
    expect(checkSchedule({ day: "sunday" })).toEqual({
      every: "week",
      day: "sunday",
      time: "07:00",
    });
  });

  it("refuses a bad schedule with the forms in the message", () => {
    for (const words of [["hourly"], ["daily", "25:00"], ["daily", "7"], ["daily", "7:00", "x"]]) {
      expect(() => parseSchedule(words), words.join(" ")).toThrow(/daily \[HH:MM\]/);
    }
    expect(() => parseSchedule(["weekly", "someday"])).toThrow(/Day: one of/);
  });

  it("writes launchd times: every day, weekdays, one day", () => {
    const day = plist(job, checkSchedule({ every: "day", time: "07:05" }));
    expect(day).toContain(
      "<dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>5</integer></dict>",
    );
    expect(
      plist(job, checkSchedule({ every: "weekday" })).match(/<key>Weekday<\/key>/g),
    ).toHaveLength(5);
    expect(plist(job, checkSchedule({ every: "week", day: "sunday" }))).toContain(
      "<key>Weekday</key><integer>0</integer>",
    );
    expect(day).toContain("<string>/opt/node/bin/npx</string>");
  });

  it("writes cron lines with the user's paths quoted and % escaped", () => {
    expect(cronLine(job, checkSchedule({ every: "weekday", time: "06:30" }))).toMatch(
      /^30 6 \* \* 1,2,3,4,5 GARMIN_DATA_DIR='\/data\/it'\\''s 100\\%' .*>> '.*refresh\.log' 2>&1 # garmin-personal-mcp refresh$/,
    );
    expect(cronLine(job, checkSchedule({ every: "day" }))).toMatch(/^0 7 \* \* \* /);
  });

  it("replaces only its own crontab line", () => {
    const mine = "0 7 * * * x # garmin-personal-mcp refresh";
    const other = "15 3 * * * backup.sh";
    expect(withCronLine(`${other}\n${mine}\n`, "1 8 * * * y # garmin-personal-mcp refresh")).toBe(
      `${other}\n1 8 * * * y # garmin-personal-mcp refresh\n`,
    );
    expect(withCronLine(`${other}\n${mine}\n`, undefined)).toBe(`${other}\n`);
  });

  it("writes schtasks days", () => {
    expect(schtasksArgs("C:\\d\\a.cmd", checkSchedule({ every: "week", day: "monday" }))).toEqual(
      expect.arrayContaining(["/SC", "WEEKLY", "/D", "MON", "/ST", "07:00"]),
    );
    expect(schtasksArgs("C:\\d\\a.cmd", checkSchedule({}))).not.toContain("/D");
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
    expect(await auto("darwin").status()).toEqual({ scheduled: false });
    expect(calls).toEqual([]);
  });

  it("installs one launchd job, and a second page or schedule replaces it", async () => {
    const a = auto("darwin");
    const plistFile = join(
      dir,
      "home/Library/LaunchAgents/com.indaco.garmin-personal-mcp.refresh.plist",
    );
    await a.set({ schedule: { every: "week", day: "monday" } });
    expect(readFileSync(plistFile, "utf8")).toContain("<key>Weekday</key><integer>1</integer>");
    const s = await a.set({ path: "coach.html", schedule: { every: "day", time: "06:00" } });
    expect(s).toMatchObject({
      scheduled: true,
      schedule: { every: "day", time: "06:00" },
      pages: [join(config.dataDir, "garmin-dashboard.html"), join(config.dataDir, "coach.html")],
      scheduler: "launchd",
      installed: true,
    });
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
    await a.set({ schedule: { every: "weekday", time: "05:45" } });
    expect((await a.set({ path: "coach.html" })).schedule).toEqual({
      every: "weekday",
      time: "05:45",
    });
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

  it("writes a script for the Windows task", async () => {
    const a = auto("win32");
    await a.set({ schedule: { every: "week", day: "friday", time: "20:00" } });
    const script = readFileSync(join(config.dataDir, "auto-refresh.cmd"), "utf8");
    expect(script).toContain('set "PATH=/opt/node/bin;%PATH%"');
    expect(script).toContain("npx.cmd");
    expect(calls.find((c) => c.args[0] === "/Create")?.args).toEqual(
      expect.arrayContaining(["/D", "FRI", "/ST", "20:00"]),
    );
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
