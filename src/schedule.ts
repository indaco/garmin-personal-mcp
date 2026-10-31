import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { name } from "../package.json";
import type { Config } from "./config";
import { type DashboardWriter, pageTarget, patchDue } from "./dashboard-page";
import { log } from "./log";
import { writeAtomically } from "./tools";

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
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
/** Garmin gets about 8 requests per refresh: two runs must be at least this far apart. */
const MIN_GAP_MINUTES = 60;

/** A 5-field cron expression in local time, read into its values. */
export interface Cron {
  text: string;
  /** The run times of a day, as minutes after midnight, sorted. */
  times: number[];
  /** Days of the month, months (1-12) and weekdays (0 = Sunday); undefined = every. */
  days?: number[];
  months?: number[];
  weekdays?: number[];
}

export interface Status {
  scheduled: boolean;
  cron?: string;
  /** The next runs, local time. */
  next?: string[];
  pages?: string[];
  scheduler?: string;
  /** False when the job is no longer in the system scheduler. */
  installed?: boolean;
  log?: string;
  /** The last run of `refresh --auto`, and the pages it could not update. */
  last?: LastRun;
}

export interface LastRun {
  at: string;
  failed: { path: string; error: string }[];
}

interface State {
  cron: string;
  pages: string[];
  /** When the schedule was set: a run time before it is not missed. */
  since?: string;
  last?: LastRun;
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
const DEFAULT_CRON = "0 7 * * *";
const LABEL = "com.indaco.garmin-personal-mcp.refresh";
const TASK = "garmin-personal-mcp refresh";
const MARK = "# garmin-personal-mcp refresh";
const FIELDS = [
  ["minute", 0, 59],
  ["hour", 0, 23],
  ["day of month", 1, 31],
  ["month", 1, 12],
  ["weekday", 0, 7],
] as const;

/** One cron field: *, n, a-b, with an optional /step, separated by commas. */
function field(text: string, [label, min, max]: (typeof FIELDS)[number]): number[] {
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    const from = m?.[2] === undefined ? min : Number(m[2]);
    const to = m?.[3] !== undefined ? Number(m[3]) : m?.[2] === undefined || m[4] ? max : from;
    const step = m?.[4] === undefined ? 1 : Number(m[4]);
    if (!m || from < min || to > max || from > to || step < 1) {
      throw new Error(`Cron ${label}: "${part}" is not ${min}-${max}, a list, a range or a /step`);
    }
    for (let v = from; v <= to; v += step) values.add(label === "weekday" && v === 7 ? 0 : v);
  }
  return [...values].toSorted((a, b) => a - b);
}

/** Reads and checks a cron expression: numbers only, and at least an hour between two runs. */
export function parseCron(text: string): Cron {
  const parts = text.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `Cron: 5 fields, minute hour day-of-month month weekday (0 = Sunday), e.g. "0 7 * * 1"`,
    );
  }
  const [minutes, hours, days, months, weekdays] = parts.map((p, i) => field(p, FIELDS[i]));
  const times = hours.flatMap((h) => minutes.map((m) => h * 60 + m)).toSorted((a, b) => a - b);
  // the gap before each time; the first one is from the last time of the day before
  const gaps = times.map((t, i) => (i === 0 ? t + 24 * 60 : t) - times[(i || times.length) - 1]);
  if (times.length > 1 && Math.min(...gaps) < MIN_GAP_MINUTES) {
    throw new Error("Cron: the runs must be at least 1 hour apart");
  }
  // as in cron, a field that starts with * is every day; with day of month and weekday, either one runs
  const cron: Cron = {
    text: parts.join(" "),
    times,
    ...(parts[2].startsWith("*") ? {} : { days }),
    ...(parts[3].startsWith("*") ? {} : { months }),
    ...(parts[4].startsWith("*") ? {} : { weekdays }),
  };
  if (nextRuns(cron, new Date(), 1).length === 0) throw new Error("Cron: this date never comes");
  return cron;
}

/** The CLI forms: daily [HH:MM], weekdays [HH:MM], weekly <day> [HH:MM], or a cron expression. */
export function cronOf(words: string[]): string {
  if (words.length === 1 && words[0].trim().includes(" ")) return words[0];
  const [kind, ...rest] = words.map((w) => w.toLowerCase());
  const day =
    kind === "weekly" && rest[0] && !rest[0].includes(":")
      ? DAYS.indexOf(rest.shift() as (typeof DAYS)[number])
      : 1;
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(rest[0] ?? "07:00");
  const weekday = { daily: "*", weekdays: "1-5", weekly: String(day) }[kind ?? ""];
  if (!weekday || !m || rest.length > 1 || day < 0) {
    throw new Error(
      'Schedule: daily [HH:MM], weekdays [HH:MM], weekly <day> [HH:MM] or a cron expression in quotes, e.g. "0 7 * * 1"',
    );
  }
  return `${Number(m[2])} ${Number(m[1])} * * ${weekday}`;
}

/** Whether the job runs on that day. */
function runsOn(c: Cron, d: Date): boolean {
  if (c.months && !c.months.includes(d.getMonth() + 1)) return false;
  if (c.days && c.weekdays) return c.days.includes(d.getDate()) || c.weekdays.includes(d.getDay());
  if (c.days) return c.days.includes(d.getDate());
  return c.weekdays?.includes(d.getDay()) ?? true;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The run times after `from`, in order; none when the date never comes. */
function* runDates(c: Cron, from: Date): Generator<Date> {
  // 8 years: a 29 February runs at least once in that time
  for (let i = 0; i < 366 * 8; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    if (!runsOn(c, d)) continue;
    for (const t of c.times) {
      const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(t / 60), t % 60);
      if (at > from) yield at;
    }
  }
}

/** The last run time at or before `now`; undefined when there is none in 8 years. */
export function lastRunTime(c: Cron, now: Date): Date | undefined {
  for (let i = 0; i < 366 * 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    if (!runsOn(c, d)) continue;
    for (const t of c.times.toReversed()) {
      const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(t / 60), t % 60);
      if (at <= now) return at;
    }
  }
  return undefined;
}

/** The next `count` runs after `from`, as local "YYYY-MM-DD HH:MM"; empty when the date never comes. */
export function nextRuns(c: Cron, from: Date, count: number): string[] {
  const runs: string[] = [];
  for (const at of runDates(c, from)) {
    if (runs.length === count) break;
    runs.push(
      `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`,
    );
  }
  return runs;
}

/** The next run of the cron as an ISO time, for the page's `due`; undefined when it never runs. */
function dueOf(cron: string): string | undefined {
  const [at] = runDates(parseCron(cron), new Date());
  return at?.toISOString();
}

/** What the job runs, with the environment it needs. */
export interface Job {
  program: string;
  args: string[];
  env: Record<string, string>;
  log: string;
}

const xml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** launchd has no cron syntax: each run time is a dict, and a run matches any dict of the array. */
function calendar(c: Cron): Record<string, number>[] {
  const months = c.months ?? [undefined];
  const days: Record<string, number>[] =
    c.days || c.weekdays
      ? [
          ...(c.days ?? []).map((d) => ({ Day: d })),
          ...(c.weekdays ?? []).map((w) => ({ Weekday: w })),
        ]
      : [{}];
  return c.times.flatMap((t) =>
    months.flatMap((m) =>
      days.map((d) => ({
        ...(m === undefined ? {} : { Month: m }),
        ...d,
        Hour: Math.floor(t / 60),
        Minute: t % 60,
      })),
    ),
  );
}

export function plist(job: Job, c: Cron): string {
  const when = calendar(c).map(
    (e) =>
      `    <dict>${Object.entries(e)
        .map(([k, v]) => `<key>${k}</key><integer>${v}</integer>`)
        .join("")}</dict>`,
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
  <key>RunAtLoad</key><true/>
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
export function cronLine(job: Job, c: Cron): string {
  const env = Object.entries(job.env).map(([k, v]) => `${k}=${sh(v)}`);
  const command = [...env, sh(job.program), ...job.args.map(sh), ">>", sh(job.log), "2>&1"].join(
    " ",
  );
  return `${c.text} ${command.replaceAll("%", "\\%")} ${MARK}`;
}

/** The crontab with our line replaced (or removed when `line` is undefined); other lines stay. */
export function withCronLine(crontab: string, line: string | undefined): string {
  const kept = crontab.split("\n").filter((l) => l.trim() !== "" && !l.endsWith(MARK));
  return [...kept, ...(line ? [line] : [])].map((l) => `${l}\n`).join("");
}

/** The .cmd file the Windows task runs. */
export function windowsScript(job: Job): string {
  const env = Object.entries(job.env).map(([k, v]) =>
    k === "PATH" ? `set "PATH=${v};%PATH%"` : `set "${k}=${v}"`,
  );
  const command = [job.program, ...job.args].map((a) => `"${a}"`).join(" ");
  return ["@echo off", ...env, `call ${command} >> "${job.log}" 2>&1`, ""].join("\r\n");
}

const tags = (names: string[]) => names.map((n) => `<${n} />`).join("");

/**
 * The Task Scheduler task: schtasks /SC cannot say most cron schedules, so each run time is a calendar
 * trigger. StartWhenAvailable runs a time that the computer missed, as launchd does.
 */
export function taskXml(script: string, c: Cron): string {
  const months = `<Months>${tags((c.months ?? MONTHS.map((_, i) => i + 1)).map((m) => MONTHS[m - 1]))}</Months>`;
  const weekdays = c.weekdays
    ? `<DaysOfWeek>${tags(c.weekdays.map((w) => DAYS[w][0].toUpperCase() + DAYS[w].slice(1)))}</DaysOfWeek>`
    : "";
  const byMonth = (days: number[]) =>
    `<ScheduleByMonth><DaysOfMonth>${days.map((d) => `<Day>${d}</Day>`).join("")}</DaysOfMonth>${months}</ScheduleByMonth>`;
  const schedules = [
    ...(c.days ? [byMonth(c.days)] : []),
    ...(c.weekdays
      ? [
          c.months
            ? `<ScheduleByMonthDayOfWeek><Weeks><Week>1</Week><Week>2</Week><Week>3</Week><Week>4</Week><Week>Last</Week></Weeks>${weekdays}${months}</ScheduleByMonthDayOfWeek>`
            : `<ScheduleByWeek><WeeksInterval>1</WeeksInterval>${weekdays}</ScheduleByWeek>`,
        ]
      : []),
    ...(c.days || c.weekdays
      ? []
      : [
          c.months
            ? byMonth(Array.from({ length: 31 }, (_, i) => i + 1))
            : "<ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>",
        ]),
  ];
  const triggers = c.times.flatMap((t) =>
    schedules.map(
      (s) =>
        `    <CalendarTrigger><StartBoundary>2026-01-01T${pad(Math.floor(t / 60))}:${pad(t % 60)}:00</StartBoundary>${s}</CalendarTrigger>`,
    ),
  );
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Updates the Garmin dashboard pages (${xml(c.text)})</Description></RegistrationInfo>
  <Triggers>
${triggers.join("\n")}
  </Triggers>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>
  </Settings>
  <Actions><Exec><Command>${xml(script)}</Command></Exec></Actions>
</Task>
`;
}

export class AutoRefresh {
  constructor(
    private readonly config: Config,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly home = homedir(),
    private readonly exec: Run = run,
    private readonly nodeDir = dirname(process.execPath),
    /** The running dist/index.js: a global or local install, or a copy in the npx cache. */
    private readonly entry = realEntry(process.argv[1]),
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
  get #taskFile() {
    return join(this.config.dataDir, "auto-refresh-task.xml");
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
      cron: state.cron,
      next: nextRuns(parseCron(state.cron), new Date(), 3),
      pages: state.pages,
      scheduler: this.#scheduler,
      installed: await this.#installed(),
      log: this.#log,
      ...(state.last ? { last: state.last } : {}),
    };
  }

  /** The next run for a scheduled page, as an ISO time; undefined when the page has no schedule. */
  async due(path: string): Promise<string | undefined> {
    let state: State | undefined;
    try {
      state = await this.#state();
    } catch (e) {
      // every page write asks: a damaged state file must not stop it
      log("WARN", (e as Error).message);
      return undefined;
    }
    if (!state?.pages.includes(path)) return undefined;
    return dueOf(state.cron);
  }

  /**
   * Whether `refresh --auto` must run: a run time passed since the last run (or since the schedule
   * was set). launchd and Task Scheduler also start the job at login or wake, so a time that the
   * computer missed runs then, once. cron skips it.
   */
  async missed(now = new Date()): Promise<boolean> {
    const state = await this.#state();
    if (!state) return false;
    const time = lastRunTime(parseCron(state.cron), now);
    // the later of the last run and the start: a new cron does not catch up its times before it
    const after = Math.max(
      Date.parse(state.last?.at ?? "") || 0,
      Date.parse(state.since ?? "") || 0,
    );
    return time !== undefined && after < time.getTime();
  }

  /** Keeps the result of a `refresh --auto` run for the status; nothing when no page is scheduled. */
  async saveRun(last: LastRun): Promise<void> {
    const state = await this.#state();
    if (state) await this.#save({ ...state, last });
  }

  /** Adds the page (default: the main dashboard) and sets the cron, or keeps the current one. */
  async set(o: { cron?: string; path?: string }): Promise<Status> {
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
    const cron = parseCron(o.cron ?? old?.cron ?? DEFAULT_CRON);
    const pages = [...new Set([...(old?.pages ?? []), page])];
    // a new cron starts now, so the job does not catch up a time of the old one
    const since = old?.cron === cron.text && old.since ? old.since : new Date().toISOString();
    // saved first: launchd starts the job as it loads it, and the job must see `since`
    await this.#save({ ...old, cron: cron.text, pages, since });
    try {
      await this.#install(cron);
    } catch (e) {
      if (old) await this.#save(old);
      else await rm(this.#stateFile, { force: true });
      throw e;
    }
    // a new cron moves the next run: each page must expect the new one, or it warns too early
    const due = dueOf(cron.text);
    for (const p of pages) await patchDue(p, due);
    return this.status();
  }

  /** Removes the page; without a page, or when no page is left, removes the job. */
  async off(path?: string): Promise<Status> {
    let old: State | undefined;
    try {
      old = await this.#state();
    } catch {
      // a damaged file: the page list is lost; each page clears its due time on its next write
      await this.#uninstall();
      await rm(this.#stateFile, { force: true });
      return { scheduled: false };
    }
    if (!old) return { scheduled: false };
    const pages = path ? old.pages.filter((p) => p !== pageTarget(this.config.dataDir, path)) : [];
    // a page without a schedule expects no run
    for (const p of old.pages) if (!pages.includes(p)) await patchDue(p, undefined);
    if (pages.length > 0) {
      await this.#save({ ...old, pages });
      return this.status();
    }
    await this.#uninstall();
    await rm(this.#stateFile, { force: true });
    return { scheduled: false };
  }

  #job(): Job {
    const win = this.platform === "win32";
    // npm can prune the npx cache, so a server started by npx schedules npx with the latest release
    const npx = this.entry === "" || /[/\\]_npx[/\\]/.test(this.entry);
    return {
      program: join(this.nodeDir, npx ? (win ? "npx.cmd" : "npx") : win ? "node.exe" : "node"),
      args: [...(npx ? ["-y", `${name}@latest`] : [this.entry]), "refresh", "--auto"],
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

  async #install(c: Cron): Promise<void> {
    await mkdir(dirname(this.#log), { recursive: true });
    const job = this.#job();
    if (this.platform === "darwin") {
      await mkdir(dirname(this.#plist), { recursive: true });
      await writeFile(this.#plist, plist(job, c));
      await this.exec("launchctl", ["bootout", this.#domain(), this.#plist]);
      await this.#must("launchctl", ["bootstrap", this.#domain(), this.#plist]);
    } else if (this.platform === "linux") {
      await this.#must("crontab", ["-"], withCronLine(await this.#crontab(), cronLine(job, c)));
    } else {
      await writeFile(this.#script, windowsScript(job));
      // schtasks reads the task XML as UTF-16 with a byte order mark
      await writeFile(this.#taskFile, Buffer.from(`\ufeff${taskXml(this.#script, c)}`, "utf16le"));
      await this.#must("schtasks", ["/Create", "/F", "/TN", TASK, "/XML", this.#taskFile]);
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
      await rm(this.#taskFile, { force: true });
    }
  }

  async #installed(): Promise<boolean> {
    if (this.platform === "darwin") return existsSync(this.#plist);
    if (this.platform === "linux") return (await this.#crontab()).includes(MARK);
    return (await this.exec("schtasks", ["/Query", "/TN", TASK])).code === 0;
  }

  #domain(): string {
    // only macOS gets here, and it always has a user id
    return `gui/${process.getuid!()}`;
  }

  /** The user's crontab; "" when there is none. Any other failure stops: a write would erase it. */
  async #crontab(): Promise<string> {
    const r = await this.exec("crontab", ["-l"]);
    if (r.code === 0) return r.stdout;
    // cronie, vixie and macOS: "no crontab for <user>"; BusyBox: "can't open ... No such file"
    if (/no crontab for|No such file or directory/i.test(r.stderr)) return "";
    throw new Error(`crontab -l failed (${r.code}): ${(r.stderr || r.stdout).trim()}`);
  }

  async #must(cmd: string, args: string[], input?: string): Promise<void> {
    const r = await this.exec(cmd, args, input);
    if (r.code !== 0) {
      throw new Error(`${cmd} failed (${r.code}): ${(r.stderr || r.stdout).trim()}`);
    }
  }

  async #save(state: State): Promise<void> {
    // the job runs in another process: it must never read a half-written file
    await writeAtomically(this.#stateFile, `${JSON.stringify(state, null, 2)}\n`);
  }

  async #state(): Promise<State | undefined> {
    const text = await readFile(this.#stateFile, "utf8").catch(() => undefined);
    if (text === undefined) return undefined;
    let state: Partial<State> | null = null;
    try {
      state = JSON.parse(text) as Partial<State> | null;
    } catch {
      // stays null: damaged
    }
    if (typeof state?.cron !== "string" || !Array.isArray(state.pages)) {
      throw new Error(
        `${this.#stateFile} is damaged: stop the automatic refresh (off), then set it again`,
      );
    }
    return state as State;
  }
}

/** The real path of the running script, so the job does not follow a link that can change. */
export function realEntry(path: string | undefined): string {
  try {
    return path ? realpathSync(path) : "";
  } catch {
    return "";
  }
}

/** Updates each page; one failure does not stop the others. Returns one log line per page. */
export async function refreshPages(
  writer: Pick<DashboardWriter, "write">,
  pages: string[],
): Promise<{ lines: string[]; failed: LastRun["failed"] }> {
  const lines: string[] = [];
  const failed: LastRun["failed"] = [];
  for (const path of pages) {
    const at = new Date().toISOString();
    try {
      await writer.write({ path, onlyExisting: true });
      lines.push(`${at} updated ${path}`);
    } catch (e) {
      const error = (e as Error).message;
      failed.push({ path, error });
      lines.push(`${at} failed ${path}: ${error}`);
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
        "computer (launchd, cron or Task Scheduler) replaces the data of the page at the given times, also",
        "with no assistant open. The refresh removes the coach notes, because old notes do not agree",
        "with new data. The computer must be on at that time. The page must exist (writeDashboard first).",
        "`last` is the last automatic run: its time and the pages that it could not update, with the",
        "error. A page shows a note when its update is more than 1 hour late: `last` tells why.",
        "`cron`: convert what the user says, in any language, into a 5-field cron expression in local",
        'time: minute hour day-of-month month weekday, numbers only (0 = Sunday), e.g. "0 7 * * 1-5" for',
        "weekdays at 7. Two runs must be at least 1 hour apart. The cron is for all scheduled pages;",
        "`path` adds that page (default the main page); `off` stops the refresh of `path`, or of every",
        "page when no `path` is given. Without arguments it only reads. The reply has `next`, the next",
        "runs in local time: tell them to the user in their language, so they can check the schedule.",
      ].join("\n"),
      inputSchema: z.object({
        cron: z
          .string()
          .describe('minute hour day-of-month month weekday, e.g. "0 7 * * *"; default 0 7 * * *')
          .optional(),
        path: z
          .string()
          .describe("The .html file; relative paths are inside the data dir")
          .optional(),
        off: z.boolean().describe("Stop the refresh").optional(),
      }),
    },
    async ({ cron, path, off }) => {
      const status = off
        ? await auto.off(path)
        : cron !== undefined || path !== undefined
          ? await auto.set({ cron, path })
          : await auto.status();
      return { content: [{ type: "text" as const, text: JSON.stringify(status) }] };
    },
  );
}
