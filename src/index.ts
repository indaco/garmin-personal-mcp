#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { cli, COMMANDS } from "./cli";
import { loadConfig } from "./config";
import { AutoRefresh } from "./schedule";
import { createParts, createServer } from "./server";

const [command = "", ...args] = process.argv.slice(2);

if (COMMANDS.includes(command)) {
  const config = loadConfig();
  const r = await cli(command, args, new AutoRefresh(config), () => createParts(config).writer);
  if (r.stdout) process.stdout.write(`${r.stdout}\n`);
  if (r.stderr) process.stderr.write(`${r.stderr}\n`);
  process.exitCode = r.code;
} else {
  // stdio transport: stdout carries MCP messages only, never write anything else to it.
  serveStdio(() => createServer(loadConfig()));
}
