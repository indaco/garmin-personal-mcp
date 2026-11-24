#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { cli, styled } from "./cli";
import { loadConfig } from "./config";
import { AutoRefresh } from "./schedule";
import { createParts, createServer } from "./server";

const [command, ...args] = process.argv.slice(2);

if (command !== undefined) {
  const config = loadConfig();
  const r = await cli(command, args, new AutoRefresh(config), () => createParts(config).writer);
  if (r.stdout) {
    // a pipe and a file have no hasColors; in a terminal it is false with NO_COLOR
    const text = process.stdout.hasColors?.() ? styled(command, r.stdout) : r.stdout;
    process.stdout.write(`${text}\n`);
  }
  if (r.stderr) process.stderr.write(`${r.stderr}\n`);
  process.exitCode = r.code;
} else {
  // stdio transport: stdout carries MCP messages only, never write anything else to it.
  serveStdio(() => createServer(loadConfig()));
}
