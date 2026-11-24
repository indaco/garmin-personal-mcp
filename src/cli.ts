import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { dirname, join, resolve as absolute } from "node:path";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { version } from "../package.json";
import { GarminApiClient, KEY_PAGE_URL, KeyRefusedError } from "./api-client";
import { type Config, loadConfig } from "./config";
import { isCache } from "./dashboard";
import { type DashboardWriter, isDay, pageInfo } from "./dashboard-page";
import { LOG_DIR } from "./log";
import {
  type AutoRefresh,
  cronOf,
  isTime,
  type LastRun,
  localTime,
  refreshPages,
  type Run,
  run,
  type Status,
} from "./schedule";
import { isCatalogue } from "./tools";

/** The commands for a terminal or a scheduler. Only a start without arguments is the MCP server. */
const COMMANDS = [
  "info",
  "doctor",
  "setup",
  "refresh",
  "schedule",
  "--version",
  "-v",
  "--help",
  "-h",
];

/** The flag that a command takes, as its first argument. */
const FLAGS: Partial<Record<string, string>> = { refresh: "--auto", setup: "--force" };

/** Commands in the form that works on each system, without an install. */
const NPX = "npx -y @indaco/garmin-personal-mcp@latest";

export const HELP = `Usage: garmin-personal-mcp [command]

Without a command, the MCP server starts on stdin and stdout.

Commands:
  info                                show the version, the settings, the pages and the schedule
  doctor                              test the API key, the folders, the data files and the schedule
  setup [--force]                     test the API key and save it in the key file
  refresh [page.html]                 update a dashboard page
                                      (default: <data-dir>/garmin-dashboard.html)
  refresh --auto                      update the pages that have a schedule
  schedule                            show the schedule
  schedule [daily|weekdays|weekly <day>] [HH:MM] [page.html]
                                      update a page automatically
  schedule "<cron>" [page.html]       the same, with a cron expression
  schedule off [page.html]            stop the automatic update
  -v, --version                       show the version
  -h, --help                          show this help

Run garmin-personal-mcp <command> --help to see the help of a command.`;

/** The help of each command that takes arguments or flags: `<command> --help`. */
export const COMMAND_HELP: Partial<Record<string, string>> = {
  info: `Usage: garmin-personal-mcp info

Show the version, the settings, where the files are, the last sync with Garmin, the dashboard
pages and the schedule. It never shows the API key, and it does not connect to the network.

Flags:
  -h, --help  show this help`,
  doctor: `Usage: garmin-personal-mcp doctor

Test the setup, and tell how to fix what fails. It tests the key file, the API key with
a token request to Garmin, the data folder, the log folder, the data files and the schedule:
the scheduled pages, the last run and a run that is late. With a schedule and a key in the
environment, it also tests the key in the key file.
It never shows the key. The exit code is 1 when a check fails.

Flags:
  -h, --help  show this help`,
  setup: `Usage: garmin-personal-mcp setup [--force]

Test a personal API key with Garmin and save it in the key file, so that only you can read it.
Paste the key at the prompt, or give it on stdin. The key stays hidden, and an argument
cannot be the key, because a shell keeps its arguments in the history.

Create a key at ${KEY_PAGE_URL}

Flags:
  --force     replace the key file. Garmin shows a key only one time, so the old key is lost.
  -h, --help  show this help`,
  refresh: `Usage: garmin-personal-mcp refresh [page.html]
       garmin-personal-mcp refresh --auto

Update a dashboard page with new data, one time. The layout, the custom widgets,
the languages and the page settings stay.

Arguments:
  page.html   the page to update. A relative path is in the data folder.
              (default: <data-dir>/garmin-dashboard.html)

Flags:
  --auto      update the pages that have a schedule, only when a run time was missed.
              The job of the automatic update runs it.
  -h, --help  show this help`,
  schedule: `Usage: garmin-personal-mcp schedule
       garmin-personal-mcp schedule [daily|weekdays|weekly <day>] [HH:MM] [page.html]
       garmin-personal-mcp schedule "<cron>" [page.html]
       garmin-personal-mcp schedule off [page.html]

Show, set or stop the automatic update of a dashboard page. Without arguments, it shows
the schedule. All the pages that update automatically use the same schedule.

Arguments:
  daily, weekdays, weekly <day>
              when to update. Without a day, weekly uses Monday.
  HH:MM       the time. (default: 07:00)
  "<cron>"    a cron expression of 5 fields in local time, in quotes
  off         stop the automatic update of the page. Without a page, stop all.
  page.html   the page. It must exist. A relative path is in the data folder.
              (default: <data-dir>/garmin-dashboard.html)

Flags:
  -h, --help  show this help`,
};

/** The waits before `refresh --auto` tries a page again after a network error: 3.5 minutes in all. */
export const RETRY_MS = [30_000, 60_000, 120_000];

export interface CliResult {
  code: number;
  stdout?: string;
  stderr?: string;
}

/** A wrong command or flag: the error and the help, on stderr. */
const usage = (error: string): CliResult => ({ code: 1, stderr: `${error}\n\n${HELP}` });

/**
 * Runs `--version` (`-v`), `--help` (`-h`), `info`, `refresh [page.html | --auto]` or
 * `schedule [daily|weekdays|weekly <day>] [HH:MM] | "<cron>" | off`, each with an optional page.
 * `--help` (`-h`) after a command gives its help and does not do its task. An unknown command or
 * flag gives the main help on stderr and exit code 1. Not MCP, so the result may go to stdout.
 */
export async function cli(
  command: string,
  args: string[],
  auto: Pick<AutoRefresh, "pages" | "status" | "set" | "off" | "saveRun" | "missed" | "late">,
  writer: () => Pick<DashboardWriter, "write">,
  sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
  config: Config = loadConfig(),
): Promise<CliResult> {
  // the word can be the key, typed in the wrong place: an error never prints it
  if (!COMMANDS.includes(command)) return usage("Unknown command");
  const help = COMMAND_HELP[command];
  if (help && (args.includes("--help") || args.includes("-h"))) return { code: 0, stdout: help };
  // setup has its own refusal
  const flag =
    command === "setup"
      ? undefined
      : args.find((a, i) => a.startsWith("-") && !(i === 0 && a === FLAGS[command]));
  if (flag) return usage("Unknown flag");
  if (command === "--version" || command === "-v") return { code: 0, stdout: version };
  if (command === "--help" || command === "-h") return { code: 0, stdout: HELP };
  if (command === "doctor") return doctor(config, auto);
  if (command === "setup") return setup(args, config);
  if (command === "info") {
    // a damaged auto-refresh.json must not stop info: the Schedule line shows the error
    const status = await auto.status().catch((e: Error) => e);
    return { code: 0, stdout: info(config, status) };
  }
  try {
    if (command === "refresh") {
      if (args.length > 1)
        return usage("refresh takes one page, a file that ends in .html, or --auto");
      if (args[0] && args[0] !== "--auto" && !/\.html$/i.test(args[0])) {
        return usage("refresh takes one page, a file that ends in .html, or --auto");
      }
      const scheduled = args[0] === "--auto";
      const at = new Date().toISOString();
      // the job starts at the run times and at login: nothing to do when no run time was missed
      if (scheduled && !(await auto.missed())) return { code: 0, stdout: `${at} no run due` };
      const pages = scheduled ? await auto.pages() : [args[0] ?? ""];
      const w = writer();
      const result = await refreshPages(w, pages);
      const { lines } = result;
      let { failed } = result;
      const partial = [...result.partial];
      // at login or after a wake the network can come a little after the job: wait for it
      for (const ms of scheduled ? RETRY_MS : []) {
        const offline = failed.filter((f) => f.error.startsWith("Network error"));
        if (offline.length === 0) break;
        lines.push(`network not ready: trying ${offline.length} page(s) again in ${ms / 1000} s`);
        await sleep(ms);
        const again = await refreshPages(
          w,
          offline.map((f) => f.path),
        );
        lines.push(...again.lines);
        partial.push(...again.partial);
        failed = [...failed.filter((f) => !offline.includes(f)), ...again.failed];
      }
      if (scheduled) await auto.saveRun({ at, failed, ...(partial.length > 0 ? { partial } : {}) });
      return { code: failed.length > 0 ? 1 : 0, stdout: lines.join("\n") };
    }
    const rest = [...args];
    const path = rest.at(-1)?.toLowerCase().endsWith(".html") ? rest.pop() : undefined;
    if (rest[0] === "off" && rest.length > 1) {
      // without this, a typo in the page name would stop the schedule of every page
      return usage("schedule off takes one page, a file that ends in .html");
    }
    const status =
      rest[0] === "off"
        ? await auto.off(path)
        : rest.length === 0 && path === undefined
          ? await auto.status()
          : await auto.set({ ...(rest.length > 0 ? { cron: cronOf(rest) } : {}), path });
    return { code: 0, stdout: summary(status) };
  } catch (e) {
    return { code: 1, stderr: `${command} failed: ${(e as Error).message}` };
  }
}

/**
 * The text with `~` for the home folder, so that it can be shared without the user name. A path on
 * Windows has either slash and no case. A folder that only looks like the home folder stays.
 */
export function hideHome(text: string, home = homedir()): string {
  const root = home.replace(/[/\\]+$/, "");
  if (/^([a-z]:)?$/i.test(root)) return text;
  const path = root.replace(/[.*+?^${}()|[\]\\/]/g, (c) =>
    c === "/" || c === "\\" ? "[/\\\\]" : `\\${c}`,
  );
  const flags = /^([a-z]:|[/\\]{2})/i.test(root) ? "gi" : "g";
  return text.replace(new RegExp(`(?<![^\\s'"(])${path}(?=$|[/\\\\\\s'")])`, flags), "~");
}

/** The files in the data folder that `info` checks. guide/tools.md tells what each file has. */
const DATA_FILES = ["exercises.json", "dashboard-cache.json", "widgets.json", "auto-refresh.json"];

const found = (path: string, from: string) =>
  `${path} (${existsSync(path) ? "found" : "missing"}, ${from})`;

/** Where a setting comes from; an empty variable gives the default, as in `loadConfig`. */
const source = (env: NodeJS.ProcessEnv, variable: string) =>
  env[variable] ? `from ${variable}` : "default";

/**
 * Text for one line. A file name, and an error with a part of an answer from Garmin, can have line
 * ends that make a false line, and control characters that change the terminal.
 */
const plain = (text: string) => text.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ");

/**
 * An error without the answer from Garmin, and without the cause of a network error, which can have an
 * address: `info` text goes into public issues. The code of the cause (ENOTFOUND) stays.
 */
const withoutAnswer = (error: string) =>
  error
    .replace(/(HTTP \d{3}\b|Response is not JSON)[\s\S]*| \(Content-Type[\s\S]*/, "$1")
    .replace(
      /(Network error [^(]*) \((?:(?:\w+ )?(E[A-Z0-9_]+)(?=[ )]))?[\s\S]*/,
      (_, start: string, code?: string) => (code ? `${start} (${code})` : start),
    );

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The text of a file; undefined when it cannot be read. A read of a FIFO can wait without an end. */
function textOf(path: string): string | undefined {
  try {
    return statSync(path).isFile() ? readFileSync(path, "utf8") : undefined;
  } catch {
    return undefined;
  }
}

const dayRange = (from: unknown, to: unknown) =>
  isDay(from) && isDay(to) ? `${from} to ${to}` : "n/a";

/** A dashboard page; undefined for another file, and for one that cannot be read. */
const pageAt = (path: string) => pageInfo(textOf(path) ?? "");

/** A line of `info`. The values are in one column: the longest label is `  dashboard-cache.json`. */
const row = (label: string, value: string | number) => `${label}:`.padEnd(24) + value;

/** When the dashboard data was fetched last, and the days that the cache has of it. */
function syncLines(dataDir: string): string[] {
  let cache: Record<string, unknown> = {};
  try {
    const saved: unknown = JSON.parse(textOf(join(dataDir, "dashboard-cache.json")) ?? "null");
    if (isCache(saved)) cache = saved;
  } catch {
    // stays empty: a damaged cache shows as n/a
  }
  return [
    row("  last sync", localTime(cache.syncedAt)),
    row("  activities", dayRange(cache.activitiesFrom, cache.activitiesTo)),
    row("  HRV", dayRange(cache.hrvFrom, cache.hrvTo)),
  ];
}

/** The pages in the data folder, then the scheduled pages that are not there. */
function pageLines(dataDir: string, scheduled: string[]): string[] {
  const own = files(dataDir, ".html").toSorted();
  const inFolder = own.map((f) => absolute(dataDir, f));
  const planned = new Set(scheduled.map((p) => absolute(p)));
  const line = (label: string, path: string) => {
    const end = planned.has(path) ? ", scheduled" : "";
    if (!existsSync(path)) return `    - ${label}: missing${end}`;
    const page = pageAt(path);
    if (!page) return `    - ${label}: not a dashboard page${end}`;
    return `    - ${label}: updated ${localTime(page.updated)}, by ${page.server}${end}`;
  };
  const lines = [
    ...own.map((f, i) => line(f, inFolder[i])),
    ...[...planned].filter((p) => !inFolder.includes(p)).map((p) => line(p, p)),
  ];
  return [row("  pages", lines.length || "none"), ...lines];
}

/** The `Schedule` lines of `info`. */
function scheduleLines(s: Status | Error): string[] {
  if (s instanceof Error) return [`cannot read it: ${s.message}`];
  if (!s.scheduled) return ["off"];
  const [first, ...details] = s.last ? lastRun(s.last, withoutAnswer) : ["n/a"];
  return [
    header(s),
    ...(s.installed ? [] : [`  ${missingJob(s)}`]),
    row("  last run", first),
    ...details.map((d) => `  ${d.replace(/^ {2}/, "  - ")}`),
    ...(hasFailed(s) ? [row("  last success", localTime(s.lastOk))] : []),
    row("  next", nextText(s)),
  ];
}

/** The names of the files in `dir` that end in `ext`. The list is empty when `dir` is missing. */
function files(dir: string, ext: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.toLowerCase().endsWith(ext));
  } catch {
    return [];
  }
}

const keySource = (env: NodeJS.ProcessEnv) =>
  env.GARMIN_PERSONAL_API_KEY?.trim() ? "from GARMIN_PERSONAL_API_KEY" : "from the key file";

/**
 * The text of `info`: the version, the settings and where the files are, with `~` for the home
 * folder. It says where the API key comes from, but it never shows the key. It does not connect to
 * the network. Each line is plain text, without the answer of a failed request.
 */
export function info(
  config: Config,
  status: Status | Error,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  const { dataDir } = config;
  const scheduled = status instanceof Error ? [] : (status.pages ?? []);
  const logs = join(home, LOG_DIR);
  const [schedule, ...scheduleDetails] = scheduleLines(status);
  const lines = [
    `garmin-personal-mcp ${version}`,
    "",
    row("Node.js", `${process.version} on ${process.platform}`),
    row("API host", `${config.baseUrl} (${source(env, "GARMIN_BASE_URL")})`),
    row("API key", keySource(env)),
    row("Key file", found(config.apiKeyFile, source(env, "GARMIN_API_KEY_FILE"))),
    row("Data folder", found(dataDir, source(env, "GARMIN_DATA_DIR"))),
    row("  .FIT files", files(join(dataDir, "fit"), ".fit").length),
    ...syncLines(dataDir),
    ...pageLines(dataDir, scheduled),
    ...DATA_FILES.map((f) => row(`  ${f}`, existsSync(join(dataDir, f)) ? "found" : "none")),
    row("Server log", join(logs, "garmin-personal-mcp.log")),
    row("Refresh log", join(logs, "refresh.log")),
    row("Schedule", schedule),
    ...scheduleDetails,
  ];
  return hideHome(lines.map(plain).join("\n"), home);
}

interface Check {
  ok: boolean;
  name: string;
  text: string;
}

/** A path for a POSIX shell. `~/` stays outside the quotes, or the shell does not expand it. */
function shellArg(path: string): string {
  if (/^[\w./~-]+$/.test(path)) return path;
  const tilde = path.startsWith("~/") ? "~/" : "";
  return `${tilde}'${path.slice(tilde.length).replaceAll("'", `'\\''`)}'`;
}

/** The key file: it is there when it is needed, and on macOS and Linux only the user can read it. */
function keyFileCheck(
  file: string,
  scheduled: boolean,
  platform: NodeJS.Platform,
  home: string,
): Check {
  const name = "Key file";
  let mode: number | undefined;
  try {
    mode = statSync(file, { throwIfNoEntry: false })?.mode;
  } catch (e) {
    return { ok: false, name, text: `cannot read it: ${(e as Error).message}` };
  }
  if (mode === undefined) {
    if (scheduled) {
      return {
        ok: false,
        name,
        text: `${file} is missing: the automatic update reads only the key file. Run: ${NPX} setup`,
      };
    }
    return process.env.GARMIN_PERSONAL_API_KEY?.trim()
      ? { ok: true, name, text: `${file} is missing, the key comes from GARMIN_PERSONAL_API_KEY` }
      : {
          ok: false,
          name,
          text: `${file} is missing. Run: ${NPX} setup`,
        };
  }
  // Windows has no modes: a stat gives the same one to each file, whoever can read it
  if (platform === "win32") {
    return { ok: true, name, text: `${file} (who can read it is not checked on Windows)` };
  }
  if ((mode & 0o077) === 0) return { ok: true, name, text: file };
  const fix = `chmod 600 ${shellArg(hideHome(file, home))}`;
  return { ok: false, name, text: `other users can read it. Run: ${fix}` };
}

/**
 * Makes and removes a folder in `dir`, or in the nearest parent that exists: only a real write gives
 * the answer on each system, because Windows gives access by ACLs that fs.access does not read.
 */
function folderCheck(name: string, dir: string): Check {
  let existing = dir;
  while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
  try {
    rmSync(mkdtempSync(join(existing, ".garmin-doctor-")), { recursive: true });
  } catch (e) {
    return { ok: false, name, text: `cannot write in ${existing}: ${(e as Error).message}` };
  }
  const text = existing === dir ? dir : `${dir} is missing, the server makes it when it needs it`;
  return { ok: true, name, text };
}

/**
 * Whether the page says that it was updated after `time`; never when it is not a dashboard page, and
 * never with a time in the future: the clock was wrong.
 */
function updatedAfter(path: string, time: string): boolean {
  const updated = pageAt(path)?.updated;
  if (!isTime(updated)) return false;
  const at = Date.parse(updated);
  return at > Date.parse(time) && at <= Date.now();
}

/**
 * The automatic update works. A failure of the last run does not count for a page that was updated
 * later or taken off the schedule, and a late run does not count when the user updated each page.
 */
function scheduleCheck(status: Status | Error, late: string | undefined): Check {
  const name = "Schedule";
  const bad = (text: string): Check => ({ ok: false, name, text });
  if (status instanceof Error) return bad(`cannot read it: ${status.message}`);
  if (!status.scheduled) return { ok: true, name, text: "off" };
  if (!status.installed) return bad(missingJob(status));
  const { last } = status;
  const pages = status.pages!;
  const gone = pages.filter((p) => !isFile(p));
  if (gone.length > 0) {
    return bad(
      `no page ${gone.join(", ")}. Make the page again, or run: ${NPX} schedule off <page>`,
    );
  }
  const failed = last?.failed.filter(
    (f) => pages.includes(f.path) && !updatedAfter(f.path, last.at),
  );
  if (failed?.length) {
    const list = failed.map((f) => `${f.path}: ${f.error}`).join(", ");
    return bad(`the last run (${localTime(last!.at)}) could not update ${list}`);
  }
  if (late && !pages.every((p) => updatedAfter(p, late))) {
    const since = last ? sinceText(last.at) : "no run yet";
    return bad(
      `${since}, expected ${localTime(late)}. The computer was perhaps off. If no update is in progress, update the pages with: ${NPX} refresh --auto`,
    );
  }
  return {
    ok: true,
    name,
    text: `${header(status)}, last run: ${lastRunText(last)}, next: ${nextText(status)}`,
  };
}

/** Says that no run came after the last one, at `at`. A time in the future comes from a clock that was ahead. */
const sinceText = (at: string) =>
  Date.parse(at) > Date.now()
    ? "the last run is unknown (its time is in the future)"
    : `no run since ${localTime(at)}`;

/** The last run on one line, for a check that passes. */
function lastRunText(last: LastRun | undefined): string {
  if (!last) return "n/a";
  const gaps = (last.partial ?? []).map((p) => `${p.path}: ${p.gaps}`).join("; ");
  return [
    localTime(last.at),
    ...(last.failed.length > 0
      ? ["its failed pages were updated or taken off the schedule since"]
      : []),
    ...(gaps ? [`updated with gaps: ${gaps}`] : []),
    ...(last.failed.length === 0 && !gaps ? ["every page updated"] : []),
  ].join(", ");
}

/** What each file in the data folder must hold for the server to use it, and the fix when it does not. */
const FILE_CHECKS: [file: string, right: (v: unknown) => boolean, fix: string][] = [
  ["exercises.json", isCatalogue, "delete it, the server makes it again"],
  ["dashboard-cache.json", isCache, "delete it, the server makes it again"],
  ["widgets.json", Array.isArray, "correct or delete it"],
];

/** The files that the server reads are not damaged. A missing file is right: the server makes it. */
function dataFilesCheck(dataDir: string): Check {
  const name = "Data files";
  const errors = FILE_CHECKS.flatMap(([file, right, fix]) => {
    const path = join(dataDir, file);
    let text: string;
    try {
      if (!statSync(path).isFile()) return [`cannot read ${path}: it is not a file`];
      text = readFileSync(path, "utf8");
    } catch (e) {
      const { code, message } = e as NodeJS.ErrnoException;
      return code === "ENOENT" || code === "ENOTDIR" ? [] : [`cannot read ${path}: ${message}`];
    }
    try {
      if (right(JSON.parse(text))) return [];
    } catch {
      // not JSON: damaged
    }
    return [`${path} is damaged: ${fix}`];
  });
  return { ok: errors.length === 0, name, text: errors.join(", ") || "readable" };
}

/** The job reads only the key file: with another key in the environment, the test of the API key says nothing about it. */
async function scheduleKeyCheck(config: Config): Promise<Check> {
  const name = "Key of the schedule";
  const key = (await readFile(config.apiKeyFile, "utf8").catch(() => "")).trim();
  if (!key) return { ok: false, name, text: `${config.apiKeyFile} has no key` };
  return new GarminApiClient(config, key).testKey().then(
    () => ({ ok: true, name, text: "Garmin accepts the key in the key file" }),
    (e: Error) => ({ ok: false, name, text: e.message }),
  );
}

/**
 * The text of `doctor`: each check with `ok` or `failed`, and the fix. It never shows the key.
 * The exit code is 1 when a check fails. It runs on macOS, Linux and Windows.
 */
export async function doctor(
  config: Config,
  auto: Pick<AutoRefresh, "status" | "late">,
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
): Promise<CliResult> {
  let status: Status | Error;
  let late: string | undefined;
  try {
    status = await auto.status();
    late = await auto.late();
  } catch (e) {
    status = e as Error;
  }
  const scheduled = !(status instanceof Error) && status.scheduled;
  const apiKey: Check = await new GarminApiClient(config).testKey().then(
    () => ({
      ok: true,
      name: "API key",
      text: `Garmin accepts it (${keySource(process.env)})`,
    }),
    (e: Error) => ({ ok: false, name: "API key", text: e.message }),
  );
  const checks = [
    keyFileCheck(config.apiKeyFile, scheduled, platform, home),
    apiKey,
    ...(scheduled && process.env.GARMIN_PERSONAL_API_KEY?.trim() && existsSync(config.apiKeyFile)
      ? [await scheduleKeyCheck(config)]
      : []),
    folderCheck("Data folder", config.dataDir),
    folderCheck("Log folder", join(home, LOG_DIR)),
    dataFilesCheck(config.dataDir),
    scheduleCheck(status, late),
  ];
  const failed = checks.filter((c) => !c.ok).length;
  const lines = checks.map((c) => plain(`${c.ok ? "ok    " : "failed"}  ${c.name}: ${c.text}`));
  lines.push(
    failed === 0 ? "All checks passed." : `${failed} ${failed === 1 ? "check" : "checks"} failed.`,
  );
  return { code: failed === 0 ? 0 : 1, stdout: hideHome(lines.join("\n"), home) };
}

/**
 * Asks for the key and gives the first line. The key is not on the screen: readline stops the echo
 * of the terminal, its own output goes nowhere, and only the prompt goes to `output`. Ctrl-C and
 * Ctrl-D close readline, so they give an empty line.
 */
export function promptKey(
  input: NodeJS.ReadableStream & { isTTY?: boolean } = process.stdin,
  output: NodeJS.WritableStream = process.stderr,
): Promise<string> {
  const hidden = new Writable({ write: (_chunk, _encoding, done) => done() });
  const rl = createInterface({ input, output: hidden, terminal: Boolean(input.isTTY) });
  // after createInterface: it stops the echo of the terminal, and a paste can come at once
  output.write(`Create a key at ${KEY_PAGE_URL}\nPaste the personal API key (it stays hidden): `);
  return new Promise((resolve) => {
    let line = "";
    rl.once("line", (text) => {
      line = text;
      rl.close();
    });
    rl.once("close", () => {
      output.write("\n");
      resolve(line);
    });
  });
}

/** Windows has no modes: only an ACL keeps other users out of a file. */
async function limitToUser(file: string, exec: Run): Promise<boolean> {
  const grant = `${userInfo().username}:F`;
  const r = await exec("icacls", [file, "/inheritance:r", "/grant:r", grant]).catch(
    () => undefined,
  );
  return r?.code === 0;
}

/**
 * Saves the key, and tells whether only the user can read it. The file is limited before the key
 * goes in, and the rename makes a replaced key appear whole or not at all.
 */
async function saveKey(
  file: string,
  key: string,
  platform: NodeJS.Platform,
  exec: Run,
): Promise<boolean> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(temp, "", { mode: 0o600, flag: "wx" });
    const limited = platform !== "win32" || (await limitToUser(temp, exec));
    await writeFile(temp, `${key}\n`);
    await rename(temp, file);
    return limited;
  } catch (e) {
    await rm(temp, { force: true });
    throw e;
  }
}

/**
 * Tests a key and saves it in the key file. A key that Garmin refuses is not saved. Any other failed
 * test saves it, because Garmin shows a key only one time. It runs on macOS, Linux and Windows.
 */
export async function setup(
  args: string[],
  config: Config,
  readKey: () => Promise<string> = promptKey,
  platform: NodeJS.Platform = process.platform,
  exec: Run = run,
  home = homedir(),
): Promise<CliResult> {
  const file = config.apiKeyFile;
  const shown = hideHome(file, home);
  if (args.length > (args[0] === "--force" ? 1 : 0)) {
    return {
      code: 1,
      stderr:
        "setup does not take the key as an argument: your shell history keeps it. Run setup without it and paste the key at the prompt. If it was your key, remove it from the history.",
    };
  }
  if (args[0] !== "--force" && existsSync(file)) {
    return {
      code: 1,
      stderr: `${shown} exists. To test its key, run doctor. To replace it, run setup --force: Garmin shows a key only one time, so the old key is lost.`,
    };
  }
  const key = (await readKey()).trim();
  if (!key) return { code: 1, stderr: "No key given. Nothing changed." };
  let untested: string | undefined;
  try {
    await new GarminApiClient(config, key).testKey();
  } catch (e) {
    if (e instanceof KeyRefusedError) {
      return { code: 1, stderr: `${e.message}\nThe key is not saved.` };
    }
    untested = (e as Error).message;
  }
  // shortcut: a file made in the milliseconds between this check and the rename is still replaced; link() would close it
  if (args[0] !== "--force" && existsSync(file)) {
    return {
      code: 1,
      stderr: `${shown} appeared while setup ran, and it stays as it is. The new key is not saved. To replace the file, run setup --force.`,
    };
  }
  let limited: boolean;
  try {
    limited = await saveKey(file, key, platform, exec);
  } catch (e) {
    const reason = hideHome((e as Error).message, home);
    return { code: 1, stderr: `Cannot save the key in ${shown}: ${reason}` };
  }
  // the real path: icacls does not read `~`, and this text is not for sharing
  const access = limited
    ? ", and only you can read it."
    : `. Other users may be able to read it. To limit it, run: icacls "${file}" /inheritance:r /grant:r "${userInfo().username}:F"`;
  if (untested !== undefined) {
    return {
      code: 1,
      stderr: `${hideHome(untested, home)}\nThe key is saved in ${shown}, but it is not tested${access}\nTo test it later, run: ${NPX} doctor`,
    };
  }
  const env = process.env;
  return {
    code: 0,
    stdout: [
      `The key works. It is saved in ${shown}${access}`,
      ...(env.GARMIN_PERSONAL_API_KEY?.trim()
        ? [
            "GARMIN_PERSONAL_API_KEY is set, and it has priority over this file. Remove it to use this key.",
          ]
        : []),
      ...(env.GARMIN_API_KEY_FILE
        ? ["Set GARMIN_API_KEY_FILE in your MCP client too, or the server does not find this file."]
        : []),
      "",
      "Now add the server to your MCP client:",
      "  command: npx",
      "  args:    -y @indaco/garmin-personal-mcp@latest",
      "The steps for each client: https://github.com/indaco/garmin-personal-mcp#2-connect-your-client",
      `To test the setup, run: ${NPX} doctor`,
    ].join("\n"),
  };
}

/** What the last run did: one line, and the pages that failed (with `shown` of the error) or have gaps. */
function lastRun(last: LastRun, shown = (error: string) => error): string[] {
  const at = localTime(last.at);
  const partial = last.partial ?? [];
  const gaps = partial.map((p) => `  ${p.path}: ${p.gaps}`);
  if (last.failed.length === 0) {
    return partial.length === 0
      ? [`${at}, every page updated`]
      : [`${at}, updated with gaps:`, ...gaps];
  }
  return [
    `${at}, failed:`,
    ...last.failed.map((f) => `  ${f.path}: ${shown(f.error)}`),
    ...(partial.length > 0 ? ["updated with gaps:", ...gaps] : []),
  ];
}

const header = (s: Status) => `Automatic refresh "${s.cron}" with ${s.scheduler}`;

const nextText = (s: Status) => s.next?.join(", ") || "n/a";

/** A successful last run is the last success, so that gets a line only after a failed run. */
const hasFailed = (s: Status) => (s.last?.failed.length ?? 0) > 0;

const missingJob = (s: Status) =>
  `The job is missing from ${s.scheduler} or cannot start (its Node.js or server file is gone). Run the schedule again.`;

/** The text of `schedule`. */
export function summary(s: Status): string {
  if (!s.scheduled) return "Automatic refresh is off.";
  const [first, ...details] = s.last ? lastRun(s.last) : [];
  return [
    header(s),
    `Next: ${nextText(s)}`,
    "Pages:",
    ...s.pages!.map((p) => `  ${p}`),
    ...(s.installed ? [] : [missingJob(s)]),
    ...(s.last ? [`Last run: ${first}`, ...details] : []),
    ...(hasFailed(s) ? [`Last success: ${localTime(s.lastOk)}`] : []),
    `Log: ${s.log}`,
  ]
    .map(plain)
    .join("\n");
}
