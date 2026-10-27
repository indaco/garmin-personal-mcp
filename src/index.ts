#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { version } from "../package.json";

// stdio transport: stdout carries MCP messages only, never write anything else to it.
serveStdio(() => new McpServer({ name: "garmin-personal", version }));
