import { version } from "../package.json";
import type { DashboardWriter } from "./dashboard-page";
import { type AutoRefresh, cronOf, type LastRun, refreshPages, type Status } from "./schedule";

/** The commands for a terminal or a scheduler; any other start is the MCP server. */
export const COMMANDS = ["refresh", "schedule", "--version", "-v", "--help", "-h"];

export const HELP = `Usage: garmin-personal-mcp [command]

Without a command, the MCP server starts on stdin and stdout.

Commands:
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

export interface CliResult {
  code: number;
  stdout?: string;
  stderr?: string;
}

/**
 * Runs `--version` (`-v`), `--help` (`-h`), `refresh [page.html | --auto]` or
 * `schedule [daily|weekdays|weekly <day>] [HH:MM] | "<cron>" | off`, each with an optional page.
 * Not MCP, so the result may go to stdout.
 */
export async function cli(
  command: string,
  args: string[],
  auto: Pick<AutoRefresh, "pages" | "status" | "set" | "off" | "saveRun">,
  writer: () => Pick<DashboardWriter, "write">,
): Promise<CliResult> {
  if (command === "--version" || command === "-v") return { code: 0, stdout: version };
  if (command === "--help" || command === "-h") return { code: 0, stdout: HELP };
  try {
    if (command === "refresh") {
      const scheduled = args[0] === "--auto";
      const at = new Date().toISOString();
      const pages = scheduled ? await auto.pages() : [args[0] ?? ""];
      const { lines, failed } = await refreshPages(writer(), pages);
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
    ...(s.installed ? [] : [`The job is missing from ${s.scheduler}: run the schedule again.`]),
    ...(s.last ? [lastLine(s.last)] : []),
    `Log: ${s.log}`,
  ].join("\n");
}
