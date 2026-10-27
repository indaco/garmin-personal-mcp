#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./config";
import { createServer } from "./server";

// stdio transport: stdout carries MCP messages only, never write anything else to it.
serveStdio(() => createServer(loadConfig()));
