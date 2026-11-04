import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { version } from "../package.json";
import { GarminApiClient, KEY_PAGE_URL, KeyRefusedError } from "./api-client";
import { type Config, loadConfig } from "./config";
import type { DashboardWriter } from "./dashboard-page";
import { LOG_DIR } from "./log";
import {
  type AutoRefresh,
  cronOf,
  type LastRun,
  refreshPages,
  type Run,
  run,
  type Status,
} from "./schedule";

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
  info                                show the version, the settings and where the files are
  doctor                              test the API key, the folders and the schedule
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

Show the version, the settings and where the files are.
It never shows the API key, and it does not connect to the network.

Flags:
  -h, --help  show this help`,
  doctor: `Usage: garmin-personal-mcp doctor

Test the setup, and tell how to fix what fails. It tests the key file, the API key with
a token request to Garmin, the data folder, the log folder and the schedule. With a schedule
and a key in the environment, it also tests the key in the key file.
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
  auto: Pick<AutoRefresh, "pages" | "status" | "set" | "off" | "saveRun" | "missed">,
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
    const schedule = await auto.status().then(
      (s) => summary(s).split("\n")[0],
      (e: Error) => `cannot read it: ${e.message}`,
    );
    return { code: 0, stdout: info(config, schedule) };
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

const found = (path: string) => `${path} (${existsSync(path) ? "found" : "missing"})`;

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
 * the network.
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
  const text = [
    `garmin-personal-mcp ${version}`,
    `Node.js:      ${process.version} on ${process.platform}`,
    `API host:     ${config.baseUrl}`,
    `API key:      ${keySource(env)}`,
    `Key file:     ${found(config.apiKeyFile)}`,
    `Data folder:  ${found(dataDir)}`,
    `  .FIT files: ${files(join(dataDir, "fit"), ".fit").length}`,
    `  pages:      ${pages.join(", ") || "none"}`,
    ...DATA_FILES.map((f) => `  ${f}: ${existsSync(join(dataDir, f)) ? "found" : "missing"}`),
    `Server log:   ${join(logs, "garmin-personal-mcp.log")}`,
    `Refresh log:  ${join(logs, "refresh.log")}`,
    `Schedule:     ${schedule}`,
  ].join("\n");
  return hideHome(text, home);
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

function scheduleCheck(status: Status | Error): Check {
  const name = "Schedule";
  if (status instanceof Error) {
    return { ok: false, name, text: `cannot read it: ${status.message}` };
  }
  if (!status.scheduled) return { ok: true, name, text: "off" };
  if (status.installed === false) {
    const text = `the job is missing from ${status.scheduler}. Set the schedule again.`;
    return { ok: false, name, text };
  }
  const failed = status.last?.failed ?? [];
  if (failed.length > 0) {
    const pages = failed.map((f) => `${f.path}: ${f.error}`).join(", ");
    const text = `the last run (${status.last!.at}) could not update ${pages}`;
    return { ok: false, name, text };
  }
  return { ok: true, name, text: summary(status).split("\n")[0] };
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
  auto: Pick<AutoRefresh, "status">,
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
): Promise<CliResult> {
  const status = await auto.status().catch((e: Error) => e);
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
    scheduleCheck(status),
  ];
  const failed = checks.filter((c) => !c.ok).length;
  const lines = checks.map((c) => `${c.ok ? "ok    " : "failed"}  ${c.name}: ${c.text}`);
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
