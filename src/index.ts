#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./config";
import { AutoRefresh, describe, parseSchedule, refreshPages, type Status } from "./schedule";
import { createParts, createServer } from "./server";

const [command, ...rest] = process.argv.slice(2);

/** Not MCP: refresh and schedule are commands for a terminal or a scheduler, so they may print. */
async function cli(): Promise<string> {
  const config = loadConfig();
  const auto = new AutoRefresh(config);
  if (command === "refresh") {
    const pages = rest[0] === "--auto" ? await auto.pages() : [rest[0] ?? ""];
    const { lines, failed } = await refreshPages(createParts(config).writer, pages);
    if (failed) process.exitCode = 1;
    return lines.join("\n");
  }
  // schedule [daily|weekdays|weekly <day>] [HH:MM] [page.html] | schedule off [page.html]
  const path = rest.at(-1)?.toLowerCase().endsWith(".html") ? rest.pop() : undefined;
  if (rest[0] === "off") return summary(await auto.off(path));
  if (rest.length === 0 && path === undefined) return summary(await auto.status());
  return summary(
    await auto.set({ ...(rest.length > 0 ? { schedule: parseSchedule(rest) } : {}), path }),
  );
}

function summary(s: Status): string {
  if (!s.scheduled) return "Automatic refresh is off.";
  return [
    `Automatic refresh ${describe(s.schedule!)} (${s.scheduler}):`,
    ...s.pages!.map((p) => `  ${p}`),
    ...(s.installed ? [] : [`The job is missing from ${s.scheduler}: run the schedule again.`]),
    `Log: ${s.log}`,
  ].join("\n");
}

if (command === "refresh" || command === "schedule") {
  cli().then(
    (out) => process.stdout.write(`${out}\n`),
    (e: Error) => {
      process.stderr.write(`${command} failed: ${e.message}\n`);
      process.exitCode = 1;
    },
  );
} else {
  // stdio transport: stdout carries MCP messages only, never write anything else to it.
  serveStdio(() => createServer(loadConfig()));
}
