import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { version } from "../package.json";
import { type Config, loadConfig } from "./config";
import type { DashboardWriter } from "./dashboard-page";
import { LOG_DIR } from "./log";
import { type AutoRefresh, cronOf, type LastRun, refreshPages, type Status } from "./schedule";

/** The commands for a terminal or a scheduler. Only a start without arguments is the MCP server. */
const COMMANDS = ["info", "refresh", "schedule", "--version", "-v", "--help", "-h"];

export const HELP = `Usage: garmin-personal-mcp [command]

Without a command, the MCP server starts on stdin and stdout.

Commands:
  info                                show the version, the settings and where the files are
  refresh [page.html]                 update a dashboard page
                                      (default: <data-dir>/garmin-dashboard.html)
  refresh --auto                      update the pages that have a schedule
  schedule                            show the schedule
  schedule [daily|weekdays|weekly <day>] [HH:MM] [page.html]
                                      update a page automatically
  schedule "<cron>" [page.html]       the same, with a cron expression
  schedule off [page.html]            stop the automatic update
  -v, --version                       show the version
  -h, --help                          show this help`;

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
 * An unknown command or flag gives the help on stderr and exit code 1.
 * Not MCP, so the result may go to stdout.
 */
export async function cli(
  command: string,
  args: string[],
  auto: Pick<AutoRefresh, "pages" | "status" | "set" | "off" | "saveRun" | "missed">,
  writer: () => Pick<DashboardWriter, "write">,
  sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
  config: Config = loadConfig(),
): Promise<CliResult> {
  if (!COMMANDS.includes(command)) return usage(`Unknown command: ${command}`);
  const flag = args.find(
    (a, i) => a.startsWith("-") && !(command === "refresh" && i === 0 && a === "--auto"),
  );
  if (flag) return usage(`Unknown flag: ${flag}`);
  if (command === "--version" || command === "-v") return { code: 0, stdout: version };
  if (command === "--help" || command === "-h") return { code: 0, stdout: HELP };
  if (command === "info") {
    // a damaged auto-refresh.json must not stop info: the Schedule line shows the error
    const schedule = await auto.status().then(
      (s) => summary(s).split("\n")[0],
      (e: Error) => `cannot read it: ${e.message}`,
    );
    return { code: 0, stdout: info(config, schedule) };
  }
  try {
    if (command === "refresh") {
      const scheduled = args[0] === "--auto";
      const at = new Date().toISOString();
      // the job starts at the run times and at login: nothing to do when no run time was missed
      if (scheduled && !(await auto.missed())) return { code: 0, stdout: `${at} no run due` };
      const pages = scheduled ? await auto.pages() : [args[0] ?? ""];
      const w = writer();
      const result = await refreshPages(w, pages);
      const { lines } = result;
      let { failed } = result;
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
        failed = [...failed.filter((f) => !offline.includes(f)), ...again.failed];
      }
      if (scheduled) await auto.saveRun({ at, failed });
      return { code: failed.length > 0 ? 1 : 0, stdout: lines.join("\n") };
    }
    const rest = [...args];
    const path = rest.at(-1)?.toLowerCase().endsWith(".html") ? rest.pop() : undefined;
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

/** The files in the data folder that `info` checks. guide/tools.md tells what each file has. */
const DATA_FILES = ["exercises.json", "dashboard-cache.json", "widgets.json", "auto-refresh.json"];

const found = (path: string) => `${path} (${existsSync(path) ? "found" : "missing"})`;

/** The names of the files in `dir` that end in `ext`. The list is empty when `dir` is missing. */
function files(dir: string, ext: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.toLowerCase().endsWith(ext));
  } catch {
    return [];
  }
}

/**
 * The text of `info`: the version, the settings and where the files are. It says where the API key
 * comes from, but it never shows the key. It does not connect to the network.
 */
export function info(
  config: Config,
  schedule: string,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  const { dataDir } = config;
  const pages = files(dataDir, ".html").toSorted();
  const logs = join(home, LOG_DIR);
  return [
    `garmin-personal-mcp ${version}`,
    `Node.js:      ${process.version} on ${process.platform}`,
    `API host:     ${config.baseUrl}`,
    `API key:      ${env.GARMIN_PERSONAL_API_KEY?.trim() ? "from GARMIN_PERSONAL_API_KEY" : "from the key file"}`,
    `Key file:     ${found(config.apiKeyFile)}`,
    `Data folder:  ${found(dataDir)}`,
    `  .FIT files: ${files(join(dataDir, "fit"), ".fit").length}`,
    `  pages:      ${pages.join(", ") || "none"}`,
    ...DATA_FILES.map((f) => `  ${f}: ${existsSync(join(dataDir, f)) ? "found" : "missing"}`),
    `Server log:   ${join(logs, "garmin-personal-mcp.log")}`,
    `Refresh log:  ${join(logs, "refresh.log")}`,
    `Schedule:     ${schedule}`,
  ].join("\n");
}

function lastLine(last: LastRun): string {
  if (last.failed.length === 0) return `Last run: ${last.at}, every page updated`;
  return [
    `Last run: ${last.at}, failed:`,
    ...last.failed.map((f) => `  ${f.path}: ${f.error}`),
  ].join("\n");
}

export function summary(s: Status): string {
  if (!s.scheduled) return "Automatic refresh is off.";
  return [
    `Automatic refresh "${s.cron}" with ${s.scheduler}, next: ${s.next!.join(", ")}`,
    "Pages:",
    ...s.pages!.map((p) => `  ${p}`),
    ...(s.installed
      ? []
      : [
          `The job is missing from ${s.scheduler} or cannot start (its Node.js or server file is gone): run the schedule again.`,
        ]),
    ...(s.last ? [lastLine(s.last)] : []),
    `Log: ${s.log}`,
  ].join("\n");
}
