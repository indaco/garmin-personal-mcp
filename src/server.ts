import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/server";
import { version } from "../package.json";
import { GarminApiClient } from "./api-client";
import type { Config } from "./config";
import { GarminDashboard, registerDashboard } from "./dashboard";
import { DashboardWriter, registerDashboardWriter } from "./dashboard-page";
import { registerPrompts } from "./prompts";
import { GarminTools, registerTools } from "./tools";

/** The page template; the build writes it next to dist/index.js. */
const template = () => readFile(new URL("./dashboard.html", import.meta.url), "utf8");

/** The garmin-personal MCP server with its 15 tools and 5 prompts. */
export function createServer(config: Config): McpServer {
  const server = new McpServer({ name: "garmin-personal", version });
  const api = new GarminApiClient(config);
  const tools = new GarminTools(api, config.dataDir);
  registerTools(server, tools);
  const dashboard = new GarminDashboard(tools, api, config.dataDir);
  registerDashboard(server, dashboard);
  registerDashboardWriter(
    server,
    new DashboardWriter((weeks) => dashboard.getDashboardData(weeks), config.dataDir, template),
  );
  registerPrompts(server);
  return server;
}
