import type { DashboardWriter } from "./dashboard-page";
import { type AutoRefresh, cronOf, refreshPages, type Status } from "./schedule";

/** The commands for a terminal or a scheduler; any other start is the MCP server. */
export const COMMANDS = ["refresh", "schedule"];

export interface CliResult {
  code: number;
  stdout?: string;
  stderr?: string;
}

/**
 * Runs `refresh [page.html | --auto]` or
 * `schedule [daily|weekdays|weekly <day>] [HH:MM] | "<cron>" | off`, each with an optional page.
 * Not MCP, so the result may go to stdout.
 */
export async function cli(
  command: string,
  args: string[],
  auto: Pick<AutoRefresh, "pages" | "status" | "set" | "off">,
  writer: () => Pick<DashboardWriter, "write">,
): Promise<CliResult> {
  try {
    if (command === "refresh") {
      const pages = args[0] === "--auto" ? await auto.pages() : [args[0] ?? ""];
      const { lines, failed } = await refreshPages(writer(), pages);
      return { code: failed ? 1 : 0, stdout: lines.join("\n") };
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

export function summary(s: Status): string {
  if (!s.scheduled) return "Automatic refresh is off.";
  return [
    `Automatic refresh "${s.cron}" with ${s.scheduler}, next: ${s.next!.join(", ")}`,
    "Pages:",
    ...s.pages!.map((p) => `  ${p}`),
    ...(s.installed ? [] : [`The job is missing from ${s.scheduler}: run the schedule again.`]),
    `Log: ${s.log}`,
  ].join("\n");
}
