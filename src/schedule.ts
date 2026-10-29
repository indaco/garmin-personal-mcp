import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { name } from "../package.json";
import type { Config } from "./config";
import { type DashboardWriter, pageTarget } from "./dashboard-page";

/**
 * The automatic refresh of dashboard pages: one job in the scheduler of the operating system (launchd,
 * cron or Task Scheduler) runs `refresh --auto`, which updates the pages listed in
 * `<data-dir>/auto-refresh.json`. Nothing is installed until the user asks.
 */

export const DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;
export type Day = (typeof DAYS)[number];

export interface Schedule {
  every: "day" | "weekday" | "week";
  /** Only for `week`. */
  day?: Day;
  /** HH:MM, 24 h. */
  time: string;
}

export interface Status {
  scheduled: boolean;
  schedule?: Schedule;
  pages?: string[];
  scheduler?: string;
  /** False when the job is no longer in the system scheduler. */
  installed?: boolean;
  log?: string;
}

interface State {
  schedule: Schedule;
  pages: string[];
}

export type Run = (
  cmd: string,
  args: string[],
  input?: string,
) => Promise<{ code: number; stdout: string; stderr: string }>;

/** Runs a command without a shell; its output never reaches our stdout. */
export const run: Run = (cmd, args, input) =>
  new Promise((ok, fail) => {
    const p = spawn(cmd, args, { stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", fail);
    p.on("close", (code) => ok({ code: code ?? 1, stdout, stderr }));
    p.stdin.end(input ?? "");
  });

const STATE_FILE = "auto-refresh.json";
const LABEL = "com.indaco.garmin-personal-mcp.refresh";
const TASK = "garmin-personal-mcp refresh";
const MARK = "# garmin-personal-mcp refresh";
const FORMS = "daily [HH:MM], weekdays [HH:MM] or weekly <day> [HH:MM]";

/** A schedule with its defaults (07:00, Monday), or an error that lists the forms. */
export function checkSchedule(s: Partial<Schedule> = {}): Schedule {
  const every = s.every ?? (s.day ? "week" : "day");
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s.time ?? "07:00");
  if (!["day", "weekday", "week"].includes(every) || !m) {
    throw new Error(`Schedule: ${FORMS}, e.g. weekly monday 07:00`);
  }
  const time = `${m[1].padStart(2, "0")}:${m[2]}`;
  if (every !== "week") return { every, time };
  const day = s.day ?? "monday";
  if (!DAYS.includes(day)) throw new Error(`Day: one of ${DAYS.join(", ")}`);
  return { every, day, time };
}

/** The CLI words, e.g. ["weekly", "monday", "7:30"]. */
export function parseSchedule(words: string[]): Schedule {
  const [kind, ...rest] = words.map((w) => w.toLowerCase());
  const every = ({ daily: "day", weekdays: "weekday", weekly: "week" } as const)[kind ?? ""];
  if (!every) throw new Error(`Schedule: ${FORMS}`);
  const day = every === "week" && rest[0] && !rest[0].includes(":") ? rest.shift() : undefined;
  if (rest.length > 1) throw new Error(`Schedule: ${FORMS}`);
  return checkSchedule({ every, day: day as Day | undefined, time: rest[0] });
}

/** "every Monday at 07:00". */
export function describe(s: Schedule): string {
  const when =
    s.every === "day"
      ? "every day"
      : s.every === "weekday"
        ? "every weekday"
        : `every ${s.day![0].toUpperCase()}${s.day!.slice(1)}`;
  return `${when} at ${s.time}`;
}

/** The days of the week the job runs, 0 = Sunday; undefined = every day. */
const weekdays = (s: Schedule) =>
  s.every === "day" ? undefined : s.every === "weekday" ? [1, 2, 3, 4, 5] : [DAYS.indexOf(s.day!)];

const hourMinute = (s: Schedule) => s.time.split(":").map(Number) as [number, number];

/** What the job runs: npx next to this node, so the job does not depend on the user's shell PATH. */
export interface Job {
  program: string;
  args: string[];
  env: Record<string, string>;
  log: string;
}

const xml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function plist(job: Job, s: Schedule): string {
  const [hour, minute] = hourMinute(s);
  const when = (weekdays(s) ?? [undefined]).map(
    (d) =>
      `    <dict>${d === undefined ? "" : `<key>Weekday</key><integer>${d}</integer>`}<key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>`,
  );
  const strings = (xs: string[]) => xs.map((x) => `    <string>${xml(x)}</string>`).join("\n");
  const env = Object.entries(job.env)
    .map(([k, v]) => `    <key>${k}</key><string>${xml(v)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${strings([job.program, ...job.args])}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>StartCalendarInterval</key>
  <array>
${when.join("\n")}
  </array>
  <key>StandardOutPath</key><string>${xml(job.log)}</string>
  <key>StandardErrorPath</key><string>${xml(job.log)}</string>
</dict>
</plist>
`;
}

const sh = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/** The crontab line; % is a newline for cron, so it is escaped. */
export function cronLine(job: Job, s: Schedule): string {
  const [hour, minute] = hourMinute(s);
  const env = Object.entries(job.env).map(([k, v]) => `${k}=${sh(v)}`);
  const command = [...env, sh(job.program), ...job.args.map(sh), ">>", sh(job.log), "2>&1"].join(
    " ",
  );
  return `${minute} ${hour} * * ${weekdays(s)?.join(",") ?? "*"} ${command.replaceAll("%", "\\%")} ${MARK}`;
}

/** The crontab with our line replaced (or removed when `line` is undefined); other lines stay. */
export function withCronLine(crontab: string, line: string | undefined): string {
  const kept = crontab.split("\n").filter((l) => l.trim() !== "" && !l.endsWith(MARK));
  return [...kept, ...(line ? [line] : [])].map((l) => `${l}\n`).join("");
}

/** The .cmd file the Windows task runs: /TR allows only 261 characters. */
export function windowsScript(job: Job): string {
  const env = Object.entries(job.env).map(([k, v]) =>
    k === "PATH" ? `set "PATH=${v};%PATH%"` : `set "${k}=${v}"`,
  );
  const command = [job.program, ...job.args].map((a) => `"${a}"`).join(" ");
  return ["@echo off", ...env, `call ${command} >> "${job.log}" 2>&1`, ""].join("\r\n");
}

export function schtasksArgs(script: string, s: Schedule): string[] {
  const days = weekdays(s)?.map((d) => DAYS[d].slice(0, 3).toUpperCase());
  return [
    "/Create",
    "/F",
    "/TN",
    TASK,
    "/TR",
    `"${script}"`,
    "/SC",
    days ? "WEEKLY" : "DAILY",
    ...(days ? ["/D", days.join(",")] : []),
    "/ST",
    s.time,
  ];
}

export class AutoRefresh {
  constructor(
    private readonly config: Config,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly home = homedir(),
    private readonly exec: Run = run,
    private readonly nodeDir = dirname(process.execPath),
  ) {}

  get #stateFile() {
    return join(this.config.dataDir, STATE_FILE);
  }
  get #plist() {
    return join(this.home, "Library/LaunchAgents", `${LABEL}.plist`);
  }
  get #script() {
    return join(this.config.dataDir, "auto-refresh.cmd");
  }
  get #log() {
    return join(this.home, ".cache/garmin-personal-mcp/refresh.log");
  }
  get #scheduler() {
    return { darwin: "launchd", linux: "cron", win32: "Task Scheduler" }[this.platform as string];
  }

  /** The pages that `refresh --auto` updates. */
  async pages(): Promise<string[]> {
    return (await this.#state())?.pages ?? [];
  }

  async status(): Promise<Status> {
    const state = await this.#state();
    if (!state) return { scheduled: false };
    return {
      scheduled: true,
      ...state,
      scheduler: this.#scheduler,
      installed: await this.#installed(),
      log: this.#log,
    };
  }

  /** Adds the page (default: the main dashboard) and sets the schedule, or keeps the current one. */
  async set(o: { schedule?: Partial<Schedule>; path?: string }): Promise<Status> {
    if (!this.#scheduler) throw new Error("Automatic refresh works on macOS, Linux and Windows");
    if (!existsSync(this.config.apiKeyFile)) {
      // the job must never hold the key, so it reads the key file
      throw new Error(
        `Save the API key in ${this.config.apiKeyFile} first: a scheduled job cannot read the key from your MCP client`,
      );
    }
    const page = pageTarget(this.config.dataDir, o.path);
    if (!existsSync(page)) {
      throw new Error(`${page} does not exist: make it first with the training-dashboard prompt`);
    }
    const old = await this.#state();
    const schedule = o.schedule ? checkSchedule(o.schedule) : (old?.schedule ?? checkSchedule());
    const pages = [...new Set([...(old?.pages ?? []), page])];
    await this.#install(schedule);
    await writeFile(this.#stateFile, `${JSON.stringify({ schedule, pages }, null, 2)}\n`);
    return this.status();
  }

  /** Removes the page; without a page, or when no page is left, removes the job. */
  async off(path?: string): Promise<Status> {
    const old = await this.#state();
    if (!old) return { scheduled: false };
    const pages = path ? old.pages.filter((p) => p !== pageTarget(this.config.dataDir, path)) : [];
    if (pages.length > 0) {
      await writeFile(this.#stateFile, `${JSON.stringify({ ...old, pages }, null, 2)}\n`);
      return this.status();
    }
    await this.#uninstall();
    await rm(this.#stateFile, { force: true });
    return { scheduled: false };
  }

  #job(): Job {
    const win = this.platform === "win32";
    return {
      program: join(this.nodeDir, win ? "npx.cmd" : "npx"),
      args: ["-y", `${name}@latest`, "refresh", "--auto"],
      env: {
        GARMIN_DATA_DIR: this.config.dataDir,
        GARMIN_API_KEY_FILE: this.config.apiKeyFile,
        GARMIN_BASE_URL: this.config.baseUrl,
        // npx starts node by name; Windows adds its own PATH in the script
        PATH: win ? this.nodeDir : [this.nodeDir, "/usr/bin", "/bin"].join(delimiter),
      },
      log: this.#log,
    };
  }

  async #install(s: Schedule): Promise<void> {
    await mkdir(dirname(this.#log), { recursive: true });
    const job = this.#job();
    if (this.platform === "darwin") {
      await mkdir(dirname(this.#plist), { recursive: true });
      await writeFile(this.#plist, plist(job, s));
      await this.exec("launchctl", ["bootout", this.#domain(), this.#plist]);
      await this.#must("launchctl", ["bootstrap", this.#domain(), this.#plist]);
    } else if (this.platform === "linux") {
      await this.#must("crontab", ["-"], withCronLine(await this.#crontab(), cronLine(job, s)));
    } else {
      await writeFile(this.#script, windowsScript(job));
      await this.#must("schtasks", schtasksArgs(this.#script, s));
    }
  }

  async #uninstall(): Promise<void> {
    if (this.platform === "darwin") {
      await this.exec("launchctl", ["bootout", this.#domain(), this.#plist]);
      await rm(this.#plist, { force: true });
    } else if (this.platform === "linux") {
      await this.#must("crontab", ["-"], withCronLine(await this.#crontab(), undefined));
    } else {
      await this.exec("schtasks", ["/Delete", "/F", "/TN", TASK]);
      await rm(this.#script, { force: true });
    }
  }

  async #installed(): Promise<boolean> {
    if (this.platform === "darwin") return existsSync(this.#plist);
    if (this.platform === "linux") return (await this.#crontab()).includes(MARK);
    return (await this.exec("schtasks", ["/Query", "/TN", TASK])).code === 0;
  }

  #domain(): string {
    return `gui/${process.getuid?.() ?? 0}`;
  }

  /** The user's crontab; "" when there is none (crontab -l then exits with 1). */
  async #crontab(): Promise<string> {
    const r = await this.exec("crontab", ["-l"]);
    return r.code === 0 ? r.stdout : "";
  }

  async #must(cmd: string, args: string[], input?: string): Promise<void> {
    const r = await this.exec(cmd, args, input);
    if (r.code !== 0) {
      throw new Error(`${cmd} failed (${r.code}): ${(r.stderr || r.stdout).trim()}`);
    }
  }

  async #state(): Promise<State | undefined> {
    const text = await readFile(this.#stateFile, "utf8").catch(() => undefined);
    return text === undefined ? undefined : (JSON.parse(text) as State);
  }
}

/** Updates each page; one failure does not stop the others. Returns one log line per page. */
export async function refreshPages(
  writer: Pick<DashboardWriter, "write">,
  pages: string[],
): Promise<{ lines: string[]; failed: boolean }> {
  const lines: string[] = [];
  let failed = false;
  for (const path of pages) {
    const at = new Date().toISOString();
    try {
      await writer.write({ path, onlyExisting: true });
      lines.push(`${at} updated ${path}`);
    } catch (e) {
      failed = true;
      lines.push(`${at} failed ${path}: ${(e as Error).message}`);
    }
  }
  return { lines, failed };
}

/** Registers scheduleDashboardRefresh. */
export function registerSchedule(server: McpServer, auto: AutoRefresh): void {
  server.registerTool(
    "scheduleDashboardRefresh",
    {
      description: [
        "Turns on, changes or stops the automatic refresh of a dashboard page. Use it only when the user",
        "asks for it or says yes to the question of a dashboard prompt. A job in the scheduler of the",
        "computer (launchd, cron or Task Scheduler) replaces the data of the page at the given time, also",
        "with no assistant open. The refresh removes the coach notes, because old notes do not agree",
        "with new data. The computer must be on at that time. The page must exist (writeDashboard first).",
        "Without arguments it only reads: `scheduled`, `schedule`, `pages`. `every` + `time` (+ `day`)",
        "sets the schedule of all scheduled pages; `path` adds that page (default the main page); `off`",
        "stops the refresh of `path`, or of every page when no `path` is given.",
      ].join("\n"),
      inputSchema: z.object({
        every: z
          .enum(["day", "weekday", "week"])
          .describe("day: every day; weekday: Monday to Friday; week: once a week on `day`")
          .optional(),
        day: z.enum(DAYS).describe("The day for `every` = week, default monday").optional(),
        time: z.string().describe("HH:MM, 24 h, default 07:00").optional(),
        path: z
          .string()
          .describe("The .html file; relative paths are inside the data dir")
          .optional(),
        off: z.boolean().describe("Stop the refresh").optional(),
      }),
    },
    async ({ every, day, time, path, off }) => {
      const asked = every ?? day ?? time;
      const status = off
        ? await auto.off(path)
        : asked !== undefined || path !== undefined
          ? await auto.set({
              ...(asked !== undefined ? { schedule: { every, day, time } } : {}),
              path,
            })
          : await auto.status();
      return { content: [{ type: "text" as const, text: JSON.stringify(status) }] };
    },
  );
}
